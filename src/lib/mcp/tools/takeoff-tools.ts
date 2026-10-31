import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run } from "../guard";
import { resolveJob, WhichCompanyAsk, audit } from "../jobs";
import { errorCard, errorMessage } from "../error-card";
import { sheetAccessResult } from "../drawing-set";
import {
  engineRpc,
  decideGeometry,
  loadStoredPage,
  readTile,
  requiredSnapshot,
  saveCalibration,
  saveGeometry,
  viewEngine,
} from "../takeoff/service";
import {
  HostDrawingReadRequired,
  hostDrawingReader,
  hostObservationsSchema,
  splitHostTile,
} from "../takeoff/vision";
import { proposeTakeoffStep, saveCountAreas } from "../takeoff/pass";
import { assertReadComplete } from "../takeoff/scope";
import { reviseGeometry } from "../takeoff/revision";
import { automaticCalibration, statedScaleCalibration } from "../takeoff/calibration";
import { readPointCrop } from "../takeoff/verify";
import { bytesToBase64 } from "../estimating-sheet";
import { hostContextForTile, hostReviewContext } from "../takeoff/host-workflow";
import {
  HostSheetReadRequired,
  proposeSheetStep,
  sheetObservationsSchema,
} from "../takeoff/sheet-pass";
import { downloadMeasuredExport, exportMeasuredSheet } from "../takeoff/export";

const point = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
});
const depth = z.object({
  value: z.number().finite().positive(),
  unit: z.enum(["ft", "in", "m", "mm"]),
  source_id: z.string().uuid(),
  sheet: z.string().trim().min(1).max(80),
  detail: z.string().trim().min(1).max(300),
});
export const takeoffShape = z.object({
  kind: z.enum(["pins", "polyline", "polygon", "rect"]),
  points: z.array(point).min(1).max(1000),
  holes: z.array(z.array(point).min(3).max(1000)).max(100).optional(),
  depth: depth.optional(),
});
const scope = {
  job_number: z.string().trim().min(1).max(40),
  company_id: z.string().trim().min(1).max(200).optional(),
  source_id: z.string().uuid().optional(),
  sheet: z.string().trim().min(1).max(80).optional(),
};
const write = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

export const sheetCalibrate = defineTool({
  name: "sheet_calibrate",
  title: "Calibrate a stored drawing",
  description:
    "Reads the stored sheet's scale evidence or saves a calibration for a named plan/detail from two points and a known distance. Requires explicit confirmation of that reference. Different detail scales have separate regions. Recalibration keeps history and makes affected measurements proposals for review.",
  inputSchema: {
    ...scope,
    operation: z.enum(["read", "save"]).optional(),
    region: z.string().trim().min(1).max(100).optional(),
    bounds: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().positive().max(1),
        height: z.number().positive().max(1),
      })
      .optional(),
    reference: z
      .object({
        points: z.tuple([point, point]),
        distance: z.number().finite().positive(),
        unit: z.enum(["ft", "in", "m", "mm"]),
      })
      .optional(),
    confirm_reference: z.boolean().optional(),
    stated_scale: z.string().trim().min(1).max(120).optional(),
    confirm_true_size: z.boolean().optional(),
    expected_version: z.number().int().min(0).optional(),
  },
  annotations: write,
  handler: (args, ctx) =>
    run(
      "sheet_calibrate",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        try {
          const job = await resolveJob(sb, args.job_number, args.company_id, "write"),
            state = await requiredSnapshot(sb, job);
          if (!args.sheet) throw new ToolError("Name the sheet to inspect or calibrate.");
          const page = await loadStoredPage(sb, job, args.sheet, args.source_id);
          let saved;
          const automatic = automaticCalibration(page.space, page.inspection);
          if (
            args.operation !== "save" &&
            automatic &&
            !state.calibrations.some((c) => c.source_id === page.source.id && c.page === page.page)
          )
            saved = await saveCalibration(sb, job, page, automatic.calibration, 0);
          if (args.operation === "save") {
            if (
              (!args.reference && !args.stated_scale) ||
              !args.region ||
              args.expected_version == null ||
              args.confirm_reference !== true
            )
              throw new ToolError(
                "Choose two reference points, their known distance and plan/detail region, then confirm the reference before saving.",
              );
            saved = await saveCalibration(
              sb,
              job,
              page,
              args.stated_scale
                ? statedScaleCalibration(
                    page.space,
                    args.stated_scale,
                    args.region,
                    args.bounds ?? { x: 0, y: 0, width: 1, height: 1 },
                    args.confirm_true_size === true,
                  )
                : {
                    region: args.region,
                    bounds: args.bounds ?? { x: 0, y: 0, width: 1, height: 1 },
                    reference: args.reference!,
                    method: "estimator",
                    confidence: "high",
                    confirmed: true,
                  },
              args.expected_version,
            );
            await audit(sb, job, "sheet_calibrate", "save_sheet_calibration", args.region);
          }
          return viewEngine(sb, job, saved ? await requiredSnapshot(sb, job) : state, page, {
            saved_calibration: saved ?? null,
          });
        } catch (error) {
          if (error instanceof WhichCompanyAsk) throw error;
          const blocked = sheetAccessResult(error);
          if (blocked) return blocked;
          return errorCard(
            "Drawing calibration",
            errorMessage(error, "The calibration could not be confirmed."),
          );
        }
      },
    ),
});

