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
  lines: vi.fn(),
  customer: vi.fn(),
  drain: vi.fn(),
  enqueue: vi.fn(),
  magic: vi.fn(),
  existing: null as Record<string, unknown> | null,
  profile: null as Record<string, unknown> | null,
  writes: [] as { table: string; row: unknown }[],
}));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (config: unknown) => config }));
vi.mock("stripe", () => ({
  default: class {
    webhooks = { constructEventAsync: async () => m.event };
    subscriptions = { retrieve: m.retrieve };
    customers = { retrieve: m.customer };
    invoices = { retrieve: m.invoice, listLineItems: () => ({ autoPagingToArray: m.lines }) };
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
  m.invoice.mockResolvedValue({ status: "paid", amount_paid: 49700 });
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
});
