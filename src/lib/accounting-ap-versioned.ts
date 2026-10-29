import { z } from "zod";
import { accountingDate, type AccountingReport } from "./accounting-report";

// Pinned to PR351 1318fa2a's two-decimal unit contract; no inferred ISO exponents.
export const AP_REPORT_CURRENCIES =
  "AED AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CNY COP CRC CUC CUP CVE CZK DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR JMD KES KGS KHR KYD KZT LKR LRD LSL MAD MDL MKD MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD PAB PEN PGK PHP PKR PLN QAR RON RUB SAR SBD SCR SDG SEK SGD SHP SLE SRD SSP STN SVC SZL THB TJS TMT TOP TRY TTD TWD TZS UAH USD UYU UZS VES WST XCD XCG XDR XSU ZAR ZMW ZWG ZWL".split(
    " ",
  );
const supported = new Set(AP_REPORT_CURRENCIES);
const amount = z
  .string()
  .regex(/^[1-9][0-9]{0,12}$/)
  .refine((s) => /^[1-9][0-9]{0,12}$/.test(s) && BigInt(s) <= 9000000000000n);
const version = z.object({
  version: z.number().int().positive(),
  recorded_at: z.string(),
  reason: z.string().nullable(),
  incurred_on: accountingDate.nullable(),
  currency_code: z.string().nullable(),
  currency_source: z.enum(["reviewed_submission", "unknown"]),
  amount_cents: amount,
  document_reference: z.string().nullable(),
  counterparty_name: z.string(),
  allocations: z
    .array(
      z.object({ job_id: z.string().uuid(), cost_code: z.string().min(1), amount_cents: amount }),
    )
    .min(1)
    .max(100),
});
const schema = z.object({
  snapshot_version: z.literal(1),
  complete: z.literal(true),
  status: z.literal("complete"),
  company_id: z.string().uuid(),
  job_id: z.string().uuid(),
  ap: z.object({
    coverage: z.literal("athena_cost_records_only"),
    external_accounting_coverage: z.literal(false),
    cents_encoding: z.literal("decimal_string"),
    currency: z.null(),
    currency_verified: z.literal(false),
    currency_coverage: z.literal("per_version"),
    accounting_effective_date_coverage: z.literal("per_posting"),
    accounting_effective_date_available: z.boolean(),
    settlement_allocation_by_job_available: z.literal(false),
    shared_payment_conservation_available: z.literal(false),
    original_evidence_coverage: z.literal(false),
    records: z
      .array(
        z.object({
          id: z.string(),
          kind: z.enum(["supplier_bill", "company_paid_expense", "reimbursable_expense"]),
          posted_version: z.number().int().positive().nullable(),
          versions: z.array(version).min(1).max(1000),
          posting_events: z
            .array(
              z.object({
                version: z.number().int().positive(),
                posted_at: z.string(),
                accounting_effective_on: accountingDate.nullable(),
              }),
            )
            .max(1000),
          payments: z.array(z.unknown()).max(1000),
          shared_allocations: z.array(z.unknown()).max(1000),
        }),
      )
      .max(200),
  }),
});
export type ApCostRow = {
  id: string;
  recordId: string;
  version: number;
  currency: string | null;
  costCode: string;
  effectiveOn: string | null;
  incurredOn: string | null;
  amountCents: string | null;
  inPeriod: boolean | null;
  source: string;
};
export type ApCurrencyGroup = {
  currency: string | null;
  postedCents: string | null;
  knownSubtotalCents: string | null;
  selectedPeriodCents: string | null;
  unpaidCents: null;
  unknownRows: number;
};
export type ApVersionReport = {
  groups: ApCurrencyGroup[];
  rows: ApCostRow[];
  costCodes: Array<{ currency: string | null; code: string; postedCents: string | null }>;
  hasUnknown: boolean;
  basis: string;
  limitations: string[];
};
const sum = (items: Array<string | null>, empty: string | null = null): string | null =>
  !items.length
    ? empty
    : items.some((x) => x === null)
      ? null
      : items.reduce((n, x) => n + BigInt(x!), 0n).toString();
