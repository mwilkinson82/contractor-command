import { sendLovableEmail, type EmailSendRequest } from "@lovable.dev/email-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

const MAX_RETRIES = 5;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_SEND_DELAY_MS = 200;
const DEFAULT_AUTH_TTL_MINUTES = 15;
const DEFAULT_TRANSACTIONAL_TTL_MINUTES = 60;
const EMAIL_QUEUES = ["auth_emails", "transactional_emails"] as const;

type QueueName = (typeof EMAIL_QUEUES)[number];
type AppSupabaseClient = SupabaseClient<Database>;
type JsonObject = { [key: string]: Json | undefined };
type EmailQueueRow = Database["public"]["Functions"]["read_email_batch"]["Returns"][number] & {
  enqueued_at?: string | null;
};
type EmailQueueMessage = Omit<EmailQueueRow, "message"> & {
  message: JsonObject;
};

export type ProcessEmailQueueResult = {
  processed: number;
  read: number;
  failed: number;
  movedToDlq: number;
  suppressed: number;
  skippedDuplicates: number;
  cycles: number;
  stopped?: "rate_limited" | "forbidden";
};

function isRateLimited(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    return (error as { status: number }).status === 429;
  }
  return error instanceof Error && error.message.includes("429");
}

function isForbidden(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    return (error as { status: number }).status === 403;
  }
  return error instanceof Error && error.message.includes("403");
}

function getErrorStatus(error: unknown): number | null {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : null;
  }
  if (error instanceof Error) {
    const match = error.message.match(/\b([45]\d\d)\b/);
    return match ? Number(match[1]) : null;
  }
  return null;
}

function isNonRetryableProviderError(error: unknown): boolean {
  const status = getErrorStatus(error);
  return Boolean(status && status >= 400 && status < 500 && status !== 403 && status !== 429);
}

function getRetryAfterSeconds(error: unknown): number {
  if (error && typeof error === "object" && "retryAfterSeconds" in error) {
    return (error as { retryAfterSeconds: number | null }).retryAfterSeconds ?? 60;
  }
  return 60;
}

function isJsonObject(value: Json): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeQueueMessages(messages: EmailQueueRow[] | null | undefined): EmailQueueMessage[] {
  return (messages ?? []).flatMap((msg) =>
    isJsonObject(msg.message) ? [{ ...msg, message: msg.message }] : [],
  );
}

