import { z } from "zod";

export const accountingDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === s;
  }, "Use a valid calendar date.");
const cents = z.number().int().nonnegative().max(9_000_000_000_000);
const source = z.object({ job_id: z.string(), currency: z.literal("USD").optional() });
const version = z
  .object({
    version: z.number().int().positive(),
    status: z.enum(["draft", "submitted", "certified", "posted", "void"]),
    invoice_date: accountingDate,
    effective_date: accountingDate,
    source: z.string(),
    gross_cents: cents.nullable(),
    withheld_cents: cents.nullable(),
    released_cents: cents.nullable(),
    net_due_cents: cents,
    reason: z.string().nullable().optional(),
  })
  .passthrough();
export const billingReportSchema = z.object({
  currency: z.literal("USD"),
  invoices: z.array(
    source.extend({
      id: z.string(),
      document_number: z.string(),
      kind: z.enum(["invoice", "pay_application", "credit"]),
      credit_for: z.string().nullable(),
      versions: z.array(version).min(1),
    }),
  ),
  receipts: z.array(
    source.extend({
      id: z.string(),
      receipt_date: accountingDate,
      amount_cents: cents,
      source: z.string(),
    }),
  ),
  allocations: z.array(
    source.extend({
      id: z.string(),
      receipt_id: z.string(),
      invoice_id: z.string(),
      effective_date: accountingDate,
      amount_cents: cents,
      reversal_of: z.string().nullable(),
      source: z.string(),
    }),
  ),
  receipt_reversals: z.array(
    source.extend({
      id: z.string(),
      receipt_id: z.string(),
      effective_date: accountingDate,
      amount_cents: cents,
      source: z.string(),
    }),
  ),
});
export type BillingReportSource = z.infer<typeof billingReportSchema>;
export type BudgetFact = { job_id: string; key: string; status: string; value: unknown };
export type Dependency<T> = { available: true; data: T } | { available: false; reason: string };
export const costReportSchema = z.object({
  records: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["supplier_bill", "company_paid_expense", "reimbursable_expense"]),
      posted_version: z.number().int().positive().nullable(),
      versions: z
        .array(
          z.object({
            version: z.number().int().positive(),
            facts: z
              .object({
                kind: z.enum(["supplier_bill", "company_paid_expense", "reimbursable_expense"]),
                description: z.string(),
                incurred_on: accountingDate,
                counterparty_name: z.string(),
                amount_cents: cents,
                document_reference: z.string().optional(),
                allocations: z
                  .array(
                    z.object({ job_id: z.string(), cost_code: z.string(), amount_cents: cents }),
                  )
                  .min(1),
              })
              .passthrough(),
          }),
        )
        .min(1),
      payments: z.array(
        z.object({
          id: z.string(),
          amount_cents: cents,
          paid_on: accountingDate,
          reference: z.string(),
          corrected: z.boolean(),
          shared: z.boolean(),
        }),
      ),
    }),
  ),
});
export const poReportSchema = z.object({
  orders: z.array(
    source.extend({
      id: z.string(),
      company_id: z.string(),
      number: z.string(),
      versions: z
        .array(
          z.object({
            version: z.number().int().positive(),
            status: z.enum(["draft", "reviewed", "approved", "issued", "accepted"]),
            created_at: z.string().datetime({ offset: true }),
            order_date: accountingDate,
            lines: z.array(
              z.object({
                description: z.string(),
                quantity: z.number().positive(),
                unit_price_cents: cents,
              }),
            ),
          }),
        )
        .min(1),
    }),
  ),
});
export type CostReportSource = z.infer<typeof costReportSchema>;
export type PoReportSource = z.infer<typeof poReportSchema>;
export type AccountingSources = {
  jobId: string;
  companyId?: string;
  capturedAt: string;
  billing: BillingReportSource;
  budgets: BudgetFact[];
  costs: Dependency<CostReportSource>;
  orders: Dependency<PoReportSource>;
};
export type AccountingOptions = { from?: string; asOf: string };
export type AccountingRow = {
  id: string;
  kind: string;
  date: string | null;
  version: number | null;
  label: string;
  costCode: string | null;
  category: string | null;
  amountCents: number | null;
  balanceCents: number | null;
  source: string;
};
export type Metric = { key: string; label: string; cents: number | null; basis: string };
export type AccountingReport = {
  jobId: string;
  companyId?: string;
  capturedAt: string;
  currency: "USD";
  from: string | null;
  asOf: string;
  basis: string;
  limitations: string[];
  metrics: Metric[];
  rows: AccountingRow[];
  costCodes: {
    code: string;
    budgetCents: number | null;
    recordedCostCents: number | null;
    remainingCents: number | null;
  }[];
};
export function sumCents(values: Array<number | null>, empty: number | null = null): number | null {
  if (!values.length) return empty;
  if (values.some((v) => v === null || !Number.isSafeInteger(v))) return null;
  const sum = values.reduce<bigint>((n, v) => n + BigInt(v!), 0n);
  return sum <= BigInt(Number.MAX_SAFE_INTEGER) && sum >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(sum)
    : null;
}
function difference(a: number | null, b: number | null) {
  return a === null || b === null ? null : sumCents([a, -b]);
}
function budgetAmount(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const n = (value as { amount?: unknown }).amount;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  // Extend the source decimal exactly, avoiding binary-float rounding or sub-cent loss.
  return n <= 90_000_000_000 ? extendedCents(n, 100) : null;
}
/** No undocumented fractional-cent rounding of PO line extensions. */
function extendedCents(quantity: number, price: number): number | null {
  const [mantissa, exponent = "0"] = quantity.toString().toLowerCase().split("e");
  const [whole, fractional = ""] = mantissa.split(".");
  const power = Number(exponent) - fractional.length;
  if (Math.abs(power) > 100) return null;
  const numerator =
    BigInt(whole + fractional) * BigInt(price) * (power > 0 ? 10n ** BigInt(power) : 1n);
  const divisor = power < 0 ? 10n ** BigInt(-power) : 1n;
  if (numerator % divisor !== 0n) return null;
  const result = numerator / divisor;
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null;
}
export function buildAccountingReport(
  s: AccountingSources,
  options: AccountingOptions,
): AccountingReport {
  const asOf = accountingDate.parse(options.asOf);
  const from = options.from ? accountingDate.parse(options.from) : null;
  const today = s.capturedAt.slice(0, 10);
  accountingDate.parse(today);
  if (asOf > today || (from && from > asOf))
    throw new Error("Choose dates through today, with start on or before as-of.");
  const billing = billingReportSchema.parse(s.billing);
  for (const row of [
    ...billing.invoices,
    ...billing.receipts,
    ...billing.allocations,
    ...billing.receipt_reversals,
    ...s.budgets,
  ])
    if (row.job_id !== s.jobId) throw new Error("Source belongs to another project.");
  const unique = (ids: string[]) => {
    if (new Set(ids).size !== ids.length) throw new Error("Duplicate source identity.");
  };
  unique(billing.invoices.map((r) => r.id));
  unique(billing.receipts.map((r) => r.id));
  unique(billing.allocations.map((r) => r.id));
  unique(billing.receipt_reversals.map((r) => r.id));
  unique(s.budgets.map((r) => r.key));
  const through = (d: string) => d <= asOf;
  const period = (d: string) => through(d) && (!from || d >= from);
  const rows: AccountingRow[] = [];
  const limitations = [
    "Entered evidence only; missing history is unknown. USD only; no currency conversion.",
    "As-of uses effective dates in evidence known now, not a reconstruction of what was known then. Inclusive calendar dates; capture time is UTC.",
    "Billed amounts are not earned revenue. Labor, burden, equipment, accruals and complete cost-category coverage are unverified; this is not a complete P&L.",
    "Budget is the current saved internal budget, not a historical budget. PO commitments are separate and are never added to actual costs or payments.",
    "Sources are read separately, not an atomic accounting close. Reload after concurrent changes; preserve the export and its capture time for review.",
  ];
  const current = billing.invoices.flatMap((i) => {
    unique(i.versions.map((v) => String(v.version)));
    // Highest immutable revision effective by the cutoff wins, independent of transport ordering.
    const v = [...i.versions]
      .filter((v) => through(v.effective_date))
      .sort((a, b) => b.version - a.version)[0];
    return v && through(v.invoice_date) ? [{ ...i, v }] : [];
  });
  const active = current.filter(
    (i) => i.kind !== "credit" && ["submitted", "certified"].includes(i.v.status),
  );
  const credits = current.filter((i) => i.kind === "credit" && i.v.status === "posted");
  const receipts = billing.receipts.filter((r) => through(r.receipt_date));
  const receiptIds = new Set(receipts.map((r) => r.id));
  const reversals = billing.receipt_reversals.filter((r) => through(r.effective_date));
  const allocations = billing.allocations.filter((r) => through(r.effective_date));
  const invoiceIds = new Set(current.map((r) => r.id));
  if (
    reversals.some((r) => !receiptIds.has(r.receipt_id)) ||
    allocations.some((a) => !receiptIds.has(a.receipt_id) || !invoiceIds.has(a.invoice_id))
  )
    throw new Error(
      "Dated settlement evidence references an unavailable invoice or receipt; reconcile source dates.",
    );
  const creditByInvoice = (id: string) =>
    sumCents(
      credits.filter((c) => c.credit_for === id).map((c) => c.v.net_due_cents),
      0,
    );
  const allocated = (id: string) =>
    sumCents(
      allocations
        .filter((a) => a.invoice_id === id)
        .map((a) => (a.reversal_of ? -a.amount_cents : a.amount_cents)),
      0,
    );
  const balances = active.map((i) =>
    difference(difference(i.v.net_due_cents, creditByInvoice(i.id)), allocated(i.id)),
  );
  for (const i of current) {
    const included =
      i.kind === "credit"
        ? i.v.status === "posted"
        : ["submitted", "certified"].includes(i.v.status);
    rows.push({
      id: `invoice:${i.id}`,
      kind: included ? (i.kind === "credit" ? "credit" : "billed") : `excluded_${i.v.status}`,
      date: i.v.invoice_date,
      version: i.v.version,
      label: i.document_number,
      costCode: null,
      category: null,
      amountCents: included ? (i.kind === "credit" ? -i.v.net_due_cents : i.v.gross_cents) : null,
      balanceCents: active.some((a) => a.id === i.id)
        ? difference(difference(i.v.net_due_cents, creditByInvoice(i.id)), allocated(i.id))
        : null,
      source: `${i.id}; effective ${i.v.effective_date}; ${i.v.status}; gross_cents ${i.v.gross_cents ?? "Unknown"}; net_due_cents ${i.v.net_due_cents}; withheld_cents ${i.v.withheld_cents ?? "Unknown"}; released_cents ${i.v.released_cents ?? "Unknown"}; ${i.v.source}${i.v.reason ? `; correction: ${i.v.reason}` : ""}${i.credit_for ? `; credits ${i.credit_for}` : ""}`,
    });
  }
  for (const r of receipts)
    rows.push({
      id: `receipt:${r.id}`,
      kind: "receipt",
      date: r.receipt_date,
      version: null,
      label: r.source,
      costCode: null,
      category: null,
      amountCents: r.amount_cents,
      balanceCents: null,
      source: r.id,
    });
  for (const r of reversals)
    rows.push({
      id: `receipt_reversal:${r.id}`,
      kind: "receipt_reversal",
      date: r.effective_date,
      version: null,
      label: r.source,
      costCode: null,
      category: null,
      amountCents: -r.amount_cents,
      balanceCents: null,
      source: `${r.id}; receipt ${r.receipt_id}`,
    });
  for (const a of allocations)
    rows.push({
      id: `allocation:${a.id}`,
      kind: a.reversal_of ? "allocation_reversal" : "allocation",
      date: a.effective_date,
      version: null,
      label: a.source,
      costCode: null,
      category: null,
      amountCents: a.reversal_of ? -a.amount_cents : a.amount_cents,
      balanceCents: null,
      source: `${a.id}; receipt ${a.receipt_id}; invoice ${a.invoice_id}${a.reversal_of ? `; reverses ${a.reversal_of}` : ""}; application only, no revenue or cash effect`,
    });
  const costAvailable = s.costs.available && asOf === today;
  const costsByCode = new Map<string, number[]>();
  let payableKnown = costAvailable;
  const payables: number[] = [];
  if (!s.costs.available) limitations.push(s.costs.reason);
  else if (!costAvailable)
    limitations.push(
      "Historical posted costs and AP balances unavailable: AP read contract omits posting timestamps. No historical cost or settlement total is inferred.",
    );
  else {
    const costs = costReportSchema.parse(s.costs.data);
    unique(costs.records.map((r) => r.id));
    for (const r of costs.records) {
      unique(r.versions.map((v) => String(v.version)));
      const v = r.versions.find((v) => v.version === r.posted_version);
      if (r.posted_version !== null && !v) throw new Error("Posted cost version unavailable.");
      if (!v) continue;
      if (
        v.facts.kind !== r.kind ||
        sumCents(v.facts.allocations.map((a) => a.amount_cents)) !== v.facts.amount_cents
      )
        throw new Error("Cost allocations do not reconcile.");
      const own = v.facts.allocations.filter((a) => a.job_id === s.jobId);
      if (!own.length || !through(v.facts.incurred_on)) continue;
      const split = v.facts.allocations.some((a) => a.job_id !== s.jobId);
      const payments = r.payments.filter((p) => !p.corrected && through(p.paid_on));
      unique(payments.map((p) => p.id));
      // A record-level payment does not identify which project's split it settles.
      const balance =
        r.kind === "company_paid_expense"
          ? 0
          : split
            ? null
            : difference(
                v.facts.amount_cents,
                sumCents(
                  payments.map((p) => p.amount_cents),
                  0,
                ),
              );
      if (balance !== null && balance < 0)
        throw new Error("Settlement exceeds posted cost; reconcile evidence.");
      if (balance === null) payableKnown = false;
      else payables.push(balance);
      const pending = Math.max(...r.versions.map((v) => v.version)) > v.version;
      own.forEach((a, index) => {
        costsByCode.set(a.cost_code, [...(costsByCode.get(a.cost_code) ?? []), a.amount_cents]);
        rows.push({
          id: `cost:${r.id}:${index}`,
          kind: "posted_cost",
          date: v.facts.incurred_on,
          version: v.version,
          label: v.facts.description,
          costCode: a.cost_code,
          category: "Unclassified (cost category unavailable)",
          amountCents: a.amount_cents,
          balanceCents: null,
          source: `${r.id}; ${r.kind}; ${v.facts.counterparty_name}; reference ${v.facts.document_reference ?? "missing"}; original missing; PO ${v.facts.purchase_order_id ?? "not linked"} revision ${v.facts.purchase_order_version ?? "unknown"}${pending ? "; later unposted correction excluded" : ""}`,
        });
      });
      rows.push({
        id: `payable:${r.id}`,
        kind: "payable",
        date: v.facts.incurred_on,
        version: v.version,
        label: v.facts.description,
        costCode: null,
        category: null,
        amountCents: null,
        balanceCents: balance,
        source: `${r.id}; ${r.kind === "company_paid_expense" ? "company-paid expense has no payable" : split ? "project share of settlement unknown" : "posted amount less active settlement evidence"}`,
      });
      for (const p of r.payments.filter((p) => through(p.paid_on)))
        rows.push({
          id: `cost_payment:${r.id}:${p.id}`,
          kind: p.corrected ? "corrected_settlement" : "settlement_evidence",
          date: p.paid_on,
          version: null,
          label: p.reference,
          costCode: null,
          category: null,
          amountCents: split || p.corrected ? null : p.amount_cents,
          balanceCents: null,
          source: `${r.id}; ${p.id}; ${p.shared ? "shared payment allocation" : "record payment"}; ${p.corrected ? "evidence corrected; not proof of bank reversal" : "settlement only, never another cost"}${split ? "; project share unknown" : ""}`,
        });
    }
    limitations.push(
      "Cost categories are unavailable in the AP contract; cost kinds identify bills/expenses, not labor/material/equipment categories. Split-job AP balances are unknown without explicit job settlement allocations.",
    );
  }
  if (!s.orders.available) limitations.push(s.orders.reason);
  else {
    const orders = poReportSchema.parse(s.orders.data);
    unique(orders.orders.map((o) => o.id));
    for (const o of orders.orders) {
      if (o.job_id !== s.jobId || (s.companyId && o.company_id !== s.companyId))
        throw new Error("PO belongs to another company or project.");
      unique(o.versions.map((v) => String(v.version)));
      const eligible = [...o.versions]
        .filter(
          (v) => new Date(v.created_at).toISOString().slice(0, 10) <= asOf && through(v.order_date),
        )
        .sort((a, b) => b.version - a.version);
      const approved = eligible.find((v) => ["approved", "issued", "accepted"].includes(v.status));
      if (!approved) continue;
      rows.push({
        id: `po:${o.id}`,
        kind: "commitment",
        date: approved.order_date,
        version: approved.version,
        label: o.number,
        costCode: null,
        category: null,
        amountCents: sumCents(
          approved.lines.map((l) => extendedCents(l.quantity, l.unit_price_cents)),
        ),
        balanceCents: null,
        source: `${o.id}; ${approved.status}; gross internally approved commitment; external acceptance not inferred; no cost/payment effect${eligible[0].version > approved.version ? "; later draft exists, prior approval not assumed revoked" : ""}`,
      });
    }
    limitations.push(
      "Commitments are gross approved PO amounts, not remaining unspent commitments; bill/PO matching and fractional-cent extension policy are not supplied.",
    );
  }
  const budget = new Map(
    s.budgets.map((b) => [b.key, b.status === "known" ? budgetAmount(b.value) : null]),
  );
  const costCodes = [...new Set([...budget.keys(), ...costsByCode.keys()])].sort().map((code) => {
    const amount = costAvailable ? sumCents(costsByCode.get(code) ?? []) : null;
    return {
      code,
      budgetCents: budget.get(code) ?? null,
      recordedCostCents: amount,
      remainingCents: difference(budget.get(code) ?? null, amount),
    };
  });
  const gross = sumCents(
    active.filter((i) => period(i.v.invoice_date)).map((i) => i.v.gross_cents),
  );
  const credit = sumCents(
    credits.filter((i) => period(i.v.invoice_date)).map((i) => i.v.net_due_cents),
    current.length ? 0 : null,
  );
  const costs = costAvailable
    ? sumCents(
        rows
          .filter((r) => r.kind === "posted_cost" && r.date && period(r.date))
          .map((r) => r.amountCents),
      )
    : null;
  const metric = (key: string, label: string, value: number | null, basis: string): Metric => ({
    key,
    label,
    cents: value,
    basis,
  });
  const metrics = [
    metric(
      "billed_gross",
      "Recorded gross billed",
      gross,
      "Submitted/certified documents dated in range, latest revision effective through as-of; excludes drafts/voids. Not earned revenue.",
    ),
    metric(
      "credits",
      "Posted invoice credits",
      credit,
      "Net invoice credit amounts dated in range; not cash refunds.",
    ),
    metric(
      "receipts",
      "Recorded net receipts",
      sumCents([
        ...receipts.filter((r) => period(r.receipt_date)).map((r) => r.amount_cents),
        ...reversals.filter((r) => period(r.effective_date)).map((r) => -r.amount_cents),
      ]),
      "Receipts less evidence reversals dated in range; allocations are not new cash.",
    ),
    metric(
      "unpaid_invoices",
      "Unpaid recorded invoices as-of",
      sumCents(balances),
      "All active invoice net dues less posted credits and net allocations through cutoff, independent of start date.",
    ),
    metric(
      "unapplied_receipts",
      "Unapplied recorded receipts as-of",
      difference(
        difference(
          sumCents(receipts.map((r) => r.amount_cents)),
          sumCents(
            reversals.map((r) => r.amount_cents),
            0,
          ),
        ),
        sumCents(
          allocations.map((r) => (r.reversal_of ? -r.amount_cents : r.amount_cents)),
          0,
        ),
      ),
      "Receipts less reversals and allocations through cutoff; not an additional receipt.",
    ),
    metric(
      "retainage",
      "Recorded retainage held as-of",
      sumCents(active.map((i) => difference(i.v.withheld_cents, i.v.released_cents))),
      "Source withheld less released across active invoice records; no assumed opening balance.",
    ),
    metric(
      "actual_costs",
      "Recorded posted costs",
      costs,
      "Latest POSTED version, incurred dates in range; includes reimbursement cost once, excludes settlements and unposted corrections. Current snapshot only.",
    ),
    metric(
      "unpaid_costs",
      "Unpaid recorded AP as-of",
      payableKnown ? sumCents(payables) : null,
      "Posted bills/reimbursements less active settlement evidence; split-job balances unavailable. Company-paid expenses have no payable.",
    ),
    metric(
      "commitments",
      "Gross approved commitments as-of",
      s.orders.available
        ? sumCents(rows.filter((r) => r.kind === "commitment").map((r) => r.amountCents))
        : null,
      "Approved PO revisions through cutoff; shown separately, not added to posted costs. Not remaining commitment.",
    ),
    metric(
      "budget",
      "Current saved cost budget",
      sumCents([...budget.values()]),
      "Known saved budget lines, dollars converted to cents; missing line values make total unknown. Completeness unverified.",
    ),
    metric(
      "provisional_result",
      "Provisional billed less recorded costs",
      difference(difference(gross, credit), costs),
      "Gross billed less net posted invoice credits less recorded posted costs for range. Incomplete billing/cost basis; not earned margin or complete P&L.",
    ),
  ];
  return {
    jobId: s.jobId,
    companyId: s.companyId,
    capturedAt: s.capturedAt,
    currency: "USD",
    from,
    asOf,
    basis:
      "Current evidence by effective date; document/receipt/cost activity in the inclusive date range. Balances and commitments are cumulative through as-of; current budget comparison uses cumulative recorded costs.",
    limitations,
    metrics,
    costCodes,
    rows: rows.sort(
      (a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.id.localeCompare(b.id),
    ),
  };
}
export function accountingPage(report: AccountingReport, page = 1, pageSize = 50) {
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    throw new Error("Invalid ledger page.");
  return {
    rows: report.rows.slice((page - 1) * pageSize, page * pageSize),
    totalRows: report.rows.length,
    page,
    pageSize,
    nextPage: page * pageSize < report.rows.length ? page + 1 : null,
  };
}
export function accountingSourceUrl(report: AccountingReport, rowId: string): string {
  const index = report.rows.findIndex((r) => r.id === rowId);
  if (index < 0) throw new Error("Source row unavailable.");
  const query = new URLSearchParams({
    as_of: report.asOf,
    ledger_page: String(Math.floor(index / 50) + 1),
    ...(report.from ? { from: report.from } : {}),
  });
  return `https://app.meetathena.io/r/job/${report.jobId}/accounting?${query}#${encodeURIComponent(rowId)}`;
}
export const accountingMoney = (n: number | null) =>
  n === null
    ? "Unknown"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n / 100);
