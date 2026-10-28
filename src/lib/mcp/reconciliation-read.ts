import { z } from "zod";
import { dbError, type Sb } from "./guard";
import { sha256Hex } from "./file-share";
import { reconcileBilling, type Scope, type Coverage, type Finding } from "./reconciliation";
import { reconcileApSnapshot } from "./ap-reconciliation-snapshot";

const envelope = z.object({
  snapshot_version: z.literal(1),
  job_id: z.string().uuid(),
  company_id: z.string().uuid(),
  complete: z.boolean(),
  billing: z.record(z.string(), z.unknown()).nullable(),
  originals: z.record(z.string(), z.unknown()).nullable(),
});
const unavailable = (reason: string): Coverage => ({ state: "unavailable", reason });
export const SNAPSHOT_RESPONSE_BUDGET_MS = 5000;
const SNAPSHOT_MAX_BYTES = 2097152;
type SnapshotResult = {
  data: unknown;
  error: { code?: string; message: string } | null;
};
// Abort the HTTP read when supported, and bound waiting even for a stuck transport.
// This is a caller deadline; database cancellation must be verified in managed staging.
async function boundedSnapshot(sb: Sb, name: string, jobId: string): Promise<SnapshotResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = (
      sb.rpc as unknown as (
        name: string,
        args: object,
      ) => PromiseLike<SnapshotResult> & {
        abortSignal?: (signal: AbortSignal) => PromiseLike<SnapshotResult>;
      }
    )(name, { _job: jobId });
    const read = request.abortSignal ? request.abortSignal(controller.signal) : request;
    const outcome = await Promise.race([
      Promise.resolve(read),
      new Promise<SnapshotResult>((resolve) => {
        timer = setTimeout(() => {
          resolve({
            data: null,
            error: {
              code: "ATHENA_SNAPSHOT_TIMEOUT",
              message: "Snapshot response budget exceeded.",
            },
          });
          controller.abort();
        }, SNAPSHOT_RESPONSE_BUDGET_MS);
      }),
    ]);
    if (
      !outcome.error &&
      new TextEncoder().encode(JSON.stringify(outcome.data)).byteLength > SNAPSHOT_MAX_BYTES
    )
      return {
        data: null,
        error: { code: "ATHENA_SNAPSHOT_SIZE", message: "Snapshot response size exceeded." },
      };
    return outcome;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The versioned database RPC captures all billing relations in one SQL statement. */
