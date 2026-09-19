import {
  syncCompedResendContact,
  type SyncResendContactResult,
} from "@/lib/resend/capture";

export type SetUserCompedInput = {
  subscriptionId: string | null;
  userId: string | null;
  email: string;
  fullName?: string | null;
  isComped: boolean;
};

export type CompSubscriptionClient = {
  from: (table: "subscriptions") => {
    update: (row: Record<string, unknown>) => {
      eq: (column: string, value: string) => PromiseLike<{ error: { message: string } | null }>;
    };
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
  };
};

export type SyncCompedResend = (
  input: {
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    source?: "admin_comp" | "marshall_comp";
  },
) => Promise<SyncResendContactResult>;

export type ApplyUserCompedDeps = {
  supabase: CompSubscriptionClient;
  syncResend?: SyncCompedResend;
};

export type ApplyUserCompedResult = {
  ok: true;
  resend: SyncResendContactResult | { skipped: true; reason: "uncomp" };
};

export function splitPersonName(name?: string | null): {
  firstName: string | null;
  lastName: string | null;
} {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { firstName: null, lastName: null };
  const parts = trimmed.split(/\s+/);
  return { firstName: parts[0] ?? null, lastName: parts.slice(1).join(" ") || null };
}

async function syncAfterCompGrant(
  data: SetUserCompedInput,
  deps: ApplyUserCompedDeps,
): Promise<SyncResendContactResult> {
  const sync = deps.syncResend ?? syncCompedResendContact;
  const { firstName, lastName } = splitPersonName(data.fullName);
  return sync({
    email: data.email,
    firstName,
    lastName,
    source: "admin_comp",
  });
}

/**
 * Grant or remove a Marshall/admin Circle comp.
 * Resend contact+segment upsert runs only when isComped becomes true.
 * Resend failure is swallowed by the sync helper and must not fail the grant.
 */
export async function applyUserComped(
  data: SetUserCompedInput,
  deps: ApplyUserCompedDeps,
): Promise<ApplyUserCompedResult> {
  if (data.subscriptionId) {
    const update: { is_comped: boolean; status?: string } = { is_comped: data.isComped };
    if (data.isComped) update.status = "active";
    const { error } = await deps.supabase
      .from("subscriptions")
      .update(update)
      .eq("id", data.subscriptionId);
    if (error) throw error;
    if (!data.isComped) return { ok: true, resend: { skipped: true, reason: "uncomp" } };
    return { ok: true, resend: await syncAfterCompGrant(data, deps) };
  }

  if (!data.isComped) {
    return { ok: true, resend: { skipped: true, reason: "uncomp" } };
  }

  const { error } = await deps.supabase.from("subscriptions").insert({
    user_id: data.userId,
    email: data.email,
    status: "active",
    is_comped: true,
    is_founding: false,
    cancel_at_period_end: false,
    metadata: { source: "admin_comp" },
  });
  if (error) throw error;
  return { ok: true, resend: await syncAfterCompGrant(data, deps) };
}
