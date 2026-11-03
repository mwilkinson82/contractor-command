import { ToolError, defineTool, type JsonValueInput } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, isMissingFunction, run, text, type Sb } from "../guard";
import { named, resolveJob } from "../jobs";
import type { Job } from "../jobs";
import { calculateSavedBidSnapshot } from "./estimate-bid-tools";
import { prepareHandoffDraft } from "../estimating-handoff-draft";
import { bidComponents } from "../estimating-handoff-preview";
import { requirementSourceBlocker } from "../estimating-requirement-sources";
import { guide } from "../visible";
import { measurementLines, type EngineSnapshot } from "../takeoff/state";

type CoverageDecision = {
  quote_index: number;
  decision: "carry" | "compare";
  ref?: string | null;
  replace_labor_and_material?: boolean;
  exclusive_to_line?: boolean;
  source_note?: string;
  scope_note?: string;
  exclusions_note?: string;
  quote?: Record<string, unknown>;
  line?: Record<string, unknown> | null;
};
type CoverageResult = {
  request?: string;
  version: number;
  current?: boolean;
  status?: string;
  decisions?: CoverageDecision[];
  estimate?: { takeoff?: { lines?: Record<string, unknown>[] } | null };
  takeoff?: EngineSnapshot | null;
  bid?: { pricing?: { quotes?: Record<string, unknown>[] } | null };
  selection?: { version: number; current: boolean; decisions: CoverageDecision[] } | null;
};

async function rpc<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (
    sb.rpc as unknown as (
      name: string,
      params: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>
  )(fn, args);
  if (error && isMissingFunction(error))
    throw new ToolError("Estimating review storage is not available yet. Nothing was changed.");
  if (error && ["40P01", "40001"].includes(error.code ?? ""))
    throw new ToolError(
      "A concurrent change interrupted this request. Read the latest state before retrying.",
    );
  if (error) dbError(error);
  return data as T;
}

const decision = z.object({
  quote_index: z.number().int().min(0).max(79),
  decision: z.enum(["carry", "compare"]),
  ref: z.string().trim().min(1).max(40).nullable().optional(),
  replace_labor_and_material: z.boolean().optional(),
  exclusive_to_line: z.boolean().optional(),
  source_note: z.string().trim().max(2000).optional(),
  scope_note: z.string().trim().max(2000).optional(),
  exclusions_note: z.string().trim().max(2000).optional(),
});

/** The database supplies immutable source evidence; callers cannot submit a
 * calculation. Replaying it is a review aid, never permission to post. */
async function frozenCalculation(result: Record<string, unknown>, job: Job) {
  const { view, snapshot } = calculateSavedBidSnapshot(result.snapshot);
  const bid = snapshot.bid as { company_id?: unknown } | null;
  if (result.source_version !== snapshot.version || bid?.company_id !== job.company_id)
    throw new ToolError("The saved source identity could not be reconciled. No bid was returned.");
  const draft = view.ready
    ? await prepareHandoffDraft({
        companyId: job.company_id,
        jobId: job.job_id,
        snapshot,
        ready: view.ready,
        breakdown: view.breakdown,
      })
    : null;
  return {
    calculated_bid: {
      calculation_schema: 1,
      source_snapshot_id: result.snapshot_id ?? null,
      source_version: snapshot.version,
      source_sha256: result.sha256,
      canonical_sha256: draft?.sha256 ?? null,
      ready: view.ready,
      total: view.total,
      breakdown: view.breakdown,
      components: view.breakdown ? bidComponents(view.breakdown) : [],
      rows: view.lines,
      posting_permitted: false,
    },
    handoff_draft: draft,
  };
}

/** Freezes server-read source evidence only. No caller-supplied totals or
 * downstream financial record are accepted by this workflow. */
