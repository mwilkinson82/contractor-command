import { stripeRefId } from "./paid-product-map";

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
/** Only settled recurring lines prove paid-through access, never invoice.created or status alone. */
export function paidThroughFromInvoice(
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
