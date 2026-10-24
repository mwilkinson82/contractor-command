import { ToolError } from "@lovable.dev/mcp-js";
import type { Sb } from "../guard";
import type { Job } from "../jobs";
import { distance, measure, type Bounds, type Point, type Shape } from "./geometry";
import { renderTile, type Tile } from "./pdf";
import { engineRpc, loadStoredPage, type StoredPage } from "./service";
import type { EngineSnapshot } from "./state";
import { gridPng, readVisionTile, verifyVisionAnswer, type VisionRead } from "./vision";

/** Partition overlaps at their midpoints. Linear fragments are measured once,
 * even when both adjoining tiles identify the same run. */
export function tileCore(tile: Tile, tiles: Tile[]): Bounds {
  const xs = [...new Set(tiles.map((t) => t.x))].sort((a, b) => a - b),
    ys = [...new Set(tiles.map((t) => t.y))].sort((a, b) => a - b);
  const axis = (offset: number, length: number, positions: number[], end: number) => {
    const i = positions.indexOf(offset);
    return [
      i ? (positions[i - 1] + Math.min(1024, end - positions[i - 1]) + offset) / 2 : 0,
      i < positions.length - 1 ? (offset + length + positions[i + 1]) / 2 : end,
    ];
  };
  const [x, right] = axis(tile.x, tile.width, xs, tile.pageWidth),
    [y, bottom] = axis(tile.y, tile.height, ys, tile.pageHeight);
  return {
    x: x / tile.pageWidth,
    y: y / tile.pageHeight,
    width: (right - x) / tile.pageWidth,
    height: (bottom - y) / tile.pageHeight,
  };
}
export function clipSegment(a: Point, b: Point, box: Bounds): Point[] | null {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  let lo = 0,
    hi = 1;
  for (const [p, q] of [
    [-dx, a.x - box.x],
    [dx, box.x + box.width - a.x],
    [-dy, a.y - box.y],
    [dy, box.y + box.height - a.y],
  ]) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) lo = Math.max(lo, t);
    else hi = Math.min(hi, t);
    if (lo >= hi) return null;
  }
  return [
    { x: a.x + lo * dx, y: a.y + lo * dy },
    { x: a.x + hi * dx, y: a.y + hi * dy },
  ];
}
const within = (p: Point, b: Bounds) =>
  p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height;
