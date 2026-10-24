import { ToolError, type JsonValueInput } from "@lovable.dev/mcp-js";
import { dbError, type Sb } from "../guard";
import { type Job, named } from "../jobs";
import {
  drawingRecords,
  readStoredDrawingBytes,
  sheetPageIndex,
  type DrawingRecord,
} from "../drawing-set";

import { bytesToBase64 } from "../estimating-sheet";
import { verifyLocatedShape } from "./verify";
import { cachedSource } from "./cache";
import { automaticCalibration } from "./calibration";
import { highlightedPreview } from "./render";
import { renderMarkdown } from "../cards/markdown";
import { TAKEOFF_CARD_URI } from "../cards/takeoff-card";
import type { CardModel } from "../cards/model";
import { calibrate, measure, type Calibration, type Shape } from "./geometry";
import { inspectSheet, renderTile, scaleProposals, sheetSpace, type SheetInspection } from "./pdf";
import { parseState, settle } from "../estimating";
import {
  engineSnapshot,
  measurementStatus,
  verifiedLines,
  type EngineSnapshot,
  type GeometryRevision,
} from "./state";

export async function engineRpc<T>(
  sb: Pick<Sb, "rpc">,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await sb.rpc(name, args);
  if (result.error) dbError(result.error);
  if (result.data == null)
    throw new ToolError("The measurement could not be confirmed. Reload before retrying.");
  return result.data as T;
}
export type StoredPage = {
  source: DrawingRecord;
  sheet: string;
  page: number;
  bytes: Uint8Array;
  inspection: SheetInspection;
  space: ReturnType<typeof sheetSpace>;
};
export async function loadStoredPage(
  sb: Sb,
  job: Job,
  sheet: string,
  sourceId?: string,
): Promise<StoredPage> {
  const sources = await drawingRecords(sb, job);
  const source = sourceId ? sources.find((s) => s.id === sourceId) : sources[0];
  if (!source)
    throw new ToolError(
      "Choose a drawing set stored on this job. No other source was substituted.",
    );
  if (!source.sheets.length)
    throw new ToolError(
      "This PDF is stored but its sheet names are needed. Save its page order once in the drawing library; no re-upload is needed.",
    );
  const index = sheetPageIndex(source.sheets, sheet);
  if (index == null)
    throw new ToolError(
      `Sheet ${sheet} is not in the selected stored set. No older drawing was substituted.`,
    );
  // Read/hash validation is shared with direct imports; a source reference alone
  // never establishes ownership or authorizes a different bucket/job.
  const bytes = await cachedSource(
    `${job.company_id}:${job.job_id}:${source.id}:${source.content_hash}`,
    () => readStoredDrawingBytes(sb, job, source),
  );
  const inspection = await inspectSheet(bytes, index);
  return {
    source,
    sheet: source.sheets[index],
    page: index + 1,
    bytes,
    inspection,
    space: sheetSpace(source, index + 1, inspection),
  };
}
export async function viewEngine(
  sb: Sb,
  job: Job,
  state: EngineSnapshot,
  page?: StoredPage,
  extra: Record<string, unknown> = {},
) {
  const summary = measurementStatus(state);
  const card: CardModel = {
    state: summary.settled ? "result" : "progress",
    show_state: false,
    title: page ? `${page.sheet} · Drawing takeoff` : "Drawing takeoff",
    job: named(job),
    kpis: [
      { label: "Located and accepted", value: String(summary.located) },
      { label: "Proposals to review", value: String(summary.proposed) },
      { label: "Unlocated", value: String(summary.unlocated) },
      { label: "Not drawable", value: String(summary.not_drawable) },
    ],
    sections: [
      {
        heading: "Measured takeoff",
        kind: "table",
        columns: ["Line", "Item", "Accepted", "Proposed", "Unit", "Status"],
        rows: summary.lines.map((l) => ({
          cells: [
            `L${l.line_no}`,
            l.item,
            l.accepted == null ? "Not established" : String(l.accepted),
            l.proposed == null ? "" : String(l.proposed),
            l.unit || "",
            l.status.replace("_", " "),
          ],
        })),
      },
    ],
    next_move: summary.settled
      ? "Review the measured takeoff and contractor rates before building the bid."
      : "Locate missing work, confirm its scale and review proposals. A quantity is confirmed only from accepted geometry or a recorded non-drawable basis.",
  };
  if (typeof extra.report_title === "string") card.title = extra.report_title;
  if (Array.isArray(extra.report_rows))
    card.sections?.push({
      heading: typeof extra.report_title === "string" ? extra.report_title : "Estimate record",
      kind: "list",
      rows: extra.report_rows
        .filter((r) => typeof r === "string")
        .map((r) => ({ cells: [r as string] })),
    });
  if ((extra.export as { historical?: boolean } | undefined)?.historical)
    card.sections?.push({
      heading: "Dated copy",
      kind: "list",
      rows: [
        {
          cells: [
            "This is the saved historical PDF, not a new measurement.",
            (extra.export as { stale?: boolean }).stale
              ? "Geometry has changed since this copy was made."
              : "Its geometry references match the current sheet.",
          ],
        },
      ],
    });
  if (Array.isArray(extra.downloads))
    card.sections?.push({
      heading: "Private downloads (15 minutes)",
      kind: "list",
      rows: extra.downloads.map((d) => {
        const file = d as { filename: string; url: string };
        return { cells: [file.filename], href: file.url };
      }),
    });
  const { renderPdfiumPage } = await import("../pdf-renderer");
  const review = parseState({
    setup: { role: state.role, trades: state.trades ?? [] },
    takeoff: { version: state.takeoff_version, lines: state.lines },
    gaps: state.gaps ?? [],
    verdicts: state.verdicts ?? [],
  });
  const settled = settle(
    verifiedLines(review.lines, state),
    review.gaps,
    review.verdicts.map((v) => (v.item_kind === "line" ? { ...v, corrected_qty: null } : v)),
    { role: review.setup.role, trades: review.setup.trades },
  );
  card.sections?.push({
    heading: "Estimate review",
    kind: "list",
    rows: [
      {
        cells: [
          `Open ${settled.counts.open} · Settled ${settled.counts.settled} · Dropped ${settled.counts.dropped}`,
        ],
      },
      ...settled.items
        .filter((i) => i.kind === "gap")
        .map((i) => ({
          cells: [`${i.ref} · ${i.title}`, i.status, i.followUp ?? i.math ?? ""],
          flag: i.holdsBid ? ("risk" as const) : null,
        })),
    ],
  });
  if (
    state.sources?.some(
      (s) => s.stale && state.geometry.some((g) => g.source_id === s.id && g.status !== "rejected"),
    )
  )
    card.sections?.push({
      heading: "Drawing revision review",
      kind: "list",
      rows: [
        {
          cells: [
            "A measured source has a newer drawing or corrected sheet index. Its previous accepted quantity remains historical; check the new sheet and approve its geometry before building a final bid.",
          ],
        },
      ],
    });
  if (Array.isArray(extra.history))
    card.sections?.push({
      heading: "Measurement history",
      kind: "list",
      rows: extra.history.map((value) => {
        const row = value as GeometryRevision & { line_no: number; item: string };
        return {
          cells: [
            `L${row.line_no} · ${row.item} · revision ${row.version}`,
            `${row.measured ?? "Not drawable"} ${row.unit ?? ""} · ${row.status}`,
            row.reason ?? "",
            row.created_at,
            `Recorded by ${row.created_by}`,
            `Source ${row.source_id ?? "non-drawable basis"}`,
          ],
        };
      }),
    });
  if (extra.include_rejected === true)
    card.sections?.push({
      heading: "Rejected geometry",
      kind: "list",
      rows: state.geometry
        .filter(
          (g) =>
            g.status === "rejected" &&
            (!page || (g.source_id === page.source.id && g.page === page.page)),
        )
        .map((g) => ({
          cells: [
            `L${state.lines.find((l) => l.id === g.line_id)?.line_no} · ${g.shape.kind}`,
            g.reason ?? "Reason not recorded",
            `Revision ${g.version}`,
          ],
        })),
    });
  const preview = page ? await renderPdfiumPage(page.bytes, page.page - 1) : null;
  const highlighted = page
    ? await highlightedPreview(page, state, extra.include_rejected === true)
    : null;
  if (extra.export && typeof (extra.export as { url?: unknown }).url === "string")
    card.sections?.push({
      heading: "Dated measured PDF",
      kind: "list",
      rows: [
        {
          cells: ["Download dated measured drawing (15-minute private link)"],
          href: (extra.export as { url: string }).url,
        },
      ],
    });
  const availableSources = (await drawingRecords(sb, job)).map((s) => ({
    id: s.id,
    filename: s.filename,
    revision: s.version,
    content_hash: s.content_hash,
    sheets: s.sheets,
    source_key: s.source_key,
  }));
  const structuredContent = {
    snapshot_at: new Date().toISOString(),
    available_sources: availableSources,
    card,
    engine: { ...state, summary },
    context: {
      job_id: job.job_id,
      job_number: job.job_number,
      company_id: job.company_id,
      source_id: page?.source.id,
      sheet: page?.sheet,
    },
    ...(page
      ? {
          source: {
            id: page.source.id,
            filename: page.source.filename,
            revision: page.source.version,
            content_hash: page.source.content_hash,
            sheet: page.sheet,
            page: page.page,
          },
          space: page.space,
          tiles: page.inspection.tiles,
          scale_proposals: scaleProposals(page.inspection.text),
          automatic_calibration: automaticCalibration(page.space, page.inspection),
          preview: preview ? `data:image/png;base64,${bytesToBase64(preview)}` : null,
        }
      : {}),
    ...extra,
  };
  const refs = {
    source_id: page?.source.id,
    sheet: page?.sheet,
    takeoff_version: state.takeoff_version,
    calibrations: state.calibrations.map((c) => ({
      id: c.id,
      source_id: c.source_id,
      page: c.page,
      region: c.region,
      version: c.version,
      confirmed: c.confirmed,
    })),
    geometry: state.geometry.map((g) => ({
      geometry_id: g.geometry_id,
      revision_id: g.id,
      expected_version: g.version,
      line_no: state.lines.find((l) => l.id === g.line_id)?.line_no,
      source_id: g.source_id,
      page: g.page,
      status: g.status,
      measured: g.measured,
      unit: g.unit,
    })),
    pass: extra.pass ?? null,
  };
  const factual =
    renderMarkdown(card) +
    "\n\n### Measurement references\n\n```json\n" +
    JSON.stringify(refs) +
    "\n```";
  return {
    content: [
      { type: "text" as const, text: factual },
      ...(highlighted
        ? [{ type: "image" as const, mimeType: "image/png", data: bytesToBase64(highlighted) }]
        : []),
    ],
    structuredContent: structuredContent as unknown as JsonValueInput,
    _meta: {
      "openai/outputTemplate": TAKEOFF_CARD_URI,
      ui: { resourceUri: TAKEOFF_CARD_URI },
    },
  };
}
export async function saveCalibration(
  sb: Sb,
  job: Job,
  page: StoredPage,
  input: Omit<Calibration, "feet_per_point" | "version">,
  expected: number,
) {
  const checked = calibrate(page.space, { ...input, version: expected + 1 });
  await verifyLocatedShape(page, { kind: "pins", points: input.reference.points });
  return engineRpc<Calibration>(sb, "mcp_takeoff_calibrate", {
    _job: job.job_id,
    _source: page.source.id,
    _page: page.page,
    _expected: expected,
    _record: { ...checked, width: page.space.width, height: page.space.height },
  });
}
export async function saveGeometry(
  sb: Sb,
  job: Job,
  page: StoredPage,
  state: EngineSnapshot,
  input: {
    line_no: number;
    shape: Shape;
    calibration_id?: string;
    geometry_id?: string;
    expected_version: number;
    reason?: string;
    evidence?: Record<string, unknown>;
  },
  operation: "save" | "propose" = "save",
) {
  if (!state.lines.some((l) => l.line_no === input.line_no))
    throw new ToolError("Read the current takeoff line before locating it.");
  const calibration = state.calibrations.find(
    (c) => c.id === input.calibration_id && c.source_id === page.source.id && c.page === page.page,
  );
  measure(page.space, input.shape, calibration);
  if (
    input.shape.depth &&
    !(await drawingRecords(sb, job)).some(
      (s) => s.id === input.shape.depth!.source_id && s.sheets.includes(input.shape.depth!.sheet),
    )
  )
    throw new ToolError("The depth citation must name a stored sheet on this job.");
  const previous = state.geometry.find((g) => g.geometry_id === input.geometry_id);
  if (
    previous?.shape.kind === "pins" &&
    input.shape.kind === "pins" &&
    input.shape.points.length < previous.shape.points.length &&
    !input.reason?.trim()
  )
    throw new ToolError("Record why this pin is being removed.");
  const checked = await verifyLocatedShape(page, input.shape);
  return engineRpc<GeometryRevision>(sb, "mcp_takeoff_geometry_save", {
    _job: job.job_id,
    _operation: operation,
    _expected: input.expected_version,
    _record: {
      ...input,
      evidence: { ...input.evidence, ...checked },
      source_id: page.source.id,
      page: page.page,
      takeoff_version: state.takeoff_version,
      width: page.space.width,
      height: page.space.height,
    },
  });
}
export async function decideGeometry(
  sb: Sb,
  job: Job,
  state: EngineSnapshot,
  input: { geometry_id: string; expected_version: number; reason?: string },
  operation: "accept" | "reject",
) {
  const row = state.geometry.find(
    (g) => g.geometry_id === input.geometry_id && g.version === input.expected_version,
  );
  if (!row) throw new ToolError("The geometry changed. Reload the proposal before deciding.");
  if (operation === "accept") {
    const { assertReadComplete } = await import("./scope");
    assertReadComplete(state, row);
  }
  if (operation === "reject" && !input.reason?.trim())
    throw new ToolError("Record why this geometry is being rejected.");
  const line = state.lines.find((l) => l.id === row.line_id)!;
  return engineRpc<GeometryRevision>(sb, "mcp_takeoff_geometry_save", {
    _job: job.job_id,
    _operation: operation,
    _expected: input.expected_version,
    _record: {
      geometry_id: row.geometry_id,
      line_no: line.line_no,
      takeoff_version: state.takeoff_version,
      reason: input.reason,
    },
  });
}
export async function readTile(sb: Sb, job: Job, page: StoredPage, index: number) {
  const tile = page.inspection.tiles[index];
  if (!tile) throw new ToolError("Choose a tile from this stored sheet.");
  const rendered = await renderTile(page.bytes, page.page - 1, tile);
  return {
    tile,
    png: `data:image/png;base64,${bytesToBase64(rendered.png)}`,
    content: { type: "image" as const, mimeType: "image/png", data: bytesToBase64(rendered.png) },
  };
}
export const requiredSnapshot = (sb: Sb, job: Job) =>
  engineSnapshot(sb, job.job_id, true) as Promise<EngineSnapshot>;
