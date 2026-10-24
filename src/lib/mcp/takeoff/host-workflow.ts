import type { CardModel } from "../cards/model";
import { parseState } from "../estimating";
import type { Sb } from "../guard";
import { measurementStatus, type EngineSnapshot } from "./state";

export const TAKEOFF_MODEL_NOTICE =
  "Before we start, switch to the strongest model available in your AI app that can read images and reason through drawings. Enable its deeper reasoning option if available. Athena cannot change that switch for you.";

export const TAKEOFF_REVIEW_WORKFLOW =
  "Read the current drawings, notes, schedules, specifications and contract available for this job before reconciling scope. Use stored sheets and cited requirements, not a target quantity. Record supported quantities, uncertain interpretations, missing scope and document conflicts separately. Use estimate_doc_review for the document comparison and estimate_gap_analysis for cited findings and specific estimator questions. Name unavailable or unread documents; a completed tile pass is not a complete project scope review. AI confidence is an interpretation, not a measured accuracy percentage. Keep geometry as proposals until the estimator accepts the displayed revisions.";

export function hostWorkflowSection(): NonNullable<CardModel["sections"]>[number] {
  return {
    heading: "Before your AI reads the drawings",
    kind: "list",
    rows: [
      { cells: [TAKEOFF_MODEL_NOTICE] },
      {
        cells: [
          "Review drawings, specifications and contract together.",
          "The review identifies supported measurements, uncertain readings, missing requirements and conflicts, with source references and questions for you. Unavailable or unread documents stay open.",
        ],
      },
      {
        cells: [
          "Athena checks locations and calculates from confirmed scales.",
          "An ink check confirms a mark touches the drawing; it does not prove the AI identified the right item or found every instance. Your review confirms the proposed scope and quantities.",
        ],
      },
    ],
  };
}

/** Confidence belongs to a specific interpretation; never turn it into a bid accuracy score. */
export function measurementEvidence(state: EngineSnapshot) {
  return measurementStatus(state).lines.map((line) => {
    const rows = state.geometry.filter(
      (g) => g.line_id === line.line_id && g.status !== "rejected",
    );
    const confidence = rows.flatMap((g) =>
      typeof g.evidence.confidence === "number" &&
      Number.isFinite(g.evidence.confidence) &&
      g.evidence.confidence >= 0 &&
      g.evidence.confidence <= 1
        ? [g.evidence.confidence]
        : [],
    );
    const dimensional = rows.filter(
      (g) => g.shape.kind !== "pins" && g.shape.kind !== "not_drawable",
    );
    const checkedScale =
      dimensional.length > 0 &&
      dimensional.every((g) =>
        state.calibrations.some(
          (c) =>
            c.id === g.calibration_id &&
            c.source_id === g.source_id &&
            c.page === g.page &&
            c.confirmed &&
            c.method === "dimension_string",
        ),
      );
    return {
      line_no: line.line_no,
      item: line.item,
      status: line.status,
      scale_status: dimensional.length
        ? checkedScale
          ? "dimension-checked"
          : "dimension check needed"
        : "not applicable to counts or non-drawable basis",
      measurement_classification:
        line.status === "accepted" && (!dimensional.length || checkedScale) ? "Measured" : "Verify",
      quantity:
        line.status === "accepted" || line.status === "not_drawable"
          ? line.accepted
          : line.proposed,
      unit: line.unit,
      confidence_basis: "AI-reported interpretation; not an accuracy probability",
      reported_confidence_range: confidence.length
        ? { low: Math.min(...confidence), high: Math.max(...confidence) }
        : null,
      references: rows.map((g) => ({
        geometry_id: g.geometry_id,
        revision: g.version,
        source_id: g.source_id,
        page: g.page,
        calibration_id: g.calibration_id,
        evidence: g.evidence,
      })),
      verification_needed:
        line.status === "accepted"
          ? dimensional.length && !checkedScale
            ? "Geometry accepted; scale still needs a check against a dimension string on this sheet. Reconcile project scope separately."
            : "Accepted geometry; reconcile coverage against drawings, specifications and contract."
          : line.status === "not_drawable"
            ? (line.reason ?? "Review the recorded non-drawable basis.")
            : line.status === "proposed"
              ? "Verify item identity, boundaries, scale and complete scope before accepting."
              : "Locate and measure this item, or record a cited non-drawable basis.",
      scope_complete: false,
    };
  });
}

/** These are saved context records, not a claim that a model read the underlying documents. */
export async function hostReviewContext(sb: Sb, jobId: string) {
  const missing: string[] = [];
  let setup: ReturnType<typeof parseState>["setup"] | null = null;
  try {
    const result = await sb.rpc("mcp_estimate_get", { _job: jobId });
    if (result.error || result.data == null)
      missing.push("Estimating document context could not be loaded.");
    else setup = parseState(result.data).setup;
  } catch {
    missing.push("Estimating document context could not be loaded.");
  }
  let clauses: { section: string; verbatim_text: string }[] = [];
  try {
    const result = await sb
      .from("mcp_contract_clauses")
      .select("section, verbatim_text")
      .eq("job_id", jobId)
      .limit(101);
    if (result.error) missing.push("Contract clause text could not be loaded.");
    else clauses = (result.data ?? []) as typeof clauses;
  } catch {
    missing.push("Contract clause text could not be loaded.");
  }
  if (!setup?.doc_review?.specs?.length)
    missing.push("No saved specification review. Obtain and read the relevant specifications.");
  if (!clauses.length) missing.push("No saved contract clause text. Obtain and read the contract.");
  // Limit repetitive per-region context without presenting truncated source text as complete.
  const bounded = clauses.slice(0, 100).map((c) => ({
    section: c.section,
    verbatim_text: (c.verbatim_text ?? "").slice(0, 2000),
    truncated: (c.verbatim_text ?? "").length > 2000,
  }));
  if (clauses.length > 100 || bounded.some((c) => c.truncated))
    missing.push("Contract excerpts are truncated; retrieve the full cited clauses for review.");
  return {
    basis: "Saved project records and excerpts; original documents still require review",
    setup,
    contract_clauses: bounded,
    unresolved_context: missing,
    scope_complete: false,
  };
}