export async function readReconciliation(sb: Sb, scope: Scope) {
  const observed = new Date().toISOString();
  const name = "mcp_billing_reconciliation_snapshot";
  const { data, error } = await boundedSnapshot(sb, name, scope.job_id);
  const budgetExceeded = ["ATHENA_SNAPSHOT_TIMEOUT", "ATHENA_SNAPSHOT_SIZE", "57014"].includes(
    error?.code ?? "",
  );
  if (
    error &&
    !budgetExceeded &&
    !(["PGRST202", "42883"].includes(error.code ?? "") && error.message.includes(name))
  )
    dbError(error);
  const parsed = envelope.safeParse(error ? null : data);
  const validScope =
    parsed.success &&
    parsed.data.job_id === scope.job_id &&
    parsed.data.company_id === scope.company_id;
  const valid =
    validScope &&
    parsed.data.complete &&
    parsed.data.billing !== null &&
    parsed.data.originals !== null;
  const outcome = valid
    ? reconcileBilling(parsed.data.billing, parsed.data.originals, scope)
    : null;
  const reason = budgetExceeded
    ? "Billing snapshot exceeded its response or size budget; findings are withheld."
    : !validScope || (parsed.success && parsed.data.complete)
      ? "Billing snapshot is unavailable or has an unsupported scope, version or payload."
      : "Billing snapshot exceeds its completeness limit; findings are withheld.";
  const source = `https://app.meetathena.io/r/job/${scope.job_id}/billing-records`;
  const billing = outcome?.coverage ?? unavailable(reason);
  const originals = outcome?.originals ?? unavailable(reason);
  let apData: unknown = null;
  try {
    const apResult = await boundedSnapshot(sb, "mcp_cost_reconciliation_snapshot", scope.job_id);
    if (!apResult.error) apData = apResult.data;
  } catch {
    /* Unavailable AP must not prevent an independent billing review. */
  }
  const ap = reconcileApSnapshot(apData, scope);
  const findings: Array<Finding & { source_tool: string }> = (outcome?.findings ?? []).map((f) => ({
    ...f,
    source_url: source,
    source_tool: "billing_evidence_read",
  }));
  findings.push(...ap.findings.map((f) => ({ ...f, source_tool: "job_cost_submissions_read" })));
  return {
    observed_at: observed,
    evidence_key: valid ? await sha256Hex(new TextEncoder().encode(JSON.stringify(data))) : null,
    ap_evidence_key:
      ap.coverage.state === "checked"
        ? await sha256Hex(new TextEncoder().encode(JSON.stringify(apData)))
        : null,
    consistency: valid
      ? "Billing evidence and document associations were captured by one scoped database statement. AP is a separate snapshot; there is no cross-domain atomic snapshot. Missing history remains unknown."
      : "No complete, supported billing snapshot is available; billing findings are withheld. AP is independently scoped.",
    consistent_snapshot: valid,
    ap_currency_totals: ap.currency_totals,
    ap_unknown_currency_records: ap.unknown_currency_records,
    ap_unknown_effective_dates: ap.unknown_effective_dates,
    ap_settlement_unchecked_records: ap.settlement_unchecked_records,
    coverage: {
      billing,
      originals,
      ap: ap.coverage,
      ap_currency:
        ap.coverage.state === "checked" &&
        ap.currency_totals.length > 0 &&
        ap.unknown_currency_records === 0
          ? ({
              state: "checked",
              reason:
                "Included posted job allocations have reviewed version currencies; source documents are not independently verified.",
            } as Coverage)
          : unavailable(
              "No known-currency posted job allocations are available, or some currencies are unknown; unknown amounts are excluded.",
            ),
      ap_effective_dates:
        ap.coverage.state === "checked" &&
        (ap.currency_totals.length > 0 || (ap.unknown_currency_records ?? 0) > 0) &&
        ap.unknown_effective_dates === 0
          ? ({
              state: "checked",
              reason:
                "Included posted job records have accounting effective dates. Totals are current recorded amounts, not a period report.",
            } as Coverage)
          : unavailable(
              "Some posted job records have unknown accounting effective dates or AP coverage is unavailable; no date is inferred.",
            ),
      ap_settlement:
        ap.coverage.state === "checked" &&
        ap.currency_totals.some(
          (t) => t.supplier_bill_cents !== "0" || t.reimbursable_expense_cents !== "0",
        ) &&
        ap.settlement_unchecked_records === 0
          ? ({
              state: "checked",
              reason:
                "Eligible whole-record single-payment evidence is compared with the posted payable using consistent reviewed posting currencies. No bank transfer is verified.",
            } as Coverage)
          : unavailable(
              "Some whole-record settlement comparisons are withheld because currency, timing, shared evidence or AP coverage is unknown.",
            ),
      ap_originals: unavailable("AP original evidence coverage is unavailable."),
      ap_job_settlement: unavailable("Recorded settlement is not allocated by job."),
      ap_shared_payment: unavailable("Shared-payment header conservation is unavailable."),
      ap_external_accounting: unavailable("The AP snapshot covers Athena cost records only."),
      bank_transfers: unavailable("No bank connector or transfer verification."),
      refunds: unavailable(
        "Receipt reversals and payment evidence corrections do not prove actual refunds.",
      ),
    },
    findings,
    records_url: source,
    correction_review: {
      automatic_repairs: false,
      supported_billing_tool: "billing_evidence_record",
      ap_status:
        "Use PR351's separately reviewed workflow only after integration; no AP write path is provided here.",
      instruction:
        "Read the exact source records again, check current versions and access, review the proposed correction and request explicit confirmation. Preserve original record and request IDs after an uncertain write. An evidence key is not write authorization.",
    },
  };
}
