import type Stripe from "stripe";
import { stripeRefId } from "./paid-product-map";

export type InvoicePaymentState =
  | "settled"
  | "stripe_payment_fully_refunded"
  | "stripe_payment_disputed"
  | "stripe_partial_refund_review"
  | "stripe_payment_unverified";

type ChargeEvidence = {
  status?: string;
  paid?: boolean;
  captured?: boolean;
  amount_captured?: number;
  amount_refunded?: number;
  refunded?: boolean;
  disputed?: boolean;
};

/** Invoice.paid survives refunds. Only a currently retained charge proves payment. */
export function chargePaymentState(charge: ChargeEvidence): InvoicePaymentState {
  if (charge.disputed === true) return "stripe_payment_disputed";
  if (
    charge.refunded === true ||
    (Number(charge.amount_captured) > 0 &&
      Number(charge.amount_refunded) >= Number(charge.amount_captured))
  )
    return "stripe_payment_fully_refunded";
  if (Number(charge.amount_refunded) > 0) return "stripe_partial_refund_review";
  if (
    charge.status !== "succeeded" ||
    charge.paid !== true ||
    charge.captured !== true ||
    !(Number(charge.amount_captured) > 0) ||
    charge.amount_refunded !== 0 ||
    charge.refunded !== false ||
    charge.disputed !== false
  )
    return "stripe_payment_unverified";
  return "settled";
}

type InvoicePaymentEvidence = {
  id: string;
  customer?: unknown;
  status?: string | null;
  amount_paid?: number;
  paid_out_of_band?: boolean;
  // The integration retains Acacia; newer shapes are supported without changing its API version.
  charge?: unknown;
  payment_intent?: unknown;
  payments?: unknown;
};

export async function verifyInvoicePayment(
  stripe: Stripe,
  invoice: InvoicePaymentEvidence,
  customerId: string,
): Promise<InvoicePaymentState> {
  if (
    invoice.status !== "paid" ||
    !(Number(invoice.amount_paid) > 0) ||
    invoice.paid_out_of_band ||
    stripeRefId(invoice.customer) !== customerId
  )
    return "stripe_payment_unverified";

  const references: { chargeId?: string; paymentIntentId?: string; amount: number }[] = [];
  const chargeId = stripeRefId(invoice.charge);
  const paymentIntentId = stripeRefId(invoice.payment_intent);
  if (chargeId || paymentIntentId) {
    references.push({
      chargeId: chargeId ?? undefined,
      paymentIntentId: paymentIntentId ?? undefined,
      amount: invoice.amount_paid!,
    });
  } else if (invoice.payments) {
    const payments = await stripe.invoicePayments
      .list({ invoice: invoice.id, status: "paid", limit: 100 })
      .autoPagingToArray({ limit: 1000 });
    for (const payment of payments) {
      if (stripeRefId(payment.invoice) !== invoice.id || !(Number(payment.amount_paid) > 0))
        return "stripe_payment_unverified";
      const chargeId = stripeRefId(payment.payment.charge);
      const paymentIntentId = stripeRefId(payment.payment.payment_intent);
      if (!chargeId && !paymentIntentId) return "stripe_payment_unverified";
      references.push({
        chargeId: chargeId ?? undefined,
        paymentIntentId: paymentIntentId ?? undefined,
        amount: payment.amount_paid!,
      });
    }
  }
  if (
    !references.length ||
    references.reduce((sum, reference) => sum + reference.amount, 0) !== invoice.amount_paid
  )
    return "stripe_payment_unverified";

  const seen = new Set<string>();
  for (const reference of references) {
    let currentChargeId = reference.chargeId;
    if (!currentChargeId && reference.paymentIntentId) {
      const intent = await stripe.paymentIntents.retrieve(reference.paymentIntentId);
      currentChargeId = stripeRefId(intent.latest_charge) ?? undefined;
    }
    if (!currentChargeId || seen.has(currentChargeId)) return "stripe_payment_unverified";
    seen.add(currentChargeId);
    // Always re-fetch; an expanded object/event can predate a refund or dispute.
    const charge = await stripe.charges.retrieve(currentChargeId);
    const linkedInvoice = stripeRefId((charge as Stripe.Charge & { invoice?: unknown }).invoice);
    if (
      stripeRefId(charge.customer) !== customerId ||
      (linkedInvoice && linkedInvoice !== invoice.id) ||
      (reference.paymentIntentId &&
        stripeRefId(charge.payment_intent) !== reference.paymentIntentId)
    )
      return "stripe_payment_unverified";
    const state = chargePaymentState(charge);
    if (state !== "settled") return state;
    if (charge.amount_captured < reference.amount) return "stripe_payment_unverified";
  }
  return "settled";
}
