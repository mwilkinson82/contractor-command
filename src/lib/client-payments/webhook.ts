// Stripe's events for client payments, from the endpoint Athena makes on its Connect platform account.
//
// Nothing in the posted body is trusted. The event id and account are read from it only to fetch the event back
// from Stripe with Athena's own key, so a forged post either names an event Stripe doesn't have (refused) or one it
// does (harmless to process again: every step below is idempotent). That is why no webhook signing secret has to be
// pasted anywhere. Each event is handled once; a failure answers 500 so Stripe sends it again.
import { recordJobNotice, type NoticeDeps } from "@/lib/notices/send";
import type { ConnectStripe, CheckoutSessionLike } from "./client";
import { accountReadiness, CHECKOUT_KIND, money, type AccountLike, type PayMode } from "./stripe";

export type WebhookDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  stripe: (mode: PayMode) => ConnectStripe;
  configured: (mode: PayMode) => boolean;
  notice?: NoticeDeps;
  log?: (msg: string) => void;
};

type Reply = { status: number; body: string };
const reply = (status: number, body: string): Reply => ({ status, body });

const idOf = (v: unknown): string | null =>
  typeof v === "string"
    ? v
    : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string"
      ? (v as { id: string }).id
      : null;

type PaySession = {
  status: "processing" | "paid" | "failed" | "expired";
  paymentIntent: string | null;
  charge: string | null;
  method: "card" | "bank" | null;
  amountCents: number | null;
  feeCents: number | null;
  paidAt: string | null;
};

/** Where a Checkout session stands, read from Stripe's fresh copy of it. Null while it's still open. */
export function sessionOutcome(s: CheckoutSessionLike): PaySession | null {
  const pi = s.payment_intent && typeof s.payment_intent === "object" ? s.payment_intent : null;
  const ch = pi?.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  const type = ch?.payment_method_details?.type ?? null;
  const base = {
    paymentIntent: idOf(s.payment_intent),
    charge: idOf(pi?.latest_charge ?? null),
    method:
      type === "card" ? ("card" as const) : type === "us_bank_account" ? ("bank" as const) : null,
    amountCents: typeof s.amount_total === "number" ? s.amount_total : null,
    feeCents: typeof pi?.application_fee_amount === "number" ? pi.application_fee_amount : null,
    paidAt: null as string | null,
  };
  if (s.status === "expired") return { ...base, status: "expired" };
  if (s.status !== "complete") return null;
  if (s.payment_status === "paid")
    return {
      ...base,
      status: "paid",
      paidAt: ch?.created ? new Date(ch.created * 1000).toISOString() : null,
    };
  // Complete but unpaid: a bank payment on its way, or one that came back.
  if (pi?.status === "processing" || pi?.status === "succeeded")
    return { ...base, status: "processing" };
  return { ...base, status: "failed" };
}

type Changed = {
  status: string;
  payment_id: string;
  payment_status: string;
  job_id: string;
  label: string | null;
  customer: string | null;
  amount_cents: number;
  method?: string | null;
  test: boolean;
  applied?: boolean;
  booked?: boolean;
  refunded_cents?: number;
  refunded_total_cents?: number;
};

const who = (c: Changed) => c.customer?.trim() || "Your client";
const what = (c: Changed) => c.label?.trim() || "the pay application";
const testMark = (c: Changed) => (c.test ? "Test payment: " : "");

async function notify(deps: WebhookDeps, c: Changed): Promise<void> {
  if (!deps.notice) return;
  const by = c.method === "bank" ? " by bank" : c.method === "card" ? " by card" : "";
  let kind: string;
  let title: string;
  let detail: string;
  if (c.payment_status === "paid") {
    kind = "pay_app_paid";
    title = `${testMark(c)}${who(c)} paid ${money(c.amount_cents)} on ${what(c)}${by}`;
    detail = c.applied
      ? "Recorded as a receipt and applied to the pay application."
      : "Recorded as a receipt. It wasn't applied to the pay application automatically, so apply it on the billing page.";
  } else if (c.payment_status === "processing") {
    kind = "pay_app_payment_processing";
    title = `${testMark(c)}${who(c)} started a ${money(c.amount_cents)} bank payment on ${what(c)}`;
    detail =
      "Bank payments take a few business days to clear. You'll get another notice when it does.";
  } else if (c.payment_status === "failed") {
    kind = "pay_app_payment_failed";
    title = `${testMark(c)}${who(c)}'s ${money(c.amount_cents)} payment on ${what(c)} didn't go through`;
    detail = "Nothing was recorded. Your client can try again from their client page.";
  } else if (c.payment_status === "refunded" || c.payment_status === "partially_refunded") {
    kind = "pay_app_refunded";
    title = `${testMark(c)}${money(c.refunded_cents ?? 0)} refunded to ${who(c)} on ${what(c)}`;
    detail =
      c.payment_status === "refunded"
        ? "The whole payment was refunded and taken back off the job's billing."
        : `Refunded so far: ${money(c.refunded_total_cents ?? 0)} of ${money(c.amount_cents)}. The refund was taken back off the job's billing.`;
  } else return;
  await recordJobNotice(deps.notice, {
    jobId: c.job_id,
    topic: "client_decision",
    kind,
    title,
    detail,
    actor: c.customer ?? null,
    refTable: "mcp_portal_payments",
    refId: c.payment_id,
    facts: {
      amount_cents: c.amount_cents,
      ...(c.refunded_cents ? { refunded_cents: c.refunded_cents } : {}),
      ...(c.test ? { test: true } : {}),
    },
    boardPage: "billing",
    dedupeKey: `client_pay:${c.payment_id}:${kind}:${c.refunded_total_cents ?? ""}`,
  }).catch(() => null);
}

