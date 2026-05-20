import { createFileRoute } from "@tanstack/react-router";
import Stripe from "stripe";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
// Anything else defaults to 'aos_only' (safe baseline — no Circle access
// is ever granted unless the price/metadata explicitly maps to it).

type Tier = "book_buyer" | "intensive" | "circle" | "aos_only";

function tierForPrice(priceId: string | null, metaProduct?: string | null): Tier {
  // Explicit metadata wins (set by our own checkout sessions).
  if (metaProduct === "book_v2" || metaProduct === "book") return "book_buyer";
  if (metaProduct === "intensive") return "intensive";
  if (metaProduct === "circle" && priceId === process.env.STRIPE_PRICE_ID_CIRCLE) return "circle";

  if (priceId && priceId === process.env.STRIPE_PRICE_ID_BOOK) return "book_buyer";
  if (priceId && priceId === process.env.STRIPE_PRICE_ID_INTENSIVE) return "intensive";
  if (priceId && priceId === process.env.STRIPE_PRICE_ID_CIRCLE) return "circle";
  return "aos_only";
}

function productLabelForTier(tier: Tier): string {
  if (tier === "book_buyer") return "book_v2";
  return tier;
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
        const stripe = new Stripe(secret, { apiVersion: "2024-12-18.acacia" as any });

        let event: Stripe.Event;
        try {
          event = await stripe.webhooks.constructEventAsync(body, sig, whSecret);
        } catch (err) {
          console.error("Stripe signature verification failed", err);
          return new Response("Invalid signature", { status: 400 });
        }

        try {
          switch (event.type) {
            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.deleted": {
              const sub = event.data.object as Stripe.Subscription;
              await upsertSubscription(stripe, sub);
              break;
            }
            case "checkout.session.completed": {
              const session = event.data.object as Stripe.Checkout.Session;
              if (session.subscription) {
                const sub = await stripe.subscriptions.retrieve(
                  typeof session.subscription === "string" ? session.subscription : session.subscription.id
                );
                await upsertSubscription(stripe, sub);
              } else {
                // One-time purchase (book, intensive). No subscription object;
                // we synthesize a row keyed on the session id so the tier
                // resolver and claim flow still work.
                await upsertOneTimePurchase(stripe, session);
              }
              break;
            }
            default:
              break;
          }
        } catch (err) {
          console.error("Stripe webhook handler error", { type: event.type, err });
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
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (!("deleted" in customer) || !customer.deleted) {
      email = (customer as Stripe.Customer).email ?? null;
    }
  } catch (err) {
    console.error("Failed to retrieve Stripe customer", { customerId, err });
  }

  if (!email) {
    console.error("Stripe subscription has no resolvable email", { subId: sub.id });
    return;
  }

  const normalizedEmail = email.toLowerCase();
  const priceId = sub.items.data[0]?.price?.id ?? null;
  const productId = (sub.items.data[0]?.price?.product as string | null) ?? null;
  const cpe = (sub as any).current_period_end as number | undefined;
  const currentPeriodEnd = cpe ? new Date(cpe * 1000).toISOString() : null;
  const metadata = (sub.metadata ?? {}) as Record<string, string>;
  const tier = tierForPrice(priceId, metadata.product);

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  const row = {
    user_id: profile?.id ?? null,
    email: normalizedEmail,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    price_id: priceId,
    product_id: productId,
    status: sub.status,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    current_period_end: currentPeriodEnd,
    metadata: { ...metadata, product: productLabelForTier(tier) },
    tier,
    updated_at: new Date().toISOString(),
  };

  const { error: upsertErr } = await supabaseAdmin
    .from("subscriptions")
    .upsert(row, { onConflict: "stripe_subscription_id" });

  if (upsertErr) {
    console.error("Failed to upsert subscription", upsertErr);
    return;
  }

  if (!profile?.id) {
    await supabaseAdmin.from("pending_claims").upsert(
      {
        email: normalizedEmail,
        stripe_customer_id: customerId,
        stripe_subscription_id: sub.id,
        price_id: priceId,
        status: sub.status,
        current_period_end: currentPeriodEnd,
        metadata: { ...metadata, product: productLabelForTier(tier) },
      },
      { onConflict: "stripe_subscription_id" }
    );

    if (sub.status === "active" || sub.status === "trialing") {
      await invitePaidMemberIfNeeded(normalizedEmail);
    }
  }
}

// One-time purchase path (book, intensive). Mirrors upsertSubscription so the
// tier/claim resolver works the same way for recurring and one-time products.
async function upsertOneTimePurchase(stripe: Stripe, session: Stripe.Checkout.Session) {
  let email: string | null = session.customer_details?.email ?? session.customer_email ?? null;
  const customerId = typeof session.customer === "string"
    ? session.customer
    : session.customer?.id ?? null;
  if (!email && customerId) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (!("deleted" in customer) || !customer.deleted) {
        email = (customer as Stripe.Customer).email ?? null;
      }
    } catch (err) {
      console.error("Failed to retrieve Stripe customer for one-time purchase", { customerId, err });
    }
  }
  if (!email) {
    console.error("One-time purchase has no resolvable email", { sessionId: session.id });
    return;
  }

  const normalizedEmail = email.toLowerCase();
  const metadata = (session.metadata ?? {}) as Record<string, string>;

  // Resolve price from line items.
  let priceId: string | null = null;
  let productId: string | null = null;
  try {
    const lines = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1, expand: ["data.price.product"] });
    const price = lines.data[0]?.price;
    priceId = price?.id ?? null;
    productId = (price?.product as Stripe.Product | string | null) instanceof Object
      ? ((price?.product as Stripe.Product).id ?? null)
      : ((price?.product as string | null) ?? null);
  } catch (err) {
    console.warn("Could not list line items for one-time purchase", { sessionId: session.id, err });
  }

  const tier = tierForPrice(priceId, metadata.product);

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
    return;
  }

  if (!profile?.id) {
    await supabaseAdmin.from("pending_claims").upsert(
      {
        email: normalizedEmail,
        stripe_customer_id: customerId,
        stripe_subscription_id: syntheticSubId,
        price_id: priceId,
        status: "active",
        current_period_end: null,
        metadata: { ...metadata, product: productLabelForTier(tier), checkout_session_id: session.id },
      },
      { onConflict: "stripe_subscription_id" }
    );
    await invitePaidMemberIfNeeded(normalizedEmail);
  }
}

async function invitePaidMemberIfNeeded(email: string) {
  const perPage = 200;
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("Failed to check auth user before member invite", { email, error });
      return;
    }
    const users = data?.users ?? [];
    if (users.some((u) => (u.email ?? "").toLowerCase() === email)) return;
    if (users.length < perPage) break;
  }

  const origin = (process.env.PUBLIC_APP_ORIGIN || process.env.APP_ORIGIN || "https://app.alpcontractorcircle.com").replace(/\/$/, "");
  const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: { source: "stripe_purchase", invited_at: new Date().toISOString() },
    redirectTo: `${origin}/welcome`,
  });
  if (error) console.error("Failed to send paid member invite", { email, error });
}