/** Quote every cell and neutralize spreadsheet formula prefixes, including whitespace/control-prefixed ones. */
export function accountingCsv(report: AccountingReport): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "Unknown" : String(v);
    let first = 0;
    while (first < s.length && (s.charCodeAt(first) <= 31 || /\s/u.test(s[first]))) first++;
    if (["=", "+", "-", "@"].includes(s[first]) && typeof v !== "number") s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  const out: unknown[][] = [
    [
      "type",
      "id",
      "date",
      "version",
      "label",
      "cost_code",
      "category",
      "currency",
      "amount_cents",
      "balance_cents",
      "basis_or_source",
      "private_source_url",
    ],
  ];
  out.push([
    "report",
    report.jobId,
    report.asOf,
    "",
    "Accounting evidence",
    "",
    "",
    "USD",
    "",
    "",
    `${report.basis} From ${report.from ?? "inception"}; captured ${report.capturedAt}; company ${report.companyId ?? "resolved by job access"}`,
  ]);
  for (const note of report.limitations)
    out.push(["limitation", "", "", "", "", "", "", "USD", "", "", note]);
  for (const m of report.metrics)
    out.push(["summary", m.key, report.asOf, "", m.label, "", "", "USD", m.cents, "", m.basis]);
  for (const c of report.costCodes)
    out.push([
      "budget_comparison",
      c.code,
      report.asOf,
      "",
      "Current budget vs cumulative recorded costs",
      c.code,
      "Unclassified",
      "USD",
      c.recordedCostCents,
      c.remainingCents,
      `Budget cents ${c.budgetCents ?? "Unknown"}; remaining budget is not forecast final cost`,
    ]);
  for (const r of report.rows)
    out.push([
      r.kind,
      r.id,
      r.date,
      r.version,
      r.label,
      r.costCode,
      r.category,
      "USD",
      r.amountCents,
      r.balanceCents,
      r.source,
      accountingSourceUrl(report, r.id),
    ]);
  return (
    "\uFEFF" +
    out
      .map((r) => [...r, ...Array(Math.max(0, 12 - r.length)).fill("")].map(cell).join(","))
      .join("\r\n") +
    "\r\n"
  );
}
