// 0.8.16: Athena plan/seat webhook (separate endpoint and signing secret from the Hub webhook).
// Needs STRIPE_SECRET_KEY + ATHENA_STRIPE_WEBHOOK_SECRET. Not registered in Stripe yet (Marshall/Cash decide).
import { createFileRoute } from "@tanstack/react-router";
import Stripe from "stripe";
import { handleAthenaBillingWebhook, type EntitlementRow } from "@/lib/athena-billing";

export const Route = createFileRoute("/api/public/athena/stripe-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.STRIPE_SECRET_KEY;
        if (!key) return new Response("Server not configured", { status: 500 });
        const stripe = new Stripe(key, { apiVersion: "2024-12-18.acacia" as never });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const store = {
          upsert: async (row: EntitlementRow) => {
            const { error } = await (supabaseAdmin as unknown as { from: (t: string) => { upsert: (r: unknown, o: unknown) => Promise<{ error: unknown }> } })
              .from("mcp_company_entitlements").upsert(row, { onConflict: "company_id" });
            if (error) throw new Error("entitlement write failed");
          },
        };
        const r = await handleAthenaBillingWebhook(
          { body: await request.text(), signature: request.headers.get("stripe-signature") },
          { stripe: stripe as never, store, secret: process.env.ATHENA_STRIPE_WEBHOOK_SECRET },
        );
        return new Response(r.body, { status: r.status });
      },
    },
  },
});
