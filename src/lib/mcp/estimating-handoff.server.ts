import { createClient } from "@supabase/supabase-js";
import { ToolError, type ToolContext } from "@lovable.dev/mcp-js";
import { dbError, type Sb } from "./guard";
import type { Job } from "./jobs";
import { packageFacts, type BuyoutLedger } from "./buyout";
import { calculateSavedBidSnapshot } from "./tools/estimate-bid-tools";
import { prepareHandoffDraft } from "./estimating-handoff-draft";
import { previewDestination } from "./estimating-handoff-preview";

export type HandoffArgs = {
  step: "review" | "save" | "read" | "cancel";
  request_id: string;
  snapshot_id?: string;
  package_id?: string;
  expected_version?: number;
  reason?: string;
  allow_historical?: boolean;
  confirmed?: boolean;
  correction_of?: string;
  allocations?: { component_id: string; include: boolean; exclusion_reason: string | null }[];
};

/** Only this server module submits calculations. It verifies the member token,
 * loads guarded immutable source, and calculates from it; a tool caller cannot
 * supply totals or a privileged actor. No credential is created or returned. */
export async function estimateHandoffRequest(
  sb: Sb,
  ctx: ToolContext,
  job: Job,
  args: HandoffArgs,
) {
  const token = ctx.getToken();
  if (!token) throw new ToolError("A verified member is required for handoff review.");
  const identity = await sb.auth.getUser(token);
  if (identity.error || !identity.data.user?.id)
    throw new ToolError("A verified member is required for handoff review.");
  let payload: Record<string, unknown> = {};
  if (args.step === "review") {
    if (
      !args.snapshot_id ||
      !args.package_id ||
      args.expected_version === undefined ||
      !args.reason ||
      !args.allocations
    )
      throw new ToolError(
        "Choose the frozen source, existing package/version, every mapping and reason first.",
      );
    const source = await sb.rpc("mcp_estimate_snapshot_read", {
      _job: job.job_id,
      _snapshot: args.snapshot_id,
    });
    if (source.error) dbError(source.error);
    const frozen = source.data as Record<string, unknown>;
    if (frozen.current !== true && args.allow_historical !== true)
      throw new ToolError(
        "This source is historical. Explicitly choose it or review the current estimate.",
      );
    const { view, snapshot } = calculateSavedBidSnapshot(frozen.snapshot);
    if (!view.ready || !view.breakdown)
      throw new ToolError(
        "The frozen estimate is held. Resolve its quantities, scope and pricing before handoff.",
      );
    const receipt = await prepareHandoffDraft({
      companyId: job.company_id,
      jobId: job.job_id,
      snapshot,
      ready: view.ready,
      breakdown: view.breakdown,
    });
    const destination = await sb.rpc("mcp_buyout_get", {
      _company: job.company_id,
      _job: job.job_id,
    });
    if (destination.error) dbError(destination.error);
    const ledger = destination.data as BuyoutLedger;
    const record = ledger.records.find((r) => r.id === args.package_id && r.kind === "package");
    if (!record) throw new ToolError("Choose an existing buyout package on this job.");
    try {
      packageFacts.parse(record.facts);
      previewDestination({
        source: {
          companyId: job.company_id,
          jobId: job.job_id,
          snapshotId: args.snapshot_id,
          sha256: String(frozen.sha256),
          sourceVersion: snapshot.version,
          breakdown: view.breakdown,
        },
        destination: {
          companyId: ledger.company_id,
          jobId: ledger.job_id!,
          kind: "buyout",
          id: record.id,
          expectedVersion: args.expected_version,
          observedVersion: record.version,
        },
        allocations: args.allocations.map((a) => ({
          componentId: a.component_id,
          targetKey: a.include ? record.id : null,
          exclusionReason: a.exclusion_reason,
        })),
      });
    } catch (error) {
      throw new ToolError(
        error instanceof Error
          ? error.message
          : "Review the saved package and destination version.",
      );
    }
    payload = {
      snapshot_id: args.snapshot_id,
      package_id: record.id,
      expected_version: args.expected_version,
      canonical_json: JSON.stringify(receipt.payload),
      canonical_sha256: receipt.sha256,
      allocations: args.allocations,
      reason: args.reason,
      allow_historical: args.allow_historical === true,
      correction_of: args.correction_of ?? null,
    };
  } else if (args.step === "save") {
    if (args.confirmed !== true)
      throw new ToolError("Review and explicitly confirm the exact source and destination first.");
    payload = { confirmed: true };
  }
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const url = env?.SUPABASE_URL ?? env?.VITE_SUPABASE_URL;
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new ToolError("Trusted estimate handoff is unavailable. Nothing was accepted.");
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await admin.rpc("mcp_estimate_buyout_handoff", {
    _job: job.job_id,
    _actor: identity.data.user.id,
    _step: args.step,
    _request: args.request_id,
    _p: payload,
  });
  if (result.error) {
    if (["40P01", "40001"].includes(result.error.code ?? ""))
      throw new ToolError(
        "A concurrent change interrupted handoff. Read its status and current records before retrying.",
      );
    dbError(result.error);
  }
  if (
    !result.data ||
    typeof result.data !== "object" ||
    Array.isArray(result.data) ||
    (result.data as Record<string, unknown>).request_id !== args.request_id
  )
    throw new ToolError(
      `The handoff result could not be verified. Read request ${args.request_id} before retrying.`,
    );
  return result.data as Record<string, unknown>;
}
