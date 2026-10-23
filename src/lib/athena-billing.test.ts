import { describe, expect, it, vi } from "vitest";
import { billingConfig, checkoutParams, createAthenaCheckout, entitlementFromSubscription, handleAthenaBillingWebhook } from "./athena-billing";

const ON = { ATHENA_CHECKOUT_ENABLED: "true" };
const PM = "price_1USgPMJdDAUSVXbNW81c9iJd", OFFICE = "price_1USgPNJdDAUSVXbN7czrTfxh", SEAT = "price_1USprHJdDAUSVXbNpRbfw3Y8";
const sub = (o: Partial<{ status: string; items: unknown[]; meta: Record<string, string> }> = {}) => ({
  id: "sub_1", status: o.status ?? "trialing", customer: "cus_1", metadata: o.meta ?? { athena_company_id: "co-1" },
  items: { data: (o.items ?? [
    { quantity: 1, price: { id: PM, product: { id: "prod_VTdgfFhRE8Eefz", metadata: { included_seats: "5", extra_seat_price: SEAT } } } },
    { quantity: 3, price: { id: SEAT, product: "prod_VTnSNdyxcFXI4F" } },
  ]) as never },
});

describe("checkout (code only, flag off by default)", () => {
  it("defaults to Cash's price ids and is off", () => {
    const c = billingConfig({});
    expect(c.checkoutEnabled).toBe(false);
    expect(c.prices).toEqual({ athena_pm: PM, athena_office: OFFICE });
    expect(c.seatPrice).toBe(SEAT);
  });
  it("plan + seats as two line items, seat quantity, 7-day trial", () => {
    const p = checkoutParams({ companyId: "co-1", ownerUserId: "u1", ownerEmail: "o@example.test", plan: "athena_office", extraSeats: 4 }, {});
    expect(p.mode).toBe("subscription");
    expect(p.line_items).toEqual([{ price: OFFICE, quantity: 1 }, { price: SEAT, quantity: 4 }]);
    expect(p.subscription_data?.trial_period_days).toBe(7);
    expect(p.subscription_data?.metadata?.athena_company_id).toBe("co-1");
  });
  it("seats only (Circle add-on) has no plan line", () => {
    expect(checkoutParams({ companyId: "co-1", ownerUserId: "u1", plan: null, extraSeats: 2 }, {}).line_items).toEqual([{ price: SEAT, quantity: 2 }]);
  });
  it("makes no Stripe call while the flag is off", async () => {
    const create = vi.fn(async () => ({ id: "cs_1", url: "https://example.test" }));
    expect(await createAthenaCheckout({ checkout: { sessions: { create } } }, { companyId: "c", ownerUserId: "u", plan: "athena_pm", extraSeats: 0 }, {})).toBeNull();
    expect(create).not.toHaveBeenCalled();
    await createAthenaCheckout({ checkout: { sessions: { create } } }, { companyId: "c", ownerUserId: "u", plan: "athena_pm", extraSeats: 0 }, ON);
    expect(create).toHaveBeenCalledOnce();
  });
});

describe("webhook sync (mocked events)", () => {
  it("reads included seats from product metadata and seat quantity", () => {
    expect(entitlementFromSubscription(sub(), "evt_1", {})).toMatchObject({ company_id: "co-1", plan: "athena_pm", included_seats: 5, extra_seats: 3, status: "trialing" });
  });
  it("falls back when metadata is missing; Office wins", () => {
    const r = entitlementFromSubscription(sub({ items: [{ quantity: 1, price: { id: OFFICE, product: "prod_x" } }] }), "e", {});
    expect(r).toMatchObject({ plan: "athena_office", included_seats: null, extra_seats: 0 });
  });
  it("ignores non-Athena subscriptions", () => {
    expect(entitlementFromSubscription(sub({ items: [{ quantity: 1, price: { id: "price_hub", product: "p" } }] }), "e", {})).toBeNull();
    expect(entitlementFromSubscription(sub({ meta: {} }), "e", {})).toBeNull();
  });
  const deps = (ok = true, type = "customer.subscription.updated", s = sub()) => {
    const rows: unknown[] = [];
    return { rows, d: {
      secret: "whsec_test",
      store: { upsert: async (r: unknown) => { rows.push(r); } },
      env: {},
      stripe: {
        webhooks: { constructEventAsync: vi.fn(async () => { if (!ok) throw new Error("bad sig"); return { id: "evt_9", type, data: { object: type.startsWith("checkout") ? { subscription: "sub_1" } : { id: "sub_1" } } }; }) },
        subscriptions: { retrieve: vi.fn(async () => s) },
      },
    } };
  };
  it("rejects a bad or missing signature without writing", async () => {
    const a = deps(false);
    expect((await handleAthenaBillingWebhook({ body: "{}", signature: "t=1,v1=x" }, a.d)).status).toBe(400);
    expect((await handleAthenaBillingWebhook({ body: "{}", signature: null }, a.d)).status).toBe(400);
    expect(a.rows).toHaveLength(0);
  });
  it("syncs tier and seats on checkout completion and updates", async () => {
    const a = deps(true, "checkout.session.completed");
    expect(await handleAthenaBillingWebhook({ body: "{}", signature: "sig" }, a.d)).toEqual({ status: 200, body: "synced" });
    expect(a.rows[0]).toMatchObject({ plan: "athena_pm", extra_seats: 3, included_seats: 5, last_event_id: "evt_9" });
  });
  it("a cancelled subscription drops to inactive (users kept, roles lock)", async () => {
    const a = deps(true, "customer.subscription.deleted", sub({ status: "canceled" }));
    await handleAthenaBillingWebhook({ body: "{}", signature: "sig" }, a.d);
    expect(a.rows[0]).toMatchObject({ status: "inactive" });
  });
});
