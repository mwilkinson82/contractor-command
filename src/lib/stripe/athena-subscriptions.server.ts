import type Stripe from "stripe";

// Standalone Athena subscriptions (Athena PM $197 / Athena Office $397).
// Routed by the Stripe product's metadata.product_key (athena_pm | athena_office),
// with the subscription metadata and the configured price IDs as fallbacks.
// Writes athena_subscriptions only; never touches the Circle `subscriptions` table
// and never sends email.
//
// Stripe (ALPio acct_1HPL9DJdDAUSVXbN):
//   Athena PM      prod_VTdgfFhRE8Eefz  price_1USgPMJdDAUSVXbNW81c9iJd
//   Athena Office  prod_VTdgRAK92yXRHv  price_1USgPNJdDAUSVXbN7czrTfxh

export type AthenaProductKey = "athena_pm" | "athena_office";
export type AthenaTier = "pm" | "office";

export const ATHENA_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export const ATHENA_DEFAULT_PRICE_IDS: Record<AthenaProductKey, string> = {
  athena_pm: "price_1USgPMJdDAUSVXbNW81c9iJd",
  athena_office: "price_1USgPNJdDAUSVXbN7czrTfxh",
};

/** Env overrides (test mode uses test price IDs); defaults are the live IDs from Cash. */
export function athenaPriceIds(env: Record<string, string | undefined> = process.env): Record<AthenaProductKey, string> {
  return {
    athena_pm: env.STRIPE_PRICE_ID_ATHENA_PM || ATHENA_DEFAULT_PRICE_IDS.athena_pm,
    athena_office: env.STRIPE_PRICE_ID_ATHENA_OFFICE || ATHENA_DEFAULT_PRICE_IDS.athena_office,
  };
}

export function tierToProductKey(tier: string | null | undefined): AthenaProductKey | null {
  const t = String(tier ?? "").trim().toLowerCase();
  if (t === "pm" || t === "athena_pm") return "athena_pm";
  if (t === "office" || t === "athena_office") return "athena_office";
  return null;
}

function asKey(v: unknown): AthenaProductKey | null {
  return v === "athena_pm" || v === "athena_office" ? v : null;
}

/**
 * The Athena product key for a subscription, or null if it isn't an Athena plan.
 * Order: product metadata.product_key (expanded or fetched) -> subscription metadata -> price ID.
 */
export async function athenaProductKey(
  sub: Stripe.Subscription,
  loadProduct?: (id: string) => Promise<{ metadata?: Record<string, string> | null } | null>,
  env: Record<string, string | undefined> = process.env,
): Promise<AthenaProductKey | null> {
  const priceIds = athenaPriceIds(env);
  for (const item of sub.items?.data ?? []) {
    const product = item.price?.product as unknown;
    if (product && typeof product === "object") {
      const k = asKey((product as { metadata?: Record<string, string> }).metadata?.product_key);
      if (k) return k;
    } else if (typeof product === "string" && loadProduct) {
      const p = await loadProduct(product).catch(() => null);
      const k = asKey(p?.metadata?.product_key);
      if (k) return k;
    }
  }
  const metaKey = asKey((sub.metadata ?? {}).product_key);
  if (metaKey) return metaKey;
  for (const item of sub.items?.data ?? []) {
    const id = item.price?.id;
    if (id === priceIds.athena_pm) return "athena_pm";
    if (id === priceIds.athena_office) return "athena_office";
  }
  return null;
}

/**
 * Grace rule: Stripe's standard retries run while the sub is past_due (access kept).
 * When retries end (unpaid, or canceled for non-payment) access continues 7 more days.
 * A user-requested cancel (including a canceled trial) gets no grace.
 */
export function nextGraceUntil(
  sub: Pick<Stripe.Subscription, "status"> & { cancellation_details?: { reason?: string | null } | null },
  previousGraceUntil: string | null | undefined,
  now = new Date(),
): string | null {
  const status = sub.status;
  if (status === "active" || status === "trialing" || status === "past_due") return null;
  const failedOut = status === "unpaid" || (status === "canceled" && sub.cancellation_details?.reason === "payment_failed");
  if (!failedOut) return null;
  return previousGraceUntil ?? new Date(now.getTime() + ATHENA_GRACE_MS).toISOString();
}

function ts(sec: number | null | undefined): string | null {
  return typeof sec === "number" ? new Date(sec * 1000).toISOString() : null;
}

type AdminLike = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/** Upsert the athena_subscriptions row from current Stripe state. Returns false if not an Athena plan. */
export async function upsertAthenaSubscription(
  admin: AdminLike,
  stripe: Stripe,
  sub: Stripe.Subscription,
  productKey: AthenaProductKey,
): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const customer = typeof sub.customer === "string" ? await stripe.customers.retrieve(customerId) : sub.customer;
  const email = (!("deleted" in customer && customer.deleted) ? (customer as Stripe.Customer).email : null)?.trim().toLowerCase();
  if (!email) throw new Error(`Athena subscription ${sub.id} has no customer email`);

  const { data: existing } = await admin
    .from("athena_subscriptions")
    .select("grace_until,user_id")
    .eq("stripe_subscription_id", sub.id)
    .maybeSingle();

  let userId: string | null = existing?.user_id ?? null;
  if (!userId) {
    const { data: profile } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
    userId = profile?.id ?? null;
  }

  const item = sub.items?.data?.[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined;
  const periodEnd = (sub as Stripe.Subscription & { current_period_end?: number }).current_period_end ?? item?.current_period_end;

  const row = {
    stripe_subscription_id: sub.id,
    stripe_customer_id: customerId,
    email,
    user_id: userId,
    product_key: productKey,
    status: sub.status,
    trial_end: ts(sub.trial_end),
    current_period_end: ts(periodEnd),
    cancel_at_period_end: sub.cancel_at_period_end === true,
    grace_until: nextGraceUntil(sub, existing?.grace_until ?? null),
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("athena_subscriptions").upsert(row, { onConflict: "stripe_subscription_id" });
  if (error) throw new Error(`Failed to upsert Athena subscription: ${error.message}`);
}
