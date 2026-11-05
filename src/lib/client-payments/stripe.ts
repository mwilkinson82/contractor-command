// Client payments through Stripe Connect: the pieces that never touch the network.
//
// Athena has its own Stripe platform account for client payments, apart from the account ALP bills members on. Its
// keys are ATHENA_CONNECT_SECRET_KEY_TEST and ATHENA_CONNECT_SECRET_KEY_LIVE, pasted into Lovable by the owner; this
// code never logs or returns them. Each contractor connects their own Stripe account to it. A customer's payment is
// a direct charge on the contractor's account (they're the merchant of record and carry Stripe's fees and losses
// handling), and Athena's fee is the application fee: ATHENA_CONNECT_FEE_BPS of the amount, capped at
// ATHENA_CONNECT_FEE_CAP_CENTS. Both are 0 until set. Athena never holds the money.

export type PayMode = "test" | "live";
export type Readiness = "not_connected" | "action_required" | "under_review" | "restricted" | "ready";

/** The only Stripe API version this code is written and tested against. */
export const CONNECT_API_VERSION = "2024-12-18.acacia";
/** Where Stripe sends client payment events. One endpoint per mode, for connected accounts. */
export const CONNECT_WEBHOOK_PATH = "/api/public/athena/connect-webhook";
/** Marks the endpoint Athena made, so a second connect finds it instead of making another. */
export const CONNECT_WEBHOOK_TAG = "athena_client_payments";
/** Events the endpoint listens for. */
export const CONNECT_WEBHOOK_EVENTS = [
  "account.updated",
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
] as const;
/** What a Checkout session carries so the webhook knows it's a client page payment. */
export const CHECKOUT_KIND = "athena_pay_app";

export class ClientPaymentsNotConfigured extends Error {
  constructor(readonly mode: PayMode) {
    super(`Client payments aren't set up for ${mode} mode yet.`);
  }
}

/**
 * The secret key for a mode, refused unless it really is that mode's key, so test mode can't move real money and
 * live mode can't quietly run on a test key.
 */
export function connectKey(mode: PayMode, env: Record<string, string | undefined>): string {
  const key = (
    mode === "live" ? env.ATHENA_CONNECT_SECRET_KEY_LIVE : env.ATHENA_CONNECT_SECRET_KEY_TEST
  )?.trim();
  const prefix = mode === "live" ? /^(sk|rk)_live_/ : /^(sk|rk)_test_/;
  if (!key || !prefix.test(key)) throw new ClientPaymentsNotConfigured(mode);
  return key;
}

/** Whether a mode has a usable key, without exposing it. */
export function connectConfigured(mode: PayMode, env: Record<string, string | undefined>): boolean {
  try {
    connectKey(mode, env);
    return true;
  } catch {
    return false;
  }
}

export type FeeConfig = { bps: number; capCents: number };

const wholeNumber = (v: string | undefined, max: number): number => {
  const n = Number((v ?? "").trim());
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : 0;
};

/** Athena's fee setting. bps is capped at 300 (3%); a cap of 0 means no cap. Anything unreadable counts as 0. */
export function feeConfig(env: Record<string, string | undefined>): FeeConfig {
  return {
    bps: wholeNumber(env.ATHENA_CONNECT_FEE_BPS, 300),
    capCents: wholeNumber(env.ATHENA_CONNECT_FEE_CAP_CENTS, 100_000_000),
  };
}

/** Athena's application fee on a payment, in cents: rounded down, capped, and always less than the payment. */
export function applicationFeeCents(amountCents: number, fee: FeeConfig): number {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return 0;
  let cents = Math.floor((amountCents * fee.bps) / 10_000);
  if (fee.capCents > 0) cents = Math.min(cents, fee.capCents);
  return Math.max(0, Math.min(cents, amountCents - 1));
}

/** The fields of a Stripe account this code reads. */
export type AccountLike = {
  id: string;
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  details_submitted?: boolean | null;
  requirements?: {
    currently_due?: string[] | null;
    past_due?: string[] | null;
    disabled_reason?: string | null;
  } | null;
};

/**
 * Where the contractor's Stripe setup stands. Ready means Stripe lets the account take payments and pay out.
 * Restricted means Stripe paused it or something is overdue; action required means Stripe needs more from them;
 * under review means they've sent everything and Stripe is checking.
 */
export function accountReadiness(a: AccountLike): Readiness {
  if (a.charges_enabled && a.payouts_enabled && a.details_submitted) return "ready";
  const r = a.requirements ?? {};
  const reason = r.disabled_reason ?? "";
  if ((r.past_due?.length ?? 0) > 0 || (reason && !/pending_verification|under_review/.test(reason)))
    return "restricted";
  if ((r.currently_due?.length ?? 0) > 0 || !a.details_submitted) return "action_required";
  return "under_review";
}

/** Dollars as the page and notices show them. */
export function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
