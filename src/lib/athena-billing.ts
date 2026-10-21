// 0.8.15: Athena plan + seat billing (CODE ONLY, staged). Checkout is behind ATHENA_CHECKOUT_ENABLED (default OFF).
// Price ids come from env, with Cash's live ids as defaults. Nothing here runs unless the flag is on; tests use mocks.
// Seat cap = 1 owner + included seats (Stripe product metadata included_seats, else plan config default 5)
//          + purchased athena_seat quantity ($49/seat/mo). Circle members: member + 5, no Stripe price.
import type Stripe from "stripe";
type SessionCreateParams = Parameters<Stripe["checkout"]["sessions"]["create"]>[0] & {};
type LineItem = NonNullable<SessionCreateParams["line_items"]>[number];

export type AthenaPlan = "athena_pm" | "athena_office";
export const DEFAULT_INCLUDED_SEATS = 5;

type Env = Record<string, string | undefined>;
export function billingConfig(env: Env = process.env) {
  return {
    checkoutEnabled: env.ATHENA_CHECKOUT_ENABLED === "true",
    prices: {
      athena_pm: env.STRIPE_PRICE_ID_ATHENA_PM || "price_1USgPMJdDAUSVXbNW81c9iJd", // $197/mo, prod_VTdgfFhRE8Eefz
      athena_office: env.STRIPE_PRICE_ID_ATHENA_OFFICE || "price_1USgPNJdDAUSVXbN7czrTfxh", // $397/mo, prod_VTdgRAK92yXRHv
    } as Record<AthenaPlan, string>,
    seatPrice: env.STRIPE_PRICE_ID_ATHENA_SEAT || "price_1USprHJdDAUSVXbNpRbfw3Y8", // $49/seat/mo, prod_VTnSNdyxcFXI4F, athena_seat
    trialDays: 7,
    origin: env.ATHENA_APP_ORIGIN || "https://app.meetathena.io",
  };
}

export const CHECKOUT_OFF_MESSAGE = "Adding seats online isn't switched on yet. Reply here and we'll set it up with you.";

export type CheckoutArgs = { companyId: string; ownerUserId: string; ownerEmail?: string | null; plan?: AthenaPlan | null; extraSeats: number; customerId?: string | null };
type StripeLike = { checkout: { sessions: { create: (p: SessionCreateParams) => Promise<{ id: string; url: string | null }> } } };

/** Builds the Checkout Session params: plan as line 1 (if any) and the athena_seat price with quantity = extra seats. */
export function checkoutParams(a: CheckoutArgs, env: Env = process.env): SessionCreateParams {
  const c = billingConfig(env);
  if (!a.plan && a.extraSeats < 1) throw new Error("Pick a plan or at least one seat.");
  if (!Number.isInteger(a.extraSeats) || a.extraSeats < 0 || a.extraSeats > 500) throw new Error("Seat count must be a whole number from 0 to 500.");
  const line_items: LineItem[] = [];
  if (a.plan) line_items.push({ price: c.prices[a.plan], quantity: 1 });
  if (a.extraSeats > 0) line_items.push({ price: c.seatPrice, quantity: a.extraSeats });
  const metadata = { athena_company_id: a.companyId, athena_owner_user_id: a.ownerUserId, athena_plan: a.plan ?? "", athena_extra_seats: String(a.extraSeats) };
  return {
    mode: "subscription",
    line_items,
    client_reference_id: a.companyId,
    ...(a.customerId ? { customer: a.customerId } : a.ownerEmail ? { customer_email: a.ownerEmail } : {}),
    subscription_data: { trial_period_days: c.trialDays, metadata },
    metadata,
    success_url: `${c.origin}/team?checkout=done`,
    cancel_url: `${c.origin}/team?checkout=cancelled`,
  };
}

/** Server-side only. Returns null when the flag is off (no Stripe call at all). */
export async function createAthenaCheckout(stripe: StripeLike, a: CheckoutArgs, env: Env = process.env): Promise<{ id: string; url: string | null } | null> {
  if (!billingConfig(env).checkoutEnabled) return null;
  return stripe.checkout.sessions.create(checkoutParams(a, env));
}

