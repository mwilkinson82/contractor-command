// Circle welcome send-state helpers. The webhook enqueues; the queue
// processor stamps subscriptions.welcome_sent_at only after a successful
// hub-mailer send. Do not treat enqueue as delivery.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const CIRCLE_WELCOME_TEMPLATE = "circle-welcome";

type WelcomeClient = SupabaseClient<Database>;

export function circleWelcomeIdempotencyKey(stripeSubscriptionId: string): string {
  return `${CIRCLE_WELCOME_TEMPLATE}-${stripeSubscriptionId}`;
}

export function stripeSubscriptionIdFromCircleWelcomeKey(
  key: string | null | undefined,
): string | null {
  if (!key) return null;
  const prefix = `${CIRCLE_WELCOME_TEMPLATE}-`;
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  if (!rest || rest.startsWith("backfill-") || rest.startsWith("admin-")) return null;
  return rest;
}

export function emailSendLogMetadata(opts: {
  idempotencyKey?: string | null;
  queue?: string | null;
}): Record<string, string> | null {
  const metadata: Record<string, string> = {};
  if (opts.idempotencyKey) metadata.idempotency_key = opts.idempotencyKey;
  if (opts.queue) metadata.queue = opts.queue;
  return Object.keys(metadata).length ? metadata : null;
}

export function isUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  return /duplicate key|unique constraint/i.test(error.message ?? "");
}

export async function findCircleWelcomeLog(
  supabase: WelcomeClient,
  idempotencyKey: string,
  statuses: string[] = ["pending", "sent"],
): Promise<{ id: string; status: string; created_at?: string } | null> {
  const { data, error } = await supabase
    .from("email_send_log")
    .select("id,status,created_at")
    .eq("template_name", CIRCLE_WELCOME_TEMPLATE)
    .filter("metadata->>idempotency_key", "eq", idempotencyKey)
    .in("status", statuses)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("findCircleWelcomeLog failed", { idempotencyKey, error });
    return null;
  }
  if (!data?.id) return null;
  return { id: data.id, status: data.status ?? "", created_at: data.created_at };
}

export async function markCircleWelcomeSent(opts: {
  supabase: WelcomeClient;
  recipientEmail: string;
  idempotencyKey?: string | null;
  sentAt?: string;
}): Promise<void> {
  const sentAt = opts.sentAt ?? new Date().toISOString();
  const subId = stripeSubscriptionIdFromCircleWelcomeKey(opts.idempotencyKey);
  if (subId) {
    const { error } = await opts.supabase
      .from("subscriptions")
      .update({ welcome_sent_at: sentAt, updated_at: sentAt })
      .eq("stripe_subscription_id", subId)
      .is("welcome_sent_at", null);
    if (error) {
      console.error("Failed to stamp welcome_sent_at by subscription", { subId, error });
    }
    return;
  }

  const email = opts.recipientEmail.trim().toLowerCase();
  if (!email) return;
  const { error } = await opts.supabase
    .from("subscriptions")
    .update({ welcome_sent_at: sentAt, updated_at: sentAt })
    .ilike("email", email)
    .eq("tier", "circle")
    .is("welcome_sent_at", null);
  if (error) {
    console.error("Failed to stamp welcome_sent_at by email", { email, error });
  }
}