export function partitionShape(shape: Shape, tile: Tile, tiles: Tile[]): Shape[] {
  const core = tileCore(tile, tiles);
  if (shape.kind === "pins") {
    const points = shape.points.filter(
      (p) =>
        within(p, core) ||
        (((p.x === 1 && core.x + core.width === 1) || (p.y === 1 && core.y + core.height === 1)) &&
          p.x >= core.x &&
          p.x <= core.x + core.width &&
          p.y >= core.y &&
          p.y <= core.y + core.height),
    );
    return points.length ? [{ ...shape, points }] : [];
  }
  if (shape.kind === "polyline")
    return shape.points.slice(1).flatMap((b, i) => {
      const a = shape.points[i];
      // A run exactly on a partition belongs to its bottom/right neighbor only.
      if (
        (Math.abs(a.y - b.y) < 1e-12 &&
          Math.abs(a.y - core.y - core.height) < 1e-12 &&
          core.y + core.height < 1 - 1e-12) ||
        (Math.abs(a.x - b.x) < 1e-12 &&
          Math.abs(a.x - core.x - core.width) < 1e-12 &&
          core.x + core.width < 1 - 1e-12)
      )
        return [];
      const points = clipSegment(a, b, core);
      return points ? [{ ...shape, points }] : [];
    });
  // Whole areas must be visible in one tile. Never add overlapping tile areas or
  // manufacture a boundary at a tile edge. Large areas require estimator tracing.
  const center = {
    x: shape.points.reduce((s, p) => s + p.x, 0) / shape.points.length,
    y: shape.points.reduce((s, p) => s + p.y, 0) / shape.points.length,
  };
  return within(center, core) ? [shape] : [];
}
export function candidateOrder(page: StoredPage, item: string): number[] {
  const words = item.toLowerCase().match(/[a-z0-9-]{3,}/g) ?? [];
  const matching = page.inspection.objects.filter(
    (o) => o.text && words.some((w) => o.text!.toLowerCase().includes(w)),
  );
  const signatures = new Set(
    page.inspection.objects
      .filter(
        (o) =>
          o.signature &&
          matching.some(
            (t) =>
              Math.abs(t.bounds.x - o.bounds.x) < 0.03 && Math.abs(t.bounds.y - o.bounds.y) < 0.03,
          ),
      )
      .map((o) => o.signature),
  );
  const candidates = [
    ...matching,
    ...page.inspection.objects.filter((o) => o.signature && signatures.has(o.signature)),
  ];
  const score = (t: Tile) =>
    candidates.reduce(
      (score, o) =>
        score +
        (within(
          { x: o.bounds.x + o.bounds.width / 2, y: o.bounds.y + o.bounds.height / 2 },
          tileCore(t, page.inspection.tiles),
        )
          ? 3
          : 0),
      0,
    ) +
    candidates.filter(
      (o) =>
        o.bounds.x < t.bounds.x + t.bounds.width &&
        o.bounds.x + o.bounds.width > t.bounds.x &&
        o.bounds.y < t.bounds.y + t.bounds.height &&
        o.bounds.y + o.bounds.height > t.bounds.y,
    ).length;
  // Vector evidence prioritizes; it never omits regions from the raster pass.
  return [...page.inspection.tiles]
    .sort((a, b) => score(b) - score(a) || a.index - b.index)
    .map((t) => t.index);
}
export async function proposeTakeoffBatch(
  sb: Sb,
  job: Job,
  page: StoredPage,
  state: EngineSnapshot,
  input: {
    line_no: number;
    calibration_id?: string;
    pass_id?: string;
    cursor?: number;
    depth?: Shape["depth"];
    legend?: { source_id: string; sheet: string; tile_index: number };
    deadline?: number;
  },
  read: VisionRead = readVisionTile,
) {
  const line = state.lines.find((l) => l.line_no === input.line_no);
  if (!line) throw new ToolError("Choose a line from the current saved takeoff first.");
  const kind = /^(ea|each)$/i.test(line.unit ?? "")
    ? "count"
    : /^(lf|ft)$/i.test(line.unit ?? "")
      ? "linear"
      : /^cy$/i.test(line.unit ?? "")
        ? "volume"
        : /^sf$/i.test(line.unit ?? "")
          ? "area"
          : null;
  if (!kind)
    throw new ToolError(
      "Automatic location supports EA, LF, SF and CY lines. Record other work with an explicit non-drawable basis.",
    );
  const cal = state.calibrations.find(
    (c) => c.id === input.calibration_id && c.source_id === page.source.id && c.page === page.page,
  );
  if (kind !== "count" && !cal?.confirmed)
    throw new ToolError("Confirm this plan or detail calibration before Athena measures it.");
  if (kind === "volume" && !input.depth && !input.pass_id)
    throw new ToolError(
      "Provide the stored detail and cited depth before locating this concrete boundary.",
    );
  const prior = input.pass_id
    ? state.passes.find((p) => p.pass_summary.pass_id === input.pass_id)
    : undefined;
  if (input.pass_id && !prior)
    throw new ToolError("The pass checkpoint is no longer in this view. Reload before continuing.");
  const summary = prior?.pass_summary;
  if (
    prior &&
    (prior.source_id !== page.source.id ||
      prior.page !== page.page ||
      summary?.line_no !== line.line_no ||
      summary.takeoff_version !== state.takeoff_version ||
      summary.calibration_id !== (cal?.id ?? null))
  )
    throw new ToolError("The drawing, line or calibration changed. Start a new reviewed pass.");
  if (
    !prior &&
    state.geometry.some(
      (g) =>
        g.line_id === line.id &&
        g.source_id === page.source.id &&
        g.page === page.page &&
        g.status !== "rejected",
    )
  )
    throw new ToolError(
      "This line already has geometry on this sheet. Review or reject it before starting another full pass, so it cannot be counted twice.",
    );
  if (summary?.complete) return summary;
  const cursor = Number(summary?.next_cursor ?? 0);
  if (input.cursor != null && input.cursor !== cursor)
    throw new ToolError("Reload the current pass checkpoint before continuing.");
  const passId = input.pass_id ?? crypto.randomUUID(),
    order = (summary?.order as number[] | undefined) ?? candidateOrder(page, line.item),
    tile = page.inspection.tiles[order[cursor]];
  if (!tile) throw new ToolError("The pass has no next tile. Reload the sheet.");
  const raster = await renderTile(page.bytes, page.page - 1, tile);
  const { renderPdfiumPage } = await import("../pdf-renderer");
  const overview = await renderPdfiumPage(page.bytes, page.page - 1);
  if (!overview)
    throw new ToolError(
      "The stored sheet's reference view could not be rendered. No drawing read was saved.",
    );
  const hints = page.inspection.objects.filter(
    (o) =>
      o.bounds.x < tile.bounds.x + tile.bounds.width &&
      o.bounds.x + o.bounds.width > tile.bounds.x &&
      o.bounds.y < tile.bounds.y + tile.bounds.height &&
      o.bounds.y + o.bounds.height > tile.bounds.y,
  );
  // Failure leaves the last checkpoint intact; no partial proposals are saved.
  const legendRef = input.legend ?? (summary?.legend as typeof input.legend);
  let legend: Uint8Array | undefined;
  if (legendRef) {
    const legendPage = await loadStoredPage(sb, job, legendRef.sheet, legendRef.source_id),
      region = legendPage.inspection.tiles[legendRef.tile_index];
    if (!region) throw new ToolError("Choose a valid stored legend tile.");
    legend = (await renderTile(legendPage.bytes, legendPage.page - 1, region)).png;
  }
  const answer = await read({
    item: line.item,
    measure_type: kind,
    png: gridPng(raster.rgba, tile),
    original: raster.png,
    overview,
    frame: {
      sheet: page.sheet,
      tile_bounds: tile.bounds,
      ...(cal ? { region: { name: cal.region, bounds: cal.bounds } } : {}),
    },
    hints,
    legend,
    signal: input.deadline
      ? AbortSignal.timeout(Math.max(1, input.deadline - Date.now()))
      : undefined,
  });
  const checked = verifyVisionAnswer({
    answer,
    rgba: raster.rgba,
    tile,
    space: page.space,
    calibration: cal,
    measure_type: kind,
    depth: input.depth ?? (summary?.depth as Shape["depth"]),
  });
  const proposals = checked.accepted
    .flatMap((candidate) =>
      partitionShape(candidate.shape, tile, page.inspection.tiles).map((shape) => ({
        candidate,
        shape,
      })),
    )
    .map((entry) =>
      entry.shape.kind === "pins"
        ? {
            ...entry,
            shape: {
              ...entry.shape,
              points: entry.shape.points.filter(
                (p) =>
                  !state.geometry.some(
                    (g) =>
                      g.line_id === line.id &&
                      g.evidence.pass_id === passId &&
                      !(g.evidence.tile_refs as number[] | undefined)?.includes(tile.index) &&
                      g.shape.kind === "pins" &&
                      g.shape.points.some((q) => distance(p, q, page.space) <= (12 * 72) / 200),
                  ),
              ),
            },
          }
        : entry,
    )
    .filter((entry) => entry.shape.points.length);
  // Remove repeated identical paths within one model answer as well.
  const unique = proposals.filter(
    (p, i, all) => all.findIndex((q) => JSON.stringify(q.shape) === JSON.stringify(p.shape)) === i,
  );
  const next = {
    pass_id: passId,
    line_no: line.line_no,
    takeoff_version: state.takeoff_version,
    calibration_id: cal?.id ?? null,
    source_hash: page.source.content_hash,
    legend: legendRef ?? null,
    depth: input.depth ?? summary?.depth ?? null,
    order,
    cursor,
    next_cursor: cursor + 1,
    complete: cursor + 1 === order.length,
    tiles_read: cursor + 1,
    tiles_total: order.length,
    verification_rejections:
      Number(summary?.verification_rejections ?? 0) + checked.rejected.length,
    uncertainties: [
      ...((summary?.uncertainties as string[]) ?? []),
      ...checked.rejected,
      ...checked.uncertainties,
    ].slice(-100),
    vector_candidates: page.inspection.objects.length,
    vector_truncated: page.inspection.truncated,
  };
  const records = unique.map(({ candidate, shape }) => ({
    line_no: line.line_no,
    takeoff_version: state.takeoff_version,
    source_id: page.source.id,
    page: page.page,
    width: page.space.width,
    height: page.space.height,
    shape,
    calibration_id: cal?.id,
    evidence: {
      pass_id: passId,
      tile_refs: [tile.index],
      confidence: candidate.confidence,
      description: candidate.evidence,
      measurement: measure(page.space, shape, cal),
      crop_refs: shape.points.map((point) => ({ tile_index: tile.index, point, edge: 160 })),
      verification: "raster-ink-and-topology",
      model: process.env.ATHENA_TAKEOFF_MODEL || "google/gemini-3-flash-preview",
      dpi: 200,
      grid_schema: "athena-grid-v1",
      source_hash: page.source.content_hash,
      scope_reference: {
        sheet: page.sheet,
        page: page.page,
        tile_bounds: tile.bounds,
        kind: "stored-sheet-overview",
      },
    },
  }));
  await engineRpc(sb, "mcp_takeoff_pass_save", {
    _job: job.job_id,
    _record: { source_id: page.source.id, page: page.page, pass_summary: next, proposals: records },
  });
  return next;
}
