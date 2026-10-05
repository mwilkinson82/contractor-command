/** Cancellation notices are dormant until a reviewed activation timestamp is set. */
export const CIRCLE_CANCELLATION_MEMBER = "circle-cancellation-confirmation";
export const CIRCLE_CANCELLATION_OWNER = "circle-cancellation-owner";
export const CIRCLE_CANCELLATION_OWNER_EMAIL = "wilkinson.marshall@gmail.com";

export type CancellationSubscription = {
  id: string;
  status: string;
  canceled_at?: number | null;
  ended_at?: number | null;
  cancel_at?: number | null;
  cancel_at_period_end?: boolean;
  cancellation_details?: {
    reason?: string | null;
    feedback?: string | null;
    comment?: string | null;
  } | null;
};

export type CircleCancellationFacts = {
  episode: string;
  requestedAt: string;
  effectiveAt: string | null;
  state: "scheduled" | "canceled";
  paidThrough: string | null;
  reviewReason: string | null;
  memberEmail: string;
  billingEmail: string;
  customerName: string | null;
  reason: string | null;
  feedback: string | null;
  comment: string | null;
  memberAllowed: boolean;
  neverEmail: boolean;
};

export function cancellationActivation(
  value = process.env.CIRCLE_CANCELLATION_EMAILS_ENABLED_FROM,
): number | null {
  // Require an explicit timestamp; dates, booleans and accidental strings fail closed.
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const cutoff = Date.parse(value);
  return Number.isFinite(cutoff) && cutoff <= Date.now() ? cutoff : null;
}

function iso(seconds?: number | null): string | null {
  return seconds && Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : null;
}

function provided(value?: string | null): string | null {
  return value?.trim().slice(0, 1000) || null;
}

export function cancellationFacts(
  sub: CancellationSubscription,
  context: Omit<
    CircleCancellationFacts,
    "episode" | "requestedAt" | "effectiveAt" | "state" | "reason" | "feedback" | "comment"
  > & { periodEnd: string | null },
): CircleCancellationFacts | null {
  if (!(sub.status === "canceled" || sub.cancel_at_period_end || sub.cancel_at)) return null;
  // Involuntary dunning/dispute terminations are not customer cancellation requests.
  if (["payment_failed", "payment_disputed"].includes(sub.cancellation_details?.reason ?? ""))
    return null;
  const requestedAt = iso(sub.canceled_at);
  if (!requestedAt) return null; // Never guess a cancellation episode from webhook arrival time.
  const { periodEnd, ...facts } = context;
  return {
    ...facts,
    episode: `${sub.id}:${sub.canceled_at}`,
    requestedAt,
    effectiveAt: sub.status === "canceled" ? iso(sub.ended_at) : (iso(sub.cancel_at) ?? periodEnd),
    state: sub.status === "canceled" ? "canceled" : "scheduled",
    reason: provided(sub.cancellation_details?.reason),
    feedback: provided(sub.cancellation_details?.feedback),
    comment: provided(sub.cancellation_details?.comment),
  };
}

export function cancellationEventMatches(
  event: { type: string; created: number; data: { object: CancellationSubscription } },
  sub: CancellationSubscription,
  facts: CircleCancellationFacts,
): boolean {
  const cutoff = cancellationActivation();
  const old = event.data.object;
  return (
    cutoff !== null &&
    event.created * 1000 >= cutoff &&
    ["customer.subscription.updated", "customer.subscription.deleted"].includes(event.type) &&
    old.id === sub.id &&
    old.canceled_at === sub.canceled_at &&
    !!(old.status === "canceled" || old.cancel_at_period_end || old.cancel_at) &&
    Date.parse(facts.requestedAt) >= cutoff
  );
}

export function isCircleCancellationLabel(label: unknown): boolean {
  return label === CIRCLE_CANCELLATION_MEMBER || label === CIRCLE_CANCELLATION_OWNER;
}
