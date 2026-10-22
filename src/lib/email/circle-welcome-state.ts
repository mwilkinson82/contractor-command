// Circle welcome send-state helpers. The webhook enqueues; the queue
// processor stamps subscriptions.welcome_sent_at, login_nudge_sent_at, and
// discord_nudge_sent_at only after a successful hub-mailer send. Do not treat
// enqueue as delivery.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const CIRCLE_WELCOME_TEMPLATE = "circle-welcome";

type WelcomeClient = SupabaseClient<Database>;

export function circleWelcomeIdempotencyKey(stripeSubscriptionId: string): string {
  return `${CIRCLE_WELCOME_TEMPLATE}-${stripeSubscriptionId}`;
}

/** Same shape `apply_circle_subscription_snapshot` accepts. Anything else is not a row key. */
const STRIPE_SUBSCRIPTION_ID = /^sub_[A-Za-z0-9]+$/;
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function stripeSubscriptionIdFromCircleWelcomeKey(
  key: string | null | undefined,
): string | null {
  if (!key) return null;
  const prefix = `${CIRCLE_WELCOME_TEMPLATE}-`;
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  if (!rest || rest.startsWith("backfill-") || rest.startsWith("admin-")) return null;
  if (!STRIPE_SUBSCRIPTION_ID.test(rest)) return null;
  return rest;
}

/** LIKE-exact: `_` and `%` in an address must not widen the match. */
export function ilikeExact(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
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

export const MEMBERSHIP_SEND_STAMPS = {
  "circle-welcome": "welcome_sent_at",
  "login-nudge": "login_nudge_sent_at",
  "discord-nudge": "discord_nudge_sent_at",
} as const;

export type MembershipStampColumn =
  (typeof MEMBERSHIP_SEND_STAMPS)[keyof typeof MEMBERSHIP_SEND_STAMPS];

type StampError = { code?: string; message?: string };

export type MembershipStampResult = {
  stamped: number;
  error: StampError | null;
};

export function membershipStampColumn(
  templateName: string | null | undefined,
): MembershipStampColumn | null {
  if (!templateName) return null;
  if (templateName in MEMBERSHIP_SEND_STAMPS) {
    return MEMBERSHIP_SEND_STAMPS[templateName as keyof typeof MEMBERSHIP_SEND_STAMPS];
  }
  return null;
}

function stampPatch(column: MembershipStampColumn, sentAt: string) {
  return { [column]: sentAt, updated_at: sentAt } as Database["public"]["Tables"]["subscriptions"]["Update"];
}

async function countStamp(
  result: PromiseLike<{ data: { id: string }[] | null; error: StampError | null }>,
): Promise<{ stamped: number; error: StampError | null }> {
  const { data, error } = await result;
  if (error) return { stamped: 0, error };
  return { stamped: data?.length ?? 0, error: null };
}

/**
 * Write the subscription stamp after the hub mailer has accepted the send.
 * Idempotent: a column that is already set is left alone.
 *
 * The Stripe-id update is not the only match. A key that is not `sub_…`, or a
 * `sub_…` key whose row is missing, falls through to the recipient email and
 * the member's user id. A zero-row update is not a PostgREST error, so this
 * checks the returned ids instead of treating a silent miss as success.
 */
export async function stampMembershipEmailSent(opts: {
  supabase: WelcomeClient;
  templateName: string;
  recipientEmail: string;
  idempotencyKey?: string | null;
  userId?: string | null;
  sentAt?: string;
}): Promise<MembershipStampResult> {
  const column = membershipStampColumn(opts.templateName);
  if (!column) return { stamped: 0, error: null };

  const sentAt = opts.sentAt ?? new Date().toISOString();
  const email = opts.recipientEmail.trim().toLowerCase();
  const subId =
    opts.templateName === CIRCLE_WELCOME_TEMPLATE
      ? stripeSubscriptionIdFromCircleWelcomeKey(opts.idempotencyKey)
      : null;
  let userId = opts.userId && USER_ID.test(opts.userId) ? opts.userId : null;
  let stamped = 0;
  let error: StampError | null = null;

  const note = (result: { stamped: number; error: StampError | null }) => {
    stamped += result.stamped;
    if (result.error) error = result.error;
  };

  try {
    if (!userId && email) {
      const { data: profile, error: profileError } = await opts.supabase
        .from("profiles")
        .select("id")
        .ilike("email", ilikeExact(email))
        .limit(1)
        .maybeSingle();
      if (profileError) {
        console.error("Profile lookup for send stamp failed", { email, error: profileError });
      } else if (profile?.id && USER_ID.test(profile.id)) {
        userId = profile.id;
      }
    }

    const patch = stampPatch(column, sentAt);

    if (subId) {
      note(
        await countStamp(
          opts.supabase
            .from("subscriptions")
            .update(patch)
            .eq("stripe_subscription_id", subId)
            .is(column, null)
            .select("id"),
        ),
      );
    }

    if (email) {
      note(
        await countStamp(
          opts.supabase
            .from("subscriptions")
            .update(patch)
            .ilike("email", ilikeExact(email))
            .is(column, null)
            .select("id"),
        ),
      );
    }

    if (userId) {
      note(
        await countStamp(
          opts.supabase
            .from("subscriptions")
            .update(patch)
            .eq("user_id", userId)
            .is(column, null)
            .select("id"),
        ),
      );
    }
  } catch (err) {
    error = { message: err instanceof Error ? err.message : String(err) };
  }

  if (error) {
    console.error("Failed to stamp subscription send", {
      column,
      email,
      subId,
      userId,
      error,
    });
    return { stamped, error };
  }

  if (stamped === 0 && (email || subId || userId)) {
    const found = await subscriptionExistsForStamp(opts.supabase, { email, subId, userId });
    if (!found) {
      console.error("Subscription send stamp matched no row", {
        column,
        templateName: opts.templateName,
        email,
        subId,
        userId,
      });
    }
  }

  return { stamped, error: null };
}

async function subscriptionExistsForStamp(
  supabase: WelcomeClient,
  identity: { email: string; subId: string | null; userId: string | null },
): Promise<boolean> {
  if (identity.subId) {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("stripe_subscription_id", identity.subId)
      .limit(1);
    if (error) return true;
    if (data && data.length > 0) return true;
  }
  if (identity.email) {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("id")
      .ilike("email", ilikeExact(identity.email))
      .limit(1);
    if (error) return true;
    if (data && data.length > 0) return true;
  }
  if (identity.userId) {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("user_id", identity.userId)
      .limit(1);
    if (error) return true;
    if (data && data.length > 0) return true;
  }
  return false;
}

export async function markCircleWelcomeSent(opts: {
  supabase: WelcomeClient;
  recipientEmail: string;
  idempotencyKey?: string | null;
  userId?: string | null;
  sentAt?: string;
}): Promise<void> {
  await stampMembershipEmailSent({
    supabase: opts.supabase,
    templateName: CIRCLE_WELCOME_TEMPLATE,
    recipientEmail: opts.recipientEmail,
    idempotencyKey: opts.idempotencyKey,
    userId: opts.userId,
    sentAt: opts.sentAt,
  });
}
