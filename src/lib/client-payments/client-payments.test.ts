import { describe, expect, it, vi } from "vitest";
import type { CheckoutCreate, CheckoutSessionLike, ConnectStripe, EventLike } from "./client";
import {
  accountReadiness,
  applicationFeeCents,
  connectConfigured,
  connectKey,
  feeConfig,
  CONNECT_WEBHOOK_PATH,
} from "./stripe";
import { ensureWebhook, refreshConnect, startConnect } from "./connect";
import { openCheckout } from "./checkout";
import { handleConnectWebhook, sessionOutcome } from "./webhook";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const ACCESS = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const JOB = "44444444-4444-4444-8444-444444444444";

function fakeStripe(over: Partial<ConnectStripe> = {}) {
  const calls: { fn: string; args: unknown[] }[] = [];
  const rec =
    <T>(fn: string, out: (...a: unknown[]) => T) =>
    async (...a: unknown[]) => {
      calls.push({ fn, args: a });
      return out(...a);
    };
  const s: ConnectStripe = {
    createAccount: rec("createAccount", () => ({ id: "acct_NEW", details_submitted: false })),
    retrieveAccount: rec("retrieveAccount", () => ({
      id: "acct_NEW",
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
    })),
    accountLink: rec("accountLink", () => ({ url: "https://connect.stripe.com/setup/x" })),
    listWebhookEndpoints: rec("listWebhookEndpoints", () => []),
    createWebhookEndpoint: rec("createWebhookEndpoint", () => ({ id: "we_1" })),
    createCheckout: rec("createCheckout", () => ({
      id: "cs_new",
      url: "https://checkout.stripe.com/c/new",
    })),
    retrieveCheckout: rec("retrieveCheckout", () => ({
      id: "cs_old",
      status: "open",
      url: "https://checkout.stripe.com/c/old",
    })),
    expireCheckout: rec("expireCheckout", () => ({ id: "cs_old", status: "expired" })),
    retrieveEvent: rec("retrieveEvent", () => {
      throw new Error("no such event");
    }),
    ...over,
  } as ConnectStripe;
  return { s, calls };
}

function fakeRpc(answers: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    const a = answers[fn];
    return typeof a === "function" ? (a as (x: Record<string, unknown>) => unknown)(args) : a;
  };
  return { rpc, calls };
}

describe("keys, fee and readiness", () => {
  it("only takes a key of the matching mode", () => {
    expect(connectKey("test", { ATHENA_CONNECT_SECRET_KEY_TEST: " sk_test_abc " })).toBe(
      "sk_test_abc",
    );
    expect(connectKey("test", { ATHENA_CONNECT_SECRET_KEY_TEST: "rk_test_abc" })).toBe(
      "rk_test_abc",
    );
    expect(() => connectKey("test", { ATHENA_CONNECT_SECRET_KEY_TEST: "sk_live_abc" })).toThrow();
    expect(() => connectKey("live", { ATHENA_CONNECT_SECRET_KEY_LIVE: "sk_test_abc" })).toThrow();
    expect(connectConfigured("live", {})).toBe(false);
  });

  it("works out Athena's fee: rounded down, capped, never the whole payment", () => {
    expect(feeConfig({})).toEqual({ bps: 0, capCents: 0 });
    expect(feeConfig({ ATHENA_CONNECT_FEE_BPS: "900", ATHENA_CONNECT_FEE_CAP_CENTS: "x" })).toEqual(
      {
        bps: 300,
        capCents: 0,
      },
    );
    const fee = { bps: 50, capCents: 50_00 };
    expect(applicationFeeCents(1_234_567, fee)).toBe(5_000); // 0.5% is $61.72, capped at $50
    expect(applicationFeeCents(100_000, fee)).toBe(500);
    expect(applicationFeeCents(199, fee)).toBe(0);
    expect(applicationFeeCents(1, { bps: 300, capCents: 0 })).toBe(0);
    expect(applicationFeeCents(0, fee)).toBe(0);
  });

  it("reads where a contractor's Stripe setup stands", () => {
    expect(
      accountReadiness({
        id: "a",
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
      }),
    ).toBe("ready");
    expect(accountReadiness({ id: "a", details_submitted: false })).toBe("action_required");
    expect(
      accountReadiness({
        id: "a",
        details_submitted: true,
        requirements: { disabled_reason: "requirements.pending_verification" },
      }),
    ).toBe("under_review");
    expect(
      accountReadiness({ id: "a", details_submitted: true, requirements: { past_due: ["x"] } }),
    ).toBe("restricted");
    expect(
      accountReadiness({
        id: "a",
        details_submitted: true,
        requirements: { disabled_reason: "rejected.fraud" },
      }),
    ).toBe("restricted");
  });
});

