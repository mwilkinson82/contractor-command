import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { chargePaymentState, verifyInvoicePayment } from "./invoice-payment.server";

const charge = {
  id: "ch_paid",
  customer: "cus_test",
  invoice: "in_test",
  payment_intent: "pi_paid",
  status: "succeeded",
  paid: true,
  captured: true,
  amount_captured: 49700,
  amount_refunded: 0,
  refunded: false,
  disputed: false,
};
const invoice = {
  id: "in_test",
  customer: "cus_test",
  status: "paid",
  amount_paid: 49700,
  charge: "ch_paid",
};
function provider(patch: Record<string, unknown> = {}) {
  const calls = {
    charges: { retrieve: vi.fn().mockResolvedValue({ ...charge, ...patch }) },
    paymentIntents: { retrieve: vi.fn().mockResolvedValue({ latest_charge: "ch_paid" }) },
    invoicePayments: {
      list: vi.fn().mockReturnValue({
        autoPagingToArray: vi
          .fn()
          .mockResolvedValue([
            { invoice: "in_test", amount_paid: 49700, payment: { payment_intent: "pi_paid" } },
          ]),
      }),
    },
  };
  return { stripe: calls as unknown as Stripe, calls };
}
describe("invoice retained-payment verification", () => {
  it("accepts the standard positive captured payment and re-fetches expanded charges", async () => {
    const { stripe, calls } = provider();
    expect(
      await verifyInvoicePayment(stripe, { ...invoice, charge: { id: "ch_paid" } }, "cus_test"),
    ).toBe("settled");
    expect(calls.charges.retrieve).toHaveBeenCalledWith("ch_paid");
  });
  it.each([
    [{ refunded: true, amount_refunded: 49700 }, "stripe_payment_fully_refunded"],
    [{ refunded: false, amount_refunded: 49700 }, "stripe_payment_fully_refunded"],
    [{ disputed: true }, "stripe_payment_disputed"],
    [{ amount_refunded: 1000 }, "stripe_partial_refund_review"],
    [{ captured: false }, "stripe_payment_unverified"],
    [{ paid: false }, "stripe_payment_unverified"],
    [{ status: "pending" }, "stripe_payment_unverified"],
    [{ disputed: undefined }, "stripe_payment_unverified"],
  ])("does not grant from invalid or incomplete charge facts %j", async (patch, expected) => {
    expect(chargePaymentState({ ...charge, ...(patch as object) })).toBe(expected);
    expect(
      await verifyInvoicePayment(
        provider(patch as Record<string, unknown>).stripe,
        invoice,
        "cus_test",
      ),
    ).toBe(expected);
  });
  it("supports PaymentIntent and paginated invoice payments without assuming paid means retained", async () => {
    const { stripe, calls } = provider();
    expect(
      await verifyInvoicePayment(
        stripe,
        { ...invoice, charge: null, payment_intent: "pi_paid" },
        "cus_test",
      ),
    ).toBe("settled");
    expect(calls.paymentIntents.retrieve).toHaveBeenCalledWith("pi_paid");
    expect(
      await verifyInvoicePayment(
        stripe,
        { ...invoice, charge: null, payments: { has_more: true } },
        "cus_test",
      ),
    ).toBe("settled");
    expect(calls.invoicePayments.list).toHaveBeenCalledWith({
      invoice: "in_test",
      status: "paid",
      limit: 100,
    });
  });
  it("holds missing payment references, customer/invoice mismatches, or incomplete amount coverage", async () => {
    expect(
      await verifyInvoicePayment(provider().stripe, { ...invoice, charge: null }, "cus_test"),
    ).toBe("stripe_payment_unverified");
    expect(
      await verifyInvoicePayment(
        provider().stripe,
        { ...invoice, customer: "cus_other" },
        "cus_test",
      ),
    ).toBe("stripe_payment_unverified");
    for (const patch of [
      { customer: "cus_other" },
      { invoice: "in_other" },
      { amount_captured: 100 },
    ])
      expect(await verifyInvoicePayment(provider(patch).stripe, invoice, "cus_test")).toBe(
        "stripe_payment_unverified",
      );
  });
  it("provider lookup errors remain retryable, not an assumption of paid access", async () => {
    const { stripe, calls } = provider();
    calls.charges.retrieve.mockRejectedValue(new Error("Stripe unavailable"));
    await expect(verifyInvoicePayment(stripe, invoice, "cus_test")).rejects.toThrow(
      "Stripe unavailable",
    );
  });
});
