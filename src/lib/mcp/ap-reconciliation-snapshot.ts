import { z } from "zod";
import type { Coverage, Finding, Scope } from "./reconciliation";

const uuid = z.string().uuid();
const version = z.number().int().positive();
const cents = z
  .string()
  .regex(/^[1-9][0-9]{0,12}$/)
  .refine((v) => /^[1-9][0-9]{0,12}$/.test(v) && BigInt(v) <= 9000000000000n);
const timestamp = z.string().min(1);
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
  posting_events: z.array(z.object({ version, posted_at: timestamp })),
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
    cents_encoding: z.literal("decimal_string"),
    coverage: z.literal("athena_cost_records_only"),
    external_accounting_coverage: z.literal(false),
    shared_payment_conservation_available: z.literal(false),
    settlement_allocation_by_job_available: z.literal(false),
    accounting_effective_date_available: z.literal(false),
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

/** No money calculations: this source does not verify currency or job settlement shares. */
export function reconcileApSnapshot(
  raw: unknown,
  scope: Scope,
): { coverage: Coverage; findings: Finding[] } {
  const parsed = schema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.company_id !== scope.company_id ||
    parsed.data.job_id !== scope.job_id
  )
    return { coverage: unavailable, findings: [] };
  const rows = parsed.data.ap.records;
  const findings: Finding[] = [];
  const ids = new Set<string>();
  for (const r of rows) {
    if (
      ids.has(r.id) ||
      !r.versions.some((v) => v.allocations.some((a) => a.job_id === scope.job_id))
    )
      return { coverage: unavailable, findings: [] };
    ids.add(r.id);
    const versions = [...r.versions].sort((a, b) => a.version - b.version);
    if (
      versions.some(
        (v, n) =>
          v.version !== n + 1 ||
          (v.version > 1 && !v.reason?.trim()) ||
          v.allocations.reduce((sum, a) => sum + BigInt(a.amount_cents), 0n) !==
            BigInt(v.amount_cents),
      )
    )
      return { coverage: unavailable, findings: [] };
    const posted = versions.find((v) => v.version === r.posted_version);
    const postedMax = r.posting_events.reduce((n, p) => Math.max(n, p.version), 0);
    if (
      (r.posted_version ?? 0) !== postedMax ||
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
      return { coverage: unavailable, findings: [] };
    if (posted && versions[versions.length - 1].version > posted.version)
      findings.push({
        code: "ap_pending_correction",
        severity: "review",
        record_ids: [r.id],
        message:
          "A later unposted correction exists; the earlier posted version remains effective.",
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
        "Structural checks cover complete visible Athena cost records only. Currency, original evidence, job-level settlement, shared-payment conservation and external accounting coverage remain unavailable.",
    },
    findings,
  };
}
