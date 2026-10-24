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
import {
  HostDrawingReadRequired,
  hostDrawingReader,
  hostObservationsSchema,
  splitHostTile,
} from "../takeoff/vision";
import { proposeTakeoffStep, saveCountAreas } from "../takeoff/pass";
import { assertReadComplete } from "../takeoff/scope";
import { reviseGeometry } from "../takeoff/revision";
import {
  automaticCalibration,
  calibrationExpectedVersion,
  checkCalibrationDimensions,
  statedScaleCalibration,
} from "../takeoff/calibration";
import { calibrate } from "../takeoff/geometry";
import { readPointCrop } from "../takeoff/verify";
import { bytesToBase64 } from "../estimating-sheet";
import { hostContextForTile, hostReviewContext } from "../takeoff/host-workflow";
import {
  HostSheetReadRequired,
  proposeSheetStep,
  sheetObservationsSchema,
  sheetReadGroups,
  sheetBatchSchema,
  prepareSheetTargets,
  submitSheetBatch,
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
    dimension_checks: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(120),
          points: z.tuple([point, point]),
          distance: z.number().finite().positive(),
          unit: z.enum(["ft", "in", "m", "mm"]),
        }),
      )
      .min(1)
      .max(4)
      .optional(),
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
            const existing = state.calibrations.find(
              (c) =>
                c.source_id === page.source.id &&
                c.page === page.page &&
                c.region.trim().toLowerCase() === args.region?.trim().toLowerCase(),
            );
            const verificationOnly =
              !!args.dimension_checks &&
              !!existing?.confirmed &&
              !args.reference &&
              !args.stated_scale;
            if (
              (!args.reference && !args.stated_scale && !verificationOnly) ||
              !args.region ||
              args.confirm_reference === false ||
              !(
                verificationOnly ||
                args.confirm_reference === true ||
                (args.stated_scale && args.confirm_true_size === true)
              )
            )
              throw new ToolError(
                "Choose and confirm the scale reference and plan/detail region before saving; dimension checks can verify an existing confirmed scale without changing it.",
              );
            const expected = calibrationExpectedVersion(
              state.calibrations,
              page.source.id,
              page.page,
              args.region,
              args.expected_version,
            );
            let candidate = verificationOnly
              ? existing!
              : args.stated_scale
                ? statedScaleCalibration(
                    page.space,
                    args.stated_scale,
                    args.region,
                    args.bounds ?? { x: 0, y: 0, width: 1, height: 1 },
                    args.confirm_true_size === true,
                  )
                : calibrate(page.space, {
                    region: args.region,
                    bounds: args.bounds ?? { x: 0, y: 0, width: 1, height: 1 },
                    reference: args.reference!,
                    method: "estimator",
                    confidence: "high",
                    confirmed: true,
                    version: expected + 1,
                  });
            if (args.dimension_checks)
              candidate = checkCalibrationDimensions(page.space, candidate, args.dimension_checks);
            saved = await saveCalibration(sb, job, page, candidate, expected);
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
      },
    ),
});

