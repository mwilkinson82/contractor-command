/** Values are integer USD cents from the scoped ledger. Missing project history is not a zero total. */
export type BillingInvoice = {
  id: string;
  kind: string;
  credit_for: string | null;
  versions: { status: string; net_due_cents: number }[];
};
export type BillingAllocation = {
  invoice_id: string;
  receipt_id: string;
  amount_cents: number;
  reversal_of: string | null;
};
export type BillingReceiptReversal = { receipt_id: string; amount_cents: number };
export function invoiceBalance(
  invoice: BillingInvoice,
  invoices: BillingInvoice[],
  allocations: BillingAllocation[],
) {
  const cash = allocations
    .filter((a) => a.invoice_id === invoice.id)
    .reduce((n, a) => n + (a.reversal_of ? -a.amount_cents : a.amount_cents), 0);
  const credits = invoices
    .filter(
      (c) =>
        c.kind === "credit" && c.credit_for === invoice.id && c.versions[0]?.status === "posted",
    )
    .reduce((n, c) => n + c.versions[0].net_due_cents, 0);
  return { cash, credits, remaining: invoice.versions[0].net_due_cents - cash - credits };
}
export function receiptBalance(
  receipt: { id: string; amount_cents: number },
  allocations: BillingAllocation[],
  reversals: BillingReceiptReversal[],
) {
  const allocated = allocations
    .filter((a) => a.receipt_id === receipt.id)
    .reduce((n, a) => n + (a.reversal_of ? -a.amount_cents : a.amount_cents), 0);
  const reversed = reversals
    .filter((r) => r.receipt_id === receipt.id)
    .reduce((n, r) => n + r.amount_cents, 0);
  return { allocated, reversed, unapplied: receipt.amount_cents - allocated - reversed };
}

/** Totals describe the evidence entered here; null means no relevant records or unsafe precision. */
export function recordedTotals(
  invoices: Array<
    BillingInvoice & {
      versions: Array<{
        status: string;
        net_due_cents: number;
        gross_cents: number | null;
        certified_cents: number | null;
      }>;
    }
  >,
  receipts: Array<{ amount_cents: number }>,
  reversals: BillingReceiptReversal[],
) {
  const sum = (values: number[]) => {
    if (!values.length) return null;
    if (values.some((v) => !Number.isSafeInteger(v))) return null;
    const total = values.reduce((n, v) => n + BigInt(v), 0n);
    return total <= BigInt(Number.MAX_SAFE_INTEGER) && total >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(total)
      : null;
  };
  const submitted = invoices.filter(
    (i) => i.kind !== "credit" && ["submitted", "certified"].includes(i.versions[0]?.status),
  );
  const certified = invoices.filter(
    (i) => i.kind !== "credit" && i.versions[0]?.status === "certified",
  );
  const posted = invoices.filter((i) => i.kind === "credit" && i.versions[0]?.status === "posted");
  return {
    submittedGross: sum(submitted.map((i) => i.versions[0].gross_cents!)),
    certified: sum(certified.map((i) => i.versions[0].certified_cents!)),
    postedCredits: sum(posted.map((i) => i.versions[0].net_due_cents)),
    received: receipts.length
      ? sum([...receipts.map((r) => r.amount_cents), ...reversals.map((r) => -r.amount_cents)])
      : null,
  };
}
