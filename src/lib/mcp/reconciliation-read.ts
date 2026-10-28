import { dbError, type Sb } from "./guard";
import { sha256Hex } from "./file-share";
import {
  reconcileBilling,
  reconcileCosts,
  type Scope,
  type Reconciliation,
  type Coverage,
} from "./reconciliation";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
async function read(sb: Sb, name: string, job: string, optional = false): Promise<unknown> {
  const { data, error } = await (
    sb.rpc as unknown as (
      name: string,
      args: object,
    ) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>
  )(name, { _job: job });
  if (error) {
    // Only a known missing optional RPC is unavailable coverage. Never hide a denied read.
    if (
      optional &&
      ["PGRST202", "42883"].includes(error.code ?? "") &&
      error.message.includes(name)
    )
      return null;
    dbError(error);
  }
  return data;
}
const changed = (): Reconciliation => ({
  coverage: {
    state: "unavailable",
    reason:
      "Evidence changed during this check. Run reconciliation again before reviewing a correction.",
  },
  findings: [],
});

/** Two observations detect intervening evidence changes. They are NOT an atomic database snapshot. */
export async function readReconciliation(sb: Sb, scope: Scope) {
  const start = new Date().toISOString();
  const collect = async () => ({
    billing: await read(sb, "mcp_billing_evidence_get", scope.job_id),
    originals: await read(sb, "mcp_billing_documents_get", scope.job_id, true),
    costs: await read(sb, "mcp_cost_submission_read", scope.job_id, true),
  });
  const first = await collect();
  const second = await collect();
  const billingStable = canonical(first.billing) === canonical(second.billing);
  const originalsStable = canonical(first.originals) === canonical(second.originals);
  const costsStable = canonical(first.costs) === canonical(second.costs);
  const billing = billingStable
    ? reconcileBilling(second.billing, originalsStable ? second.originals : null, scope)
    : { ...changed(), originals: changed().coverage };
  if (!originalsStable) billing.originals = changed().coverage;
  const costs = costsStable ? reconcileCosts(second.costs, scope) : changed();
  // Matching non-atomic observations do not prove that related rows coexisted.
  // The current RPCs also cannot attest to omitted AP records. Do not expose
  // calculated discrepancies until an authorized, complete snapshot contract exists.
  const withheld = (coverage: Coverage): Coverage =>
    coverage.state === "unavailable"
      ? coverage
      : {
          state: "unavailable",
          reason: "A complete, consistent evidence snapshot is unavailable; findings are withheld.",
        };
  const source = `https://app.meetathena.io/r/job/${scope.job_id}/billing-records`;
  return {
    observed_from: start,
    observed_to: new Date().toISOString(),
    evidence_key: await sha256Hex(new TextEncoder().encode(canonical({ scope, ...second }))),
    consistency:
      "Two matching observations are not an atomic snapshot. Exception findings are withheld until a complete, consistent evidence snapshot is available.",
    observations_match: billingStable && originalsStable && costsStable,
    consistent_snapshot: false,
    coverage: {
      billing: withheld(billing.coverage),
      originals: withheld(billing.originals),
      ap: withheld(costs.coverage),
      bank_transfers: {
        state: "unavailable",
        reason: "No bank connector or transfer verification.",
      } as Coverage,
      refunds: {
        state: "unavailable",
        reason: "Receipt reversals and payment evidence corrections do not prove actual refunds.",
      } as Coverage,
    },
    findings: [] as Array<import("./reconciliation").Finding & { source_tool: string }>,
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