async function process(
  deps: WebhookDeps,
  mode: PayMode,
  account: string,
  type: string,
  obj: Record<string, unknown>,
) {
  if (type === "account.updated") {
    await deps.rpc("mcp_client_payments_account_status", {
      _account: account,
      _livemode: mode === "live",
      _status: accountReadiness(obj as unknown as AccountLike),
    });
    return;
  }
  if (type.startsWith("checkout.session.")) {
    const meta = (obj.metadata ?? {}) as Record<string, string>;
    if (meta.athena_kind !== CHECKOUT_KIND || typeof obj.id !== "string") return;
    const fresh = await deps.stripe(mode).retrieveCheckout(obj.id, { stripeAccount: account });
    const o = sessionOutcome(fresh);
    if (!o) return;
    const r = (await deps.rpc("mcp_portal_pay_update", {
      _session: fresh.id,
      _account: account,
      _status: o.status,
      _payment_intent: o.paymentIntent,
      _charge: o.charge,
      _method: o.method,
      _amount_cents: o.amountCents,
      _fee_cents: o.feeCents,
      _paid_at: o.paidAt,
    })) as Changed | null;
    if (r?.status === "changed") await notify(deps, r);
    return;
  }
  if (type === "charge.refunded") {
    const pi = idOf(obj.payment_intent);
    const total = obj.amount_refunded;
    if (!pi || typeof total !== "number") return;
    const r = (await deps.rpc("mcp_portal_pay_refunded", {
      _payment_intent: pi,
      _account: account,
      _refunded_total_cents: total,
    })) as Changed | null;
    if (r?.status === "changed") await notify(deps, r);
  }
}

export async function handleConnectWebhook(body: string, deps: WebhookDeps): Promise<Reply> {
  let posted: { id?: unknown; account?: unknown; livemode?: unknown };
  try {
    posted = JSON.parse(body);
  } catch {
    return reply(400, "Bad request");
  }
  const id =
    typeof posted?.id === "string" && /^evt_[A-Za-z0-9]+$/.test(posted.id) ? posted.id : null;
  const account =
    typeof posted?.account === "string" && /^acct_[A-Za-z0-9]+$/.test(posted.account)
      ? posted.account
      : null;
  if (!id || !account || typeof posted.livemode !== "boolean") return reply(400, "Bad request");
  const mode: PayMode = posted.livemode ? "live" : "test";
  if (!deps.configured(mode)) return reply(503, "Not configured");

  let event;
  try {
    event = await deps.stripe(mode).retrieveEvent(id, { stripeAccount: account });
  } catch {
    // Stripe doesn't have this event on that account: not ours to act on.
    return reply(400, "Unknown event");
  }
  if (!event || event.id !== id || event.livemode !== posted.livemode)
    return reply(400, "Unknown event");

  const claim = (await deps
    .rpc("mcp_stripe_connect_event_claim", {
      _event: id,
      _type: event.type,
      _livemode: event.livemode,
      _account: account,
    })
    .catch(() => null)) as string | null;
  if (claim === "done") return reply(200, "Already handled");
  if (claim === "busy") return reply(409, "In progress");
  if (claim !== "fresh" && claim !== "retry") return reply(500, "Try again");

  try {
    await process(deps, mode, account, event.type, event.data?.object ?? {});
  } catch {
    deps.log?.(`client payments: ${event.type} ${id} failed`);
    await deps
      .rpc("mcp_stripe_connect_event_finish", { _event: id, _processed: false })
      .catch(() => null);
    return reply(500, "Try again");
  }
  await deps
    .rpc("mcp_stripe_connect_event_finish", { _event: id, _processed: true })
    .catch(() => null);
  return reply(200, "OK");
}
