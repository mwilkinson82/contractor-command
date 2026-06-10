import { createFileRoute } from "@tanstack/react-router";
import Stripe from "stripe";

type SupabaseAdminClient = typeof import("@/integrations/supabase/client.server").supabaseAdmin;

async function getSupabaseAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// Stripe webhook: keeps `subscriptions` in sync with Stripe state.
// Configure this URL in Stripe Dashboard → Developers → Webhooks:
//   https://contractor-command.lovable.app/api/public/stripe/webhook
// Required events: customer.subscription.created, customer.subscription.updated,
// customer.subscription.deleted, checkout.session.completed, invoice.payment_failed.
//
// Tier mapping (set these env vars to enable):
//   STRIPE_PRICE_ID_BOOK       → 'book_buyer'   (alphandbook.com, $47 one-time)
//   STRIPE_PRICE_ID_INTENSIVE  → 'intensive'    ($5,000 one-time)
//   STRIPE_PRICE_ID_CIRCLE     → 'circle'       (recurring subscription)
// Anything else is ignored. This Stripe account also sells products outside
// this portal, so unknown prices must not create people/subscription rows here.

type Tier = "book_buyer" | "power_hour" | "sm_school" | "contractor_school" | "intensive" | "circle" | "aos_only";
type WebhookEventClaim = "process" | "duplicate" | "in_progress";
type SupabaseRpcResult<T> = Promise<{
  data: T | null;
  error: { message: string } | null;
}>;
type SupabaseRpcClient = {
  rpc: <T>(fn: string, args: Record<string, unknown>) => SupabaseRpcResult<T>;
};

const LEGACY_CIRCLE_PRICE_IDS = new Set([
  // Founding Circle import price used before the current STRIPE_PRICE_ID_CIRCLE env var.
  "price_1TDR3aJdDAUSVXbNZOY6EXF3",
]);

function tierForPrice(
  priceId: string | null,
  metaProduct?: string | null,
  metaKind?: string | null,
): Tier | null {
  const product = metaProduct ?? metaKind ?? null;
  if (product === "book_v2" || product === "book") return "book_buyer";
  if (product === "power_hour") return "power_hour";
  if (product === "sm_school") return "sm_school";
  if (product === "contractor_school") return "contractor_school";
  if (product === "intensive") return "intensive";
  if (product === "circle" && priceId === process.env.STRIPE_PRICE_ID_CIRCLE) return "circle";

  if (priceId && priceId === process.env.STRIPE_PRICE_ID_BOOK) return "book_buyer";
  if (priceId && priceId === process.env.STRIPE_PRICE_ID_INTENSIVE) return "intensive";
  if (priceId && priceId === process.env.STRIPE_PRICE_ID_CIRCLE) return "circle";
  if (priceId && LEGACY_CIRCLE_PRICE_IDS.has(priceId)) return "circle";
  if (priceId && (priceId === process.env.STRIPE_PRICE_ID_POWER_HOUR_MONTH || priceId === process.env.STRIPE_PRICE_ID_POWER_HOUR_QUARTER)) return "power_hour";
  if (priceId && (priceId === process.env.STRIPE_PRICE_ID_SM_SCHOOL_MONTH || priceId === process.env.STRIPE_PRICE_ID_SM_SCHOOL_QUARTER)) return "sm_school";
  if (priceId && (priceId === process.env.STRIPE_PRICE_ID_CONTRACTOR_SCHOOL_MONTH || priceId === process.env.STRIPE_PRICE_ID_CONTRACTOR_SCHOOL_QUARTER)) return "contractor_school";
  return null;
}

function productLabelForTier(tier: Tier): string {
  if (tier === "book_buyer") return "book_v2";
  return tier;
}

function stripeObjectId(event: Stripe.Event): string | null {
  const object = event.data.object as { id?: unknown };
  return typeof object.id === "string" ? object.id : null;
}

async function beginWebhookEvent(supabaseAdmin: SupabaseAdminClient, event: Stripe.Event): Promise<WebhookEventClaim> {
  const rpc = supabaseAdmin as unknown as SupabaseRpcClient;
  const { data, error } = await rpc.rpc<WebhookEventClaim>("begin_stripe_webhook_event", {
    _event_id: event.id,
    _event_type: event.type,
    _object_id: stripeObjectId(event),
  });

  if (error) {
    throw new Error(`Failed to claim Stripe webhook event: ${error.message}`);
  }

  if (data === "process" || data === "duplicate" || data === "in_progress") {
    return data;
  }

  throw new Error(`Unexpected Stripe webhook claim result: ${String(data)}`);
}

