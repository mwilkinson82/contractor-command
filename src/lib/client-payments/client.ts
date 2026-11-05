// The slice of the Stripe API client payments use, so the flows can be tested without Stripe. stripe.server.ts maps
// it onto the real SDK. Every call on a contractor's account passes that account, so it runs on their account.
import type { AccountLike } from "./stripe";

export type CheckoutSessionLike = {
  id: string;
  url?: string | null;
  status?: "open" | "complete" | "expired" | null;
  payment_status?: "paid" | "unpaid" | "no_payment_required" | null;
  amount_total?: number | null;
  metadata?: Record<string, string> | null;
  payment_intent?:
    | string
    | {
        id: string;
        status?: string | null;
        application_fee_amount?: number | null;
        latest_charge?:
          | string
          | {
              id: string;
              created?: number | null;
              payment_method_details?: { type?: string | null } | null;
            }
          | null;
      }
    | null;
};

export type EventLike = {
  id: string;
  type: string;
  livemode: boolean;
  account?: string | null;
  created?: number;
  data: { object: Record<string, unknown> };
};

export type CheckoutCreate = {
  mode: "payment";
  payment_method_types: ("card" | "us_bank_account")[];
  customer_email?: string;
  line_items: {
    quantity: 1;
    price_data: {
      currency: "usd";
      unit_amount: number;
      product_data: { name: string; description?: string };
    };
  }[];
  payment_intent_data: {
    application_fee_amount?: number;
    description: string;
    metadata: Record<string, string>;
  };
  payment_method_options?: {
    us_bank_account?: { verification_method: "automatic" | "instant" };
  };
  metadata: Record<string, string>;
  success_url: string;
  cancel_url: string;
  expires_at?: number;
};

export type ConnectStripe = {
  createAccount(
    p: { companyId: string; companyName: string; email: string | null; userId: string; mode: string },
    idempotencyKey: string,
  ): Promise<AccountLike>;
  retrieveAccount(account: string): Promise<AccountLike>;
  accountLink(p: {
    account: string;
    refresh_url: string;
    return_url: string;
  }): Promise<{ url: string }>;
  /** Webhook endpoints on the platform account, for finding the one Athena made. */
  listWebhookEndpoints(): Promise<{ id: string; url: string; metadata?: Record<string, string> | null }[]>;
  createWebhookEndpoint(p: {
    url: string;
    enabled_events: string[];
    connect: true;
    description: string;
    metadata: Record<string, string>;
  }): Promise<{ id: string }>;
  createCheckout(
    p: CheckoutCreate,
    opts: { stripeAccount: string; idempotencyKey: string },
  ): Promise<CheckoutSessionLike>;
  retrieveCheckout(id: string, opts: { stripeAccount: string }): Promise<CheckoutSessionLike>;
  expireCheckout(id: string, opts: { stripeAccount: string }): Promise<CheckoutSessionLike>;
  /** Re-reads an event from Stripe: the webhook trusts only what this returns. */
  retrieveEvent(id: string, opts: { stripeAccount?: string }): Promise<EventLike>;
};