// ---- Webhook sync ------------------------------------------------------------------------------------------------
export type EntitlementRow = {
  company_id: string; plan: AthenaPlan | null; extra_seats: number; included_seats: number | null; status: string;
  stripe_customer_id: string | null; stripe_subscription_id: string; last_event_id: string; updated_at: string;
};
type SubLike = {
  id: string; status: string; customer: string | { id: string } | null; metadata?: Record<string, string> | null;
  items: { data: { quantity?: number | null; price: { id: string; product: string | { id: string; metadata?: Record<string, string> | null } } }[] };
};

const productMeta = (p: string | { metadata?: Record<string, string> | null }) => (typeof p === "string" ? null : p.metadata ?? null);

/** Pure: subscription -> entitlement row. Unknown/foreign subscriptions (no Athena company metadata, no Athena price) return null. */
export function entitlementFromSubscription(sub: SubLike, eventId: string, env: Env = process.env, now = new Date()): EntitlementRow | null {
  const c = billingConfig(env);
  const companyId = sub.metadata?.athena_company_id;
  let plan: AthenaPlan | null = null;
  let seats = 0;
  let included: number | null = null;
  let athena = false;
  for (const it of sub.items.data) {
    const pid = it.price.id;
    if (pid === c.prices.athena_pm || pid === c.prices.athena_office) {
      athena = true;
      plan = pid === c.prices.athena_office ? "athena_office" : plan ?? "athena_pm";
      const n = Number(productMeta(it.price.product)?.included_seats);
      if (Number.isInteger(n) && n >= 0) included = n;
    } else if (pid === c.seatPrice) {
      athena = true;
      seats += Math.max(0, it.quantity ?? 0);
    }
  }
  if (!athena || !companyId) return null;
  const live = ["active", "trialing"].includes(sub.status);
  return {
    company_id: companyId, plan, extra_seats: seats, included_seats: included,
    status: live ? sub.status : sub.status === "past_due" ? "past_due" : "inactive",
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
    stripe_subscription_id: sub.id, last_event_id: eventId, updated_at: now.toISOString(),
  };
}

export type EntitlementStore = { upsert: (row: EntitlementRow) => Promise<void> };
type WebhookStripe = {
  webhooks: { constructEventAsync: (body: string, sig: string, secret: string) => Promise<{ id: string; type: string; data: { object: unknown } }> };
  subscriptions: { retrieve: (id: string, p?: { expand?: string[] }) => Promise<SubLike> };
};

const SYNC_EVENTS = new Set(["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"]);

/** Verifies the signature, then re-reads the subscription (with product metadata) and writes the entitlement row. */
export async function handleAthenaBillingWebhook(req: { body: string; signature: string | null }, deps: { stripe: WebhookStripe; store: EntitlementStore; secret: string | undefined; env?: Env }): Promise<{ status: number; body: string }> {
  if (!deps.secret) return { status: 500, body: "Server not configured" };
  if (!req.signature) return { status: 400, body: "Missing signature" };
  let event;
  try {
    event = await deps.stripe.webhooks.constructEventAsync(req.body, req.signature, deps.secret);
  } catch {
    return { status: 400, body: "Invalid signature" };
  }
  if (!SYNC_EVENTS.has(event.type)) return { status: 200, body: "ignored" };
  const obj = event.data.object as { id?: string; subscription?: string | { id: string } | null; object?: string };
  const subId = event.type === "checkout.session.completed" ? (typeof obj.subscription === "string" ? obj.subscription : obj.subscription?.id) : obj.id;
  if (!subId) return { status: 200, body: "no subscription" };
  const sub = await deps.stripe.subscriptions.retrieve(subId, { expand: ["items.data.price.product"] });
  const row = entitlementFromSubscription(sub, event.id, deps.env);
  if (!row) return { status: 200, body: "not athena" };
  if (event.type === "customer.subscription.deleted") row.status = "inactive";
  await deps.store.upsert(row);
  return { status: 200, body: "synced" };
}