function getString(payload: JsonObject, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getBoolean(payload: JsonObject, key: string): boolean | undefined {
  const value = payload[key];
  return typeof value === "boolean" ? value : undefined;
}

function buildSendRequest(payload: JsonObject): EmailSendRequest | null {
  const to = getString(payload, "to");
  const from = getString(payload, "from");
  const subject = getString(payload, "subject");
  const html = getString(payload, "html");
  const text = getString(payload, "text");

  if (!to || !from || !subject || !html || !text) {
    return null;
  }

  return {
    run_id: getString(payload, "run_id"),
    to,
    from,
    sender_domain: getString(payload, "sender_domain"),
    subject,
    html,
    text,
    purpose: getString(payload, "purpose"),
    reply_to: getString(payload, "reply_to"),
    identity_id: getString(payload, "identity_id"),
    test_mode: getBoolean(payload, "test_mode"),
    label: getString(payload, "label"),
    idempotency_key: getString(payload, "idempotency_key"),
    unsubscribe_token: getString(payload, "unsubscribe_token"),
    message_id: getString(payload, "message_id"),
  };
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function deleteQueueMessage(
  supabase: AppSupabaseClient,
  queue: string,
  msg: EmailQueueMessage,
): Promise<void> {
  const { error } = await supabase.rpc("delete_email", {
    queue_name: queue,
    message_id: msg.msg_id,
  });
  if (error) {
    console.error("Failed to delete message from queue", {
      queue,
      msg_id: msg.msg_id,
      error,
    });
  }
}

type TokenRepairResult =
  | { status: "ready"; token: string }
  | { status: "suppressed"; reason: string }
  | { status: "failed"; reason: string };

async function ensureUnsubscribeTokenForQueue(
  supabase: AppSupabaseClient,
  email: string,
): Promise<TokenRepairResult> {
  const emailLower = email.toLowerCase();

  const { data: suppressed, error: suppressionError } = await supabase
    .from("suppressed_emails")
    .select("email")
    .eq("email", emailLower)
    .maybeSingle();
  if (suppressionError) {
    return { status: "failed", reason: "Failed to verify suppression status" };
  }
  if (suppressed) {
    return { status: "suppressed", reason: "email_suppressed" };
  }

  const { data: existing, error: lookupError } = await supabase
    .from("email_unsubscribe_tokens")
    .select("token,used_at")
    .eq("email", emailLower)
    .maybeSingle();
  if (lookupError) {
    return { status: "failed", reason: "Failed to look up unsubscribe token" };
  }
  if (existing && !existing.used_at) {
    return { status: "ready", token: existing.token };
  }
  if (existing?.used_at) {
    return { status: "suppressed", reason: "unsubscribe_token_used" };
  }

  const newToken = generateToken();
  const { error: upsertError } = await supabase
    .from("email_unsubscribe_tokens")
    .upsert(
      { token: newToken, email: emailLower },
      { onConflict: "email", ignoreDuplicates: true },
    );
  if (upsertError) {
    return { status: "failed", reason: "Failed to create unsubscribe token" };
  }

  const { data: stored, error: reReadError } = await supabase
    .from("email_unsubscribe_tokens")
    .select("token,used_at")
    .eq("email", emailLower)
    .maybeSingle();
  if (reReadError || !stored) {
    return { status: "failed", reason: "Failed to confirm unsubscribe token" };
  }
  if (stored.used_at) {
    return { status: "suppressed", reason: "unsubscribe_token_used" };
  }
  return { status: "ready", token: stored.token };
}

async function suppressQueueMessage(
  supabase: AppSupabaseClient,
  queue: string,
  msg: EmailQueueMessage,
  reason: string,
): Promise<void> {
  const payload = msg.message;
  await supabase.from("email_send_log").insert({
    message_id: getString(payload, "message_id"),
    template_name: getString(payload, "label") ?? queue,
    recipient_email: getString(payload, "to") ?? "unknown",
    status: "suppressed",
    error_message: reason,
    metadata: { queue, reason },
  });
  await deleteQueueMessage(supabase, queue, msg);
}

async function prepareSendRequest({
  supabase,
  queue,
  msg,
  sendRequest,
}: {
  supabase: AppSupabaseClient;
  queue: string;
  msg: EmailQueueMessage;
  sendRequest: EmailSendRequest;
}): Promise<
  | { status: "ready"; sendRequest: EmailSendRequest }
  | { status: "suppressed"; reason: string }
  | { status: "failed"; reason: string }
> {
  if (sendRequest.unsubscribe_token || sendRequest.purpose !== "transactional") {
    return { status: "ready", sendRequest };
  }

  const tokenRepair = await ensureUnsubscribeTokenForQueue(supabase, sendRequest.to);
  if (tokenRepair.status === "ready") {
    return {
      status: "ready",
      sendRequest: {
        ...sendRequest,
        unsubscribe_token: tokenRepair.token,
      },
    };
  }

  if (tokenRepair.status === "suppressed") {
    await suppressQueueMessage(supabase, queue, msg, tokenRepair.reason);
    return { status: "suppressed", reason: tokenRepair.reason };
  }

  return { status: "failed", reason: tokenRepair.reason };
}

async function moveToDlq(
  supabase: AppSupabaseClient,
  queue: string,
  msg: EmailQueueMessage,
  reason: string,
  reasonCode = "queue_processing_error",
): Promise<void> {
  const payload = msg.message;
  await supabase.from("email_send_log").insert({
    message_id: getString(payload, "message_id"),
    template_name: getString(payload, "label") ?? queue,
    recipient_email: getString(payload, "to") ?? "unknown",
    status: "dlq",
    error_message: reason,
    metadata: { queue, reason: reasonCode },
  });
  const { error } = await supabase.rpc("move_to_dlq", {
    source_queue: queue,
    dlq_name: `${queue}_dlq`,
    message_id: msg.msg_id,
    payload,
  });
  if (error) {
    console.error("Failed to move message to DLQ", {
      queue,
      msg_id: msg.msg_id,
      reason,
      error,
    });
  }
}

async function processCycle({
  supabase,
  apiKey,
  sendUrl,
}: {
  supabase: AppSupabaseClient;
  apiKey: string;
  sendUrl?: string;
}): Promise<ProcessEmailQueueResult> {
  const result: ProcessEmailQueueResult = {
    processed: 0,
    read: 0,
    failed: 0,
    movedToDlq: 0,
    suppressed: 0,
    skippedDuplicates: 0,
    cycles: 1,
  };

  const { data: state } = await supabase
    .from("email_send_state")
    .select(
      "retry_after_until, batch_size, send_delay_ms, auth_email_ttl_minutes, transactional_email_ttl_minutes",
    )
    .single();

  if (state?.retry_after_until && new Date(state.retry_after_until) > new Date()) {
    return { ...result, stopped: "rate_limited" };
  }

  const batchSize = state?.batch_size ?? DEFAULT_BATCH_SIZE;
  const sendDelayMs = state?.send_delay_ms ?? DEFAULT_SEND_DELAY_MS;
  const ttlMinutes: Record<QueueName, number> = {
    auth_emails: state?.auth_email_ttl_minutes ?? DEFAULT_AUTH_TTL_MINUTES,
    transactional_emails:
      state?.transactional_email_ttl_minutes ?? DEFAULT_TRANSACTIONAL_TTL_MINUTES,
  };

  for (const queue of EMAIL_QUEUES) {
    const { data: queueRows, error: readError } = await supabase.rpc("read_email_batch", {
      queue_name: queue,
      batch_size: batchSize,
      vt: 30,
    });

    if (readError) {
      console.error("Failed to read email batch", { queue, error: readError });
      continue;
    }

    const messages = normalizeQueueMessages(queueRows);
    if (!messages.length) continue;
    result.read += messages.length;

    const messageIds = Array.from(
      new Set(
        messages
          .map((msg) => getString(msg.message, "message_id") ?? null)
          .filter((id: string | null): id is string => Boolean(id)),
      ),
    );
    const failedAttemptsByMessageId = new Map<string, number>();
    if (messageIds.length > 0) {
      const { data: failedRows, error: failedRowsError } = await supabase
        .from("email_send_log")
        .select("message_id")
        .in("message_id", messageIds)
        .eq("status", "failed");

      if (failedRowsError) {
        console.error("Failed to load failed-attempt counters", {
          queue,
          error: failedRowsError,
        });
      } else {
        for (const row of failedRows ?? []) {
          const messageId = row?.message_id;
          if (typeof messageId !== "string" || !messageId) continue;
          failedAttemptsByMessageId.set(
            messageId,
            (failedAttemptsByMessageId.get(messageId) ?? 0) + 1,
          );
        }
      }
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const payload = msg.message;
      const messageId = getString(payload, "message_id");
      const label = getString(payload, "label") ?? queue;
      const recipientEmail = getString(payload, "to") ?? "unknown";
      const failedAttempts = messageId
        ? (failedAttemptsByMessageId.get(messageId) ?? 0)
        : (msg.read_ct ?? 0);

      const queuedAt = getString(payload, "queued_at") ?? msg.enqueued_at;
      if (queuedAt) {
        const ageMs = Date.now() - new Date(queuedAt).getTime();
        const maxAgeMs = ttlMinutes[queue] * 60 * 1000;
        if (ageMs > maxAgeMs) {
          console.warn("Email expired (TTL exceeded)", {
            queue,
            msg_id: msg.msg_id,
            queued_at: queuedAt,
            ttl_minutes: ttlMinutes[queue],
          });
          await moveToDlq(
            supabase,
            queue,
            msg,
            `TTL exceeded (${ttlMinutes[queue]} minutes)`,
            "ttl_exceeded",
          );
          result.movedToDlq += 1;
          continue;
        }
      }

      if (failedAttempts >= MAX_RETRIES) {
        await moveToDlq(
          supabase,
          queue,
          msg,
          `Max retries (${MAX_RETRIES}) exceeded (attempted ${failedAttempts} times)`,
          "max_retries_exceeded",
        );
        result.movedToDlq += 1;
        continue;
      }

      if (messageId) {
        const { data: alreadySent } = await supabase
          .from("email_send_log")
          .select("id")
          .eq("message_id", messageId)
          .eq("status", "sent")
          .maybeSingle();

        if (alreadySent) {
          console.warn("Skipping duplicate send (already sent)", {
            queue,
            msg_id: msg.msg_id,
            message_id: messageId,
          });
          await deleteQueueMessage(supabase, queue, msg);
          result.skippedDuplicates += 1;
          continue;
        }
      }

      const sendRequest = buildSendRequest(payload);
      if (!sendRequest) {
        await moveToDlq(
          supabase,
          queue,
          msg,
          "Missing required email payload fields",
          "missing_required_fields",
        );
        result.movedToDlq += 1;
        continue;
      }

      const prepared = await prepareSendRequest({ supabase, queue, msg, sendRequest });
      if (prepared.status === "suppressed") {
        result.suppressed += 1;
        continue;
      }
      if (prepared.status === "failed") {
        await moveToDlq(supabase, queue, msg, prepared.reason, "unsubscribe_token_repair_failed");
        result.movedToDlq += 1;
        continue;
      }

      try {
        await sendLovableEmail(prepared.sendRequest, { apiKey, sendUrl });

        await supabase.from("email_send_log").insert({
          message_id: messageId,
          template_name: label,
          recipient_email: recipientEmail,
          status: "sent",
        });

        await deleteQueueMessage(supabase, queue, msg);
        result.processed += 1;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.failed += 1;
        console.error("Email send failed", {
          queue,
          msg_id: msg.msg_id,
          read_ct: msg.read_ct,
          failed_attempts: failedAttempts,
          error: errorMsg,
        });

        if (isRateLimited(error)) {
          await supabase.from("email_send_log").insert({
            message_id: messageId,
            template_name: label,
            recipient_email: recipientEmail,
            status: "failed",
            error_message: errorMsg.slice(0, 1000),
          });

          const retryAfterSecs = getRetryAfterSeconds(error);
          await supabase
            .from("email_send_state")
            .update({
              retry_after_until: new Date(Date.now() + retryAfterSecs * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", 1);

          return { ...result, stopped: "rate_limited" };
        }

        if (isForbidden(error)) {
          await moveToDlq(supabase, queue, msg, errorMsg.slice(0, 1000), "provider_forbidden");
          result.movedToDlq += 1;
          return { ...result, stopped: "forbidden" };
        }

        if (isNonRetryableProviderError(error)) {
          await moveToDlq(supabase, queue, msg, errorMsg.slice(0, 1000), "provider_rejected");
          result.movedToDlq += 1;
          continue;
        }

        await supabase.from("email_send_log").insert({
          message_id: messageId,
          template_name: label,
          recipient_email: recipientEmail,
          status: "failed",
          error_message: errorMsg.slice(0, 1000),
        });
        if (messageId) {
          failedAttemptsByMessageId.set(messageId, failedAttempts + 1);
        }
      }

      if (i < messages.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, sendDelayMs));
      }
    }
  }

  return result;
}

export async function processEmailQueues({
  supabase,
  apiKey,
  sendUrl,
  maxCycles = 1,
}: {
  supabase: AppSupabaseClient;
  apiKey: string;
  sendUrl?: string;
  maxCycles?: number;
}): Promise<ProcessEmailQueueResult> {
  const aggregate: ProcessEmailQueueResult = {
    processed: 0,
    read: 0,
    failed: 0,
    movedToDlq: 0,
    suppressed: 0,
    skippedDuplicates: 0,
    cycles: 0,
  };

  for (let cycle = 0; cycle < maxCycles; cycle++) {
    const result = await processCycle({ supabase, apiKey, sendUrl });
    aggregate.processed += result.processed;
    aggregate.read += result.read;
    aggregate.failed += result.failed;
    aggregate.movedToDlq += result.movedToDlq;
    aggregate.suppressed += result.suppressed;
    aggregate.skippedDuplicates += result.skippedDuplicates;
    aggregate.cycles += 1;

    if (result.stopped) {
      aggregate.stopped = result.stopped;
      break;
    }

    if (
      result.read === 0 ||
      result.processed + result.movedToDlq + result.skippedDuplicates === 0
    ) {
      break;
    }
  }

  return aggregate;
}
