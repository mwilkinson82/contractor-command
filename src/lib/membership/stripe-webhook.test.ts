import { beforeEach, describe, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  event: {
    id: "evt_test",
    type: "invoice.paid",
    data: { object: { subscription: "sub_test" } },
  } as Record<string, unknown>,
  rpc: vi.fn(),
  from: vi.fn(),
  retrieve: vi.fn(),
  invoice: vi.fn(),
  charge: vi.fn(),
  lines: vi.fn(),
  customer: vi.fn(),
  drain: vi.fn(),
  enqueue: vi.fn(),
  magic: vi.fn(),
  existing: null as Record<string, unknown> | null,
  profile: null as Record<string, unknown> | null,
  evidence: null as Record<string, unknown> | null,
  billingApproval: false as unknown,
  writes: [] as { table: string; row: unknown }[],
}));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (config: unknown) => config }));
vi.mock("stripe", () => ({
  default: class {
    webhooks = { constructEventAsync: async () => m.event };
    subscriptions = { retrieve: m.retrieve };
    customers = { retrieve: m.customer };
    invoices = {
      retrieve: m.invoice,
      listLineItems: (id: string) => ({ autoPagingToArray: () => m.lines(id) }),
    };
    charges = { retrieve: m.charge };
    checkout = {
      sessions: {
        retrieve: async () => {
          throw new Error("missing subscription");
        },
      },
    };
  },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: m.rpc, from: m.from },
}));
vi.mock("@/lib/membership/reconcile.server", () => ({ drainCircleAudienceSync: m.drain }));
vi.mock("@/lib/email/ensure-magic-link", () => ({
  appOrigin: () => "https://example.test",
  ensureMagicLinkForMember: m.magic,
}));
vi.mock("@/lib/email/enqueue-circle-welcome", () => ({ enqueueCircleWelcome: m.enqueue }));
vi.mock("@/lib/email/circle-welcome-state", () => ({
  circleWelcomeIdempotencyKey: (id: string) => `circle-welcome-${id}`,
  findCircleWelcomeLog: async () => null,
  markCircleWelcomeSent: vi.fn(),
}));
import { Route } from "@/routes/api/public/stripe/webhook";
const handler = (
  Route as unknown as {
    server: { handlers: { POST: (input: { request: Request }) => Promise<Response> } };
  }
).server.handlers.POST;
const request = () =>
  handler({
    request: new Request("https://example.test/api/public/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "synthetic" },
      body: "{}",
    }),
  });
const snapshot = () =>
  m.rpc.mock.calls.find(([name]) => name === "apply_circle_subscription_snapshot")?.[1];
