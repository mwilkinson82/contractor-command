import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { athenaPriceIds, athenaProductKey, nextGraceUntil, tierToProductKey } from "./athena-subscriptions.server";

function sub(items: { priceId: string; product: unknown }[], metadata: Record<string, string> = {}): Stripe.Subscription {
  return { id: "sub_1", metadata, items: { data: items.map((i) => ({ price: { id: i.priceId, product: i.product } })) } } as unknown as Stripe.Subscription;
}

describe("athenaProductKey", () => {
  it("routes by expanded product metadata", async () => {
    expect(await athenaProductKey(sub([{ priceId: "price_x", product: { metadata: { product_key: "athena_office" } } }]))).toBe("athena_office");
  });
  it("routes by fetched product metadata", async () => {
    const load = async () => ({ metadata: { product_key: "athena_pm" } });
    expect(await athenaProductKey(sub([{ priceId: "price_x", product: "prod_VTdgfFhRE8Eefz" }]), load)).toBe("athena_pm");
  });
  it("falls back to the configured price IDs", async () => {
    expect(await athenaProductKey(sub([{ priceId: "price_1USgPMJdDAUSVXbNW81c9iJd", product: "prod_a" }]), undefined, {})).toBe("athena_pm");
    expect(await athenaProductKey(sub([{ priceId: "price_test_off", product: "prod_a" }]), undefined, { STRIPE_PRICE_ID_ATHENA_OFFICE: "price_test_off" })).toBe("athena_office");
  });
  it("ignores Circle and other products", async () => {
    const load = async () => ({ metadata: {} });
    expect(await athenaProductKey(sub([{ priceId: "price_1TDR3aJdDAUSVXbNZOY6EXF3", product: "prod_circle" }]), load, {})).toBeNull();
    expect(await athenaProductKey(sub([{ priceId: "price_x", product: { metadata: { product_key: "something_else" } } }]), undefined, {})).toBeNull();
  });
});

describe("tier + prices", () => {
  it("maps button tiers", () => {
    expect(tierToProductKey("pm")).toBe("athena_pm");
    expect(tierToProductKey("Office")).toBe("athena_office");
    expect(tierToProductKey("circle")).toBeNull();
    expect(tierToProductKey(null)).toBeNull();
  });
  it("defaults to Cash's live price IDs", () => {
    expect(athenaPriceIds({})).toEqual({ athena_pm: "price_1USgPMJdDAUSVXbNW81c9iJd", athena_office: "price_1USgPNJdDAUSVXbN7czrTfxh" });
  });
});

describe("nextGraceUntil", () => {
  const now = new Date("2026-10-20T17:00:00Z");
  it("no grace while active, trialing or still retrying", () => {
    for (const status of ["active", "trialing", "past_due"] as const) expect(nextGraceUntil({ status }, "2026-10-21T00:00:00Z", now)).toBeNull();
  });
  it("starts 7 days of grace when retries end", () => {
    expect(nextGraceUntil({ status: "unpaid" }, null, now)).toBe("2026-10-27T17:00:00.000Z");
    expect(nextGraceUntil({ status: "canceled", cancellation_details: { reason: "payment_failed" } }, null, now)).toBe("2026-10-27T17:00:00.000Z");
  });
  it("keeps the first grace date on later events", () => {
    expect(nextGraceUntil({ status: "unpaid" }, "2026-10-22T00:00:00.000Z", now)).toBe("2026-10-22T00:00:00.000Z");
  });
  it("no grace for a member-requested cancel or canceled trial", () => {
    expect(nextGraceUntil({ status: "canceled", cancellation_details: { reason: "cancellation_requested" } }, null, now)).toBeNull();
  });
});
