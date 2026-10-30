import { accountingMoney, sumCents, type AccountingReport } from "./accounting-report";
import { apMoney, type ApCostRow } from "./accounting-ap-versioned";

export const REPORT_TYPES = {
  summary: "Project financial summary",
  receivables: "Receivables & cash",
  costs: "Costs versus budget",
  statement: "Customer statement",
  evidence: "Full accounting evidence",
} as const;
export type ReportType = keyof typeof REPORT_TYPES;
export type ReportFilters = { currency: string; vendor: string; costCode: string };
export const defaultReportFilters: ReportFilters = { currency: "USD", vendor: "", costCode: "" };
export type ReadableRow = { label: string; amount: string; basis: string };
export type ReadableTable = { title: string; headers: string[]; rows: string[][] };
export type ReadableReport = {
  title: string;
  notes: string[];
  metrics: ReadableRow[];
  tables: ReadableTable[];
  customerSafe: boolean;
};
const exactSum = (values: (string | null)[]) =>
  !values.length || values.some((v) => v === null)
    ? null
    : values.reduce((n, v) => n + BigInt(v!), 0n).toString();
const byKind = (r: AccountingReport, kinds: string[]) =>
  r.rows.filter((x) => kinds.includes(x.kind));
const signed = (r: AccountingReport, kinds: string[]) =>
  sumCents(byKind(r, kinds).map((x) => x.amountCents));
