import { z } from "zod";
import type { Coverage, Finding, Scope } from "./reconciliation";
import { COST_CURRENCIES } from "./ap-supported-currencies";

const uuid = z.string().uuid();
const version = z.number().int().positive();
const cents = z
  .string()
  .regex(/^[1-9][0-9]{0,12}$/)
  .refine((v) => /^[1-9][0-9]{0,12}$/.test(v) && BigInt(v) <= 9000000000000n);
const timestamp = z.string().min(1);
const day = z
  .string()
  .refine(
    (v) =>
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      !v.startsWith("0000") &&
      Number.isFinite(Date.parse(`${v}T00:00:00Z`)) &&
      new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v,
  );
const correction = z
  .object({ id: uuid, reason: z.string().min(1), corrected_at: timestamp })
  .nullable();
const payment = z.object({
  id: uuid,
  amount_cents: cents,
  paid_on: z.string(),
  reference: z.string(),
  recorded_at: timestamp,
  correction,
  shared: z.literal(false),
});
const shared = z.object({
  payment_id: uuid,
  amount_cents: cents,
  paid_on: z.string(),
  reference: z.string(),
  recorded_at: timestamp,
  correction,
});
const rec = z.object({
  id: uuid,
  kind: z.enum(["supplier_bill", "reimbursable_expense", "company_paid_expense"]),
  posted_version: version.nullable(),
  versions: z
    .array(
      z.object({
        version,
        recorded_at: timestamp,
        reason: z.string().nullable(),
        incurred_on: day.nullable(),
        currency_code: z.enum(COST_CURRENCIES).nullable(),
        currency_source: z.enum(["reviewed_submission", "unknown"]),
        amount_cents: cents,
        document_reference: z.string().nullable(),
        counterparty_name: z.string(),
        allocations: z
          .array(z.object({ job_id: uuid, cost_code: z.string().min(1), amount_cents: cents }))
          .min(1)
          .max(100),
      }),
    )
    .min(1),
  accounting_approvals: z.array(z.object({ version, approved_at: timestamp })),
  posting_events: z.array(
    z.object({
      version,
      posted_at: timestamp,
      accounting_effective_on: day.nullable(),
    }),
  ),
  business_approvals: z.array(
    z.object({
      id: uuid,
      version,
      job_id: uuid,
      allocated_cents: cents,
      bill_total_cents: cents,
      basis: z.string(),
      notes: z.string().nullable(),
      approved_by: uuid,
      approved_at: timestamp,
      withdrawal: z
        .object({ reason: z.string(), withdrawn_by: uuid, withdrawn_at: timestamp })
        .nullable(),
    }),
  ),
  payments: z.array(payment),
  shared_allocations: z.array(shared),
});
const schema = z.object({
  snapshot_version: z.literal(1),
  complete: z.literal(true),
  status: z.literal("complete"),
  company_id: uuid,
  job_id: uuid,
  ap: z.object({
    currency: z.null(),
    currency_verified: z.literal(false),
    currency_coverage: z.literal("per_version"),
    cents_encoding: z.literal("decimal_string"),
    coverage: z.literal("athena_cost_records_only"),
    external_accounting_coverage: z.literal(false),
    shared_payment_conservation_available: z.literal(false),
    settlement_allocation_by_job_available: z.literal(false),
    accounting_effective_date_available: z.boolean(),
    accounting_effective_date_coverage: z.literal("per_posting"),
    original_evidence_coverage: z.literal(false),
    records: z.array(rec).max(200),
  }),
});
const norm = (v: string) => v.trim().toLowerCase();
const unavailable: Coverage = {
  state: "unavailable",
  reason:
    "AP snapshot unavailable, unauthorized, incomplete or unsupported. No AP findings are asserted.",
};

export type ApCurrencyTotal = {
  currency_code: string;
  supplier_bill_cents: string;
  reimbursable_expense_cents: string;
  company_paid_expense_cents: string;
  posted_record_count: number;
};
type ApResult = {
  coverage: Coverage;
  findings: Finding[];
  currency_totals: ApCurrencyTotal[];
  unknown_currency_records: number | null;
  unknown_effective_dates: number | null;
  settlement_unchecked_records: number | null;
};
const notAvailable = (): ApResult => ({
  coverage: unavailable,
  findings: [],
  currency_totals: [],
  unknown_currency_records: null,
  unknown_effective_dates: null,
  settlement_unchecked_records: null,
});

