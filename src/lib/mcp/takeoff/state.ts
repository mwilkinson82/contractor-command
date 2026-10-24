import { dbError, isMissingFunction, type Sb } from "../guard";
import type {
  StoredLine,
  StoredGap,
  StoredVerdict,
  Setup,
  DocumentScopeRequirement,
} from "../estimating";
import type { Calibration, Shape } from "./geometry";

export type EngineLine = StoredLine & { id: string; takeoff_id: string };
export type GeometryRevision = {
  id: string;
  geometry_id: string;
  version: number;
  line_id: string;
  source_id: string | null;
  page: number | null;
  calibration_id: string | null;
  shape: Shape | { kind: "not_drawable"; exception_kind: string; quantity?: number; unit?: string };
  measured: number | string | null;
  unit: "EA" | "LF" | "SF" | "CY" | null;
  status: "proposed" | "accepted" | "rejected" | "not_drawable";
  source: "athena" | "estimator";
  reason: string | null;
  created_by: string;
  created_at: string;
  evidence: Record<string, unknown>;
};
export type CalibrationRevision = Calibration & {
  id: string;
  source_id: string;
  page: number;
  width: number;
  height: number;
  created_at: string;
  created_by: string;
};
export type Pass = {
  id: string;
  source_id: string;
  page: number;
  created_at: string;
  pass_summary: Record<string, unknown>;
  geometry_revs: string[];
};
export type EngineSnapshot = {
  document_scope?: DocumentScopeRequirement[];
  available: true;
  exports?: {
    id: string;
    source_id: string;
    page: number;
    created_at: string;
    sheet: string;
    source_filename: string;
  }[];
  verdicts?: StoredVerdict[];
  role?: Setup["role"];
  trades?: string[];
  gaps?: StoredGap[];
  sources?: { id: string; stale: boolean }[];
  accepted_history?: GeometryRevision[];
  takeoff_version: number | null;
  /** Lines in the previous takeoff version that the latest save left out. */
  dropped_lines?: { line_no: number; item: string; version: number; had_geometry: boolean }[];
  lines: EngineLine[];
  geometry: GeometryRevision[];
  calibrations: CalibrationRevision[];
  passes: Pass[];
};
export type LineMeasurement = {
  line_no: number;
  line_id: string;
  item: string;
  accepted: number | null;
  proposed: number | null;
  unit: string | null;
  status: "accepted" | "proposed" | "unlocated" | "not_drawable";
  reason?: string;
  exception_kind?: string;
  geometry_revs: string[];
  sheets: { source_id: string; page: number }[];
};
export async function engineSnapshot(
  sb: Pick<Sb, "rpc">,
  jobId: string,
  required = false,
): Promise<EngineSnapshot | null> {
  const { data, error } = await sb.rpc("mcp_takeoff_get", { _job: jobId });
  if (error) {
    if (!required && isMissingFunction(error)) return null;
    dbError(error);
  }
  if (!(data as EngineSnapshot | null)?.available) {
    if (required)
      throw new Error(
        "Drawing measurements are temporarily unavailable. Your stored originals are preserved.",
      );
    return null;
  }
  return data as EngineSnapshot;
}
export function measurementLines(state: EngineSnapshot): LineMeasurement[] {
  return state.lines.map((line) => {
    const latestVerdict = (state.verdicts ?? [])
      .filter(
        (v) => v.item_kind === "line" && v.line_no === line.line_no && v.item_text === line.item,
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const excluded = latestVerdict?.mark === "not_relevant" && !!latestVerdict.note?.trim();
    const invalidated = state.geometry.some(
      (g) => g.line_id === line.id && g.evidence.requires_relocation === true,
    );
    const rows = state.geometry.filter((g) => g.line_id === line.id && g.status !== "rejected");
    const exception = rows
      .filter((g) => g.status === "not_drawable")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const geometry = rows.filter((g) => g.status !== "not_drawable");
    const accepted = geometry.filter((g) => g.status === "accepted"),
      proposed = geometry.filter((g) => g.status === "proposed");
    const sum = (rs: GeometryRevision[]) =>
      rs.length ? rs.reduce((n, g) => n + Number(g.measured), 0) : null;
    // An exception does not silently hide pending or existing geometry.
    const stale = geometry.some((g) =>
      state.sources?.some(
        (s) =>
          (s.id === g.source_id ||
            (g.shape.kind !== "not_drawable" && s.id === g.shape.depth?.source_id)) &&
          s.stale,
      ),
    );
    const status = excluded
      ? "not_drawable"
      : invalidated
        ? "unlocated"
        : stale
          ? "proposed"
          : proposed.length
            ? "proposed"
            : accepted.length
              ? "accepted"
              : exception
                ? "not_drawable"
                : "unlocated";
    return {
      line_no: line.line_no,
      line_id: line.id,
      item: line.item,
      accepted:
        status === "not_drawable"
          ? excluded
            ? 0
            : exception?.shape.kind === "not_drawable"
              ? exception.shape.exception_kind === "by_others"
                ? 0
                : (exception.shape.quantity ?? null)
              : null
          : sum([
              ...accepted,
              ...(state.accepted_history ?? []).filter(
                (g) =>
                  g.line_id === line.id && proposed.some((p) => p.geometry_id === g.geometry_id),
              ),
            ]),
      proposed: stale ? null : proposed.length ? sum([...accepted, ...proposed]) : null,
      unit:
        status === "not_drawable" && exception?.shape.kind === "not_drawable"
          ? (exception.shape.unit ?? line.unit)
          : (geometry[0]?.unit ?? line.unit),
      status,
      exception_kind: excluded
        ? "excluded"
        : exception?.shape.kind === "not_drawable"
          ? exception.shape.exception_kind
          : undefined,
      reason: excluded
        ? (latestVerdict.note ?? undefined)
        : status === "not_drawable"
          ? (exception?.reason ?? undefined)
          : undefined,
      geometry_revs:
        status === "not_drawable" && exception ? [exception.id] : geometry.map((g) => g.id),
      sheets: geometry.flatMap((g) =>
        g.source_id && g.page ? [{ source_id: g.source_id, page: g.page }] : [],
      ),
    };
  });
}
export function measurementStatus(state: EngineSnapshot) {
  const lines = measurementLines(state);
  return {
    lines,
    located: lines.filter((l) => l.status === "accepted").length,
    proposed: lines.filter((l) => l.status === "proposed").length,
    unlocated: lines.filter((l) => l.status === "unlocated").length,
    not_drawable: lines.filter((l) => l.status === "not_drawable").length,
    settled:
      lines.length > 0 &&
      lines.every(
        (l) =>
          l.status === "accepted" ||
          (l.status === "not_drawable" &&
            (["by_others", "excluded"].includes(l.exception_kind ?? "") || l.accepted != null)),
      ),
  };
}
/** Existing takeoff reports get quantities from accepted geometry, never from an
 * AI-typed value. The legacy saved rows remain unchanged as historical evidence. */
export function verifiedLines<T extends StoredLine>(lines: T[], snapshot: EngineSnapshot): T[] {
  const measurements = measurementLines(snapshot);
  return lines.map((line) => {
    const m = measurements.find((r) => r.line_no === line.line_no);
    if (!m) return { ...line, qty: null, missing_input: "drawing location and measurement" };
    if (m.status === "not_drawable")
      return {
        ...line,
        qty: ["by_others", "excluded"].includes(m.exception_kind ?? "") ? 0 : m.accepted,
        unit: m.unit,
        math: `Non-drawable (${m.exception_kind}): ${m.reason}. Quantity confirmed by the estimator.`,
        basis: "deduced",
        missing_input: null,
        note: `${line.note ?? ""} Not drawable: ${m.reason}.`.trim(),
      };
    if (m.status !== "accepted")
      return {
        ...line,
        qty: null,
        missing_input:
          m.status === "proposed"
            ? "estimator acceptance of the geometry proposal"
            : "drawing location and measurement",
      };
    return {
      ...line,
      qty: m.accepted,
      unit: m.unit,
      missing_input: null,
      basis: "measured",
      confidence: "high",
      markup_ref: m.geometry_revs.join(","),
      math: `Measured from accepted geometry ${m.geometry_revs.join(", ")}.`,
      note: line.note,
    };
  });
}
