import type { CaptureSegment } from "@/lib/resend/segments";

export const RESEND_SYNC_STATUSES = ["ok", "skipped", "failed"] as const;
export type ResendSyncStatus = (typeof RESEND_SYNC_STATUSES)[number];

export type ResendSyncLogRow = {
  email: string;
  segment: string;
  source: string;
  status: ResendSyncStatus;
  contact_id?: string | null;
  error_message?: string | null;
  metadata?: Record<string, unknown>;
};

export type ResendSyncLogClient = {
  from: (table: "resend_sync_log") => {
    insert: (
      row: ResendSyncLogRow,
    ) => PromiseLike<{ error: { message: string } | null }>;
  };
};

export type PersistResendSyncLogInput = {
  email: string;
  segment: CaptureSegment | string;
  source: string;
  status: ResendSyncStatus;
  contactId?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
};

export function resendSyncLogRow(input: PersistResendSyncLogInput): ResendSyncLogRow {
  return {
    email: input.email.trim().toLowerCase(),
    segment: input.segment,
    source: input.source,
    status: input.status,
    contact_id: input.contactId ?? null,
    error_message: input.errorMessage?.slice(0, 2000) ?? null,
    metadata: input.metadata ?? {},
  };
}

async function defaultLogClient(): Promise<ResendSyncLogClient | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return supabaseAdmin;
  } catch (err) {
    console.error("resend_sync_log: could not load supabase admin", err);
    return null;
  }
}

/**
 * Persist a Resend contact-sync outcome. Never throws — logging must not
 * fail a grant, webhook, or capture.
 */
export async function persistResendSyncLog(
  input: PersistResendSyncLogInput,
  opts?: { supabase?: ResendSyncLogClient | null },
): Promise<void> {
  try {
    const supabase = opts?.supabase ?? (await defaultLogClient());
    if (!supabase) return;
    const { error } = await supabase.from("resend_sync_log").insert(resendSyncLogRow(input));
    if (error) {
      console.error("resend_sync_log insert failed", { email: input.email, error });
    }
  } catch (err) {
    console.error("resend_sync_log persist threw", { email: input.email, err });
  }
}
