import { createFileRoute } from "@tanstack/react-router";
import Stripe from "stripe";
import { circleDecision } from "@/lib/membership/circle.server";
import { athenaPriceIds, tierToProductKey } from "@/lib/stripe/athena-subscriptions.server";

// "Start free trial" for Athena PM ($197/mo) and Athena Office ($397/mo).
// Button URLs (for the meetathena.io site):
//   https://app.meetathena.io/api/public/athena/checkout?tier=pm
//   https://app.meetathena.io/api/public/athena/checkout?tier=office
// GET shows a one-field email form. POST checks the email: an active Circle member
// (who already has every role) is sent to sign-in instead of being charged; anyone
// else gets a Stripe Checkout Session (subscription, 7-day trial, card up front)
// and a 303 redirect to it. Price IDs come from server config, never the request.

const SIGN_IN = "https://app.meetathena.io/login";
const PRICING = "https://meetathena.io/";
const TIER_NAME = { athena_pm: "Athena PM", athena_office: "Athena Office" } as const;

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function page(tier: string, name: string, error?: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Start your free trial · ${esc(name)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:12vh auto;padding:0 20px;color:#111}
h1{font-size:1.4rem}input{width:100%;padding:12px;font-size:1rem;border:1px solid #ccc;border-radius:8px;box-sizing:border-box}
button{margin-top:12px;width:100%;padding:12px;font-size:1rem;background:#2563EB;color:#fff;border:0;border-radius:8px;cursor:pointer}
p{color:#444;font-size:.95rem}.err{color:#b91c1c}</style></head><body>
<h1>Start your 7-day free trial of ${esc(name)}</h1>
<p>Use the email you'll sign in to Athena with. Your card is charged after 7 days unless you cancel.</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="post"><input type="hidden" name="tier" value="${esc(tier)}">
<input type="email" name="email" required autocomplete="email" placeholder="you@company.com">
<button type="submit">Continue</button></form></body></html>`;
  return new Response(html, { status: error ? 400 : 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function redirect(url: string): Response {
  return new Response(null, { status: 303, headers: { Location: url } });
}

export const Route = createFileRoute("/api/public/athena/checkout")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const tier = new URL(request.url).searchParams.get("tier") ?? "";
        const key = tierToProductKey(tier);
        if (!key) return redirect(PRICING);
        return page(tier, TIER_NAME[key]);
      },
      POST: async ({ request }) => {
        const form = await request.formData();
        const tier = String(form.get("tier") ?? "");
        const key = tierToProductKey(tier);
        if (!key) return redirect(PRICING);
        const email = String(form.get("email") ?? "").trim().toLowerCase();
        if (!isEmail(email)) return page(tier, TIER_NAME[key], "Enter a valid email address.");

        const secret = process.env.STRIPE_SECRET_KEY;
        if (!secret) {
          console.error("Athena checkout: missing STRIPE_SECRET_KEY");
          return new Response("Server not configured", { status: 500 });
        }

        // Active Circle members already have every Athena role: send them to sign in, don't charge.
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const decision = await circleDecision(supabaseAdmin, { email });
          if (decision.hasAccess) return redirect(`${SIGN_IN}?email=${encodeURIComponent(email)}&member=circle`);
        } catch (err) {
          // Fail open to checkout: a lookup error must not block a new buyer.
          console.warn("Athena checkout: Circle lookup failed", err);
        }

        const stripe = new Stripe(secret, { apiVersion: "2024-12-18.acacia" as never });
        const session = await stripe.checkout.sessions.create({
          mode: "subscription",
          line_items: [{ price: athenaPriceIds()[key], quantity: 1 }],
          customer_email: email,
          payment_method_collection: "always",
          subscription_data: {
            trial_period_days: 7,
            metadata: { product_key: key },
          },
          metadata: { product_key: key },
          allow_promotion_codes: false,
          success_url: `${SIGN_IN}?email=${encodeURIComponent(email)}&trial=started`,
          cancel_url: PRICING,
        });
        if (!session.url) return new Response("Could not start checkout", { status: 502 });
        return redirect(session.url);
      },
    },
  },
});