/** Amounts are source-recorded, grouped by reviewed version currency, not document-verified. */
export function reconcileApSnapshot(raw: unknown, scope: Scope): ApResult {
  const parsed = schema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.company_id !== scope.company_id ||
    parsed.data.job_id !== scope.job_id
  )
    return notAvailable();
  const rows = parsed.data.ap.records;
  const findings: Finding[] = [];
  const ids = new Set<string>();
  const singlePaymentIds = new Set<string>();
  const sharedPaymentIds = new Set<string>();
  for (const r of rows) {
    if (
      ids.has(r.id) ||
      !r.versions.some((v) => v.allocations.some((a) => a.job_id === scope.job_id))
    )
      return notAvailable();
    ids.add(r.id);
    for (const p of r.payments) {
      if (singlePaymentIds.has(p.id) || sharedPaymentIds.has(p.id)) return notAvailable();
      singlePaymentIds.add(p.id);
    }
    const recordShared = new Set<string>();
    for (const p of r.shared_allocations) {
      if (recordShared.has(p.payment_id) || singlePaymentIds.has(p.payment_id))
        return notAvailable();
      recordShared.add(p.payment_id);
      sharedPaymentIds.add(p.payment_id);
    }
    const versions = [...r.versions].sort((a, b) => a.version - b.version);
    if (
      versions.some(
        (v, n) =>
          v.version !== n + 1 ||
          (v.version > 1 && !v.reason?.trim()) ||
          (v.currency_code === null) !== (v.currency_source === "unknown") ||
          v.allocations.reduce((sum, a) => sum + BigInt(a.amount_cents), 0n) !==
            BigInt(v.amount_cents),
      )
    )
      return notAvailable();
    const posted = versions.find((v) => v.version === r.posted_version);
    const postedMax = r.posting_events.reduce((n, p) => Math.max(n, p.version), 0);
    if (
      (r.posted_version ?? 0) !== postedMax ||
      new Set(r.posting_events.map((p) => p.version)).size !== r.posting_events.length ||
      new Set(r.accounting_approvals.map((a) => a.version)).size !==
        r.accounting_approvals.length ||
      r.posting_events.some(
        (p) =>
          !versions.some((v) => v.version === p.version) ||
          !r.accounting_approvals.some((a) => a.version === p.version),
      ) ||
      r.accounting_approvals.some((a) => !versions.some((v) => v.version === a.version)) ||
      (r.posted_version !== null &&
        (!posted ||
          !r.posting_events.some((p) => p.version === r.posted_version) ||
          !r.accounting_approvals.some((a) => a.version === r.posted_version)))
    )
      return notAvailable();
    if (posted && versions[versions.length - 1].version > posted.version)
      findings.push({
        code: "ap_pending_correction",
        severity: "review",
        record_ids: [r.id],
        message:
          "A later unposted correction exists; the earlier posted version remains effective.",
      });
    if (
      r.kind === "company_paid_expense" &&
      (r.payments.some((p) => p.correction === null) ||
        r.shared_allocations.some((p) => p.correction === null))
    )
      findings.push({
        code: "ap_company_paid_settlement",
        severity: "attention",
        record_ids: [r.id],
        message:
          "Company-paid expense has recorded settlement evidence even though it does not create a supplier or reimbursement payable.",
      });
  }
  const allPosts = rows.flatMap((r) => r.posting_events);
  if (
    parsed.data.ap.accounting_effective_date_available !==
    (allPosts.length > 0 && allPosts.every((p) => p.accounting_effective_on !== null))
  )
    return notAvailable();
  const totals = new Map<
    string,
    {
      supplier_bill: bigint;
      reimbursable_expense: bigint;
      company_paid_expense: bigint;
      count: number;
    }
  >();
  let unknownCurrency = 0,
    unknownDates = 0,
    settlementUnchecked = 0;
  for (const r of rows) {
    const posted = r.versions.find((v) => v.version === r.posted_version);
    if (!posted) continue;
    const jobAmount = posted.allocations
      .filter((a) => a.job_id === scope.job_id)
      .reduce((n, a) => n + BigInt(a.amount_cents), 0n);
    if (jobAmount === 0n) continue;
    const posting = r.posting_events.find((p) => p.version === posted.version)!;
    if (!posting.accounting_effective_on) unknownDates++;
    if (!posted.currency_code) {
      unknownCurrency++;
      if (r.kind !== "company_paid_expense") settlementUnchecked++;
      continue;
    }
    const group = totals.get(posted.currency_code) ?? {
      supplier_bill: 0n,
      reimbursable_expense: 0n,
      company_paid_expense: 0n,
      count: 0,
    };
    group[r.kind] += jobAmount;
    group.count++;
    totals.set(posted.currency_code, group);
    if (r.kind === "company_paid_expense") continue;
    const active = r.payments.filter((p) => p.correction === null);
    const postedHistory = r.posting_events.map(
      (p) => r.versions.find((v) => v.version === p.version)!,
    );
    const hasShared = r.shared_allocations.some((p) => p.correction === null);
    const sameCurrency = postedHistory.every(
      (v) =>
        v.currency_code === posted.currency_code && v.currency_source === "reviewed_submission",
    );
    const earliest = Math.min(...r.posting_events.map((p) => Date.parse(p.posted_at)));
    const zoned = (value: string) => /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
    const clearOrder =
      Number.isFinite(earliest) &&
      r.posting_events.every((p) => zoned(p.posted_at)) &&
      active.every(
        (p) =>
          zoned(p.recorded_at) &&
          Number.isFinite(Date.parse(p.recorded_at)) &&
          Date.parse(p.recorded_at) > earliest,
      );
    if (
      hasShared ||
      !sameCurrency ||
      !clearOrder ||
      new Set(active.map((p) => p.id)).size !== active.length
    ) {
      settlementUnchecked++;
      continue;
    }
    const unmatched =
      BigInt(posted.amount_cents) - active.reduce((n, p) => n + BigInt(p.amount_cents), 0n);
    if (unmatched !== 0n)
      findings.push({
        code: unmatched > 0n ? "ap_unmatched" : "ap_over_settled",
        severity: unmatched > 0n ? "review" : "attention",
        record_ids: [r.id],
        currency_code: posted.currency_code,
        amount_cents: (unmatched > 0n ? unmatched : -unmatched).toString(),
        message:
          unmatched > 0n
            ? "Whole posted payable less recorded single-payment evidence remains unmatched. Payment currency is inferred from consistent reviewed posting history; external payment history is unknown."
            : "Recorded single-payment evidence exceeds the whole posted payable. Payment currency is inferred from consistent reviewed posting history; review the source.",
      });
  }
  const references = new Map<string, string[]>();
  for (const r of rows) {
    const v = [...r.versions].sort((a, b) => b.version - a.version)[0];
    const k =
      v.document_reference && norm(v.document_reference) && norm(v.counterparty_name)
        ? JSON.stringify([r.kind, norm(v.counterparty_name), norm(v.document_reference)])
        : "";
    if (k) references.set(k, [...(references.get(k) ?? []), r.id]);
  }
  for (const group of references.values())
    if (group.length > 1)
      findings.push({
        code: "duplicate_ap_reference",
        severity: "attention",
        record_ids: group,
        message:
          "Multiple AP records have matching counterparty and document references; review the source records.",
      });
  const payments = new Map<string, Set<string>>();
  for (const r of rows) {
    for (const p of r.payments)
      if (!p.correction && norm(p.reference))
        payments.set(
          norm(p.reference),
          new Set([...(payments.get(norm(p.reference)) ?? []), p.id]),
        );
    for (const p of r.shared_allocations)
      if (!p.correction && norm(p.reference))
        payments.set(
          norm(p.reference),
          new Set([...(payments.get(norm(p.reference)) ?? []), p.payment_id]),
        );
  }
  for (const group of payments.values())
    if (group.size > 1)
      findings.push({
        code: "duplicate_payment_reference",
        severity: "attention",
        record_ids: [...group],
        message: "Different recorded payments repeat a reference; review the evidence.",
      });
  return {
    coverage: {
      state: "checked",
      reason:
        "Checks cover Athena cost records only. Version currency is supplied and reviewed, not independently verified. Settlement checks infer payment currency only from consistent posting history. Original evidence, job-level settlement, shared-payment conservation and external accounting coverage remain unavailable.",
    },
    findings,
    currency_totals: [...totals]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency_code, t]) => ({
        currency_code,
        supplier_bill_cents: t.supplier_bill.toString(),
        reimbursable_expense_cents: t.reimbursable_expense.toString(),
        company_paid_expense_cents: t.company_paid_expense.toString(),
        posted_record_count: t.count,
      })),
    unknown_currency_records: unknownCurrency,
    unknown_effective_dates: unknownDates,
    settlement_unchecked_records: settlementUnchecked,
  };
}