async function finishWebhookEvent(supabaseAdmin: SupabaseAdminClient, eventId: string, status: "processed" | "failed", err?: unknown) {
  const message = err instanceof Error ? err.message : err ? String(err) : null;
  const rpc = supabaseAdmin as unknown as SupabaseRpcClient;
  const { error } = await rpc.rpc<void>("finish_stripe_webhook_event", {
    _event_id: eventId,
    _status: status,
    _last_error: message?.slice(0, 2000) ?? null,
  });

  if (error) {
    console.error("Failed to finish Stripe webhook event", {
      eventId,
      status,
      error,
    });
    throw new Error(`Failed to finish Stripe webhook event: ${error.message}`);
  }
}

export const Route = createFileRoute("/api/public/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.STRIPE_SECRET_KEY;
        const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!secret || !whSecret) {
          console.error("Stripe webhook: missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET");
          return new Response("Server not configured", { status: 500 });
        }

        const sig = request.headers.get("stripe-signature");
        if (!sig) return new Response("Missing signature", { status: 400 });

        const body = await request.text();
        const stripe = new Stripe(secret, { apiVersion: "2024-12-18.acacia" as never });
        const supabaseAdmin = await getSupabaseAdmin();

        let event: Stripe.Event;
        try {
          event = await stripe.webhooks.constructEventAsync(body, sig, whSecret);
        } catch (err) {
          console.error("Stripe signature verification failed", err);
          return new Response("Invalid signature", { status: 400 });
        }

        let claim: WebhookEventClaim;
        try {
          claim = await beginWebhookEvent(supabaseAdmin, event);
        } catch (err) {
          console.error("Stripe webhook idempotency check failed", {
            type: event.type,
            eventId: event.id,
            err,
          });
          return new Response("Idempotency check failed", { status: 500 });
        }

        if (claim === "duplicate") {
          return new Response(JSON.stringify({ received: true, duplicate: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (claim === "in_progress") {
          return new Response("Event already processing", { status: 409 });
        }

        try {
          switch (event.type) {
            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.deleted": {
              const sub = event.data.object as Stripe.Subscription;
              if (isAosAddonSubscription(sub)) {
                await upsertAosAddon(supabaseAdmin, stripe, sub);
              } else {
                await upsertSubscription(supabaseAdmin, stripe, sub);
              }
              break;
            }
            case "checkout.session.completed": {
              const session = event.data.object as Stripe.Checkout.Session;
              if (session.subscription) {
                const sub = await stripe.subscriptions.retrieve(
                  typeof session.subscription === "string"
                    ? session.subscription
                    : session.subscription.id,
                );
                if (isAosAddonSubscription(sub)) {
                  await upsertAosAddon(supabaseAdmin, stripe, sub);
                } else {
                  await upsertSubscription(supabaseAdmin, stripe, sub);
                }
              } else {
                // One-time purchase (book, intensive). No subscription object;
                // we synthesize a row keyed on the session id so the tier
                // resolver and claim flow still work.
                await upsertOneTimePurchase(supabaseAdmin, stripe, session);
              }
              break;
            }
            case "invoice.payment_failed": {
              const invoice = event.data.object as Stripe.Invoice;
              const subscription = (
                invoice as Stripe.Invoice & {
                  subscription?: string | { id?: string } | null;
                }
              ).subscription;
              const subscriptionId =
                typeof subscription === "string" ? subscription : subscription?.id;
              if (subscriptionId) {
                const sub = await stripe.subscriptions.retrieve(subscriptionId);
                await upsertSubscription(supabaseAdmin, stripe, sub);
              }
              break;
            }
            default:
              break;
          }
          await finishWebhookEvent(supabaseAdmin, event.id, "processed");
        } catch (err) {
          console.error("Stripe webhook handler error", { type: event.type, err });
          try {
            await finishWebhookEvent(supabaseAdmin, event.id, "failed", err);
          } catch {
            // finishWebhookEvent already logs; preserve the Stripe retry signal.
          }
          return new Response("Handler error", { status: 500 });
        }

        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});

async function upsertSubscription(stripe: Stripe, sub: Stripe.Subscription) {
  let email: string | null = null;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const existingByStripe = await supabaseAdmin
    .from("subscriptions")
    .select("user_id,email,tier,status,is_founding,is_comped")
    .eq("stripe_subscription_id", sub.id)
    .maybeSingle();
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (!("deleted" in customer) || !customer.deleted) {
      email = (customer as Stripe.Customer).email ?? null;
    }
  } catch (err) {
    console.error("Failed to retrieve Stripe customer", { customerId, err });
    throw err;
  }

  if (!email) {
    throw new Error(`Stripe subscription has no resolvable email: ${sub.id}`);
  }

  const normalizedEmail = (existingByStripe.data?.email ?? email).toLowerCase();
  const priceId = sub.items.data[0]?.price?.id ?? null;
  const productId = (sub.items.data[0]?.price?.product as string | null) ?? null;
  const cpe = (sub as Stripe.Subscription & { current_period_end?: number }).current_period_end;
  const currentPeriodEnd = cpe ? new Date(cpe * 1000).toISOString() : null;
  const metadata = (sub.metadata ?? {}) as Record<string, string>;
  const tier = tierForPrice(priceId, metadata.product, metadata.kind);

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  const row = {
    user_id: profile?.id ?? existingByStripe.data?.user_id ?? null,
    email: normalizedEmail,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    price_id: priceId,
    product_id: productId,
    status: sub.status === "past_due" && existingByStripe.data?.status === "active" ? "active" : sub.status,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    current_period_end: currentPeriodEnd,
    metadata: { ...metadata, stripe_customer_email: email.toLowerCase(), product: productLabelForTier(tier) },
    tier: tier === "aos_only" && existingByStripe.data?.tier === "circle" ? "circle" : tier,
    updated_at: new Date().toISOString(),
  };

  const { error: upsertErr } = await supabaseAdmin
    .from("subscriptions")
    .upsert(row, { onConflict: "stripe_subscription_id" });

  if (upsertErr) {
    console.error("Failed to upsert subscription", upsertErr);
    throw new Error(upsertErr.message);
  }

  if (!profile?.id) {
    const { error: pendingErr } = await supabaseAdmin.from("pending_claims").upsert(
      {
        email: normalizedEmail,
        stripe_customer_id: customerId,
        stripe_subscription_id: sub.id,
        price_id: priceId,
        status: sub.status,
        current_period_end: currentPeriodEnd,
        metadata: { ...metadata, product: productLabelForTier(tier) },
      },
      { onConflict: "stripe_subscription_id" },
    );
    if (pendingErr) {
      console.error("Failed to upsert pending claim", pendingErr);
      throw new Error(pendingErr.message);
    }

    if (sub.status === "active" || sub.status === "trialing") {
      await invitePaidMemberIfNeeded(normalizedEmail);
    }
  }
}

