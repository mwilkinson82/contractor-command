// A sheet read: one tile handed to the member's model with every open line that could appear on it,
// one set of observations back, each line verified and checkpointed on its own pass. The per-line
// passes share one tile order and move in lockstep, so a 60-line sheet costs one round trip per tile,
// not one per line per tile. Nothing here calls a model; nothing here accepts geometry.
import { ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import type { Sb } from "../guard";
import type { Job } from "../jobs";
import type { Bounds, Shape } from "./geometry";
import { renderPlanReference, renderTile, type Tile } from "./pdf";
import type { StoredPage } from "./service";
import { measurementLines, type EngineSnapshot } from "./state";
import {
  HostDrawingReadRequired,
  hostDrawingReader,
  lineObservationsSchema,
  type VisionRead,
} from "./vision";
import { candidateOrder, confirmedCountArea, proposeTakeoffBatch } from "./pass";
import { assertScopeBounds, scopedTarget } from "./scope";

export const sheetObservationsSchema = z
  .object({
    cursor: z.number().int().min(0),
    reported_model: z.string().trim().min(1).max(120).optional(),
    lines: z
      .array(
        lineObservationsSchema
          .extend({
            line_no: z.number().int().min(1).max(9999),
            pass_id: z.string().uuid(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()
  .refine(
    (o) => new Set(o.lines.map((l) => l.line_no)).size === o.lines.length,
    "Return each line once.",
  );
export type SheetObservations = z.infer<typeof sheetObservationsSchema>;

type Kind = "count" | "linear" | "area" | "volume";
export function measureKind(unit: string | null | undefined): Kind | null {
  return /^(ea|each)$/i.test(unit ?? "")
    ? "count"
    : /^(lf|ft)$/i.test(unit ?? "")
      ? "linear"
      : /^cy$/i.test(unit ?? "")
        ? "volume"
        : /^sf$/i.test(unit ?? "")
          ? "area"
          : null;
}

export type SheetLine = {
  line_no: number;
  item: string;
  measure_type: Kind;
  pass_id: string | null;
  next_cursor: number;
  scope: { kind: "count-area" | "calibrated-region"; name: string; bounds: Bounds };
  depth: Shape["depth"] | null;
};
export type SheetSkip = { line_no: number; item: string; reason: string };

export class HostSheetReadRequired extends Error {
  constructor(
    public read: {
      cursor: number;
      order: number[];
      tile: Tile;
      scope: Bounds;
      png: Uint8Array;
      overview: Uint8Array;
      reference_bounds: Bounds;
      lines: SheetLine[];
      waiting: SheetLine[];
      skipped: SheetSkip[];
      hints: string[];
      calibration_id: string | null;
    },
  ) {
    super(
      "This sheet region is ready for the connected AI to inspect for every open line. No quantity has been established.",
    );
  }
}

function union(bounds: Bounds[]): Bounds {
  const x = Math.min(...bounds.map((b) => b.x)),
    y = Math.min(...bounds.map((b) => b.y));
  const right = Math.max(...bounds.map((b) => b.x + b.width)),
    bottom = Math.max(...bounds.map((b) => b.y + b.height));
  return { x, y, width: Math.min(1, right) - x, height: Math.min(1, bottom) - y };
}

/** Which lines a sheet read can carry, with the reason for each one it cannot. */
export function sheetLines(
  page: StoredPage,
  state: EngineSnapshot,
  input: { line_nos?: number[]; calibration_id?: string },
): { lines: SheetLine[]; skipped: SheetSkip[] } {
  const cal = state.calibrations.find(
    (c) => c.id === input.calibration_id && c.source_id === page.source.id && c.page === page.page,
  );
  const wanted = input.line_nos?.length
    ? state.lines.filter((l) => input.line_nos!.includes(l.line_no))
    : state.lines;
  const lines: SheetLine[] = [],
    skipped: SheetSkip[] = [];
  const measurements = new Map(measurementLines(state).map((line) => [line.line_no, line]));
  const here = (sheet: string | null | undefined) =>
    (sheet ?? "").trim().toLowerCase() === page.sheet.trim().toLowerCase();
  for (const line of wanted) {
    const kind = measureKind(line.unit);
    const skip = (reason: string) =>
      skipped.push({ line_no: line.line_no, item: line.item, reason });
    const measurement = measurements.get(line.line_no);
    if (measurement?.status === "not_drawable") {
      skip(
        `This line is excluded or has a recorded non-drawable basis${measurement.reason ? `: ${measurement.reason}` : "."}`,
      );
      continue;
    }
    if (!kind) {
      skip("Only EA, LF, SF and CY lines are located on a drawing; record a non-drawable basis.");
      continue;
    }
    // A line belongs to the sheet its takeoff names. Another sheet's line is never read here, and a
    // line with no sheet joins only when the member names it.
    if (line.sheet?.trim() && !here(line.sheet)) {
      skip(`This line is assigned to sheet ${line.sheet.trim()}, not ${page.sheet}.`);
      continue;
    }
    if (!line.sheet?.trim() && !input.line_nos?.includes(line.line_no)) {
      skip("This line names no sheet; include it with line_nos to read it here.");
      continue;
    }
    const active = state.geometry.filter(
      (g) =>
        g.line_id === line.id &&
        g.source_id === page.source.id &&
        g.page === page.page &&
        g.status !== "rejected",
    );
    const prior = state.passes
      .filter(
        (p) =>
          p.source_id === page.source.id &&
          p.page === page.page &&
          p.pass_summary.line_no === line.line_no &&
          p.pass_summary.takeoff_version === state.takeoff_version &&
          p.pass_summary.source_hash === page.source.content_hash &&
          (kind === "count"
            ? !!confirmedCountArea(p.pass_summary)
            : p.pass_summary.calibration_id === (cal?.id ?? null)),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const summary = prior?.pass_summary;
    if (summary?.complete === true) {
      skip("This line's read on this sheet is complete; review its proposals.");
      continue;
    }
    if (active.some((g) => g.evidence.pass_id !== summary?.pass_id)) {
      skip(
        "This line already has geometry on this sheet from another read; review or reject it first.",
      );
      continue;
    }
    if (kind === "count") {
      const area = confirmedCountArea(summary);
      if (!area) {
        skip("Confirm this count line's plan or room area first; counts need no scale.");
        continue;
      }
      lines.push({
        line_no: line.line_no,
        item: line.item,
        measure_type: kind,
        pass_id: (summary?.pass_id as string) ?? null,
        next_cursor: Number(summary?.next_cursor ?? 0),
        scope: { kind: "count-area", name: area.name, bounds: area.bounds },
        depth: null,
      });
      continue;
    }
    if (!cal?.confirmed) {
      skip("Confirm this sheet's calibration before its lengths and areas are read.");
      continue;
    }
    const depth = (summary?.depth as Shape["depth"] | undefined) ?? null;
    if (kind === "volume" && !depth) {
      skip("Provide this concrete line's cited depth with a single-line read first.");
      continue;
    }
    lines.push({
      line_no: line.line_no,
      item: line.item,
      measure_type: kind,
      pass_id: (summary?.pass_id as string) ?? null,
      next_cursor: Number(summary?.next_cursor ?? 0),
      scope: { kind: "calibrated-region", name: cal.region, bounds: cal.bounds },
      depth,
    });
  }
  return { lines, skipped };
}

/** One tile order for the whole read: every tile that touches any line's region, vector hints first. */
export function sheetOrder(page: StoredPage, lines: SheetLine[]): number[] {
  const scope = union(lines.map((l) => l.scope.bounds));
  const score = new Map<number, number>();
  for (const line of lines)
    candidateOrder(page, line.item, line.scope.bounds).forEach((index, rank) =>
      score.set(index, (score.get(index) ?? 0) + Math.max(0, 1000 - rank)),
    );
  return [...page.inspection.tiles]
    .filter(
      (t) =>
        t.bounds.x <= scope.x + scope.width &&
        t.bounds.x + t.bounds.width >= scope.x &&
        t.bounds.y <= scope.y + scope.height &&
        t.bounds.y + t.bounds.height >= scope.y,
    )
    .sort((a, b) => (score.get(b.index) ?? 0) - (score.get(a.index) ?? 0) || a.index - b.index)
    .map((t) => t.index);
}

/**
 * Prepare the next tile for every open line (throws HostSheetReadRequired with the images), or
 * verify one set of observations for all of them and advance each line's pass by one tile.
 */
export async function proposeSheetStep(
  sb: Sb,
  job: Job,
  page: StoredPage,
  state: EngineSnapshot,
  input: { line_nos?: number[]; calibration_id?: string },
  observations?: SheetObservations,
) {
  const picked = sheetLines(page, state, input);
  if (!picked.lines.length)
    throw new ToolError(
      `No line on ${page.sheet} is ready for a sheet read. ${picked.skipped
        .slice(0, 6)
        .map((s) => `L${s.line_no}: ${s.reason}`)
        .join(" ")}`.trim(),
    );
  // Lines already on a pass must share one order; a line with none joins at that order.
  const orders = new Set(
    picked.lines.flatMap((l) => {
      const pass = state.passes.find((p) => p.pass_summary.pass_id === l.pass_id);
      return pass ? [JSON.stringify(pass.pass_summary.order)] : [];
    }),
  );
  if (orders.size > 1)
    throw new ToolError(
      "These lines are on reads with different tile orders. Finish or reject the older reads, or name the lines that share one.",
    );
  const order: number[] = orders.size ? JSON.parse([...orders][0]) : sheetOrder(page, picked.lines);
  if (!order.length) throw new ToolError("No stored tile touches these lines' regions.");
  // A saved order is immutable in the database. Sharing it is safe only if it covers every
  // participating region. Never narrow a new line to an older room/count read and then
  // label it complete. Name the wider lines so the host can prepare their own grouped read.
  const covered = new Set(order);
  const wider = picked.lines.filter((line) =>
    candidateOrder(page, line.item, line.scope.bounds).some((index) => !covered.has(index)),
  );
  if (wider.length)
    throw new ToolError(
      `The existing tile order does not cover the complete region for ${wider.map((line) => `L${line.line_no}`).join(", ")}. ` +
        `Keep the existing checkpoints and prepare those lines separately with line_nos: [${wider.map((line) => line.line_no).join(", ")}]. ` +
        "No new checkpoint or measurement was saved. Resume the other lines separately; do not report this sheet complete.",
    );
  // Lockstep: the read sits at the lowest cursor; lines already past it wait for the others.
  const cursor = Math.min(...picked.lines.map((l) => l.next_cursor));
  const active = picked.lines.filter((l) => l.next_cursor === cursor);
  const waiting = picked.lines.filter((l) => l.next_cursor !== cursor);
  const tile = page.inspection.tiles[order[cursor]];
  if (!tile) throw new ToolError("The sheet read has no next tile. Reload the sheet.");
  const scope = union(active.map((l) => l.scope.bounds));
  assertScopeBounds(scope);
  const raster = await renderTile(page.bytes, page.page - 1, tile);
  const reference = await renderPlanReference(page.bytes, page.page - 1, scope);
  const prepared = { raster, reference, scope, writePending: false };
  // Every line, new or resumed, runs on the shared order, so the tile the host saw is the tile each pass records.
  const lineInput = (line: SheetLine) => ({
    line_no: line.line_no,
    calibration_id: line.measure_type === "count" ? undefined : input.calibration_id,
    pass_id: line.pass_id ?? undefined,
    cursor,
    depth: line.depth ?? undefined,
    order,
  });
  if (!observations) {
    // Create the pass for any line that has none, so the host gets a pass_id for every line.
    for (const line of active) {
      if (line.pass_id) continue;
      try {
        await proposeTakeoffBatch(sb, job, page, state, lineInput(line), undefined, {
          ...prepared,
          writePending: true,
        });
      } catch (error) {
        if (!(error instanceof HostDrawingReadRequired) || !error.checkpoint) throw error;
        line.pass_id = String(error.checkpoint.pass_id);
        state.passes.unshift({
          id: `pending-${line.pass_id}`,
          source_id: page.source.id,
          page: page.page,
          created_at: new Date().toISOString(),
          geometry_revs: [],
          pass_summary: error.checkpoint,
        });
      }
    }
    const hints = page.inspection.objects
      .filter(
        (o) =>
          o.kind === "text" &&
          o.text &&
          o.bounds.x < tile.bounds.x + tile.bounds.width &&
          o.bounds.x + o.bounds.width > tile.bounds.x &&
          o.bounds.y < tile.bounds.y + tile.bounds.height &&
          o.bounds.y + o.bounds.height > tile.bounds.y,
      )
      .slice(0, 80)
      .map((o) => o.text!.slice(0, 300));
    throw new HostSheetReadRequired({
      cursor,
      order,
      tile,
      scope,
      png: scopedTarget(raster.rgba, tile, scope),
      overview: reference.png,
      reference_bounds: reference.bounds,
      lines: active,
      waiting,
      skipped: picked.skipped,
      hints,
      calibration_id: input.calibration_id ?? null,
    });
  }
  if (observations.cursor !== cursor)
    throw new ToolError("Reload the sheet read; its checkpoint moved before these observations.");
  const byLine = new Map(observations.lines.map((l) => [l.line_no, l]));
  const missing = active.filter((l) => !byLine.has(l.line_no));
  if (missing.length)
    throw new ToolError(
      `Return an observation for every open line, with empty findings when none is visible. Missing: ${missing
        .map((l) => `L${l.line_no}`)
        .join(", ")}.`,
    );
  const extra = observations.lines.filter((l) => !active.some((a) => a.line_no === l.line_no));
  if (extra.length)
    throw new ToolError(
      `Lines ${extra.map((l) => `L${l.line_no}`).join(", ")} are not part of this tile's read.`,
    );
  for (const line of active)
    if (byLine.get(line.line_no)!.pass_id !== line.pass_id)
      throw new ToolError(`L${line.line_no} belongs to a different pass. Reload the sheet read.`);
  // Verify every line before saving any, so a bad observation set stops the whole tile.
  const readers = new Map<number, VisionRead>();
  for (const line of active) {
    const { line_no: _n, pass_id: _p, ...observed } = byLine.get(line.line_no)!;
    readers.set(
      line.line_no,
      hostDrawingReader({
        ...observed,
        ...(observations.reported_model ? { reported_model: observations.reported_model } : {}),
      }),
    );
  }
  const results: Record<string, unknown>[] = [];
  for (const line of active)
    results.push(
      await proposeTakeoffBatch(
        sb,
        job,
        page,
        state,
        lineInput(line),
        readers.get(line.line_no)!,
        prepared,
      ),
    );
  const next = cursor + 1;
  return {
    cursor,
    next_cursor: next,
    tiles_total: order.length,
    complete: next === order.length,
    lines: results.map((r) => ({
      line_no: r.line_no,
      pass_id: r.pass_id,
      next_cursor: r.next_cursor,
      complete: r.complete,
      verification_rejections: r.verification_rejections,
    })),
    waiting: waiting.map((l) => ({ line_no: l.line_no, next_cursor: l.next_cursor })),
    skipped: picked.skipped,
  };
}
