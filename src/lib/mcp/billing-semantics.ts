// Legacy forecasts do not identify whether amounts came from issued invoices
// or from the old earned-progress fallback. Preserve them as unverified data.
export function safeBillingView<T extends Record<string, unknown>>(billing: T): T & { unverified_billed_to_date: unknown; unverified_payments_received: unknown } {
  const raw = billing.billed_to_date;
  const previous = billing.unverified_billed_to_date;
  return {
    ...billing,
    unverified_billed_to_date: previous ?? raw ?? null,
    billed_to_date: null,
    unverified_payments_received: billing.unverified_payments_received ?? billing.payments_received ?? null,
    payments_received: null,
    months: Array.isArray(billing.months)
      ? billing.months.map((row: Record<string, unknown>) =>
          row.kind === "actual" ? { ...row, kind: "unverified" } : row)
      : billing.months,
  } as T & { unverified_billed_to_date: unknown; unverified_payments_received: unknown };
}