function unique(values: Array<string | number>) {
  if (new Set(values).size !== values.length) throw new Error("Duplicate AP source identity.");
}
export function buildVersionedApReport(
  raw: unknown,
  jobId: string,
  asOf: string,
  from: string | null,
  companyId?: string,
): ApVersionReport | null {
  if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > 2097152) return null;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return null;
  const s = parsed.data;
  if (s.job_id !== jobId || (companyId && s.company_id !== companyId)) return null;
  try {
    unique(s.ap.records.map((r) => r.id));
    const rows: ApCostRow[] = [];
    for (const r of s.ap.records) {
      unique(r.versions.map((v) => v.version));
      unique(r.posting_events.map((p) => p.version));
      if ((r.posted_version ?? 0) !== Math.max(0, ...r.posting_events.map((p) => p.version)))
        throw new Error("Posted version mismatch.");
      for (const v of r.versions)
        if (sum(v.allocations.map((a) => a.amount_cents)) !== v.amount_cents)
          throw new Error("Allocation mismatch.");
      if (r.posting_events.some((p) => !r.versions.some((v) => v.version === p.version)))
        throw new Error("Posting version absent.");
      const eligible = [...r.posting_events]
        .filter((p) => p.accounting_effective_on !== null && p.accounting_effective_on <= asOf)
        .sort((a, b) => b.version - a.version)[0];
      const uncertain = [...r.posting_events]
        .filter((p) => p.accounting_effective_on === null && p.version > (eligible?.version ?? 0))
        .sort((a, b) => b.version - a.version)[0];
      const p = uncertain ?? eligible;
      if (!p) continue;
      const v = r.versions.find((v) => v.version === p.version)!;
      const currency =
        v.currency_source === "reviewed_submission" &&
        v.currency_code !== null &&
        supported.has(v.currency_code)
          ? v.currency_code
          : null;
      const dated = !uncertain && p.accounting_effective_on !== null;
      const changed =
        new Set(
          r.versions.map((v) =>
            v.currency_source === "reviewed_submission" ? v.currency_code : null,
          ),
        ).size > 1;
      const later = r.versions.some(
        (x) => x.version > v.version && !r.posting_events.some((e) => e.version === x.version),
      );
      v.allocations
        .filter((a) => a.job_id === jobId)
        .forEach((a, i) =>
          rows.push({
            id: `ap:${r.id}:${v.version}:${i}`,
            recordId: r.id,
            version: v.version,
            currency,
            costCode: a.cost_code,
            effectiveOn: dated ? p.accounting_effective_on : null,
            incurredOn: v.incurred_on,
            amountCents: currency && dated ? a.amount_cents : null,
            inPeriod: dated ? !from || p.accounting_effective_on! >= from : null,
            source: `${r.id}; ${r.kind}; ${v.counterparty_name}; reference ${v.document_reference ?? "missing"}; currency source ${v.currency_source} (review confirmation, not independent document verification); incurred ${v.incurred_on ?? "Unknown"}; accounting effective ${dated ? p.accounting_effective_on : "Unknown"}; recorded ${v.recorded_at}; posted recording ${p.posted_at}${later ? "; later unposted revision excluded" : ""}${changed ? "; currency changed across versions: prior settlement is not carried into this currency" : ""}; settlement allocation and conservation unsupported; originals missing`,
          }),
        );
    }
    const groups = [...new Set(rows.map((r) => r.currency))]
      .sort((a, b) => (a ?? "~").localeCompare(b ?? "~"))
      .map((currency) => {
        const own = rows.filter((r) => r.currency === currency);
        return {
          currency,
          postedCents: currency ? sum(own.map((r) => r.amountCents)) : null,
          knownSubtotalCents: currency
            ? sum(own.filter((r) => r.amountCents !== null).map((r) => r.amountCents))
            : null,
          selectedPeriodCents:
            currency && !own.some((r) => r.inPeriod === null)
              ? sum(own.filter((r) => r.inPeriod).map((r) => r.amountCents))
              : null,
          unpaidCents: null,
          unknownRows: own.filter((r) => r.amountCents === null).length,
        } satisfies ApCurrencyGroup;
      });
    const costCodes = [...new Set(rows.map((r) => JSON.stringify([r.currency, r.costCode])))]
      .sort()
      .map((key) => {
        const [currency, code] = JSON.parse(key) as [string | null, string];
        return {
          currency,
          code,
          postedCents: currency
            ? sum(
                rows
                  .filter((r) => r.currency === currency && r.costCode === code)
                  .map((r) => r.amountCents),
              )
            : null,
        };
      });
    return {
      groups,
      rows,
      costCodes,
      hasUnknown: rows.some((r) => r.amountCents === null),
      basis:
        "Latest immutable posted version effective through as-of, selected by explicitly reviewed accounting_effective_on, never recorded_at/posted_at. Range amounts select those current versions whose effective date falls in range; they are not posting-delta or journal movement totals. Exact decimal-string cents, grouped by reviewed version currency, with no currency conversion.",
      limitations: [
        "Currency is explicitly reviewed submission provenance, not independent document verification. Unknown legacy currency/effective dates remain Unknown, never zero.",
        "AP coverage is Athena cost records only, not external accounting, payroll, labor/burden/equipment completeness or a complete P&L. Categories are unclassified; cost codes are source allocations.",
        "Net AP balances, project settlement amounts and shared-payment conservation remain unsupported. A currency correction never inherits settlement from another currency. Company-paid expenses are costs, not new supplier payables.",
      ],
    };
  } catch {
    return null;
  }
}
const safe = (value: string | null) =>
  value !== null && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
