import { describe, it, expect } from "vitest";
import {
  invoiceSubscriptionId,
  paidThroughFromInvoice,
  subscriptionPeriodEnd,
} from "./subscription-evidence";
const line = {
  subscription: "sub_paid",
  price: { id: "price_circle", recurring: {} },
  period: { start: 100, end: 200 },
};
const invoice = { status: "paid", amount_paid: 49700, lines: { data: [line] } };
describe("Stripe payment evidence", () => {
  it("supports legacy and new invoice subscription references", () => {
    expect(invoiceSubscriptionId({ subscription: "sub_legacy" })).toBe("sub_legacy");
    expect(
      invoiceSubscriptionId({
        parent: { subscription_details: { subscription: { id: "sub_new" } } },
      }),
    ).toBe("sub_new");
    expect(invoiceSubscriptionId({})).toBeNull();
  });
  it("supports subscription and item period dates without inventing a period", () => {
    expect(subscriptionPeriodEnd({ current_period_end: 200, items: { data: [] } })).toBe(
      new Date(200000).toISOString(),
    );
    expect(
      subscriptionPeriodEnd({
        items: { data: [{ current_period_end: 300 }, { current_period_end: 200 }] },
      }),
    ).toBe(new Date(200000).toISOString());
    expect(subscriptionPeriodEnd({ items: { data: [] } })).toBeNull();
  });
  it("accepts settled matching recurring invoice lines", () => {
    expect(paidThroughFromInvoice(invoice, "sub_paid", ["price_circle"])).toBe(
      new Date(200000).toISOString(),
    );
  });
  it.each([
    { status: "open" },
    { amount_paid: 0 },
    { paid_out_of_band: true },
    { lines: { data: [line], has_more: true } },
    { lines: { data: [{ ...line, subscription: "sub_other" }] } },
    { lines: { data: [{ ...line, price: { id: "price_unrelated" } }] } },
    { lines: { data: [{ ...line, proration: true }] } },
    { lines: { data: [{ ...line, period: { start: 999999999999, end: 9999999999999 } }] } },
  ])("does not turn incomplete/ambiguous evidence into paid access (%j)", (patch) => {
    expect(
      paidThroughFromInvoice({ ...invoice, ...patch }, "sub_paid", ["price_circle"]),
    ).toBeNull();
  });
  it("supports Basil and later invoice lines", () => {
    expect(
      paidThroughFromInvoice(
        {
          ...invoice,
          lines: {
            data: [
              {
                parent: { subscription_item_details: { subscription: "sub_paid" } },
                pricing: { price_details: { price: "price_circle" } },
                period: line.period,
              },
            ],
          },
        },
        "sub_paid",
        ["price_circle"],
      ),
    ).toBe(new Date(200000).toISOString());
  });
});