export const takeoffGeometry = defineTool({
  name: "takeoff_geometry",
  title: "Measure and review a drawing takeoff",
  description:
    "Measures and reviews stored drawings using confirmed regional scales and host-supplied geometry, with up to three consecutive images for all ready line_nos per batch, resumable source-bound cursors, sheet_batch_observations submissions that return the next images, factual project context, per-proposal confidence, explicit estimator acceptance, immutable history and dated PDF exports; Athena validates locations and calculates quantities without a server-side model call.",
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
    sheet_batch_observations: sheetBatchSchema.optional(),
    batch_size: z.number().int().min(1).max(3).optional(),
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
          const job = await resolveJob(sb, args.job_number, args.company_id, "write");
          let state = await requiredSnapshot(sb, job);
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
            const calibrations = state.calibrations.filter(
              (c) => c.source_id === page!.source.id && c.page === page!.page && c.confirmed,
            );
            const calibrationId =
              args.calibration_id ?? (calibrations.length === 1 ? calibrations[0].id : undefined);
            const selectedLines = state.lines.filter((l) =>
              args.line_nos?.length
                ? args.line_nos.includes(l.line_no)
                : args.line_no
                  ? l.line_no === args.line_no
                  : l.sheet?.trim().toLowerCase() === page!.sheet.trim().toLowerCase(),
            );
            const countsOnly =
              selectedLines.length > 0 &&
              selectedLines.every((l) => /^(ea|each)$/i.test(l.unit ?? ""));
            if (!countsOnly && !calibrations.some((c) => c.id === calibrationId))
              return viewEngine(sb, job, state, page, {
                scale_required: true,
                calibration_question:
                  calibrations.length > 1
                    ? "Choose the saved calibration for this plan/detail; different scales cannot be combined."
                    : "Lock this plan/detail's scale before measuring lengths or areas.",
              });
            if (
              args.reload_context &&
              (args.observations || args.sheet_observations || args.sheet_batch_observations)
            )
              throw new ToolError(
                "Reload the project context in a prepare call before submitting observations.",
              );
            if (
              !args.line_no ||
              args.line_nos?.length ||
              args.sheet_observations ||
              args.sheet_batch_observations
            ) {
              const groups = sheetReadGroups(page!, state, {
                line_nos: args.line_nos,
                calibration_id: calibrationId,
              });
              const submitted = args.sheet_batch_observations?.[0] ?? args.sheet_observations;
              const readLineNos =
                args.line_nos ??
                (submitted
                  ? submitted.lines.map((l) => l.line_no)
                  : groups.length > 1
                    ? groups[0].line_nos
                    : undefined);
              extra.queued_sheet_groups = groups;
              // A sheet read: every open line on one tile, one observation set back.
              if (args.observations)
                throw new ToolError(
                  "A sheet read takes sheet_observations with one entry per line, not single-line observations.",
                );
              try {
                if (args.sheet_batch_observations && args.sheet_observations)
                  throw new ToolError("Use one observation format per request.");
                if (args.sheet_batch_observations) {
                  const batch = await submitSheetBatch(
                    sb,
                    job,
                    page!,
                    state,
                    { line_nos: readLineNos, calibration_id: calibrationId },
                    args.sheet_batch_observations,
                    () => requiredSnapshot(sb, job),
                  );
                  state = batch.state;
                  extra.saved_batch = batch.results;
                  if (batch.complete) return viewEngine(sb, job, state, page, extra);
                }
                extra.sheet_read = await proposeSheetStep(
                  sb,
                  job,
                  page!,
                  state,
                  { line_nos: readLineNos, calibration_id: calibrationId },
                  args.sheet_observations,
                );
                if (
                  args.sheet_observations &&
                  !(extra.sheet_read as { complete: boolean }).complete
                ) {
                  state = await requiredSnapshot(sb, job);
                  await proposeSheetStep(sb, job, page!, state, {
                    line_nos: readLineNos,
                    calibration_id: calibrationId,
                  });
                }
              } catch (error) {
                if (!(error instanceof HostSheetReadRequired)) throw error;
                const read = error.read;
                const targets = await prepareSheetTargets(page!, read, args.batch_size);
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
                  ...extra,
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
                    measurement_contract: {
                      linear:
                        "Visible local centerline spans are valid observations, including spans ending at a target boundary; Athena clips overlapping tiles so each span is measured once. The entire footing run need not fit in one tile.",
                      area: "A polygon or rectangle needs its whole closed boundary visible. An incomplete contour remains unresolved; empty findings are not a zero-area quantity. A complete outline assembled from the stored sheet can instead be recorded as a page-space geometry proposal with operation save, after reviewing its missing edges.",
                      count:
                        "Pins identify visible instances inside the confirmed region; tile overlap ownership prevents counting the same location twice.",
                    },
                    target_tile: read.tile,
                    targets: targets.map((t) => ({ cursor: t.cursor, tile: t.tile })),
                    batch_submit: {
                      operation: "propose",
                      job_number: job.job_number,
                      company_id: job.company_id,
                      source_id: page!.source.id,
                      sheet: page!.sheet,
                      calibration_id: read.calibration_id ?? undefined,
                      line_nos: read.lines.map((l) => l.line_no),
                      sheet_batch_observations: targets.map((t) => ({
                        cursor: t.cursor,
                        lines: read.lines.map((l) => ({
                          line_no: l.line_no,
                          pass_id: l.pass_id,
                          findings: [],
                          uncertainties: [],
                        })),
                      })),
                    },
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
                    ...targets.flatMap((target) => [
                      {
                        type: "text" as const,
                        text: `Target image · cursor ${target.cursor} · tile ${target.tile.index} · coordinates 0–1000 on this image. Confirmed region only; quantities remain proposals.`,
                      },
                      {
                        type: "image" as const,
                        mimeType: "image/png",
                        data: bytesToBase64(target.png),
                      },
                    ]),
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
                    calibration_id: calibrationId,
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
                    calibration_id: calibrationId,
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
                    calibration_id: calibrationId ?? null,
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
