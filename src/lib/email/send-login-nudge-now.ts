import * as React from "react";
import { render } from "@react-email/components";
import { sendLovableEmail } from "@lovable.dev/email-js";
import { TEMPLATES } from "@/lib/email-templates/registry";

type SupabaseAdminClient = typeof import("@/integrations/supabase/client.server").supabaseAdmin;

const SITE_NAME = "Contractor Circle";
const VERIFIED_SENDER_DOMAIN = "notify.mail.alpcontractorcircle.com";
const TEMPLATE_NAME = "magic-link";

export type DirectLoginNudgeResult =
  | { status: "sent"; messageId: string }
  | { status: "suppressed"; messageId: string; reason: string }
  | { status: "failed"; messageId: string; reason: string };

function appOrigin(): string {
  return (
    process.env.PUBLIC_APP_ORIGIN ||
    process.env.APP_ORIGIN ||
    "https://app.alpcontractorcircle.com"
  ).replace(/\/$/, "");
}

function redactEmail(email: string): string {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return "***";
  return `${localPart[0]}***@${domain}`;
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function loginEmailSender(): { from: string; senderDomain: string } {
  const senderDomain = VERIFIED_SENDER_DOMAIN;

  return {
    from: `${SITE_NAME} <no-reply@${senderDomain}>`,
    senderDomain,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function ensureUnsubscribeToken(
  supabaseAdmin: SupabaseAdminClient,
  emailLower: string,
): Promise<string | null> {
  const { data: existing } = await supabaseAdmin
    .from("email_unsubscribe_tokens")
    .select("token,used_at")
    .eq("email", emailLower)
    .maybeSingle();

  if (existing && !existing.used_at) return existing.token;
  if (existing && existing.used_at) return null;

  const newToken = generateToken();
  await supabaseAdmin
    .from("email_unsubscribe_tokens")
    .upsert(
      { token: newToken, email: emailLower },
      { onConflict: "email", ignoreDuplicates: true },
    );

  const { data: stored } = await supabaseAdmin
    .from("email_unsubscribe_tokens")
    .select("token")
    .eq("email", emailLower)
    .maybeSingle();

  return stored?.token ?? null;
}

export async function sendLoginNudgeNow({
  supabaseAdmin,
  email,
  firstName,
  confirmationUrl,
  idempotencyKey,
  channel,
  siteUrl = appOrigin(),
}: {
  supabaseAdmin: SupabaseAdminClient;
  email: string;
  firstName: string | null;
  confirmationUrl: string;
  idempotencyKey: string;
  channel: "public_magic_link" | "admin_people_signin";
  siteUrl?: string;
}): Promise<DirectLoginNudgeResult> {
  const apiKey = process.env.LOVABLE_API_KEY;
  const emailLower = email.toLowerCase();
  const messageId = crypto.randomUUID();

  const { data: suppressed } = await supabaseAdmin
    .from("suppressed_emails")
    .select("email")
    .eq("email", emailLower)
    .maybeSingle();

  if (suppressed) {
    const reason = "suppressed_email";
    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: TEMPLATE_NAME,
      recipient_email: email,
      status: "suppressed",
      error_message: reason,
      metadata: {
        idempotency_key: idempotencyKey,
        channel,
        reason,
        send_method: "direct_lovable",
      },
    });
    return { status: "suppressed", messageId, reason };
  }

  const unsubscribeToken = await ensureUnsubscribeToken(supabaseAdmin, emailLower);
  if (!unsubscribeToken) {
    const reason = "unsubscribe_token_used";
    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: TEMPLATE_NAME,
      recipient_email: email,
      status: "suppressed",
      error_message: "Unsubscribe token used",
      metadata: {
        idempotency_key: idempotencyKey,
        channel,
        reason,
        send_method: "direct_lovable",
      },
    });
    return { status: "suppressed", messageId, reason };
  }

  const entry = TEMPLATES[TEMPLATE_NAME];
  if (!entry || !apiKey) {
    const reason = !entry ? "template_missing" : "lovable_api_key_missing";
    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: TEMPLATE_NAME,
      recipient_email: email,
      status: "failed",
      error_message: !entry ? "Template not registered" : "LOVABLE_API_KEY missing",
      metadata: {
        idempotency_key: idempotencyKey,
        channel,
        reason,
        send_method: "direct_lovable",
      },
    });
    return { status: "failed", messageId, reason };
  }

  const props = {
    firstName: firstName ?? undefined,
    siteName: SITE_NAME,
    siteUrl,
    confirmationUrl,
  };
  const element = React.createElement(entry.component, props);
  const html = await render(element);
  const plainText = await render(element, { plainText: true });
  const subject = typeof entry.subject === "function" ? entry.subject(props) : entry.subject;
  const sender = loginEmailSender();

  await supabaseAdmin.from("email_send_log").insert({
    message_id: messageId,
    template_name: TEMPLATE_NAME,
    recipient_email: email,
    status: "pending",
    metadata: {
      idempotency_key: idempotencyKey,
      channel,
      send_method: "direct_lovable",
      sender_domain: sender.senderDomain,
    },
  });

  try {
    await withTimeout(
      sendLovableEmail(
        {
          to: email,
          from: sender.from,
          sender_domain: sender.senderDomain,
          subject,
          html,
          text: plainText,
          purpose: "transactional",
          label: TEMPLATE_NAME,
          idempotency_key: idempotencyKey,
          unsubscribe_token: unsubscribeToken,
          message_id: messageId,
        },
        { apiKey, sendUrl: process.env.LOVABLE_SEND_URL },
      ),
      12_000,
      "Magic-link email send",
    );

    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: TEMPLATE_NAME,
      recipient_email: email,
      status: "sent",
      metadata: {
        idempotency_key: idempotencyKey,
        channel,
        send_method: "direct_lovable",
        sender_domain: sender.senderDomain,
      },
    });

    return { status: "sent", messageId };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: TEMPLATE_NAME,
      recipient_email: email,
      status: "failed",
      error_message: errorMessage.slice(0, 1000),
      metadata: {
        idempotency_key: idempotencyKey,
        channel,
        send_method: "direct_lovable",
        sender_domain: sender.senderDomain,
      },
    });
    console.error("[magic-link] direct send failed", {
      email: redactEmail(email),
      channel,
      error: errorMessage,
    });
    return { status: "failed", messageId, reason: errorMessage.slice(0, 1000) };
  }
}
