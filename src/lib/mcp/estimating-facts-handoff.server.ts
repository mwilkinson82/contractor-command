import { createClient } from "@supabase/supabase-js";
import { ToolError, type ToolContext } from "@lovable.dev/mcp-js";
import { dbError, isMissingFunction, type Sb } from "./guard";
import type { Job } from "./jobs";
import { calculateSavedBidSnapshot } from "./tools/estimate-bid-tools";
import { prepareHandoffDraft } from "./estimating-handoff-draft";
import {
  mapEstimateDestination,
  type DestinationPlan,
  type DestinationSnapshot,
} from "./estimating-destination-mapping";
import type { HandoffArgs } from "./estimating-handoff.server";

export type FactsHandoffArgs = Omit<HandoffArgs, "allocations"> & {
  destination: "budget" | "sov";
  plan?: DestinationPlan;
};

function handoffError(error: { code?: string; message?: string }) {
  if (isMissingFunction(error))
    throw new ToolError("Versioned handoff storage is unavailable. Nothing was accepted.");
  if (["40P01", "40001"].includes(error.code ?? ""))
    throw new ToolError(
      "A concurrent change interrupted handoff. Read its status and current records before retrying.",
    );
  dbError(error);
}

/** Normalize one guarded SQL snapshot; never synthesize an absent revision. */
export function destinationSnapshot(raw: unknown): DestinationSnapshot {
  const d = raw as {
    company_id?: string;
    job_id?: string;
    version?: number;
    capabilities?: { destination_cas?: boolean };
    fact_sources?: DestinationSnapshot["facts"];
    terms?: { fee_pct?: number | null; basis?: string | null };
    draft_terms?: { fee_pct?: number | null; basis?: string | null };
  } | null;
  if (
    !d ||
    d.capabilities?.destination_cas !== true ||
    !Number.isSafeInteger(d.version) ||
    d.version! < 0 ||
    !Array.isArray(d.fact_sources)
  )
    throw new ToolError("Versioned budget and SOV storage is unavailable. Nothing was changed.");
  return {
    company_id: d.company_id!,
    job_id: d.job_id!,
    version: d.version!,
    facts: d.fact_sources,
    fee_pct: d.terms?.fee_pct ?? null,
    basis: d.terms?.basis ?? null,
    draft_fee_pct: d.draft_terms?.fee_pct ?? null,
    draft_basis: d.draft_terms?.basis ?? null,
  };
}

export async function readEstimateDestination(sb: Sb, job: Job) {
  const r = await sb.rpc("mcp_estimate_destination_snapshot", { _job: job.job_id });
  if (r.error) handoffError(r.error);
  const snapshot = destinationSnapshot(r.data);
  if (snapshot.company_id !== job.company_id || snapshot.job_id !== job.job_id)
    throw new ToolError("The destination identity changed. Read the current company and job.");
  return { raw: r.data as Record<string, unknown>, snapshot };
}

/** Privileged RPC receives only server-calculated source and validated mapping.
 * The member's verified identity is obtained from Supabase, never a tool field. */
export async function estimateFactsHandoffRequest(
  sb: Sb,
  ctx: ToolContext,
  job: Job,
  args: FactsHandoffArgs,
) {
  const token = ctx.getToken();
  if (!token) throw new ToolError("A verified member is required for handoff review.");
  const identity = await sb.auth.getUser(token);
  if (identity.error || !identity.data.user?.id)
    throw new ToolError("A verified member is required for handoff review.");
  let payload: Record<string, unknown> = { kind: args.destination };
  if (args.step === "review") {
    if (
      !args.snapshot_id ||
      args.expected_version === undefined ||
      !args.plan ||
      args.plan.kind !== args.destination ||
      !args.reason
    )
      throw new ToolError(
        "Choose the frozen source, destination version, explicit plan and reason before review.",
      );
    const source = await sb.rpc("mcp_estimate_snapshot_read", {
      _job: job.job_id,
      _snapshot: args.snapshot_id,
    });
    if (source.error) handoffError(source.error);
    const frozen = source.data as Record<string, unknown>;
    if (frozen.current !== true && args.allow_historical !== true)
      throw new ToolError(
        "This source is historical. Explicitly choose it or review the current estimate.",
      );
    const { view, snapshot } = calculateSavedBidSnapshot(frozen.snapshot);
    if (!view.ready || !view.breakdown)
      throw new ToolError(
        "Resolve the frozen estimate's held scope, quantities and pricing before handoff.",
      );
    const current = await readEstimateDestination(sb, job);
    if (current.snapshot.version !== args.expected_version)
      throw new ToolError(
        "The destination changed. Read its current version and review the mapping again.",
      );
    const receipt = await prepareHandoffDraft({
      companyId: job.company_id,
      jobId: job.job_id,
      snapshot,
      ready: view.ready,
      breakdown: view.breakdown,
    });
    let mapping: ReturnType<typeof mapEstimateDestination>;
    try {
      mapping = mapEstimateDestination({
        breakdown: view.breakdown,
        destination: current.snapshot,
        plan: args.plan,
      });
    } catch (error) {
      throw new ToolError(
        error instanceof Error ? error.message : "Review the destination mapping.",
      );
    }
    payload = {
      ...payload,
      snapshot_id: args.snapshot_id,
      expected_version: args.expected_version,
      allow_historical: args.allow_historical === true,
      correction_of: args.correction_of ?? null,
      reason: args.reason,
      canonical_json: JSON.stringify(receipt.payload),
      canonical_sha256: receipt.sha256,
      mapping_json: JSON.stringify(mapping),
    };
  } else if (args.step === "save") {
    if (args.confirmed !== true)
      throw new ToolError(
        "Explicitly confirm the reviewed source, mapping and destination before accepting.",
      );
    payload.confirmed = true;
  }
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const url = env?.SUPABASE_URL ?? env?.VITE_SUPABASE_URL,
    key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new ToolError("Trusted estimate handoff is unavailable. Nothing was accepted.");
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await admin.rpc("mcp_estimate_facts_handoff", {
    _job: job.job_id,
    _actor: identity.data.user.id,
    _step: args.step,
    _request: args.request_id,
    _p: payload,
  });
  if (result.error) handoffError(result.error);
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