describe("connecting a contractor's Stripe", () => {
  const server = (over: Record<string, unknown> = {}) => ({
    company_id: COMPANY,
    company: "ALP Construction",
    mode: "test",
    account_test: null,
    account_live: null,
    status_test: "not_connected",
    status_live: "not_connected",
    ...over,
  });

  it("makes the account once, saves it, makes the webhook once and returns Stripe's setup page", async () => {
    const { s, calls } = fakeStripe();
    const db = fakeRpc({
      mcp_client_payments_server_get: server(),
      mcp_client_payments_account_save: {},
    });
    const r = await startConnect(
      { rpc: db.rpc, stripe: () => s, origin: "https://app.meetathena.io" },
      { companyId: COMPANY, mode: "test", userId: "u1", email: "owner@alp.test" },
    );
    expect(r.url).toBe("https://connect.stripe.com/setup/x");
    const made = calls.find((c) => c.fn === "createAccount")!;
    expect(made.args[1]).toBe(`athena-connect:${COMPANY}:test`);
    expect(db.calls.find((c) => c.fn === "mcp_client_payments_account_save")!.args).toMatchObject({
      _company: COMPANY,
      _mode: "test",
      _account: "acct_NEW",
      _status: "action_required",
      _by: "u1",
    });
    const hook = calls.find((c) => c.fn === "createWebhookEndpoint")!.args[0] as Record<
      string,
      unknown
    >;
    expect(hook).toMatchObject({
      url: `https://app.meetathena.io${CONNECT_WEBHOOK_PATH}`,
      connect: true,
    });
    const link = calls.find((c) => c.fn === "accountLink")!.args[0] as Record<string, string>;
    expect(link.return_url).toBe(
      "https://app.meetathena.io/account?payments=return&mode=test#payments",
    );
  });

  it("continues setup on the saved account without making another", async () => {
    const { s, calls } = fakeStripe({
      listWebhookEndpoints: async () => [
        {
          id: "we_9",
          url: `https://app.meetathena.io${CONNECT_WEBHOOK_PATH}`,
          metadata: { athena: "athena_client_payments" },
        },
      ],
    });
    const db = fakeRpc({ mcp_client_payments_server_get: server({ account_test: "acct_OLD" }) });
    await startConnect(
      { rpc: db.rpc, stripe: () => s, origin: "https://app.meetathena.io" },
      { companyId: COMPANY, mode: "test", userId: "u1", email: null },
    );
    expect(calls.map((c) => c.fn)).toEqual(["accountLink"]);
    expect((calls[0].args[0] as { account: string }).account).toBe("acct_OLD");
  });

  it("finds its own webhook endpoint and leaves other endpoints alone", async () => {
    const { s } = fakeStripe({
      listWebhookEndpoints: async () => [
        { id: "we_other", url: `https://app.meetathena.io${CONNECT_WEBHOOK_PATH}`, metadata: {} },
      ],
    });
    expect(await ensureWebhook(s, "https://app.meetathena.io")).toBe("we_1");
  });

  it("refreshes only the modes that are connected and configured", async () => {
    const { s, calls } = fakeStripe();
    const db = fakeRpc({
      mcp_client_payments_server_get: server({ account_test: "acct_T", account_live: "acct_L" }),
      mcp_client_payments_account_save: {},
    });
    await refreshConnect(
      { rpc: db.rpc, stripe: () => s, origin: "https://x" },
      { companyId: COMPANY, userId: "u1", configured: (m) => m === "test" },
    );
    expect(calls.map((c) => c.args[0])).toEqual(["acct_T"]);
    expect(
      db.calls.filter((c) => c.fn === "mcp_client_payments_account_save")[0].args,
    ).toMatchObject({
      _mode: "test",
      _status: "ready",
    });
  });
});

