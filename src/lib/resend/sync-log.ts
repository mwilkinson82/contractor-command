// Append-only observability for Resend contact syncing.
// Writes NEVER throw: a logging failure must not break capture or a webhook.

export const RESEND_SYNC_SOURCES = ["stripe_webhook", "public_capture", "backfill"] as const;
export type ResendSyncSource = (typeof RESEND_SYNC_SOURCES)[number];
export type ResendSyncStatus = "ok" | "skip" | "fail";

export type ResendSyncLogEntry = {
  email: string;
  source: ResendSyncSource;
  segment?: string | null;
  status: ResendSyncStatus;
  reason?: string | null;
  stripeSubscriptionId?: string | null;
};

function truncate(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export async function logResendSync(entry: ResendSyncLogEntry): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("resend_sync_log").insert({
      email: entry.email.trim().toLowerCase(),
      source: entry.source,
      segment: truncate(entry.segment, 100),
      status: entry.status,
      reason: truncate(entry.reason, 1000),
      stripe_subscription_id: truncate(entry.stripeSubscriptionId, 255),
    });
    if (error) {
      console.error("resend_sync_log insert failed", { email: entry.email, error });
    }
  } catch (err) {
    console.error("resend_sync_log insert threw", { email: entry.email, err });
  }
}
