import { stripeRefId } from "./paid-product-map";
import type { InvoicePaymentState } from "./invoice-payment.server";

type PeriodItem = { current_period_end?: number; price?: { id?: string } };
export function subscriptionPeriodEnd(sub: {
  current_period_end?: number;
  items: { data: PeriodItem[] };
}): string | null {
  const ends = sub.items.data
    .map((i) => i.current_period_end)
    .filter((n): n is number => typeof n === "number" && n > 0);
  const end = sub.current_period_end ?? (ends.length ? Math.min(...ends) : null);
  return end && Number.isFinite(end) ? new Date(end * 1000).toISOString() : null;
}

export function invoiceSubscriptionId(invoice: {
  subscription?: unknown;
  parent?: { subscription_details?: { subscription?: unknown } | null } | null;
}): string | null {
  return (
    stripeRefId(invoice.subscription) ??
    stripeRefId(invoice.parent?.subscription_details?.subscription)
  );
}

type InvoiceLine = {
  subscription?: unknown;
  parent?: {
    subscription_item_details?: { subscription?: unknown; proration?: boolean } | null;
  } | null;
  price?: { id?: string; recurring?: unknown } | null;
  pricing?: { price_details?: { price?: unknown } | null } | null;
  period?: { start?: number; end?: number };
  proration?: boolean;
};
/** Line period only; callers must independently verify retained payment. */
export function recurringInvoicePeriodEnd(
  invoice: {
    status?: string | null;
    amount_paid?: number;
    paid_out_of_band?: boolean;
    lines: { data: InvoiceLine[]; has_more?: boolean };
  },
  subscriptionId: string,
  priceIds: string[],
  now = Date.now(),
): string | null {
  if (
    invoice.status !== "paid" ||
    !(Number(invoice.amount_paid) > 0) ||
    invoice.paid_out_of_band ||
    invoice.lines.has_more
  )
    return null;
  const ends = invoice.lines.data
    .filter((line) => {
      const sid =
        stripeRefId(line.subscription) ??
        stripeRefId(line.parent?.subscription_item_details?.subscription);
      const pid = line.price?.id ?? stripeRefId(line.pricing?.price_details?.price);
      return (
        sid === subscriptionId &&
        !!pid &&
        priceIds.includes(pid) &&
        !line.proration &&
        !line.parent?.subscription_item_details?.proration &&
        typeof line.period?.start === "number" &&
        line.period.start * 1000 <= now
      );
    })
    .map((line) => line.period?.end)
    .filter((n): n is number => typeof n === "number" && n > 0);
  return ends.length ? new Date(Math.max(...ends) * 1000).toISOString() : null;
}

/** A paid invoice alone never proves access after a refund/dispute. */
export function paidThroughFromInvoice(
  invoice: Parameters<typeof recurringInvoicePeriodEnd>[0],
  subscriptionId: string,
  priceIds: string[],
  paymentState: InvoicePaymentState,
  now = Date.now(),
): string | null {
  return paymentState === "settled"
    ? recurringInvoicePeriodEnd(invoice, subscriptionId, priceIds, now)
    : null;
}

export function paymentEvidenceReviewReason(
  priorPaidThrough: string | null,
  verifiedPaidThrough: string | null,
  rejected: { through: string; reason: Exclude<InvoicePaymentState, "settled"> }[],
  now = Date.now(),
): string | null {
  const verifiedEnd = verifiedPaidThrough ? Date.parse(verifiedPaidThrough) : 0;
  const unsupported = rejected
    .filter((item) => Date.parse(item.through) > Math.max(now, verifiedEnd))
    .sort((a, b) => Date.parse(b.through) - Date.parse(a.through))[0];
  if (unsupported) return unsupported.reason;
  // SQL retains greatest(paid_through). Never clear a hold while that stored
  // future period lacks revalidated invoice/charge evidence, even on an open renewal.
  if (priorPaidThrough && Date.parse(priorPaidThrough) > Math.max(now, verifiedEnd))
    return "stripe_payment_unverified";
  return null;
}
