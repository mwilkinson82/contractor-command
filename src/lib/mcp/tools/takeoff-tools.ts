import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run } from "../guard";
import { resolveJob, WhichCompanyAsk, audit } from "../jobs";
import { errorCard, errorMessage } from "../error-card";
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
import { proposeTakeoffBatch } from "../takeoff/pass";
import { reviseGeometry } from "../takeoff/revision";
import { automaticCalibration } from "../takeoff/calibration";
import { readPointCrop } from "../takeoff/verify";
import { bytesToBase64 } from "../estimating-sheet";
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
    expected_version: z.number().int().min(0).optional(),
  },
  annotations: write,
  handler: (args, ctx) =>
    run("sheet_calibrate", ctx, { jobNumber: args.job_number }, async (sb) => {
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
            !args.reference ||
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
            {
              region: args.region,
              bounds: args.bounds ?? { x: 0, y: 0, width: 1, height: 1 },
              reference: args.reference,
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
        return errorCard(
          "Drawing calibration",
          errorMessage(error, "The calibration could not be confirmed."),
        );
      }
    }),
});

export const takeoffGeometry = defineTool({
  name: "takeoff_geometry",
  title: "Measure and review a drawing takeoff",
  description:
    "Locates and measures takeoff lines on an exact stored drawing. List opens Athena's measurement viewer. Propose runs Athena's own bounded, resumable drawing read; it never accepts its own output. Save records estimator-located pins, runs or areas as a review proposal; quantities are computed from geometry. Accept requires the estimator's explicit approval of the displayed revision. Reject keeps its reason and history. Tile returns a legible 200-dpi region; crop inspects a source-backed location. History reads immutable revisions; revise compares a corresponding newer source without accepting it. Accept_all confirms only the exact displayed revision list. Export creates a private dated geometry-derived PDF; download reopens a saved version. Never use an unlocated typed quantity as a measured takeoff.",
  inputSchema: {
    ...scope,
    operation: z
      .enum([
        "list",
        "history",
        "download",
        "save",
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
    pass_id: z.string().uuid().optional(),
    cursor: z.number().int().min(0).optional(),
    depth: depth.optional(),
  },
  annotations: write,
  handler: (args, ctx) =>
    run("takeoff_geometry", ctx, { jobNumber: args.job_number }, async (sb) => {
      try {
        const job = await resolveJob(sb, args.job_number, args.company_id, "write"),
          state = await requiredSnapshot(sb, job);
        const operation = args.operation ?? "list";
        const extra: Record<string, unknown> = { include_rejected: args.include_rejected === true };
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
          ["save", "propose", "tile", "crop", "revise", "export", "accept_all"].includes(
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
        } else if (operation === "accept_all") {
          if (args.confirm !== true || !args.decisions)
            throw new ToolError(
              "Confirm the exact displayed list of verified proposals before accepting the sheet.",
            );
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
          if (!args.line_no)
            throw new ToolError("Choose the takeoff line Athena should locate on this sheet.");
          const deadline = Date.now() + 18000;
          let current = state,
            passId = args.pass_id,
            cursor = args.cursor;
          for (let batch = 0; batch < 12; batch++) {
            try {
              const progress = await proposeTakeoffBatch(sb, job, page!, current, {
                line_no: args.line_no,
                calibration_id: args.calibration_id,
                pass_id: passId,
                cursor,
                depth: args.depth,
                legend: args.legend,
                deadline,
              });
              extra.pass = progress;
              if (progress.complete || Date.now() > deadline - 4000) break;
              passId = String(progress.pass_id);
              cursor = Number(progress.next_cursor);
              current = await requiredSnapshot(sb, job);
            } catch (error) {
              if (!extra.pass) throw error;
              extra.pass_paused = true;
              extra.pass_pause_reason = errorMessage(
                error,
                "The next tile was not completed. Resume from the saved checkpoint.",
              );
              break;
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
        return errorCard(
          "Drawing takeoff",
          errorMessage(
            error,
            "The drawing measurement could not be confirmed. Reload before retrying.",
          ),
        );
      }
    }),
});
