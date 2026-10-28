import { z } from "zod";
import { dbError, type Sb } from "./guard";
import { sha256Hex } from "./file-share";
import { reconcileBilling, type Scope, type Coverage, type Finding } from "./reconciliation";

const envelope = z.object({
  snapshot_version: z.literal(1),
  job_id: z.string().uuid(),
  company_id: z.string().uuid(),
  complete: z.boolean(),
  billing: z.record(z.string(), z.unknown()).nullable(),
  originals: z.record(z.string(), z.unknown()).nullable(),
});
const unavailable = (reason: string): Coverage => ({ state: "unavailable", reason });

/** The versioned database RPC captures all billing relations in one SQL statement. */
export async function readReconciliation(sb: Sb, scope: Scope) {
  const observed = new Date().toISOString();
  const name = "mcp_billing_reconciliation_snapshot";
  const { data, error } = await (
    sb.rpc as unknown as (
      name: string,
      args: object,
    ) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>
  )(name, { _job: scope.job_id });
  if (error && !(["PGRST202", "42883"].includes(error.code ?? "") && error.message.includes(name)))
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
  const reason =
    !validScope || (parsed.success && parsed.data.complete)
      ? "Billing snapshot is unavailable or has an unsupported scope, version or payload."
      : "Billing snapshot exceeds its completeness limit; findings are withheld.";
  const source = `https://app.meetathena.io/r/job/${scope.job_id}/billing-records`;
  const billing = outcome?.coverage ?? unavailable(reason);
  const originals = outcome?.originals ?? unavailable(reason);
  const findings: Array<Finding & { source_tool: string }> = (outcome?.findings ?? []).map((f) => ({
    ...f,
    source_url: source,
    source_tool: "billing_evidence_read",
  }));
  return {
    observed_at: observed,
    evidence_key: valid ? await sha256Hex(new TextEncoder().encode(JSON.stringify(data))) : null,
    consistency: valid
      ? "Billing evidence and document associations were captured by one scoped database statement. Missing history remains unknown."
      : "No complete, supported billing snapshot is available; billing findings are withheld.",
    consistent_snapshot: valid,
    coverage: {
      billing,
      originals,
      ap: unavailable(
        "AP reconciliation requires a separate versioned, complete scoped snapshot; the provisional read can omit records.",
      ),
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
