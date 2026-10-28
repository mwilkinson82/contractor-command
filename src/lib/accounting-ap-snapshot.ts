import { z } from "zod";
import type { CostReportSource, Dependency } from "./accounting-report";

const envelope = z.discriminatedUnion("complete", [
  z
    .object({
      snapshot_version: z.literal(1),
      complete: z.literal(false),
      status: z.literal("unavailable"),
    })
    .strict(),
  z.object({
    snapshot_version: z.literal(1),
    complete: z.literal(true),
    status: z.literal("complete"),
    company_id: z.string().uuid(),
    job_id: z.string().uuid(),
    ap: z.object({
      coverage: z.literal("athena_cost_records_only"),
      external_accounting_coverage: z.literal(false),
      cents_encoding: z.literal("decimal_string"),
      currency: z.string().nullable(),
      currency_verified: z.boolean(),
      accounting_effective_date_available: z.boolean(),
      settlement_allocation_by_job_available: z.boolean(),
      original_evidence_coverage: z.boolean(),
      shared_payment_conservation_available: z.boolean(),
      records: z.array(z.unknown()).max(200),
    }),
  }),
]);

/** PR351 owns this RPC. Snapshot v1 is an evidence contract, not a verified monetary reporting source. */
export function apReportingCapability(
  raw: unknown,
  jobId: string,
  companyId?: string,
): Dependency<CostReportSource> {
  if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > 2_097_152)
    return {
      available: false,
      reason:
        "AP snapshot unavailable: bounded source limit exceeded. No partial total was inferred.",
    };
  const parsed = envelope.safeParse(raw);
  if (!parsed.success)
    return {
      available: false,
      reason:
        "AP snapshot unavailable: unsupported version or malformed contract. No fallback to the partial cost reader.",
    };
  const s = parsed.data;
  if (!s.complete)
    return {
      available: false,
      reason:
        "AP snapshot unavailable: complete authorized evidence was not returned. No hidden-record count, zero total or partial-reader fallback is inferred.",
    };
  if (s.job_id !== jobId || (companyId && s.company_id !== companyId))
    return {
      available: false,
      reason:
        "AP snapshot unavailable: company or project scope does not match. No financial rows were used.",
    };
  const missing: string[] = [];
  if (!s.ap.currency_verified || s.ap.currency !== "USD") missing.push("verified USD currency");
  if (!s.ap.accounting_effective_date_available) missing.push("accounting effective dates");
  if (!s.ap.settlement_allocation_by_job_available) missing.push("job settlement allocations");
  if (!s.ap.shared_payment_conservation_available) missing.push("shared-payment conservation");
  return {
    available: false,
    reason: `AP monetary reporting remains unavailable: ${missing.length ? missing.join(", ") + " are unsupported in snapshot v1" : "the versioned monetary adapter has not been validated"}. Decimal-string cents are not assigned an inferred currency. Recorded posting/correction timestamps are not accounting effective dates. Coverage is Athena cost records only; no external ledger, transfer or refund is established.`,
  };
}
