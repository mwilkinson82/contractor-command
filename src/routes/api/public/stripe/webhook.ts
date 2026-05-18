import { createFileRoute } from "@tanstack/react-router";
import Stripe from "stripe";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Stripe webhook: keeps `subscriptions` in sync with Stripe state.
// Configure this URL in Stripe Dashboard → Developers → Webhooks:
//   https://contractor-command.lovable.app/api/public/stripe/webhook
// Required events: customer.subscription.created, customer.subscription.updated,
// customer.subscription.deleted, checkout.session.completed, invoice.payment_failed.

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
              }
              break;
            }
            default:
              // Ignore unhandled event types
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
  // Resolve customer email
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


  // Try to match an existing user by email
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  const metadata = (sub.metadata ?? {}) as any;

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
    metadata,
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
        metadata,
      },
      { onConflict: "stripe_subscription_id" }
    );
  }
}