// One-time purchase path (book, intensive). Mirrors upsertSubscription so the
// tier/claim resolver works the same way for recurring and one-time products.
async function upsertOneTimePurchase(stripe: Stripe, session: Stripe.Checkout.Session) {
  let email: string | null = session.customer_details?.email ?? session.customer_email ?? null;
  const customerId =
    typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);
  if (!email && customerId) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (!("deleted" in customer) || !customer.deleted) {
        email = (customer as Stripe.Customer).email ?? null;
      }
    } catch (err) {
      console.error("Failed to retrieve Stripe customer for one-time purchase", {
        customerId,
        err,
      });
      throw err;
    }
  }
  if (!email) {
    throw new Error(`One-time purchase has no resolvable email: ${session.id}`);
  }

  const normalizedEmail = email.toLowerCase();
  const metadata = (session.metadata ?? {}) as Record<string, string>;

  // Call packs are services, not tier purchases — log to vault_packets
  // and skip subscription row creation.
  if (metadata.product === "calls" || metadata.kind === "calls") {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("email", normalizedEmail)
      .maybeSingle();
    if (profile?.id) {
      await supabaseAdmin.from("vault_packets").insert({
        user_id: profile.id,
        kind: "call_pack_purchase",
        source: "Stripe · Call pack",
        status: "Open",
        title: `Call pack: ${metadata.plan ?? "unknown"}`,
        payload: {
          plan: metadata.plan ?? "",
          email: normalizedEmail,
          checkout_session_id: session.id,
          amount_total: session.amount_total,
          captured_at: new Date().toISOString(),
        },
      });
    } else {
      console.warn("Call pack purchase has no matching profile yet", { email: normalizedEmail, session: session.id });
    }
    return;
  }



  // Resolve price from line items.
  let priceId: string | null = null;
  let productId: string | null = null;
  try {
    const lines = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 1,
      expand: ["data.price.product"],
    });
    const price = lines.data[0]?.price;
    priceId = price?.id ?? null;
    productId =
      (price?.product as Stripe.Product | string | null) instanceof Object
        ? ((price?.product as Stripe.Product).id ?? null)
        : ((price?.product as string | null) ?? null);
  } catch (err) {
    console.warn("Could not list line items for one-time purchase", { sessionId: session.id, err });
  }

  const tier = tierForPrice(priceId, metadata.product, metadata.kind);

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  const syntheticSubId = `cs_${session.id}`; // unique per checkout session
  const row = {
    user_id: profile?.id ?? null,
    email: normalizedEmail,
    stripe_customer_id: customerId,
    stripe_subscription_id: syntheticSubId,
    price_id: priceId,
    product_id: productId,
    status: "active",
    cancel_at_period_end: false,
    current_period_end: null,
    metadata: { ...metadata, product: productLabelForTier(tier), checkout_session_id: session.id },
    tier,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from("subscriptions")
    .upsert(row, { onConflict: "stripe_subscription_id" });
  if (error) {
    console.error("Failed to upsert one-time purchase", error);
    throw new Error(error.message);
  }

  if (!profile?.id) {
    const { error: pendingErr } = await supabaseAdmin.from("pending_claims").upsert(
      {
        email: normalizedEmail,
        stripe_customer_id: customerId,
        stripe_subscription_id: syntheticSubId,
        price_id: priceId,
        status: "active",
        current_period_end: null,
        metadata: {
          ...metadata,
          product: productLabelForTier(tier),
          checkout_session_id: session.id,
        },
      },
      { onConflict: "stripe_subscription_id" },
    );
    if (pendingErr) {
      console.error("Failed to upsert one-time pending claim", pendingErr);
      throw new Error(pendingErr.message);
    }
    await invitePaidMemberIfNeeded(normalizedEmail);
  }
}