describe("a customer paying from their client page", () => {
  const start = (over: Record<string, unknown> = {}) => ({
    status: "ok",
    company_id: COMPANY,
    job_id: JOB,
    item_id: ITEM,
    access_id: ACCESS,
    mode: "test",
    account_id: "acct_C",
    amount_cents: 1_000_000,
    email: "rosa@client.test",
    customer: "Rosa Delgado",
    label: "Pay application #3",
    job_number: "2810",
    job_name: "Harbor Lofts",
    company: "ALP Construction",
    card: true,
    bank: true,
    open_session: null,
    ...over,
  });
  const deps = (
    s: ConnectStripe,
    rpc: (f: string, a: Record<string, unknown>) => Promise<unknown>,
  ) => ({
    rpc,
    stripe: () => s,
    fee: () => ({ bps: 50, capCents: 2_500 }),
    origin: "https://app.meetathena.io",
  });
  const pay = { access: ACCESS, sessionHash: "h", item: ITEM };

  it("opens a Checkout page on the contractor's account for the amount due, with Athena's fee", async () => {
    const { s, calls } = fakeStripe();
    const db = fakeRpc({ mcp_portal_pay_start: start(), mcp_portal_pay_opened: { status: "ok" } });
    const r = await openCheckout(deps(s, db.rpc), { ...pay, method: "bank" });
    expect(r).toEqual({ status: "redirect", url: "https://checkout.stripe.com/c/new" });
    const [create, opts] = calls.find((c) => c.fn === "createCheckout")!.args as [
      CheckoutCreate,
      Record<string, string>,
    ];
    expect(opts.stripeAccount).toBe("acct_C");
    expect(create.payment_method_types).toEqual(["us_bank_account"]);
    expect(create.line_items[0].price_data.unit_amount).toBe(1_000_000);
    expect(create.payment_intent_data.application_fee_amount).toBe(2_500);
    expect(create.metadata.athena_kind).toBe("athena_pay_app");
    expect(create.success_url).toBe(
      `https://app.meetathena.io/c/${ACCESS}?s=billing&i=${ITEM}&paid=1`,
    );
    expect(JSON.stringify(create)).not.toMatch(/fee_pct|markup|cost/i);
    expect(db.calls.find((c) => c.fn === "mcp_portal_pay_opened")!.args).toMatchObject({
      _session: "cs_new",
      _methods: ["us_bank_account"],
      _amount_cents: 1_000_000,
      _fee_cents: 2_500,
    });
  });

  it("leaves the fee off when Athena's fee is 0", async () => {
    const { s, calls } = fakeStripe();
    const db = fakeRpc({ mcp_portal_pay_start: start(), mcp_portal_pay_opened: { status: "ok" } });
    await openCheckout(
      { ...deps(s, db.rpc), fee: () => ({ bps: 0, capCents: 0 }) },
      { ...pay, method: "card" },
    );
    const [create] = calls.find((c) => c.fn === "createCheckout")!.args as [CheckoutCreate];
    expect(create.payment_intent_data.application_fee_amount).toBeUndefined();
    expect(create.payment_method_types).toEqual(["card"]);
  });

  it("refuses a way to pay the contractor turned off or a card over the card limit", async () => {
    const { s, calls } = fakeStripe();
    const db = fakeRpc({ mcp_portal_pay_start: start({ card: false }) });
    expect(await openCheckout(deps(s, db.rpc), { ...pay, method: "card" })).toEqual({
      status: "method",
    });
    expect(calls).toEqual([]);
  });

  it("passes on why the database said no", async () => {
    const { s } = fakeStripe();
    for (const st of [
      "not_approved",
      "nothing_due",
      "not_accepting",
      "already_paid",
      "signed_out",
    ]) {
      const db = fakeRpc({ mcp_portal_pay_start: { status: st } });
      expect(await openCheckout(deps(s, db.rpc), { ...pay, method: "bank" })).toEqual({
        status: st,
      });
    }
  });

  it("sends the customer back to the same open page when nothing changed", async () => {
    const { s, calls } = fakeStripe();
    const open = {
      checkout_session_id: "cs_old",
      methods: ["card"],
      amount_cents: 1_000_000,
      mode: "test",
      account_id: "acct_C",
    };
    const db = fakeRpc({ mcp_portal_pay_start: start({ open_session: open }) });
    const r = await openCheckout(deps(s, db.rpc), { ...pay, method: "card" });
    expect(r).toEqual({ status: "redirect", url: "https://checkout.stripe.com/c/old" });
    expect(calls.map((c) => c.fn)).toEqual(["retrieveCheckout"]);
  });

  it("closes the old page before opening a new one for another way to pay", async () => {
    const { s, calls } = fakeStripe();
    const open = {
      checkout_session_id: "cs_old",
      methods: ["card"],
      amount_cents: 1_000_000,
      mode: "test",
      account_id: "acct_C",
    };
    const db = fakeRpc({
      mcp_portal_pay_start: start({ open_session: open }),
      mcp_portal_pay_opened: { status: "ok" },
    });
    await openCheckout(deps(s, db.rpc), { ...pay, method: "bank" });
    expect(calls.map((c) => c.fn)).toEqual([
      "retrieveCheckout",
      "expireCheckout",
      "createCheckout",
    ]);
    expect((calls[2].args[1] as { idempotencyKey: string }).idempotencyKey).toContain("cs_old");
  });

  it("closes a new page it couldn't record", async () => {
    const { s, calls } = fakeStripe();
    const db = fakeRpc({
      mcp_portal_pay_start: start(),
      mcp_portal_pay_opened: () => {
        throw new Error("rpc failed");
      },
    });
    expect(await openCheckout(deps(s, db.rpc), { ...pay, method: "bank" })).toEqual({
      status: "error",
    });
    expect(calls.map((c) => c.fn)).toEqual(["createCheckout", "expireCheckout"]);
  });
});

