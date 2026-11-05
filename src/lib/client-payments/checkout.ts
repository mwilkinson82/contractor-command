// A customer paying an approved pay application from their client page. The database decides whether they may pay
// and how much (the pay app's current amount due); this opens a Stripe Checkout page on the contractor's own Stripe
// account for exactly that amount and sends the customer there. Athena's fee rides along as the application fee.
import type { CheckoutCreate, ConnectStripe } from "./client";
import { applicationFeeCents, CHECKOUT_KIND, type FeeConfig, type PayMode } from "./stripe";

export type PayMethod = "card" | "bank";
const STRIPE_METHOD = { card: "card", bank: "us_bank_account" } as const;

export type CheckoutDeps = {
  /** Service-role rpc. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  stripe: (mode: PayMode) => ConnectStripe;
  fee: () => FeeConfig;
  /** The origin the customer's page is on, for Stripe's return links. */
  origin: string;
};

type Start = {
  status: string;
  company_id: string;
  job_id: string;
  item_id: string;
  access_id: string;
  mode: PayMode;
  account_id: string;
  amount_cents: number;
  email: string | null;
  customer: string | null;
  label: string | null;
  job_number: string | null;
  job_name: string | null;
  company: string | null;
  card: boolean;
  bank: boolean;
  open_session: {
    checkout_session_id: string;
    methods: string[];
    amount_cents: number;
    mode: PayMode;
    account_id: string;
  } | null;
};

export type OpenCheckoutResult =
  | { status: "redirect"; url: string }
  /** Why the customer can't pay right now; the page explains it. */
  | {
      status:
        | "unknown"
        | "signed_out"
        | "invalid"
        | "not_approved"
        | "nothing_due"
        | "not_accepting"
        | "already_paid"
        | "method"
        | "error"
        | string;
    };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function openCheckout(
  deps: CheckoutDeps,
  p: { access: string; sessionHash: string; item: string; method: PayMethod },
): Promise<OpenCheckoutResult> {
  let s: Start;
  try {
    s = (await deps.rpc("mcp_portal_pay_start", {
      _access: p.access,
      _session_hash: p.sessionHash,
      _item: p.item,
    })) as Start;
  } catch {
    return { status: "error" };
  }
  if (s?.status !== "ok") return { status: s?.status ?? "error" };
  if ((p.method === "card" && !s.card) || (p.method === "bank" && !s.bank))
    return { status: "method" };

  const stripe = deps.stripe(s.mode);
  const methods = [STRIPE_METHOD[p.method]];
  const amount = Number(s.amount_cents);
  const acct = { stripeAccount: s.account_id };

  // Reuse the session already open for this payment when it still matches; otherwise close it first, so the
  // customer can never complete two Checkout pages for the same pay app.
  const prev = s.open_session;
  if (prev) {
    const same =
      prev.mode === s.mode &&
      prev.account_id === s.account_id &&
      Number(prev.amount_cents) === amount &&
      prev.methods.length === 1 &&
      prev.methods[0] === methods[0];
    try {
      const old = await stripe.retrieveCheckout(prev.checkout_session_id, {
        stripeAccount: prev.account_id,
      });
      if (same && old.status === "open" && old.url) return { status: "redirect", url: old.url };
      if (old.status === "complete") return { status: "already_paid" };
      if (old.status === "open")
        await stripe.expireCheckout(prev.checkout_session_id, { stripeAccount: prev.account_id });
    } catch {
      return { status: "error" };
    }
  }

  const fee = applicationFeeCents(amount, deps.fee());
  const page = `${deps.origin}/c/${s.access_id}`;
  const back = (extra: Record<string, string>) =>
    `${page}?${new URLSearchParams({ s: "billing", i: s.item_id, ...extra }).toString()}`;
  const label = clip(s.label || "Pay application", 120);
  const where = [s.job_number, s.job_name].filter(Boolean).join(" ");
  const metadata = {
    athena_kind: CHECKOUT_KIND,
    athena_item_id: s.item_id,
    athena_job_id: s.job_id,
    athena_company_id: s.company_id,
    athena_access_id: s.access_id,
    athena_mode: s.mode,
  };
  const create: CheckoutCreate = {
    mode: "payment",
    payment_method_types: methods,
    ...(s.email ? { customer_email: s.email } : {}),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amount,
          product_data: {
            name: label,
            ...(where
              ? { description: clip(`${s.company ?? ""} · ${where}`.replace(/^ · /, ""), 300) }
              : {}),
          },
        },
      },
    ],
    payment_intent_data: {
      ...(fee > 0 ? { application_fee_amount: fee } : {}),
      description: clip(`${label}${where ? ` · ${where}` : ""}`, 300),
      metadata,
    },
    ...(p.method === "bank"
      ? {
          payment_method_options: {
            us_bank_account: { verification_method: "automatic" as const },
          },
        }
      : {}),
    metadata,
    success_url: back({ paid: "1" }),
    cancel_url: back({}),
  };

  let made;
  try {
    made = await stripe.createCheckout(create, {
      ...acct,
      // The same click retried makes the same session; a new session after closing one gets a new key.
      idempotencyKey: `athena-pay:${s.item_id}:${p.method}:${amount}:${fee}:${prev?.checkout_session_id ?? "first"}`,
    });
  } catch {
    return { status: "error" };
  }
  if (!made?.id || !made.url) return { status: "error" };
  try {
    await deps.rpc("mcp_portal_pay_opened", {
      _item: s.item_id,
      _access: s.access_id,
      _mode: s.mode,
      _account: s.account_id,
      _session: made.id,
      _methods: methods,
      _amount_cents: amount,
      _fee_cents: fee,
    });
  } catch {
    // Not kept, so no one could match its payment: close it rather than let the customer pay into it.
    await stripe.expireCheckout(made.id, acct).catch(() => null);
    return { status: "error" };
  }
  return { status: "redirect", url: made.url };
}
