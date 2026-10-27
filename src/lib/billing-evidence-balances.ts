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