export function attachVersionedAp(report: AccountingReport, ap: ApVersionReport): AccountingReport {
  report.ap = ap;
  report.limitations = report.limitations.map((l) =>
    l.startsWith("Entered evidence only;")
      ? "Entered evidence only; missing history is Unknown. AR/budget/PO use USD; AP is grouped by reviewed version currency without conversion."
      : l,
  );
  report.limitations = report.limitations.filter(
    (l) =>
      !l.startsWith("AP monetary reporting remains unavailable:") &&
      !l.startsWith("AP snapshot unavailable:"),
  );
  report.limitations.push(...ap.limitations, ap.basis);
  const usdOnly =
    ap.rows.length > 0 && !ap.hasUnknown && ap.groups.every((g) => g.currency === "USD");
  const usd = ap.groups.find((g) => g.currency === "USD");
  const costs = usdOnly ? safe(usd?.selectedPeriodCents ?? null) : null;
  for (const m of report.metrics) {
    if (m.key === "actual_costs") {
      m.cents = costs;
      m.basis = usdOnly
        ? "Reviewed USD AP versions effective in range; current-version selection, not journal movements. See AP currency groups and provenance."
        : "See separate AP currency groups. A USD job cost total is withheld when currencies are mixed/unknown or effective dates are unsupported.";
    }
    if (m.key === "unpaid_costs") {
      m.cents = null;
      m.basis =
        "Per-job settlement allocation and shared-payment conservation are unsupported; no currency-correction settlement inheritance.";
    }
    if (m.key === "provisional_result") {
      const gross = report.metrics.find((x) => x.key === "billed_gross")!.cents,
        credits = report.metrics.find((x) => x.key === "credits")!.cents;
      const n =
        gross !== null && credits !== null && costs !== null
          ? BigInt(gross) - BigInt(credits) - BigInt(costs)
          : null;
      m.cents =
        n !== null && n <= BigInt(Number.MAX_SAFE_INTEGER) && n >= BigInt(Number.MIN_SAFE_INTEGER)
          ? Number(n)
          : null;
      m.basis =
        "USD billed less net invoice credits less selected reviewed USD AP amounts; withheld for mixed/unknown currency or date coverage. Incomplete source evidence, not earned margin or complete P&L.";
    }
  }
  if (usdOnly)
    for (const code of new Set([
      ...report.costCodes.map((c) => c.code),
      ...ap.costCodes.map((c) => c.code),
    ])) {
      let target = report.costCodes.find((c) => c.code === code);
      if (!target) {
        target = { code, budgetCents: null, recordedCostCents: null, remainingCents: null };
        report.costCodes.push(target);
      }
      target.recordedCostCents = safe(
        ap.costCodes.find((c) => c.currency === "USD" && c.code === code)?.postedCents ?? null,
      );
      target.remainingCents =
        target.budgetCents !== null && target.recordedCostCents !== null
          ? target.budgetCents - target.recordedCostCents
          : null;
    }
  return report;
}
export function apMoney(cents: string | null, currency: string | null) {
  if (cents === null || currency === null) return "Unknown";
  const n = BigInt(cents),
    negative = n < 0n,
    absolute = negative ? -n : n;
  return `${currency} ${negative ? "-" : ""}${(absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(absolute % 100n).toString().padStart(2, "0")}`;
}