export const estimateSourceSnapshot = defineTool({
  name: "estimate_source_snapshot",
  title: "Review estimate source snapshot",
  description:
    "Reviews and saves an exact estimate source version without posting financial records.",
  inputSchema: {
    job_number: z.string().trim().min(1).max(40),
    company_id: z.string().trim().min(1).max(200).optional(),
    step: z.enum(["review", "save", "read"]),
    expected_version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    request_id: z.uuid().optional(),
    snapshot_id: z.uuid().optional(),
    confirmed: z.boolean().optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run(
      "estimate_source_snapshot",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveJob(sb, args.job_number, args.company_id, "write");
        if (args.step === "review") {
          if (args.expected_version === undefined)
            throw new ToolError(
              "Read the current estimate version before reviewing its source snapshot.",
            );
          const currentSources = await rpc<Record<string, unknown>>(
            sb,
            "mcp_estimate_coverage_snapshot",
            { _job: job.job_id },
          );
          const blocked = requirementSourceBlocker(currentSources);
          if (blocked) throw new ToolError(blocked);
          const request = args.request_id ?? crypto.randomUUID();
          const result = await rpc<Record<string, unknown>>(sb, "mcp_estimate_snapshot_review", {
            _job: job.job_id,
            _request: request,
            _expected_version: args.expected_version,
          });
          const saved = result.status === "saved";
          const calculation = await frozenCalculation(result, job);
          return guide(
            {
              ...text(
                result.current === true
                  ? `${named(job)} · Source snapshot version ${String(result.source_version)}. ${saved ? "This request was already saved." : "Review the exact source evidence and confirm to save it."} This is not a bid approval or financial posting.`
                  : "This snapshot request is no longer current. Read and review the latest estimate.",
              ),
              structuredContent: {
                ...result,
                ...calculation,
                request_id: request,
              } as unknown as JsonValueInput,
            },
            "Present the exact source evidence, version, scope, quantities, pricing inputs, quote decisions and calculated_bid rows. A flag or request ID is not proof of human approval. Only after explicit confirmation save the same request. This freezes source evidence, not approval to post; destination review is still required.",
          );
        }
        if (args.step === "save") {
          if (!args.request_id || args.confirmed !== true)
            throw new ToolError("Review the source snapshot and explicitly confirm before saving.");
          const current = await rpc<{ capabilities?: { requirement_sources?: unknown } }>(
            sb,
            "mcp_estimate_coverage_snapshot",
            { _job: job.job_id },
          );
          if (current.capabilities?.requirement_sources !== true)
            throw new ToolError(
              "Version-bound requirement source storage is unavailable. Read any saved snapshot before retrying; no new source freeze was attempted.",
            );
          const result = await rpc<Record<string, unknown>>(sb, "mcp_estimate_snapshot_save", {
            _job: job.job_id,
            _request: args.request_id,
            _confirmed: true,
          });
          const frozen = await rpc<Record<string, unknown>>(sb, "mcp_estimate_snapshot_read", {
            _job: job.job_id,
            _snapshot: result.snapshot_id,
          });
          const calculation = await frozenCalculation(frozen, job);
          return guide(
            {
              ...text(
                result.current === true
                  ? "Source snapshot saved. No financial record was posted."
                  : "This earlier snapshot was saved, but the estimate has since changed.",
              ),
              structuredContent: { ...result, ...calculation } as unknown as JsonValueInput,
            },
            "Retain the exact snapshot ID, source checksum and calculated bid checksum. The calculation is replayed from saved source using schema 1, not a persisted financial approval. Explicitly review the destination before any separately authorized handoff.",
          );
        }
        if (!args.snapshot_id) throw new ToolError("Choose the saved source snapshot to read.");
        const result = await rpc<Record<string, unknown>>(sb, "mcp_estimate_snapshot_read", {
          _job: job.job_id,
          _snapshot: args.snapshot_id,
        });
        const calculation = await frozenCalculation(result, job);
        return guide(
          {
            ...text(
              result.current === true
                ? "Saved source snapshot loaded. No financial record was posted."
                : "Historical source snapshot loaded; the current estimate has changed.",
            ),
            structuredContent: { ...result, ...calculation } as unknown as JsonValueInput,
          },
          "The calculated bid is replayed from immutable source using schema 1. Historical source can differ from the current estimate. Neither the checksum nor source confirmation authorizes posting. Explicitly review any destination.",
        );
      },
    ),
});

/** Decisions are untrusted inputs. The database review binds them to exact
 * server-loaded quote, scope, user and version before a separate save. */