beforeEach(() => {
  vi.clearAllMocks();
  m.existing = null;
  m.profile = null;
  m.evidence = null;
  m.billingApproval = false;
  m.writes = [];
  process.env.STRIPE_SECRET_KEY = "synthetic";
  process.env.STRIPE_WEBHOOK_SECRET = "synthetic";
  m.event = {
    id: "evt_test",
    type: "invoice.paid",
    data: { object: { subscription: "sub_test" } },
  };
  m.retrieve.mockResolvedValue({
    id: "sub_test",
    customer: "cus_test",
    status: "active",
    cancel_at_period_end: false,
    current_period_end: 4070908800,
    latest_invoice: "in_test",
    metadata: {},
    items: {
      data: [{ price: { id: "price_1TVh3TJdDAUSVXbNJRsYFTbp", product: "prod_UUgQlHRk9H1ZUS" } }],
    },
  });
  m.customer.mockResolvedValue({
    id: "cus_test",
    email: "member@example.test",
    name: "Test Member",
  });
  m.invoice.mockImplementation(async (id: string) => ({
    id,
    customer: "cus_test",
    subscription: "sub_test",
    charge: "ch_test",
    status: "paid",
    amount_paid: 49700,
  }));
  m.charge.mockResolvedValue({
    id: "ch_test",
    customer: "cus_test",
    invoice: "in_test",
    status: "succeeded",
    paid: true,
    captured: true,
    amount_captured: 49700,
    amount_refunded: 0,
    refunded: false,
    disputed: false,
  });
  m.lines.mockResolvedValue([
    {
      subscription: "sub_test",
      price: { id: "price_1TVh3TJdDAUSVXbNJRsYFTbp" },
      period: { start: 1, end: 4070908800 },
    },
  ]);
  m.drain.mockResolvedValue({ processed: 1, failed: 0 });
  m.magic.mockResolvedValue("https://example.test/signin");
  m.enqueue.mockResolvedValue({ status: "queued" });
  m.rpc.mockImplementation(async (name: string) => ({
    error: null,
    data:
      name === "begin_stripe_webhook_event"
        ? "process"
        : name === "apply_circle_subscription_snapshot"
          ? true
          : name === "circle_billing_identity_approved"
            ? m.billingApproval
            : name === "get_circle_entitlement"
              ? { state: "eligible", hasAccess: true, reason: "paid_period" }
              : null,
  }));
  m.from.mockImplementation((table: string) => {
    let fields = "";
    const chain = {
      select: (s: string) => {
        fields = s;
        return chain;
      },
      eq: () => chain,
      ilike: () => chain,
      maybeSingle: async () => ({
        error: null,
        data:
          table === "profiles"
            ? m.profile
            : table === "circle_subscription_evidence"
              ? m.evidence
              : fields === "welcome_sent_at"
                ? { welcome_sent_at: null }
                : m.existing,
      }),
      upsert: async (row: unknown) => {
        m.writes.push({ table, row });
        return { error: null };
      },
    };
    return chain;
  });
});
describe("Stripe lifecycle orchestration with synthetic providers", () => {
  it("an exact approved billing alias renews the existing Hub identity and saves payment provenance", async () => {
    m.existing = { id: "source", user_id: "bound-user", email: "hub@example.test", tier: "circle" };
    m.profile = { id: "bound-user" };
    m.billingApproval = true;
    expect((await request()).status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith("circle_billing_identity_approved", {
      _source_id: "source",
      _stripe_subscription_id: "sub_test",
      _stripe_customer_id: "cus_test",
      _hub_user_id: "bound-user",
      _hub_email: "hub@example.test",
      _billing_email: "member@example.test",
    });
    expect(snapshot()).toMatchObject({
      _row: {
        user_id: "bound-user",
        email: "hub@example.test",
        metadata: { circle_paid_invoice_id: "in_test" },
      },
      _review_reason: null,
    });
  });
  it("a billing approval cannot rebind a source to an unrelated profile", async () => {
    m.existing = { id: "source", user_id: "bound-user", email: "hub@example.test", tier: "circle" };
    m.profile = { id: "different-user" };
    m.billingApproval = true;
    expect((await request()).status).toBe(200);
    expect(m.rpc.mock.calls.some(([name]) => name === "circle_billing_identity_approved")).toBe(
      false,
    );
    expect(snapshot()).toMatchObject({
      _row: { user_id: "bound-user" },
      _review_reason: "stripe_identity_mismatch",
    });
  });
  it("an approved billing alias cannot override a refunded payment", async () => {
    m.existing = { id: "source", user_id: "bound-user", email: "hub@example.test", tier: "circle" };
    m.profile = { id: "bound-user" };
    m.billingApproval = true;
    const charge = await m.charge();
    m.charge.mockResolvedValue({ ...charge, refunded: true, amount_refunded: 49700 });
    expect((await request()).status).toBe(200);
    expect(snapshot()).toMatchObject({
      _paid_through: null,
      _review_reason: "stripe_payment_fully_refunded",
    });
    expect(m.enqueue).not.toHaveBeenCalled();
  });
  it("approval lookup failure remains retryable without changing membership", async () => {
    m.existing = { id: "source", user_id: "bound-user", email: "hub@example.test", tier: "circle" };
    const original = m.rpc.getMockImplementation()!;
    m.rpc.mockImplementation(async (name: string, ...args: unknown[]) =>
      name === "circle_billing_identity_approved"
        ? { data: null, error: { message: "approval lookup unavailable" } }
        : original(name, ...args),
    );
    expect((await request()).status).toBe(500);
    expect(snapshot()).toBeUndefined();
    expect(m.writes).toHaveLength(0);
  });
  it("paid renewal refreshes Stripe, writes paid evidence, and preserves welcome and pending-claim signup", async () => {
    expect((await request()).status).toBe(200);
    expect(m.retrieve).toHaveBeenCalledWith("sub_test");
    expect(snapshot()).toMatchObject({
      _row: { status: "active", tier: "circle" },
      _paid_through: "2099-01-01T00:00:00.000Z",
    });
    expect(m.writes.some((w) => w.table === "pending_claims")).toBe(true);
    expect(m.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "circle-welcome-sub_test" }),
    );
  });
  it("a paid event still proves its period when the next invoice is already open", async () => {
    m.event = {
      id: "evt_paid",
      type: "invoice.paid",
      data: { object: { id: "in_paid", subscription: "sub_test" } },
    };
    const live = await m.retrieve();
    m.retrieve.mockResolvedValue({ ...live, latest_invoice: "in_pending" });
    m.invoice.mockImplementation(async (id: string) => ({
      id,
      customer: "cus_test",
      subscription: "sub_test",
      charge: "ch_test",
      status: id === "in_paid" ? "paid" : "open",
      amount_paid: id === "in_paid" ? 49700 : 0,
    }));
    const charge = await m.charge();
    m.charge.mockResolvedValue({ ...charge, invoice: "in_paid" });
    expect((await request()).status).toBe(200);
    expect(snapshot()).toMatchObject({
      _paid_through: "2099-01-01T00:00:00.000Z",
      _review_reason: "renewal_payment_pending",
    });
  });
  it("an old canceled event refreshes current state instead of overwriting a renewed membership", async () => {
    m.event = {
      id: "evt_old",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_test", status: "canceled" } },
    };
    expect((await request()).status).toBe(200);
    expect(snapshot()._row.status).toBe("active");
  });
  it("records past_due truth instead of turning it into active", async () => {
    const live = await m.retrieve();
    m.retrieve.mockResolvedValue({ ...live, status: "past_due" });
    m.existing = { status: "active", email: "member@example.test", tier: "circle" };
    m.event = {
      id: "evt_fail",
      type: "invoice.payment_failed",
      data: { object: { parent: { subscription_details: { subscription: "sub_test" } } } },
    };
    expect((await request()).status).toBe(200);
    expect(snapshot()._row.status).toBe("past_due");
  });
  it("duplicate events do not repeat onboarding or provider writes", async () => {
    m.rpc.mockResolvedValue({ data: "duplicate", error: null });
    expect((await request()).status).toBe(200);
    expect(m.retrieve).not.toHaveBeenCalled();
    expect(m.enqueue).not.toHaveBeenCalled();
  });
  it("Resend failure stays retryable after Hub provisioning and welcome enqueue", async () => {
    m.drain.mockResolvedValue({ processed: 1, failed: 1 });
    expect((await request()).status).toBe(500);
    expect(m.enqueue).toHaveBeenCalledOnce();
    expect(m.rpc).toHaveBeenCalledWith(
      "finish_stripe_webhook_event",
      expect.objectContaining({ _status: "failed" }),
    );
  });
  it("does not fulfill an unpaid completed checkout", async () => {
    m.event = {
      id: "evt_unpaid",
      type: "checkout.session.completed",
      data: { object: { mode: "payment", payment_status: "unpaid" } },
    };
    expect((await request()).status).toBe(200);
    expect(snapshot()).toBeUndefined();
    expect(m.writes).toHaveLength(0);
  });
  it("supports async checkout success and Payment Link recognition", async () => {
    const live = await m.retrieve();
    m.retrieve.mockResolvedValue({
      ...live,
      items: { data: [{ price: { id: "price_custom", product: "prod_custom" } }] },
    });
    m.lines.mockResolvedValue([
      {
        subscription: "sub_test",
        price: { id: "price_custom" },
        period: { start: 1, end: 4070908800 },
      },
    ]);
    m.event = {
      id: "evt_async",
      type: "checkout.session.async_payment_succeeded",
      data: {
        object: {
          mode: "subscription",
          payment_status: "paid",
          subscription: "sub_test",
          payment_link: "plink_1ThaqAJdDAUSVXbN66bTiP9o",
        },
      },
    };
    expect((await request()).status).toBe(200);
    expect(snapshot()._row.tier).toBe("circle");
  });
  it("does not invent a one-time membership when a subscription checkout cannot be resolved", async () => {
    m.event = {
      id: "evt_missing",
      type: "checkout.session.completed",
      data: { object: { id: "cs_test", mode: "subscription", payment_status: "paid" } },
    };
    expect((await request()).status).toBe(500);
    expect(m.writes).toHaveLength(0);
  });
  it("email mismatch creates a review case and keeps the established account mapping", async () => {
    m.existing = { email: "old@example.test", tier: "circle" };
    expect((await request()).status).toBe(200);
    expect(snapshot()).toMatchObject({
      _review_reason: "stripe_identity_mismatch",
      _row: { email: "old@example.test" },
    });
  });
  it("a refunded invoice with a future paid line cannot restore a canceled member", async () => {
    const sub = await m.retrieve();
    const charge = await m.charge();
    m.retrieve.mockResolvedValue({ ...sub, status: "canceled" });
    m.charge.mockResolvedValue({ ...charge, refunded: true, amount_refunded: 49700 });
    m.event = {
      id: "evt_after_refund",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_test" } },
    };
    expect((await request()).status).toBe(200);
    expect(snapshot()).toMatchObject({
      _row: { status: "canceled" },
      _paid_through: null,
      _review_reason: "stripe_payment_fully_refunded",
    });
    expect(m.enqueue).not.toHaveBeenCalled();
  });
  it("rechecks the saved paid invoice behind an open renewal and retains the refund hold", async () => {
    const sub = await m.retrieve();
    const charge = await m.charge();
    m.retrieve.mockResolvedValue({ ...sub, latest_invoice: "in_pending" });
    m.existing = {
      tier: "circle",
      email: "member@example.test",
      metadata: { circle_paid_invoice_id: "in_test" },
    };
    m.evidence = { paid_through: "2099-01-01T00:00:00Z" };
    m.invoice.mockImplementation(async (id: string) => ({
      id,
      customer: "cus_test",
      subscription: "sub_test",
      charge: "ch_test",
      status: id === "in_pending" ? "open" : "paid",
      amount_paid: id === "in_pending" ? 0 : 49700,
    }));
    m.charge.mockResolvedValue({ ...charge, refunded: true, amount_refunded: 49700 });
    expect((await request()).status).toBe(200);
    expect(snapshot()).toMatchObject({
      _paid_through: null,
      _review_reason: "stripe_payment_fully_refunded",
    });
    expect(snapshot()._row.metadata.circle_paid_invoice_id).toBe("in_test");
    expect(m.enqueue).not.toHaveBeenCalled();
  });
  it("legacy saved future evidence without an invoice reference cannot silently clear its hold", async () => {
    m.evidence = { paid_through: "2099-01-01T00:00:00Z" };
    m.invoice.mockResolvedValue({
      id: "in_test",
      subscription: "sub_test",
      status: "open",
      amount_paid: 0,
    });
    expect((await request()).status).toBe(200);
    expect(snapshot()).toMatchObject({
      _paid_through: null,
      _review_reason: "stripe_payment_unverified",
    });
  });
  it("an older refunded event cannot negate a newer independently paid period", async () => {
    const charge = await m.charge();
    m.event = {
      id: "evt_old_paid",
      type: "invoice.paid",
      data: { object: { id: "in_old", subscription: "sub_test" } },
    };
    m.existing = {
      tier: "circle",
      email: "member@example.test",
      metadata: { circle_paid_invoice_id: "in_old" },
    };
    m.evidence = { paid_through: "2098-01-01T00:00:00Z" };
    m.invoice.mockImplementation(async (id: string) => ({
      id,
      subscription: "sub_test",
      customer: "cus_test",
      charge: id === "in_old" ? "ch_old" : "ch_test",
      status: "paid",
      amount_paid: 49700,
    }));
    m.charge.mockImplementation(async (id: string) => ({
      ...charge,
      id,
      invoice: id === "ch_old" ? "in_old" : "in_test",
      refunded: id === "ch_old",
      amount_refunded: id === "ch_old" ? 49700 : 0,
    }));
    m.lines.mockImplementation(async (id: string) => [
      {
        subscription: "sub_test",
        price: { id: "price_1TVh3TJdDAUSVXbNJRsYFTbp" },
        period: { start: 1, end: id === "in_old" ? 4039372800 : 4070908800 },
      },
    ]);
    expect((await request()).status).toBe(200);
    expect(snapshot()).toMatchObject({
      _paid_through: "2099-01-01T00:00:00.000Z",
      _review_reason: null,
    });
    expect(snapshot()._row.metadata.circle_paid_invoice_id).toBe("in_test");
  });
  it.each([
    "charge.refunded",
    "charge.dispute.created",
    "charge.dispute.updated",
    "charge.dispute.closed",
  ])("refreshes current source/payment state on %s without replaying welcome", async (type) => {
    const charge = await m.charge();
    m.charge.mockResolvedValue({ ...charge, disputed: true });
    m.event = { id: "evt_reversed", type, data: { object: { id: "ch_test", charge: "ch_test" } } };
    expect((await request()).status).toBe(200);
    expect(snapshot()).toMatchObject({
      _paid_through: null,
      _review_reason: "stripe_payment_disputed",
    });
    expect(m.enqueue).not.toHaveBeenCalled();
  });
  it("a reversed one-time charge does not alter product access", async () => {
    m.charge.mockResolvedValue({ id: "ch_book", invoice: null });
    m.event = {
      id: "evt_book_refund",
      type: "charge.refunded",
      data: { object: { id: "ch_book" } },
    };
    expect((await request()).status).toBe(200);
    expect(snapshot()).toBeUndefined();
    expect(m.writes).toHaveLength(0);
  });
  it("saves invoice provenance on clean signup and fails visibly before writes if charge lookup fails", async () => {
    expect((await request()).status).toBe(200);
    expect(snapshot()._row.metadata.circle_paid_invoice_id).toBe("in_test");
    vi.clearAllMocks();
    m.writes = [];
    m.charge.mockRejectedValueOnce(new Error("Stripe charge unavailable"));
    expect((await request()).status).toBe(500);
    expect(snapshot()).toBeUndefined();
    expect(m.writes).toHaveLength(0);
    expect(m.rpc).toHaveBeenCalledWith(
      "finish_stripe_webhook_event",
      expect.objectContaining({ _status: "failed" }),
    );
  });
});