async function invitePaidMemberIfNeeded(email: string) {
  const perPage = 200;
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("Failed to check auth user before member invite", { email, error });
      throw error;
    }
    const users = data?.users ?? [];
    if (users.some((u) => (u.email ?? "").toLowerCase() === email)) return;
    if (users.length < perPage) break;
  }

  const origin = (
    process.env.PUBLIC_APP_ORIGIN ||
    process.env.APP_ORIGIN ||
    "https://app.alpcontractorcircle.com"
  ).replace(/\/$/, "");
  const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: { source: "stripe_purchase", invited_at: new Date().toISOString() },
    redirectTo: `${origin}/welcome`,
  });
  if (error) {
    const msg = error.message ?? "";
    if (/already|registered|exists/i.test(msg)) return;
    console.error("Failed to send paid member invite", { email, error });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// AOS add-ons — separate table (aos_addons), separate code path. We never
// want add-on purchases to overwrite a user's primary tier in `subscriptions`.
// ---------------------------------------------------------------------------

function isAosAddonSubscription(sub: Stripe.Subscription): boolean {
  const seatPrice = process.env.STRIPE_PRICE_ID_AOS_SEAT_MONTH;
  const wsPrice = process.env.STRIPE_PRICE_ID_AOS_WORKSPACE_MONTH;
  const meta = (sub.metadata ?? {}) as Record<string, string>;
  if (meta.product === "aos_addon" || meta.kind === "aos_addon") return true;
  for (const item of sub.items.data) {
    const id = item.price?.id;
    if (id && (id === seatPrice || id === wsPrice)) return true;
  }
  return false;
}

function addonKindForPrice(priceId: string | null): "seat" | "workspace" | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_ID_AOS_SEAT_MONTH) return "seat";
  if (priceId === process.env.STRIPE_PRICE_ID_AOS_WORKSPACE_MONTH) return "workspace";
  return null;
}

async function upsertAosAddon(stripe: Stripe, sub: Stripe.Subscription) {
  let email: string | null = null;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (!("deleted" in customer) || !customer.deleted) {
      email = (customer as Stripe.Customer).email ?? null;
    }
  } catch (err) {
    console.error("Failed to retrieve Stripe customer for AOS add-on", { customerId, err });
    throw err;
  }
  if (!email) {
    throw new Error(`AOS add-on subscription has no resolvable email: ${sub.id}`);
  }
  const normalizedEmail = email.toLowerCase();

  // Each subscription = one line item of one add-on kind (we always create
  // them that way). If Stripe ever splits across items, take the first that
  // matches one of our two add-on price IDs.
  const item =
    sub.items.data.find((i) => addonKindForPrice(i.price?.id ?? null) !== null) ??
    sub.items.data[0];
  const priceId = item?.price?.id ?? null;
  const kind = addonKindForPrice(priceId);
  if (!kind) {
    console.warn("AOS add-on event with no matching price", { subId: sub.id, priceId });
    return;
  }
  const quantity = item?.quantity ?? 1;
  const cpe = (sub as Stripe.Subscription & { current_period_end?: number }).current_period_end;
  const currentPeriodEnd = cpe ? new Date(cpe * 1000).toISOString() : null;
  const metadata = (sub.metadata ?? {}) as Record<string, string>;

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  // Map Stripe lifecycle to our status. 'canceled' subs go inactive so they
  // stop counting in get_user_aos_limits.
  const status =
    sub.status === "canceled" || sub.status === "incomplete_expired" ? "canceled" : sub.status;

  const { error } = await supabaseAdmin.from("aos_addons").upsert(
    {
      user_id: profile?.id ?? null,
      email: normalizedEmail,
      kind,
      quantity,
      stripe_subscription_id: sub.id,
      stripe_customer_id: customerId,
      price_id: priceId,
      status,
      current_period_end: currentPeriodEnd,
      metadata,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" },
  );
  if (error) {
    console.error("Failed to upsert aos_addons row", error);
    throw new Error(error.message);
  }
}