export function reportingChoices(report: AccountingReport) {
  return {
    currencies: [
      ...new Set([
        "USD",
        ...(report.ap?.rows.map((r) => r.currency).filter((c): c is string => c !== null) ?? []),
      ]),
    ].sort(),
    vendors: [
      ...new Set(report.ap?.rows.map((r) => r.counterparty).filter((v): v is string => !!v) ?? []),
    ].sort(),
    costCodes: [
      ...new Set([
        ...report.costCodes.map((c) => c.code),
        ...(report.ap?.rows.map((r) => r.costCode) ?? []),
      ]),
    ].sort(),
  };
}
export function selectedApRows(report: AccountingReport, filters: ReportFilters): ApCostRow[] {
  return (
    report.ap?.rows.filter(
      (r) =>
        (r.currency === filters.currency ||
          (filters.currency === "unknown" && r.currency === null)) &&
        (!filters.vendor || r.counterparty === filters.vendor) &&
        (!filters.costCode || r.costCode === filters.costCode),
    ) ?? []
  );
}
/** A presentation of the canonical report; never sums heterogeneous ledger rows. */
export function readableAccountingReport(
  report: AccountingReport,
  type: Exclude<ReportType, "evidence">,
  input: ReportFilters = defaultReportFilters,
): ReadableReport {
  const filters = type === "costs" ? input : { ...defaultReportFilters, currency: input.currency };
  const customerSafe = type === "statement";
  const notes = [
    `As of ${report.asOf}; activity ${report.from ?? "inception"} through ${report.asOf}, inclusive. Captured ${report.capturedAt} (UTC).`,
    "Balances are cumulative through as-of, independent of the activity start date. Current evidence selected by effective date; this is not a historical close.",
  ];
  const metric = (key: string): ReadableRow => {
    const m = report.metrics.find((m) => m.key === key);
    return {
      label: m?.label ?? key,
      amount: accountingMoney(m?.cents ?? null),
      basis: m?.basis ?? "Unknown",
    };
  };
  const metrics: ReadableRow[] = [];
  const tables: ReadableTable[] = [];
  if (type === "summary" || type === "receivables" || type === "statement") {
    // AR has an explicit USD-only contract. Never relabel it as the selected AP currency.
    if (filters.currency === "USD") {
      metrics.push(
        ...[
          "billed_gross",
          "credits",
          "receipts",
          "unpaid_invoices",
          "unapplied_receipts",
          "retainage",
        ].map(metric),
      );
      metrics.splice(
        3,
        0,
        {
          label: "Gross receipts through as-of",
          amount: accountingMoney(signed(report, ["receipt"])),
          basis:
            "Cumulative recorded receipts before evidence reversals; allocations are not additional cash.",
        },
        {
          label: "Net receipts through as-of",
          amount: accountingMoney(signed(report, ["receipt", "receipt_reversal"])),
          basis:
            "Cumulative recorded receipts less evidence reversals; not reduced again by allocations.",
        },
        {
          label: "Applied cash through as-of",
          amount: accountingMoney(signed(report, ["allocation", "allocation_reversal"])),
          basis:
            "Cumulative receipt allocations less allocation reversals. Not additional receipts or revenue.",
        },
      );
      tables.push({
        title: "Recorded invoice balances",
        headers: [
          "Document",
          "Invoice date",
          "Gross billed (USD)",
          "Outstanding (USD)",
          "Revision",
        ],
        rows: byKind(report, ["billed"]).map((r) => [
          r.label,
          r.date ?? "Unknown",
          accountingMoney(r.amountCents),
          accountingMoney(r.balanceCents),
          String(r.version ?? "Unknown"),
        ]),
      });
      if (!customerSafe)
        tables.push({
          title: "Cash activity and applications",
          headers: ["Record", "Date", "Type", "Amount (USD)", "Basis"],
          rows: byKind(report, [
            "receipt",
            "receipt_reversal",
            "allocation",
            "allocation_reversal",
            "credit",
          ]).map((r) => [
            r.label,
            r.date ?? "Unknown",
            r.kind.replaceAll("_", " "),
            accountingMoney(r.amountCents),
            r.source,
          ]),
        });
      if (customerSafe)
        notes.push(
          "Recorded billing and payment balances only. Prepared for review; no delivery or external sharing has occurred.",
        );
    } else
      notes.push(
        "Receivables, receipts, retainage and budget have USD source contracts only. No conversion or non-USD receivables are inferred.",
      );
  }
  if (type === "summary" || type === "costs") {
    notes.push(
      "Costs are recorded Athena AP only; payroll, burden, equipment and external accounting completeness are unverified. Profit and margin are not established.",
    );
    if (report.ap) {
      const rows = selectedApRows(report, filters);
      const amount = (values: (string | null)[]) =>
        apMoney(exactSum(values), filters.currency === "unknown" ? null : filters.currency);
      metrics.push(
        {
          label: `Recorded posted costs (${filters.currency}) through as-of`,
          amount: amount(rows.map((r) => r.amountCents)),
          basis:
            "Cumulative current posted versions effective through cutoff. Not settlement or complete job costs.",
        },
        {
          label: `Selected-range AP amounts (${filters.currency})`,
          amount: rows.some((r) => r.inPeriod === null)
            ? "Unknown"
            : amount(rows.filter((r) => r.inPeriod).map((r) => r.amountCents)),
          basis:
            "Selected current versions with accounting effective dates in the activity range; not posting-delta or journal movement totals.",
        },
      );
      if (report.ap.rows.some((r) => r.currency === null))
        notes.push(
          "Some AP currency is unknown. Currency-filtered amounts represent the reviewed-currency subset only; unknown rows remain in full evidence.",
        );
      if (type === "costs") {
        const codes = [
          ...new Set([
            ...rows.map((r) => r.costCode),
            ...(filters.currency === "USD" && !filters.vendor
              ? report.costCodes
                  .map((c) => c.code)
                  .filter((c) => !filters.costCode || c === filters.costCode)
              : []),
          ]),
        ].sort();
        tables.push({
          title: "Current budget and cumulative recorded costs",
          headers: [
            "Cost code",
            `Budget (${filters.currency})`,
            `Recorded costs (${filters.currency})`,
            `Budget less recorded (${filters.currency})`,
          ],
          rows: codes.map((code) => {
            const costs = exactSum(
              rows.filter((r) => r.costCode === code).map((r) => r.amountCents),
            );
            const budget =
              filters.currency === "USD" && !filters.vendor
                ? (report.costCodes.find((c) => c.code === code)?.budgetCents ?? null)
                : null;
            return [
              code,
              budget === null ? "Unknown" : apMoney(String(budget), "USD"),
              apMoney(costs, filters.currency === "unknown" ? null : filters.currency),
              budget !== null && costs !== null
                ? apMoney((BigInt(budget) - BigInt(costs)).toString(), "USD")
                : "Unknown",
            ];
          }),
        });
        tables.push({
          title: "Posted AP allocations",
          headers: ["Vendor", "Reference", "Effective date", "Cost code", "Amount", "Revision"],
          rows: rows.map((r) => [
            r.counterparty ?? "Not recorded",
            r.reference ?? "Not recorded",
            r.effectiveOn ?? "Unknown",
            r.costCode,
            apMoney(r.amountCents, r.currency),
            `v${r.version}`,
          ]),
        });
      }
      notes.push(report.ap.basis);
    } else {
      const selectedCosts =
        filters.currency === "USD" && !filters.vendor
          ? sumCents(
              report.rows
                .filter(
                  (r) =>
                    r.kind === "posted_cost" &&
                    (!filters.costCode || r.costCode === filters.costCode) &&
                    !!r.date &&
                    (!report.from || r.date >= report.from),
                )
                .map((r) => r.amountCents),
            )
          : null;
      metrics.push({
        label: "Recorded posted costs in selected range",
        amount: accountingMoney(selectedCosts),
        basis:
          "Filtered recorded USD cost rows. Missing integration or unsupported currency remains unknown.",
      });
      if (type === "costs")
        tables.push({
          title: "Current budget and cumulative recorded costs",
          headers: ["Cost code", "Budget (USD)", "Recorded cost (USD)", "Remaining (USD)"],
          rows:
            filters.currency === "USD" && !filters.vendor
              ? report.costCodes
                  .filter((c) => !filters.costCode || c.code === filters.costCode)
                  .map((c) => [
                    c.code,
                    accountingMoney(c.budgetCents),
                    accountingMoney(c.recordedCostCents),
                    accountingMoney(c.remainingCents),
                  ])
              : [],
        });
    }
    if (filters.currency === "USD" && !filters.vendor)
      metrics.push(
        filters.costCode
          ? {
              label: "Current saved budget for selected code",
              amount: accountingMoney(
                report.costCodes.find((c) => c.code === filters.costCode)?.budgetCents ?? null,
              ),
              basis: "Current saved budget; completeness unverified.",
            }
          : metric("budget"),
      );
    if (type === "summary" && filters.currency === "USD") metrics.push(metric("commitments"));
    metrics.push(
      {
        label: "Unpaid AP",
        amount: "Unknown",
        basis: "Job settlement allocations and shared-payment conservation are unsupported.",
      },
      {
        label: "Profit / margin",
        amount: "Not established",
        basis:
          "Billed amounts are not earned revenue; costs and budget do not establish final margin.",
      },
    );
    if (filters.vendor)
      notes.push(
        `Vendor: ${filters.vendor}. Budget comparison is withheld because budget lines have no vendor allocation.`,
      );
    if (filters.costCode) notes.push(`Cost code: ${filters.costCode}.`);
    notes.push(
      "Current budget is not historical budget or forecast final cost. Commitments are separate from costs and payments.",
    );
  }
  return { title: REPORT_TYPES[type], notes, metrics, tables, customerSafe };
}

