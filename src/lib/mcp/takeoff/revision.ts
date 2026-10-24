import { ToolError } from "@lovable.dev/mcp-js";
import type { Sb } from "../guard";
import type { Job } from "../jobs";
import { drawingRecords } from "../drawing-set";
import { saveGeometry, type StoredPage } from "./service";
import type { EngineSnapshot } from "./state";
import type { Shape } from "./geometry";
export async function reviseGeometry(
  sb: Sb,
  job: Job,
  page: StoredPage,
  state: EngineSnapshot,
  input: {
    geometry_id: string;
    expected_version: number;
    calibration_id?: string;
    confirm?: boolean;
  },
) {
  const before = state.geometry.find(
    (g) => g.geometry_id === input.geometry_id && g.version === input.expected_version,
  );
  if (
    !before ||
    before.shape.kind === "not_drawable" ||
    !before.source_id ||
    before.status === "rejected"
  )
    throw new ToolError("Read the active geometry revision before checking a new drawing.");
  if (input.confirm !== true)
    throw new ToolError(
      "Confirm the named replacement sheet before checking geometry on it. Every transferred measurement remains a proposal.",
    );
  const sources = await drawingRecords(sb, job),
    old = sources.find((s) => s.id === before.source_id);
  if (
    !old ||
    old.id === page.source.id ||
    old.source_key !== page.source.source_key ||
    old.sheets[before.page! - 1] !== page.sheet
  )
    throw new ToolError(
      "Choose the corresponding sheet revision of the same drawing set. No unrelated source was substituted.",
    );
  const line = state.lines.find((l) => l.id === before.line_id);
  if (!line) throw new ToolError("The takeoff line changed. Reload before comparing revisions.");
  const saved = await saveGeometry(sb, job, page, state, {
    line_no: line.line_no,
    geometry_id: before.geometry_id,
    expected_version: before.version,
    shape: before.shape as Shape,
    calibration_id: input.calibration_id,
    reason:
      "Stored drawing revision changed; every transferred location requires estimator review.",
    evidence: {
      revised_from: before.id,
      prior_source_id: before.source_id,
      prior_measurement: Number(before.measured),
      prior_source_hash: old.content_hash,
    },
  });
  const change =
    Math.abs(Number(saved.measured) - Number(before.measured)) /
    Math.max(Math.abs(Number(before.measured)), 1e-12);
  return {
    geometry: saved,
    prior_quantity: Number(before.measured),
    proposed_quantity: Number(saved.measured),
    change_percent: change * 100,
    over_two_percent: change > 0.02,
    accepted: false,
  };
}