describe("Stripe's events", () => {
  const session = (over: Partial<CheckoutSessionLike> = {}): CheckoutSessionLike => ({
    id: "cs_1",
    status: "complete",
    payment_status: "paid",
    amount_total: 1_000_000,
    metadata: { athena_kind: "athena_pay_app" },
    payment_intent: {
      id: "pi_1",
      status: "succeeded",
      application_fee_amount: 2_500,
      latest_charge: {
        id: "ch_1",
        created: 1_762_300_000,
        payment_method_details: { type: "us_bank_account" },
      },
    },
    ...over,
  });

  it("reads a session's outcome from Stripe's own copy", () => {
    expect(sessionOutcome(session())).toMatchObject({
      status: "paid",
      paymentIntent: "pi_1",
      charge: "ch_1",
      method: "bank",
      amountCents: 1_000_000,
      feeCents: 2_500,
    });
    const pi = { id: "pi_1", status: "processing", latest_charge: null };
    expect(sessionOutcome(session({ payment_status: "unpaid", payment_intent: pi }))?.status).toBe(
      "processing",
    );
    expect(
      sessionOutcome(
        session({
          payment_status: "unpaid",
          payment_intent: { ...pi, status: "requires_payment_method" },
        }),
      )?.status,
    ).toBe("failed");
    expect(sessionOutcome(session({ status: "expired", payment_status: "unpaid" }))?.status).toBe(
      "expired",
    );
    expect(sessionOutcome(session({ status: "open" }))).toBeNull();
  });

  const event = (type: string, object: Record<string, unknown>): EventLike => ({
    id: "evt_1",
    type,
    livemode: false,
    data: { object },
  });
  const post = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ id: "evt_1", account: "acct_C", livemode: false, type: "forged", ...over });

  function setup(ev: EventLike | null, answers: Record<string, unknown> = {}) {
    const { s, calls } = fakeStripe({
      retrieveEvent: async () => {
        if (!ev) throw new Error("No such event");
        return ev;
      },
      retrieveCheckout: async () => session(),
    });
    const db = fakeRpc({
      mcp_stripe_connect_event_claim: "fresh",
      mcp_stripe_connect_event_finish: null,
      ...answers,
    });
    const notice = fakeRpc({
      mcp_job_notice_record: (a: Record<string, unknown>) => ({
        notice_id: "n1",
        created: true,
        title: a._title,
        recipients: [],
      }),
    });
    const send = vi.fn(async () => "sent" as const);
    return {
      calls,
      db,
      notice,
      deps: {
        rpc: db.rpc,
        stripe: () => s,
        configured: () => true,
        notice: { rpc: notice.rpc, send },
      },
    };
  }

  it("refuses posts it can't read and events Stripe doesn't have", async () => {
    const t = setup(null);
    expect((await handleConnectWebhook("{", t.deps)).status).toBe(400);
    expect((await handleConnectWebhook(post({ account: "x" }), t.deps)).status).toBe(400);
    expect((await handleConnectWebhook(post(), t.deps)).status).toBe(400);
    expect(t.db.calls).toEqual([]);
  });

  it("asks Stripe to send again when the mode isn't set up", async () => {
    const t = setup(event("account.updated", {}));
    expect(
      (await handleConnectWebhook(post(), { ...t.deps, configured: () => false })).status,
    ).toBe(503);
  });

  it("books a paid session and tells the team, using only what Stripe returned", async () => {
    const t = setup(
      event("checkout.session.completed", {
        id: "cs_1",
        metadata: { athena_kind: "athena_pay_app" },
      }),
      {
        mcp_portal_pay_update: {
          status: "changed",
          payment_id: "p1",
          payment_status: "paid",
          job_id: JOB,
          label: "Pay application #3",
          customer: "Rosa Delgado",
          amount_cents: 1_000_000,
          method: "bank",
          test: true,
          applied: true,
          booked: true,
        },
      },
    );
    const r = await handleConnectWebhook(post({ type: "charge.refunded" }), t.deps);
    expect(r.status).toBe(200);
    expect(t.db.calls.map((c) => c.fn)).toEqual([
      "mcp_stripe_connect_event_claim",
      "mcp_portal_pay_update",
      "mcp_stripe_connect_event_finish",
    ]);
    expect(t.db.calls[0].args._type).toBe("checkout.session.completed");
    expect(t.db.calls[1].args).toMatchObject({
      _session: "cs_1",
      _account: "acct_C",
      _status: "paid",
      _payment_intent: "pi_1",
      _amount_cents: 1_000_000,
      _fee_cents: 2_500,
      _method: "bank",
    });
    expect(t.db.calls[2].args).toEqual({ _event: "evt_1", _processed: true });
    const n = t.notice.calls[0].args;
    expect(n._title).toBe(
      "Test payment: Rosa Delgado paid $10,000.00 on Pay application #3 by bank",
    );
    expect(n._kind).toBe("pay_app_paid");
    expect(n._board_page).toBe("billing");
    expect(JSON.stringify(n._facts)).not.toMatch(/fee/);
  });

  it("ignores Checkout sessions that aren't Athena's", async () => {
    const t = setup(event("checkout.session.completed", { id: "cs_x", metadata: {} }));
    expect((await handleConnectWebhook(post(), t.deps)).status).toBe(200);
    expect(t.db.calls.map((c) => c.fn)).toEqual([
      "mcp_stripe_connect_event_claim",
      "mcp_stripe_connect_event_finish",
    ]);
  });

  it("skips an event already handled and asks for a retry while one is in progress", async () => {
    const done = setup(event("account.updated", {}), { mcp_stripe_connect_event_claim: "done" });
    expect((await handleConnectWebhook(post(), done.deps)).status).toBe(200);
    expect(done.db.calls).toHaveLength(1);
    const busy = setup(event("account.updated", {}), { mcp_stripe_connect_event_claim: "busy" });
    expect((await handleConnectWebhook(post(), busy.deps)).status).toBe(409);
  });

  it("saves an account's new setup state", async () => {
    const t = setup(
      event("account.updated", {
        id: "acct_C",
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
      }),
      {
        mcp_client_payments_account_status: { status: "ok" },
      },
    );
    expect((await handleConnectWebhook(post(), t.deps)).status).toBe(200);
    expect(t.db.calls[1].args).toEqual({ _account: "acct_C", _livemode: false, _status: "ready" });
  });

  it("takes a refund back off the job and tells the team", async () => {
    const t = setup(
      event("charge.refunded", { id: "ch_1", payment_intent: "pi_1", amount_refunded: 250_000 }),
      {
        mcp_portal_pay_refunded: {
          status: "changed",
          payment_id: "p1",
          payment_status: "partially_refunded",
          refunded_cents: 250_000,
          refunded_total_cents: 250_000,
          job_id: JOB,
          label: "Pay application #3",
          customer: "Rosa Delgado",
          amount_cents: 1_000_000,
          test: false,
        },
      },
    );
    expect((await handleConnectWebhook(post(), t.deps)).status).toBe(200);
    expect(t.db.calls[1].args).toEqual({
      _payment_intent: "pi_1",
      _account: "acct_C",
      _refunded_total_cents: 250_000,
    });
    expect(t.notice.calls[0].args._title).toBe(
      "$2,500.00 refunded to Rosa Delgado on Pay application #3",
    );
  });

  it("lets the event go and asks Stripe to retry when handling fails", async () => {
    const t = setup(event("charge.refunded", { payment_intent: "pi_1", amount_refunded: 5 }), {
      mcp_portal_pay_refunded: () => {
        throw new Error("rpc failed");
      },
    });
    expect((await handleConnectWebhook(post(), t.deps)).status).toBe(500);
    expect(t.db.calls.at(-1)!.args).toEqual({ _event: "evt_1", _processed: false });
  });
});