/** Separate, rectangular, major-unit reports. Original heterogeneous evidence CSV stays unchanged. */
export function readableAccountingCsv(
  report: AccountingReport,
  type: Exclude<ReportType, "evidence">,
  filters: ReportFilters,
  identity: string,
  fields: { basis: boolean; tableIndex?: number } = { basis: true },
): string {
  const view = readableAccountingReport(report, type, filters);
  const metadata = [
    identity,
    view.title,
    report.asOf,
    report.from ?? "Inception",
    report.capturedAt,
    filters.currency,
  ];
  const context = view.notes.join(" ");
  const table =
    fields.tableIndex !== undefined
      ? view.tables[fields.tableIndex]
      : type === "summary"
        ? undefined
        : view.tables[0];
  const out: string[][] = table
    ? [
        [
          "Project",
          "Report",
          "As of",
          "Activity from",
          "Captured at (UTC)",
          "Currency",
          ...table.headers,
          "Report basis",
        ],
        ...(table.rows.length
          ? table.rows.map((row) => [...metadata, ...row, context])
          : [
              [
                ...metadata,
                "No matching recorded evidence",
                ...Array(Math.max(0, table.headers.length - 1)).fill("Unknown"),
                context + " No record total is inferred.",
              ],
            ]),
      ]
    : [
        [
          "Project",
          "Report",
          "As of",
          "Activity from",
          "Captured at (UTC)",
          "Currency",
          "Measure",
          "Value (major units)",
          "Basis",
        ],
        ...view.metrics.map((m) => [
          ...metadata,
          m.label,
          m.amount,
          `${fields.basis ? m.basis + " " : ""}${context}`,
        ]),
      ];
  const cell = (value: string) => {
    // Valid monetary values are emitted as display text without literal apostrophe prefixes.
    const safe =
      /^-?(?:[A-Z]{3} |\$)[\d,.]+$/.test(value) ||
      !/^[=+\-@]/u.test(
        value
          .replace(/^[\s]+/u, "")
          .split("")
          .filter((c) => c.charCodeAt(0) > 31)
          .join(""),
      )
        ? value
        : `'${value}`;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return "\uFEFF" + out.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
