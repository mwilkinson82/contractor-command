import { ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import type { DocumentScopeRequirement } from "../estimating";
import { measurementEvidence } from "./host-workflow";
import type { EngineSnapshot } from "./state";
import { sheetPageIndex, type DrawingRecord } from "../drawing-set";

export function bindScopeSources(
  requirements: DocumentScopeRequirement[],
  sources: DrawingRecord[],
) {
  return requirements.map((r) => {
    if (r.source_type !== "sheet") return r;
    const source = r.source_id
      ? sources.find((s) => s.id === r.source_id)
      : sources.find((s) => sheetPageIndex(s.sheets, r.source_ref) != null);
    if (!source || sheetPageIndex(source.sheets, r.source_ref) == null)
      throw new ToolError(
        `Scope ${r.id} does not name a stored source containing ${r.source_ref}. Nothing was saved.`,
      );
    if (r.source_hash && r.source_hash !== source.content_hash)
      throw new ToolError(
        `Scope ${r.id} names a different drawing fingerprint. Nothing was saved.`,
      );
    return { ...r, source_id: source.id, source_hash: source.content_hash };
  });
}

export const documentScopeSchema = z
  .array(
    z
      .object({
        id: z.string().trim().min(1).max(80),
        source_id: z.string().uuid().optional(),
        source_hash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        title: z.string().trim().min(1).max(200),
        kind: z.enum(["quantity", "watch"]),
        source_type: z.enum(["sheet", "spec", "contract"]),
        source_ref: z.string().trim().min(1).max(80),
        citation: z.string().trim().min(1).max(500),
        excerpt: z.string().trim().min(1).max(1000),
        line_nos: z.array(z.number().int().min(1).max(9999)).max(200),
        confidence: z.enum(["high", "medium", "low"]),
        evidence_basis: z.enum(["seen", "measured", "assumed"]),
      })
      .strict(),
  )
  .max(300)
  .refine(
    (rows) => new Set(rows.map((r) => r.id)).size === rows.length,
    "Each document scope requirement needs its own ID.",
  );

/** The host supplies document interpretation; classification checks saved
 * geometry. A cited requirement without a mapped line stays visible. */
export function reconcileDocumentScope(
  state: EngineSnapshot,
  requirements: DocumentScopeRequirement[] = state.document_scope ?? [],
) {
  const measured = new Map(measurementEvidence(state).map((l) => [l.line_no, l]));
  return requirements.map((r) => {
    const lines = r.line_nos.map((n) => measured.get(n));
    const missing = !lines.length || lines.some((l) => !l);
    const source = r.source_id ? state.sources?.find((s) => s.id === r.source_id) : null;
    const sourceStatus =
      r.source_type !== "sheet"
        ? "paragraph cited"
        : !r.source_id
          ? "revision not bound"
          : !source
            ? "source status unavailable"
            : source.stale
              ? "superseded drawing"
              : "current stored drawing";
    const classification =
      r.kind === "watch"
        ? "Watch"
        : missing
          ? "Not found"
          : (r.source_type !== "sheet" || sourceStatus === "current stored drawing") &&
              lines.every((l) => l?.measurement_classification === "Measured")
            ? "Measured"
            : "Verify";
    return {
      ...r,
      classification,
      source_status: sourceStatus,
      interpretation: "Host-reported document reading; not independent accuracy",
      reason:
        classification === "Not found"
          ? "No current takeoff line is mapped to this document requirement. This is not a claim that it is absent from the drawings."
          : classification === "Watch"
            ? "Document instruction affecting scope or measurement; retain its citation during review."
            : classification === "Verify"
              ? "Mapped work is not fully accepted on independently checked scales, or remains uncertain."
              : "Mapped geometry is accepted with required scale checks; complete project scope is still a separate review.",
      lines: lines.filter((l) => l != null),
      scope_complete: false,
    };
  });
}
