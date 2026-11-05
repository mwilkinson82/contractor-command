// The real Stripe client for client payments, on Athena's Connect platform account for the given mode.
import Stripe from "stripe";
import type { ConnectStripe } from "./client";
import { CONNECT_API_VERSION, connectKey, type PayMode } from "./stripe";

export function connectStripe(mode: PayMode, env = process.env): ConnectStripe {
  const stripe = new Stripe(connectKey(mode, env), {
    apiVersion: CONNECT_API_VERSION as never,
    maxNetworkRetries: 1,
    appInfo: { name: "Athena client payments" },
  });
  return {
    async createAccount(p, idempotencyKey) {
      // The contractor is the merchant: Stripe collects their details, they pay Stripe's fees, Stripe covers
      // losses, and they get the full Stripe Dashboard to see payouts and issue refunds.
      return (await stripe.accounts.create(
        {
          country: "US",
          ...(p.email ? { email: p.email } : {}),
          business_type: "company",
          business_profile: { name: p.companyName.slice(0, 100) },
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
            us_bank_account_ach_payments: { requested: true },
          },
          controller: {
            fees: { payer: "account" },
            losses: { payments: "stripe" },
            requirement_collection: "stripe",
            stripe_dashboard: { type: "full" },
          },
          metadata: { athena_company_id: p.companyId, athena_user_id: p.userId, athena_mode: p.mode },
        } as never,
        { idempotencyKey },
      )) as never;
    },
    async retrieveAccount(account) {
      return (await stripe.accounts.retrieve(account)) as never;
    },
    async accountLink(p) {
      const link = await stripe.accountLinks.create({ ...p, type: "account_onboarding" });
      return { url: link.url };
    },
    async listWebhookEndpoints() {
      const list = await stripe.webhookEndpoints.list({ limit: 100 });
      return list.data.map((w) => ({ id: w.id, url: w.url, metadata: w.metadata }));
    },
    async createWebhookEndpoint(p) {
      const w = await stripe.webhookEndpoints.create({
        ...p,
        enabled_events: p.enabled_events as never,
        api_version: CONNECT_API_VERSION as never,
      });
      return { id: w.id };
    },
    async createCheckout(p, opts) {
      return (await stripe.checkout.sessions.create(p as never, opts)) as never;
    },
    async retrieveCheckout(id, opts) {
      return (await stripe.checkout.sessions.retrieve(
        id,
        { expand: ["payment_intent.latest_charge"] },
        opts,
      )) as never;
    },
    async expireCheckout(id, opts) {
      return (await stripe.checkout.sessions.expire(id, {}, opts)) as never;
    },
    async retrieveEvent(id, opts) {
      return (await stripe.events.retrieve(
        id,
        {},
        opts.stripeAccount ? { stripeAccount: opts.stripeAccount } : undefined,
      )) as never;
    },
  };
}
