export const RESEND_SYNC_SOURCES = ["stripe_webhook", "public_capture", "backfill"] as const;
export type ResendSyncSource = (typeof RESEND_SYNC_SOURCES)[number];

export const RESEND_SYNC_STATUSES = ["ok", "skip", "fail"] as const;
export type ResendSyncStatus = (typeof RESEND_SYNC_STATUSES)[number];

export type ResendSyncLogInput = {
  email: string;
  source: ResendSyncSource;
  segment: string;
  status: ResendSyncStatus;
  reason?: string | null;
  stripe_subscription_id?: string | null;
};

export type PersistResendSyncLog = (row: ResendSyncLogInput) => Promise<void>;

export function normalizeResendSyncLog(input: ResendSyncLogInput): ResendSyncLogInput {
  const reason = input.reason?.trim();
  const stripeSubscriptionId = input.stripe_subscription_id?.trim();
  return {
    email: input.email.trim().toLowerCase(),
    source: input.source,
    segment: input.segment,
    status: input.status,
    reason: reason ? reason.slice(0, 2000) : null,
    stripe_subscription_id: stripeSubscriptionId || null,
  };
}

/**
 * Append a Resend contact-sync outcome. Never throws — logging must not
 * break Stripe webhook success or the public capture response path.
 */
export async function persistResendSyncLog(input: ResendSyncLogInput): Promise<void> {
  const row = normalizeResendSyncLog(input);
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("resend_sync_log").insert({
      email: row.email,
      source: row.source,
      segment: row.segment,
      status: row.status,
      reason: row.reason,
      stripe_subscription_id: row.stripe_subscription_id,
    });
    if (error) {
      console.error("Failed to persist resend_sync_log", {
        email: row.email,
        status: row.status,
        error,
      });
    }
  } catch (err) {
    console.error("Failed to persist resend_sync_log", {
      email: row.email,
      status: row.status,
      err,
    });
  }
}