export const estimateQuoteCoverage = defineTool({
  name: "estimate_quote_coverage",
  title: "Review subcontract quote coverage",
  description:
    "Reads current scope and quotes, reviews which quotes replace whole takeoff lines, and separately saves the reviewed decision after explicit confirmation.",
  inputSchema: {
    job_number: z.string().trim().min(1).max(40),
    company_id: z.string().trim().min(1).max(200).optional(),
    step: z.enum(["read", "review", "save"]),
    expected_version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    request_id: z.uuid().optional(),
    decisions: z.array(decision).max(80).optional(),
    confirmed: z.boolean().optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run(
      "estimate_quote_coverage",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveJob(sb, args.job_number, args.company_id, "write");
        if (args.step === "read") {
          const result = await rpc<CoverageResult>(sb, "mcp_estimate_coverage_snapshot", {
            _job: job.job_id,
          });
          const quotes = result.bid?.pricing?.quotes ?? [];
          const lines = result.estimate?.takeoff?.lines ?? [];
          return guide(
            {
              ...text(
                [
                  `${named(job)} · Subcontract quote coverage`,
                  quotes.length ? "Quotes on file:" : "No subcontract quotes are saved yet.",
                  ...quotes.map(
                    (quote, index) =>
                      `- Quote ${index + 1}: ${String(quote.sub ?? "")} · ${String(quote.description ?? "")} · ${quote.amount == null ? "amount unknown" : String(quote.amount)} · line ${String(quote.ref ?? "unassigned")}`,
                  ),
                  "Current takeoff lines:",
                  ...lines.map((line) => `- T-${String(line.line_no)} ${String(line.item ?? "")}`),
                  result.selection?.current
                    ? "A reviewed selection is saved for this version."
                    : "The current version has no current saved coverage selection.",
                ].join("\n"),
              ),
              structuredContent: { ...result, quotes, lines } as unknown as JsonValueInput,
            },
            "Ask the estimator which exact quote, if any, replaces each entire takeoff line including labor and material, and verify that it excludes all other priced scope, including other direct or subcontracted lines, gaps, general conditions and requirements. Preserve the others as comparisons. Ask for the quote source, included scope and exclusions; do not infer a vendor, coverage, or human approval. The structured quote_index is zero-based and is for tool calls, not a user-facing label. Before a review, read this current version and send one decision for every quote.",
          );
        }
        if (args.step === "review") {
          if (args.expected_version === undefined || !args.decisions || !args.decisions.length)
            throw new ToolError(
              "Read the current quotes and supply every coverage decision first.",
            );
          const request = args.request_id ?? crypto.randomUUID();
          const result = await rpc<CoverageResult>(sb, "mcp_estimate_coverage_review", {
            _job: job.job_id,
            _request: request,
            _expected_version: args.expected_version,
            _decisions: args.decisions,
          });
          const snapshot = await rpc<CoverageResult>(sb, "mcp_estimate_coverage_snapshot", {
            _job: job.job_id,
          });
          if (!result.current || snapshot.version !== result.version)
            throw new ToolError(
              "The estimate changed during review. Read the current version and review it again.",
            );
          if (result.status === "saved")
            return guide(
              {
                ...text("This reviewed coverage was already saved for the current version."),
                structuredContent: result as unknown as JsonValueInput,
              },
              "This is the result of the earlier request, not a new save. Check bid readiness separately.",
            );
          const measurements = snapshot.takeoff?.available
            ? measurementLines(snapshot.takeoff)
            : [];
          const reviewedScope = (d: CoverageDecision) => {
            const lineNumber = Number(d.line?.line_no);
            const measured = measurements.find((row) => row.line_no === lineNumber);
            const quantity =
              measured && (measured.status === "accepted" || measured.status === "not_drawable")
                ? measured.accepted
                : null;
            return quantity == null
              ? "Current measured quantity is not accepted or available."
              : `Current reviewed quantity: ${quantity} ${measured?.unit ?? ""}; drawing reference ${String(d.line?.sheet ?? "unspecified")}.`;
          };
          return guide(
            {
              ...text(
                [
                  `${named(job)} · Review quote coverage`,
                  ...(result.decisions ?? []).map((d) =>
                    d.decision === "carry"
                      ? `- Carry ${String(d.quote?.sub ?? "")} · ${String(d.quote?.description ?? "")} · ${String(d.quote?.amount ?? "amount unknown")} for ${String(d.ref)} ${String(d.line?.item ?? "")}; replaces both direct labor and material for this line only and excludes all other priced scope, including other lines, gaps, general conditions and requirements. ${reviewedScope(d)} Source: ${d.source_note}. Scope: ${d.scope_note}. Exclusions: ${d.exclusions_note}.`
                      : `- Comparison only: ${String(d.quote?.sub ?? "")} · ${String(d.quote?.description ?? "")} · ${String(d.quote?.amount ?? "amount unknown")}.`,
                  ),
                  "Save this coverage decision, or revise it?",
                ].join("\n"),
              ),
              structuredContent: { ...result, request_id: request } as unknown as JsonValueInput,
            },
            "Show every reviewed quote, amount, exact line, replacement effect, source, scope and exclusions. A review or confirmation flag alone is not a human decision. Only after the estimator explicitly confirms, save the exact returned request ID. For an edit, read and review again. After an uncertain save, read state and retry only the same request; never select a vendor for the estimator.",
          );
        }
        if (!args.request_id || args.confirmed !== true)
          throw new ToolError("Review the exact coverage and explicitly confirm before saving.");
        const result = await rpc<CoverageResult>(sb, "mcp_estimate_coverage_save", {
          _job: job.job_id,
          _request: args.request_id,
          _confirmed: true,
        });
        return guide(
          {
            ...text(
              result.current
                ? "Quote coverage saved for the reviewed estimate version. The bid still requires all other quantities, costs and assumptions to be reviewed."
                : "That request was saved earlier, but the estimate has since changed. Read and review the current coverage before using it.",
            ),
            structuredContent: result as unknown as JsonValueInput,
          },
          "Report the saved version and whether it is still current. Do not claim the bid is ready without the bid summary's independent readiness checks.",
        );
      },
    ),
});