export const takeoffGeometry = defineTool({
  name: "takeoff_geometry",
  title: "Measure and review a drawing takeoff",
  description:
    "Reconcile drawings, notes, specifications and contract using the returned project context and estimate_gap_analysis, distinguishing supported measurements, uncertain interpretations, missing scope and conflicts with citations and specific questions. " +
    "Locates and measures takeoff lines on an exact stored drawing. List opens Athena's measurement viewer. Scope confirms a named complete plan or room boundary for a count line without saving a quantity; counts need no scale. Confirm that area before Propose. Scope with line_nos confirms the same complete named area for several count lines in one call; it never accepts quantities. Propose without observations returns a target tile and reference images for the connected AI to inspect, with a pass_id and cursor. Propose with no line_no (or with line_nos) is a sheet read: the one target tile is returned with every open line that may appear on it, and the connected AI returns sheet_observations with that cursor and one entry per listed line, empty findings where nothing is visible; each line keeps its own pass and checkpoint, and lines not ready are listed with the reason. The connected AI returns observations on that TARGET TILE using x/y 0–1000, confidence and visible evidence, then calls Propose with the same pass_id/cursor and observations. Athena verifies physical locations, scope, kind and topology, computes quantities and advances the checkpoint; reported confidence is retained for review and never used as a rejection threshold. Project context is supplied at cursor 0; later targets return a bound context reference. Use reload_context true in a prepare call without observations if the context is missing or needs refreshing. No server-side AI service is used. For a dense target, split_region true returns four smaller images of only that pending region. Submit all four distinct observations.parts with part 0 to 3 and local image x/y 0–1000; Athena maps them to the original target and advances only after all four are returned. Review objects crossing split boundaries for repeated instances; coordinates alone cannot distinguish two nearby objects from two views of one object. Earlier checkpoints are retained. Only the target image is counted; reference images are orientation only. Empty findings means the AI inspected this target and found no instances, never that a tile can be skipped. Save records estimator-located pins, runs or areas as a review proposal; quantities are computed from geometry. Accept requires the estimator's explicit approval of the displayed revision. Reject keeps its reason and history. Tile returns a legible 200-dpi region; crop inspects a source-backed location. History reads immutable revisions; revise compares a corresponding newer source without accepting it. Accept_all confirms only the exact displayed revision list. Export creates a private dated geometry-derived PDF; download reopens a saved version. Never use an unlocated typed quantity as a measured takeoff.",
  inputSchema: {
    ...scope,
    operation: z
      .enum([
        "list",
        "history",
        "download",
        "save",
        "scope",
        "propose",
        "accept",
        "accept_all",
        "reject",
        "tile",
        "crop",
        "revise",
        "export",
      ])
      .optional(),
    markup_id: z.string().uuid().optional(),
    include_rejected: z.boolean().optional(),
    line_no: z.number().int().min(1).max(9999).optional(),
    shape: takeoffShape.optional(),
    count_area: z
      .object({
        name: z.string().trim().min(1).max(100),
        bounds: z.object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          width: z.number().positive().max(1),
          height: z.number().positive().max(1),
        }),
      })
      .optional(),
    calibration_id: z.string().uuid().optional(),
    geometry_id: z.string().uuid().optional(),
    expected_version: z.number().int().min(0).optional(),
    legend: z
      .object({
        source_id: z.string().uuid(),
        sheet: z.string().trim().min(1).max(80),
        tile_index: z.number().int().min(0),
      })
      .optional(),
    decisions: z
      .array(
        z.object({ geometry_id: z.string().uuid(), expected_version: z.number().int().positive() }),
      )
      .min(1)
      .max(200)
      .optional(),
    reason: z.string().trim().min(3).max(2000).optional(),
    confirm: z.boolean().optional(),
    crop_point: point.optional(),
    tile_index: z.number().int().min(0).optional(),
    observations: hostObservationsSchema.optional(),
    line_nos: z.array(z.number().int().min(1).max(9999)).min(1).max(200).optional(),
    sheet_observations: sheetObservationsSchema.optional(),
    split_region: z.boolean().optional(),
    reload_context: z.boolean().optional(),
    pass_id: z.string().uuid().optional(),
    cursor: z.number().int().min(0).optional(),
    depth: depth.optional(),
  },
  annotations: write,
  handler: (args, ctx) =>
    run(
      "takeoff_geometry",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        try {
          const job = await resolveJob(sb, args.job_number, args.company_id, "write"),
            state = await requiredSnapshot(sb, job);
          const operation = args.operation ?? "list";
          const extra: Record<string, unknown> = {
            include_rejected: args.include_rejected === true,
          };
          let source = args.source_id,
            sheet = args.sheet;
          if (operation === "accept" || operation === "reject") {
            if (!args.geometry_id || args.expected_version == null)
              throw new ToolError("Read the exact geometry and its revision before deciding.");
            if (operation === "accept" && args.confirm !== true)
              throw new ToolError(
                "Review the measured quantity and drawing highlight, then confirm that exact proposal before accepting.",
              );
            const row = state.geometry.find((g) => g.geometry_id === args.geometry_id);
            const passId = row?.evidence.pass_id;
            const checkpoint = state.passes.find((p) => p.pass_summary.pass_id === passId);
            if (
              operation === "accept" &&
              passId &&
              checkpoint &&
              checkpoint.pass_summary.complete !== true
            )
              throw new ToolError(
                "Finish Athena's sheet read before accepting its partial quantity.",
              );
            extra.saved_geometry = await decideGeometry(
              sb,
              job,
              state,
              {
                geometry_id: args.geometry_id,
                expected_version: args.expected_version,
                reason: args.reason,
              },
              operation,
            );
            source = row?.source_id ?? source;
            if (!sheet && row?.source_id && row.page) {
              const { drawingRecords } = await import("../drawing-set");
              sheet = (await drawingRecords(sb, job)).find((s) => s.id === row.source_id)?.sheets[
                row.page - 1
              ];
            }
          }
          const page = sheet ? await loadStoredPage(sb, job, sheet, source) : undefined;
          if (
            ["scope", "save", "propose", "tile", "crop", "revise", "export", "accept_all"].includes(
              operation,
            ) &&
            !page
          )
            throw new ToolError("Name the stored sheet and source for this measurement.");
          if (operation === "download") {
            if (!args.markup_id)
              throw new ToolError("Choose a dated measurement PDF from this job's history.");
            extra.export = await downloadMeasuredExport(sb, job, state, args.markup_id);
          } else if (operation === "history") {
            if (!args.geometry_id && !args.line_no)
              throw new ToolError("Choose a line or geometry reference for its dated history.");
            extra.history = await engineRpc(sb, "mcp_takeoff_history", {
              _job: job.job_id,
              _geometry: args.geometry_id ?? null,
              _line: args.line_no ?? null,
            });
          } else if (operation === "scope") {
            const lines = args.line_nos ?? (args.line_no ? [args.line_no] : []);
            if (!lines.length || !args.count_area)
              throw new ToolError(
                "Choose the count lines and confirm their complete named plan or room area.",
              );
            const passes = await saveCountAreas(
              sb,
              job,
              page!,
              state,
              lines,
              args.count_area,
              args.confirm === true,
            );
            extra.passes = passes;
            extra.pass = passes[0];
          } else if (operation === "accept_all") {
            if (args.confirm !== true || !args.decisions)
              throw new ToolError(
                "Confirm the exact displayed list of verified proposals before accepting the sheet.",
              );
            for (const decision of args.decisions) {
              const row = state.geometry.find(
                (g) =>
                  g.geometry_id === decision.geometry_id &&
                  g.version === decision.expected_version &&
                  g.source_id === page!.source.id &&
                  g.page === page!.page,
              );
              if (!row)
                throw new ToolError("The geometry changed. Reload the proposals before accepting.");
              assertReadComplete(state, row);
            }
            extra.accepted = await engineRpc(sb, "mcp_takeoff_accept_batch", {
              _job: job.job_id,
              _source: page!.source.id,
              _page: page!.page,
              _decisions: args.decisions,
            });
          } else if (operation === "save") {
            if (!args.shape || !args.line_no || args.expected_version == null)
              throw new ToolError(
                "Choose the current takeoff line, draw its geometry and supply the revision being edited.",
              );
            extra.saved_geometry = await saveGeometry(sb, job, page!, state, {
              line_no: args.line_no,
              shape: args.shape,
              calibration_id: args.calibration_id,
              geometry_id: args.geometry_id,
              expected_version: args.expected_version,
              reason: args.reason,
            });
          } else if (operation === "tile") {
            const tile = await readTile(sb, job, page!, args.tile_index ?? 0);
            const view = await viewEngine(sb, job, state, page, {
              tile: { ...tile.tile, png: tile.png },
            });
            return { ...view, content: [...view.content, tile.content] };
          } else if (operation === "revise") {
            if (!args.geometry_id || args.expected_version == null)
              throw new ToolError(
                "Choose the original geometry revision before checking its replacement drawing.",
              );
            extra.revision_comparison = await reviseGeometry(sb, job, page!, state, {
              geometry_id: args.geometry_id,
              expected_version: args.expected_version,
              calibration_id: args.calibration_id,
              confirm: args.confirm,
            });
          } else if (operation === "crop") {
            if (!args.crop_point) throw new ToolError("Choose a pin or vertex to inspect.");
            const crop = await readPointCrop(page!, args.crop_point);
            extra.crop = {
              point: args.crop_point,
              png: `data:image/png;base64,${bytesToBase64(crop)}`,
              edge: 160,
            };
          } else if (operation === "propose") {
            const locked = state.calibrations.some(
              (c) =>
                c.source_id === page!.source.id &&
                c.page === page!.page &&
                c.confirmed &&
                (!args.calibration_id || c.id === args.calibration_id),
            );
            if (!locked) return viewEngine(sb, job, state, page, { scale_required: true });
            if (args.reload_context && (args.observations || args.sheet_observations))
              throw new ToolError(
                "Reload the project context in a prepare call before submitting observations.",
              );
            if (!args.line_no || args.line_nos?.length || args.sheet_observations) {
              // A sheet read: every open line on one tile, one observation set back.
              if (args.observations)
                throw new ToolError(
                  "A sheet read takes sheet_observations with one entry per line, not single-line observations.",
                );
              try {
                extra.sheet_read = await proposeSheetStep(
                  sb,
                  job,
                  page!,
                  state,
                  { line_nos: args.line_nos, calibration_id: args.calibration_id },
                  args.sheet_observations,
                );
              } catch (error) {
                if (!(error instanceof HostSheetReadRequired)) throw error;
                const read = error.read;
                const included = read.cursor === 0 || args.reload_context === true;
                const reload = {
                  operation: "propose",
                  job_number: job.job_number,
                  company_id: job.company_id,
                  source_id: page!.source.id,
                  sheet: page!.sheet,
                  line_nos: read.lines.map((l) => l.line_no),
                  calibration_id: read.calibration_id ?? undefined,
                  reload_context: true,
                };
                const view = await viewEngine(sb, job, await requiredSnapshot(sb, job), page, {
                  sheet_read: {
                    cursor: read.cursor,
                    tiles_total: read.order.length,
                    lines: read.lines,
                    waiting: read.waiting,
                    skipped: read.skipped,
                  },
                  pass_paused: true,
                  pass_pause_reason:
                    "The sheet region is ready for your connected AI, for every open line at once. No proposal or quantity has been saved from it.",
                  read_request: {
                    kind: "sheet",
                    project_context_reference: {
                      job_id: job.job_id,
                      source_id: page!.source.id,
                      source_hash: page!.source.content_hash,
                      takeoff_version: state.takeoff_version,
                      initial_cursor: 0,
                      context_included: included,
                      reload,
                    },
                    ...(included
                      ? { project_context: await hostReviewContext(sb, job.job_id) }
                      : {}),
                    cursor: read.cursor,
                    tiles_total: read.order.length,
                    coordinate_system: "target-tile-image-0-1000",
                    target_tile: read.tile,
                    frame: {
                      sheet: page!.sheet,
                      tile_bounds: read.tile.bounds,
                      reference_bounds: read.reference_bounds,
                      region: { name: "union of the lines' regions", bounds: read.scope },
                    },
                    lines: read.lines.map((l) => ({
                      line_no: l.line_no,
                      item: l.item,
                      measure_type: l.measure_type,
                      pass_id: l.pass_id,
                      region: l.scope,
                      depth: l.depth,
                    })),
                    waiting: read.waiting.map((l) => ({
                      line_no: l.line_no,
                      next_cursor: l.next_cursor,
                    })),
                    skipped: read.skipped,
                    source_id: page!.source.id,
                    source_hash: page!.source.content_hash,
                    calibration_id: read.calibration_id,
                    takeoff_version: state.takeoff_version,
                    vector_text: read.hints,
                    submit: {
                      operation: "propose",
                      sheet_observations: {
                        cursor: read.cursor,
                        lines: read.lines.map((l) => ({
                          line_no: l.line_no,
                          pass_id: l.pass_id,
                          findings: [],
                          uncertainties: [],
                        })),
                      },
                    },
                  },
                });
                return {
                  ...view,
                  content: [
                    ...view.content,
                    {
                      type: "text" as const,
                      text:
                        "### Sheet read: target, lines and references\n\n```json\n" +
                        JSON.stringify(
                          (view.structuredContent as Record<string, unknown>).read_request,
                        ) +
                        "\n```",
                    },
                    {
                      type: "text" as const,
                      text: "Reference plan for orientation only; not the coordinate image.",
                    },
                    {
                      type: "image" as const,
                      mimeType: "image/png",
                      data: bytesToBase64(read.overview),
                    },
                    {
                      type: "text" as const,
                      text: `TARGET TILE ${read.cursor + 1} of ${read.order.length}. Inspect it once for every line listed under lines. Return sheet_observations with cursor ${read.cursor} and one entry per line (same pass_id), findings as x/y 0–1000 on this image, confidence and visible evidence; empty findings means inspected and none visible. Outside-scope pixels are masked white. Each line's own region still bounds what Athena keeps. Quantities remain proposals until estimator acceptance.`,
                    },
                    {
                      type: "image" as const,
                      mimeType: "image/png",
                      data: bytesToBase64(read.png),
                    },
                  ],
                };
              }
            } else {
              if (args.observations && (!args.pass_id || args.cursor == null))
                throw new ToolError(
                  "Prepare the exact target tile first, then return its pass_id, cursor and observations.",
                );
              try {
                extra.pass = await proposeTakeoffStep(
                  sb,
                  job,
                  page!,
                  state,
                  {
                    line_no: args.line_no,
                    calibration_id: args.calibration_id,
                    pass_id: args.pass_id,
                    cursor: args.cursor,
                    depth: args.depth,
                    legend: args.legend,
                  },
                  args.observations ? hostDrawingReader(args.observations) : undefined,
                );
              } catch (error) {
                if (!(error instanceof HostDrawingReadRequired) || !error.tile || !error.checkpoint)
                  throw error;
                const request = error.request;
                const parts = args.split_region ? splitHostTile(request.png) : null;
                const projectContext = await hostContextForTile(
                  sb,
                  job,
                  {
                    pass_id: String(error.checkpoint.pass_id),
                    cursor: Number(error.checkpoint.next_cursor),
                    line_no: args.line_no,
                    sheet: page!.sheet,
                    source_id: page!.source.id,
                    source_hash: page!.source.content_hash,
                    takeoff_version: state.takeoff_version,
                    calibration_id: args.calibration_id,
                  },
                  args.reload_context === true,
                );
                const view = await viewEngine(sb, job, await requiredSnapshot(sb, job), page, {
                  pass: error.checkpoint,
                  pass_paused: true,
                  pass_pause_reason:
                    "The target region is ready for your connected AI. No proposal or quantity has been saved from it.",
                  read_request: {
                    ...projectContext,
                    pass_id: error.checkpoint.pass_id,
                    cursor: error.checkpoint.next_cursor,
                    line_no: args.line_no,
                    item: state.lines.find((l) => l.line_no === args.line_no)?.item,
                    measure_type: request.measure_type,
                    target_tile: error.tile,
                    coordinate_system: parts ? "part-image-0-1000" : "target-tile-image-0-1000",
                    parts: parts?.map(({ part, frame }) => ({ part, frame })),
                    frame: request.frame,
                    source_id: page!.source.id,
                    source_hash: page!.source.content_hash,
                    calibration_id: args.calibration_id ?? null,
                    takeoff_version: state.takeoff_version,
                    vector_text: request.hints
                      .filter((h) => h.kind === "text" && h.text)
                      .slice(0, 80)
                      .map((h) => h.text!.slice(0, 300)),
                  },
                });
                return {
                  ...view,
                  content: [
                    ...view.content,
                    {
                      type: "text" as const,
                      text:
                        "### Target and project references\n\n```json\n" +
                        JSON.stringify(
                          (view.structuredContent as Record<string, unknown>).read_request,
                        ) +
                        "\n```",
                    },
                    ...(request.overview
                      ? [
                          {
                            type: "text" as const,
                            text: "Reference plan for orientation only; not the coordinate image.",
                          },
                          {
                            type: "image" as const,
                            mimeType: "image/png",
                            data: bytesToBase64(request.overview),
                          },
                        ]
                      : []),
                    ...(request.legend
                      ? [
                          { type: "text" as const, text: "Reference legend only; not counted." },
                          {
                            type: "image" as const,
                            mimeType: "image/png",
                            data: bytesToBase64(request.legend),
                          },
                        ]
                      : []),
                    ...(parts
                      ? parts.flatMap((part) => [
                          {
                            type: "text" as const,
                            text: `TARGET PART ${part.part}. Local coordinates x/y 0–1000. All four parts form the same pending region; references are not counted.`,
                          },
                          {
                            type: "image" as const,
                            mimeType: "image/png",
                            data: bytesToBase64(part.png),
                          },
                        ])
                      : [
                          {
                            type: "text" as const,
                            text: "TARGET TILE. Observations use x/y 0–1000 on this image only. Outside-scope pixels are masked white. Quantities remain proposals until estimator acceptance.",
                          },
                          {
                            type: "image" as const,
                            mimeType: "image/png",
                            data: bytesToBase64(request.png),
                          },
                        ]),
                  ],
                };
              }
            }
          } else if (operation === "export")
            extra.export = await exportMeasuredSheet(sb, job, page!, state);
          if (operation !== "list" && operation !== "crop")
            await audit(
              sb,
              job,
              "takeoff_geometry",
              `takeoff_geometry_${operation}`,
              args.line_no ? `T-${args.line_no}` : null,
            );
          return viewEngine(sb, job, await requiredSnapshot(sb, job), page, extra);
        } catch (error) {
          if (error instanceof WhichCompanyAsk) throw error;
          const blocked = sheetAccessResult(error);
          if (blocked) return blocked;
          return errorCard(
            "Drawing takeoff",
            errorMessage(
              error,
              "The drawing measurement could not be confirmed. Reload before retrying.",
            ),
          );
        }
      },
    ),
});
