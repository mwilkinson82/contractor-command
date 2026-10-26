import { EXAMPLE_LINE_RE } from "../takeoff/history";
import { TAKEOFF_MODEL_NOTICE, TAKEOFF_REVIEW_WORKFLOW } from "../takeoff/host-workflow";
import { drawingCardResultMeta } from "../cards/drawing-card";
import { verifyLocatedShape } from "../takeoff/verify";
import { saveTakeoffArtifact, artifactRecord } from "../takeoff/artifacts";
import { takeoffShape } from "./takeoff-tools";
import { engineSnapshot, measurementStatus, verifiedLines } from "../takeoff/state";
import {
  engineRpc,
  loadStoredPage,
  viewEngine,
  saveGeometry,
  requiredSnapshot,
} from "../takeoff/service";
import { measure } from "../takeoff/geometry";
import {
  appendMeasuredSheets,
  measurementExport,
  measuredSettlement,
} from "../takeoff/integration";
import { drawingFile, drawingWithFile } from "../drawing-file-input";
import { drawingUploadSecret, signDrawingUpload, verifyDrawingReceipt } from "../drawing-upload";
// Estimating role. Same gate as the other tools: run() checks auth, the call cap and the membership entitlement.
import { ToolError, defineTool, type JsonValueInput } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { BidError, requirementGaps, scanProject } from "../estimating-bid";
import {
  keepUnexplainedGaps,
  reviewEstimatorLines,
  type EstimatorLine,
} from "../estimating-method";
import {
  ESTIMATE_QUANTITY_REQUIRED,
  ESTIMATE_VIEW_SPEC,
  EstimateError,
  NOT_RELEVANT_ASK,
  assignGapRefs,
  conventionFor,
  intakeQuestions,
  normalizeScale,
  normalizeSchedules,
  alignGapsToTakeoff,
  autoGaps,
  bidCheckRefusal,
  checkBids,
  estimateLayout,
  formatQty,
  parseState,
  accountTakeoffLines,
  prepareGaps,
  prepareLines,
  preserveGapList,
  renderBidCheck,
  renderDocReview,
  renderExport,
  renderGaps,
  renderIntake,
  renderMark,
  renderStatus,
  renderSummary,
  renderTakeoff,
  reuseWarning,
  revisionUsed,
  settle,
  type Doc,
  type DocReview,
  type GapIn,
  type LineIn,
  type RateIn,
  type Setup,
  type StoredLine,
  type SubBid,
} from "../estimating";
import { errorCard, errorMessage } from "../error-card";
import { dbError, isMissingFunction, run, text, type Sb } from "../guard";
import {
  attachSheetPages,
  DRAWING_B64_MAX_CHARS,
  drawingTooBigMessage,
  drawingRecords,
  drawingOwned,
  DrawingSheetIndexRequired,
  sheetAccessResult,
  SheetPreviewUnavailable,
  withRevisionNotice,
  keepDrawingPaths,
  indexStoredDrawingSet,
  readStoredDrawingSet,
  loadSheetPages,
  storedSheet,
  sheetsForMarkup,
  storeDrawingSet,
  withDrawingPath,
  type DrawingUpload,
} from "../drawing-set";
import { bytesToBase64 } from "../estimating-sheet";
import {
  drawingMarkupCard,
  saveDrawingMarkup,
  savedDrawingAnnotations,
} from "../drawing-markup-render";
import { WhichCompanyAsk, audit, named, resolveJob } from "../jobs";
import { htmlBlock, renderMarkdown } from "../cards/markdown";
import { renderHtml } from "../cards/html";
import type { CardModel } from "../cards/model";
import { guide } from "../visible";

const jobNumber = z.string().trim().min(1).max(40);
const companyId = z.string().trim().min(1).max(200).optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const READ = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;
const SAVE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;
const MARK = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

export const TAKEOFF_MODES = ["upsert", "replace"] as const;
export const takeoffMode = z
  .preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    z.enum(TAKEOFF_MODES),
  )
  .optional();
const looseWord = z.union([z.string(), z.number(), z.boolean(), z.null()]).optional();
function lineLabel(line: { line_no?: number; item?: string }, index: number) {
  const n = line.line_no ?? index + 1;
  const desc = line.item?.trim() || "this line";
  return `Line ${n} (${desc})`;
}
const basis = z.enum([
  "measured",
  "deduced",
  "read",
  "derived",
  "MEASURED",
  "DEDUCED",
  "READ",
  "DERIVED",
]);
const checkKey = z.enum([
  "cf",
  "if",
  "fs",
  "fr",
  "fd",
  "tp",
  "cp",
  "ts",
  "td",
  "sg",
  "us",
  "ew",
  "pi",
  "pt",
  "fg",
  "bc",
  "bt",
  "dw",
  "kw",
  "ef",
]);
const qtyInput = z.object({
  name: z.any(),
  value: z.number().finite().nullable(),
  unit: z.string().trim().max(20).optional(),
  sheet: z.string().trim().max(80).optional(),
  detail: z.string().trim().max(80).optional(),
});
const lineIn = z.object({
  geometry: z
    .object({
      source_id: z.string().uuid(),
      shape: takeoffShape,
      calibration_id: z.string().uuid().optional(),
    })
    .optional(),
  line_no: z.number().int().min(1).max(9999).optional(),
  item: z.string().trim().min(1).max(200),
  material: z.string().trim().max(120).optional(),
  unit: z.string().trim().max(20).optional(),
  basis,
  op: z
    .enum(["product", "sum", "net", "quotient", "cy_from_area", "rebar_lb", "scale", "as_read"])
    .optional(),
  inputs: z.array(qtyInput).max(20).optional(),
  divisor: z.number().finite().positive().optional(),
  bar_size: z.string().trim().max(8).optional(),
  value: z.number().finite().nullable().optional(),
  qty: z.number().finite().nullable().optional(),
  range: z.string().trim().max(40).optional(),
  measure_type: z.enum(["count", "linear", "area", "volume"]).optional(),
  sheet: z.string().trim().min(1).max(80),
  detail: z.string().trim().max(80).optional(),
  spec_section: z.string().trim().max(80).optional(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  scale: z.string().trim().max(40).optional(),
  method: looseWord,
  markup_ref: z.string().trim().max(40).optional(),
  location_text: z.string().trim().max(200).optional(),
  missing_input: looseWord,
  exclusion: z.string().trim().max(300).optional(),
  checklist_key: checkKey.optional(),
  forms_faces: z.union([z.literal(1), z.literal(2)]).optional(),
  area_basis: z.enum(["net", "gross"]).optional(),
  element: z.string().trim().max(80).optional(),
  trade: z.string().trim().max(80).optional(),
  note: z.string().trim().max(500).optional(),
});
const takeoffLines = z
  .array(lineIn)
  .min(1)
  .max(400)
  .superRefine((lines, ctx) => {
    lines.forEach((line, i) => {
      const label = lineLabel(line, i);
      if (
        line.method != null &&
        (typeof line.method !== "string" || line.method.trim().length > 200)
      ) {
        ctx.addIssue({
          code: "custom",
          path: [i, "method"],
          message: `${label}: method must be plain words, at most 200 characters, or leave it off.`,
        });
      }
      if (
        line.missing_input != null &&
        (typeof line.missing_input !== "string" || line.missing_input.trim().length > 120)
      ) {
        ctx.addIssue({
          code: "custom",
          path: [i, "missing_input"],
          message: `${label}: the missing input must be plain words naming that one input, at most 120 characters, or leave it off.`,
        });
      }
      if (typeof line.value === "number" && line.value < 0) {
        ctx.addIssue({
          code: "custom",
          path: [i, "value"],
          message: `${label}: quantity has to be zero or more.`,
        });
      }
      (line.inputs ?? []).forEach((input, j) => {
        const name =
          typeof input.name === "string"
            ? input.name.trim()
            : input.name == null
              ? ""
              : String(input.name);
        if (name.length > 80) {
          ctx.addIssue({
            code: "custom",
            path: [i, "inputs", j, "name"],
            message: `${label}: the input name is longer than 80 characters.`,
          });
        }
        if (typeof input.value === "number" && input.value < 0) {
          ctx.addIssue({
            code: "custom",
            path: [i, "inputs", j, "value"],
            message: `${label}: quantity has to be zero or more.`,
          });
        }
      });
    });
  });
const doc = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(["base", "addendum", "sheet", "spec"]),
  revision: z.string().trim().max(40).optional(),
  date: date.optional(),
  sheets: z.array(z.string().trim().min(1).max(40)).max(400).optional(),
});
const drawingUpload = z
  .object({
    filename: z.string().trim().min(1).max(120).optional(),
    content_base64: z.string().max(DRAWING_B64_MAX_CHARS, drawingTooBigMessage()).optional(),
    file: z
      .object({
        download_url: z.string(),
        file_id: z.string(),
        mime_type: z.string().optional(),
        file_name: z.string().optional(),
      })
      .optional(),
    sheets: z.array(z.string().trim().min(1).max(40)).max(400).optional(),
    source_url: z.string().url().max(4096).optional(),
    staged_path: z.string().max(300).optional(),
    upload_receipt: z.string().max(2048).optional(),
  })
  .optional();
const bidLine = z.object({
  description: z.string().trim().min(1).max(300),
  qty: z.number().finite().nullable().optional(),
  unit: z.string().trim().max(20).optional(),
  amount: z.number().finite().nullable().optional(),
  exclusion: z.string().trim().max(500).optional(),
});
const subBid = z.object({
  sub: z.string().trim().min(1).max(160),
  trade: z.string().trim().min(1).max(80),
  total: z.number().finite().nullable().optional(),
  lines: z.array(bidLine).max(80).optional(),
});
const gapIn = z.object({
  ref: z.string().trim().max(12).optional(),
  kind: z.enum(["seen", "verify"]),
  category: z.enum([
    "missing_on_drawings",
    "conflict",
    "scale_or_dimension",
    "scope_seam",
    "allowance_or_alternate",
  ]),
  severity: z.enum(["hard", "soft", "cannot_know"]).optional(),
  title: z.string().trim().min(1).max(200),
  reasoning: z.string().trim().min(1).max(2000),
  sheet: z.string().trim().min(1).max(80),
  detail: z.string().trim().max(80).optional(),
  spec_section: z.string().trim().min(1).max(80),
  holds_bid: z.boolean().optional(),
  qty: z.number().finite().nullable().optional(),
  unit: z.string().trim().max(20).optional(),
  element: z.string().trim().max(80).optional(),
  line_no: z.number().int().min(1).max(9999).optional(),
});
const rateIn = z.object({
  line_no: z.number().int().min(1).max(9999).optional(),
  item: z.string().trim().max(200).optional(),
  trade: z.string().trim().max(80).optional(),
  system: z.string().trim().max(80).optional(),
  cost_type: z.enum(["labor", "material", "equipment", "sub", "other"]).optional(),
  rate: z.number().finite().min(0).nullable().optional(),
  bought: z.boolean().optional(),
});

type LineArg = z.infer<typeof lineIn>;
type BidArg = z.infer<typeof subBid>;

async function rpc<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (
    sb.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>
  )(fn, args);
  if (error && isMissingFunction(error))
    throw new ToolError("Estimating storage is not available yet. Nothing was changed.");
  if (error) dbError(error);
  return data as T;
}
const load = async (sb: Sb, jobId: string) =>
  parseState(await rpc(sb, "mcp_estimate_get", { _job: jobId }));

/** The version registry retains the source even if the legacy setup patch fails. Never delete a shared original. */
async function saveDrawing(
  sb: Sb,
  job: { company_id: string; job_id: string },
  documents: Doc[],
  drawing: DrawingUpload,
) {
  const stored = await storeDrawingSet(sb, job, drawing, documents);
  const next = withDrawingPath(documents, stored);
  await rpc(sb, "mcp_estimate_setup_save", { _job: job.job_id, _patch: { documents: next } });
  return { stored, documents: next };
}
const asBids = (rows: BidArg[]): SubBid[] =>
  rows.map((b) => ({
    sub: b.sub,
    trade: b.trade,
    total: b.total ?? null,
    lines: (b.lines ?? []).map((l) => ({
      description: l.description,
      qty: l.qty ?? null,
      unit: l.unit ?? null,
      amount: l.amount ?? null,
      exclusion: l.exclusion ?? null,
    })),
  }));
function dedupeGaps(rows: GapIn[]): GapIn[] {
  const seen = new Set<string>();
  const out: GapIn[] = [];
  for (const g of rows) {
    const key = `${g.title.trim()}|${g.sheet.trim()}|${g.spec_section.trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(g);
  }
  return out;
}
const asLine = (l: LineArg): LineIn => ({
  ...l,
  method: typeof l.method === "string" ? l.method.trim() : undefined,
  missing_input: typeof l.missing_input === "string" ? l.missing_input.trim() : undefined,
  value: l.value !== undefined ? l.value : l.qty !== undefined ? (l.qty ?? null) : null,
  inputs: l.inputs?.map((i) => ({
    name: typeof i.name === "string" ? i.name : String(i.name ?? ""),
    value: i.value,
    unit: i.unit ?? null,
    sheet: i.sheet ?? null,
    detail: i.detail ?? null,
  })),
});
function noEstimate(jobNumber: string) {
  const card: CardModel = {
    state: "progress",
    title: "No estimate on this job yet",
    job: jobNumber,
    sections: [
      {
        heading: "Estimate",
        kind: "list",
        rows: [{ cells: ["No estimate on this job yet."], tone: "unknown" }],
      },
    ],
    next_move: "Save the intake, then send the takeoff.",
  };
  const html = renderHtml(card);
  return guide(
    {
      ...text(`${renderMarkdown(card)}\n\n${htmlBlock(html)}`),
      structuredContent: { report: "Estimator loop", found: false, card, html },
    },
    "There is no estimate on this job yet. Do not say the call failed.",
  );
}
async function existingJobs(sb: Sb): Promise<string[]> {
  try {
    const { data, error } = await sb.from("mcp_jobs").select("job_number, name");
    if (error || !Array.isArray(data)) return [];
    return (data as { job_number?: string; name?: string | null }[])
      .filter((row) => row.job_number?.trim())
      .map((row) => `${row.job_number}${row.name ? ` (${row.name})` : ""}`);
  } catch {
    return [];
  }
}

function missingJobCard(jobNumber: string, detail: string, jobs: string[]) {
  const named = [...detail.matchAll(/job ([^()\s]+) \(([^)]+)\)/g)].map(
    (hit) => `${hit[1]} (${hit[2]})`,
  );
  const choices = [...new Set([...named, ...jobs])];
  const card: CardModel = {
    state: "ask",
    title: "Job isn't on file",
    job: jobNumber,
    ask: { prompt: `Create job ${jobNumber}, or pick an existing job?` },
    sections: [
      {
        heading: "Nothing was created",
        kind: "list",
        rows: [{ cells: [`Job ${jobNumber} is not on file. This save did not create it.`] }],
      },
      ...(choices.length
        ? [
            {
              heading: "Existing jobs",
              kind: "list" as const,
              rows: choices.map((job) => ({ cells: [job], tone: "action" as const })),
            },
          ]
        : []),
    ],
    next_move: `Say yes to create ${jobNumber}, or name the job to use. Nothing was saved.`,
  };
  const html = renderHtml(card);
  return guide(
    {
      ...text(`${renderMarkdown(card)}\n\n${htmlBlock(html)}`),
      structuredContent: { report: "Takeoff", found: false, created: false, card, html },
    },
    "Nothing was created. Do not create the job unless the member says yes. If they name a different job, save the takeoff on that job.",
  );
}

function emptyTakeoff(label: string) {
  return guide(
    {
      ...text(
        [
          ESTIMATE_QUANTITY_REQUIRED,
          ...ESTIMATE_VIEW_SPEC,
          "Report: Takeoff",
          `${label} · Takeoff`,
          "No takeoff is saved for this job yet.",
        ].join("\n"),
      ),
      structuredContent: { report: "Takeoff", found: false, layout: estimateLayout() },
    },
    "No takeoff yet. Compute DEDUCED quantities from MEASURED inputs when the lines are sent.",
  );
}
function reply(view: { text: string; structured: Record<string, unknown>; guidance: string[] }) {
  return guide(
    { ...text(view.text), structuredContent: view.structured as unknown as JsonValueInput },
    ...view.guidance,
  );
}
function caught(e: unknown): never {
  if (e instanceof EstimateError || e instanceof BidError) throw new ToolError(e.message);
  throw e;
}

async function savedProfileRecord(
  sb: Sb,
  jobId: string,
): Promise<{ profile: "as_drawn" | "estimator"; forms_faces: 1 | 2 } | null> {
  try {
    const data = await rpc<{ found?: boolean; profile?: string; forms_faces?: number }>(
      sb,
      "mcp_estimate_profile_get",
      {
        _job: jobId,
      },
    );
    if (data?.profile !== "as_drawn" && data?.profile !== "estimator") return null;
    return { profile: data.profile, forms_faces: data.forms_faces === 2 ? 2 : 1 };
  } catch (e) {
    if (e instanceof ToolError && /not available/.test(e.message)) return null;
    throw e;
  }
}
async function savedProfile(sb: Sb, jobId: string): Promise<"as_drawn" | "estimator" | null> {
  return (await savedProfileRecord(sb, jobId))?.profile ?? null;
}

async function sameNameTakeoffs(
  sb: Sb,
  job: { job_id: string; company_id: string; name: string },
): Promise<{ jobNumber: string; jobName: string }[]> {
  const want = job.name.trim().toLowerCase();
  if (!want) return [];
  try {
    const jobs = await sb
      .from("mcp_jobs")
      .select("id, job_number, name")
      .eq("company_id", job.company_id);
    if (jobs.error || !Array.isArray(jobs.data)) return [];
    const others = (jobs.data as { id: string; job_number: string; name: string | null }[]).filter(
      (row) => row.id !== job.job_id && (row.name ?? "").trim().toLowerCase() === want,
    );
    const out: { jobNumber: string; jobName: string }[] = [];
    for (const other of others) {
      const takes = await sb
        .from("mcp_estimate_takeoffs")
        .select("id")
        .eq("job_id", other.id)
        .limit(1);
      if (!takes.error && Array.isArray(takes.data) && takes.data.length)
        out.push({ jobNumber: other.job_number, jobName: other.name ?? job.name });
    }
    return out;
  } catch {
    return [];
  }
}

export const estimateIntake = defineTool({
  name: "estimate_intake",
  title: "Estimating intake",
  description:
    "Starts estimating, confirms role and scope, warns before reusing a saved takeoff, stores supplied drawings and prepares a cited drawing/specification/contract review through estimate_doc_review and estimate_gap_analysis.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    role: z.enum(["gc", "self_performer"]).optional(),
    profile: z.enum(["as_drawn", "estimator"]).optional(),
    reuse: z.enum(["reuse", "fresh"]).optional(),
    trades: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
    bid_due: date.optional(),
    delivery_method: z.string().trim().max(80).optional(),
    documents: z.array(doc).max(200).optional(),
    sub_bids: z.array(subBid).max(40).optional(),
    workbook_note: z.string().trim().max(300).optional(),
    in_scope: z.array(z.string().trim().min(1).max(200)).max(40).optional(),
    out_scope: z.array(z.string().trim().min(1).max(200)).max(40).optional(),
    assumptions: z.array(z.string().trim().min(1).max(300)).max(40).optional(),
    forms_faces: z.union([z.literal(1), z.literal(2)]).optional(),
    drawing: drawingUpload,
    file: drawingFile,
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("estimate_intake", ctx, { jobNumber: args.job_number, companyId: args.company_id }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id, "write");
      const prior = await load(sb, job.job_id);
      const profileOnFile = await savedProfileRecord(sb, job.job_id);
      const sameName = await sameNameTakeoffs(sb, job);
      const warning = reuseWarning({
        jobNumber: job.job_number,
        jobName: job.name,
        lines: prior.lines.length,
        version: prior.version,
        sameName,
      });
      if (warning && !args.reuse) {
        const pending = intakeQuestions({
          role: args.role ?? prior.setup.role,
          trades: args.trades ?? prior.setup.trades,
          in_scope: args.in_scope ?? prior.setup.in_scope,
          profile: args.profile ?? profileOnFile?.profile ?? null,
          forms_faces: args.forms_faces ?? profileOnFile?.forms_faces ?? null,
        });
        return reply({
          text: [TAKEOFF_MODEL_NOTICE, warning, ...pending.map((q) => `- ${q}`)].join("\n"),
          structured: {
            complete: false,
            reused: false,
            saved: false,
            model_selection: TAKEOFF_MODEL_NOTICE,
            review_workflow: TAKEOFF_REVIEW_WORKFLOW,
          },
          guidance: [
            "Ask reuse or fresh before using the takeoff on file. Do not assume self-performer.",
          ],
        });
      }
      let documents: Doc[] = args.documents
        ? keepDrawingPaths(args.documents as Doc[], prior.setup.documents)
        : prior.setup.documents;
      let drawingName = "";
      const drawing = drawingWithFile(args.drawing, args.file);
      if (drawing) {
        const saved = await saveDrawing(sb, job, documents, drawing);
        documents = saved.documents;
        drawingName = saved.stored.name;
      }
      const setup: Setup = {
        role: args.role ?? prior.setup.role,
        trades: args.trades ?? prior.setup.trades,
        bid_due: args.bid_due ?? prior.setup.bid_due,
        delivery_method: args.delivery_method ?? prior.setup.delivery_method,
        documents,
        sub_bids: args.sub_bids ? asBids(args.sub_bids) : prior.setup.sub_bids,
        workbook_note: args.workbook_note ?? prior.setup.workbook_note,
        in_scope: args.in_scope ?? prior.setup.in_scope,
        out_scope: args.out_scope ?? prior.setup.out_scope,
        assumptions: args.assumptions ?? prior.setup.assumptions,
        doc_review: prior.setup.doc_review,
        summary_version: prior.setup.summary_version,
      };
      const profile = args.profile ?? profileOnFile?.profile ?? null;
      const forms = args.forms_faces ?? profileOnFile?.forms_faces ?? null;
      const patch: Record<string, unknown> = {};
      if (args.role) patch.role = args.role;
      if (args.trades) patch.trades = args.trades;
      if (args.bid_due) patch.bid_due = args.bid_due;
      if (args.delivery_method) patch.delivery_method = args.delivery_method;
      if (args.documents && !drawing) patch.documents = documents;
      if (args.sub_bids) patch.sub_bids = asBids(args.sub_bids);
      if (args.workbook_note) patch.workbook_note = args.workbook_note;
      if (args.in_scope) patch.in_scope = args.in_scope;
      if (args.out_scope) patch.out_scope = args.out_scope;
      if (args.assumptions) patch.assumptions = args.assumptions;
      if (Object.keys(patch).length)
        await rpc(sb, "mcp_estimate_setup_save", { _job: job.job_id, _patch: patch });
      if (args.profile || args.forms_faces)
        await rpc(sb, "mcp_estimate_profile_save", {
          _job: job.job_id,
          _profile: profile ?? "as_drawn",
          _faces: forms ?? 1,
        }).catch((e: unknown) => {
          if (e instanceof ToolError && /not available/.test(e.message)) return null;
          throw e;
        });
      await audit(sb, job, "estimate_intake", "save_estimate_intake", null);
      const view = renderIntake(`${named(job)}`, setup, profile, forms);
      const fresh =
        args.reuse === "fresh"
          ? prior.lines.length
            ? "Start fresh. The old takeoff stays until a replace save."
            : "Start fresh. Nothing was copied from the other job."
          : args.reuse === "reuse"
            ? prior.lines.length
              ? "Reuse confirmed. The takeoff on file stays."
              : "Reuse confirmed. Nothing was copied onto this job. The other takeoff stays where it is."
            : "";
      const drawingLine = drawingName ? `Drawing set stored: ${drawingName}.` : "";
      const lead = [TAKEOFF_MODEL_NOTICE, fresh, drawingLine].filter(Boolean).join("\n");
      return reply({
        ...view,
        text: lead ? `${lead}\n${view.text}` : view.text,
        structured: {
          ...view.structured,
          reuse: args.reuse ?? null,
          model_selection: TAKEOFF_MODEL_NOTICE,
          review_workflow: TAKEOFF_REVIEW_WORKFLOW,
        },
      });
    }),
});

export const estimateDocReview = defineTool({
  name: "estimate_doc_review",
  title: "Estimating document review",
  description: "Saves the sheet index, revisions and spec-versus-drawing list for a job.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    sheets: z
      .array(
        z.object({
          sheet: z.string().trim().min(1).max(80),
          title: z.string().trim().min(1).max(200),
          revision: z.string().trim().max(40).optional(),
          date: date.optional(),
          scale: z.string().trim().max(40).optional(),
          notes: z.array(z.string().trim().max(500)).max(40).optional(),
          schedules: z.any().optional(),
        }),
      )
      .max(400),
    specs: z
      .array(
        z.object({
          section: z.string().trim().min(1).max(40),
          title: z.string().trim().min(1).max(200),
          part1: z.string().trim().max(1000).optional(),
          part2: z.string().trim().max(1000).optional(),
          part3: z.string().trim().max(1000).optional(),
        }),
      )
      .max(200),
    pairs: z
      .array(
        z.object({
          spec_section: z.string().trim().min(1).max(40),
          requirement: z.string().trim().min(1).max(500),
          sheet: z.string().trim().min(1).max(80),
          detail: z.string().trim().max(80).optional(),
          drawing_shows: z.string().trim().max(500).optional(),
        }),
      )
      .max(200),
    context: z.string().trim().max(1000).optional(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("estimate_doc_review", ctx, { jobNumber: args.job_number, companyId: args.company_id }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id, "write");
      const prior = await load(sb, job.job_id);
      const review: DocReview = {
        sheets: args.sheets.map((s) => ({ ...s, schedules: normalizeSchedules(s.schedules) })),
        specs: args.specs,
        pairs: args.pairs,
        context: args.context ?? null,
      };
      await rpc(sb, "mcp_estimate_setup_save", {
        _job: job.job_id,
        _patch: { doc_review: review },
      });
      await audit(sb, job, "estimate_doc_review", "save_estimate_doc_review", null);
      const view = renderDocReview(`${named(job)}`, review, prior.setup.documents);
      return reply(view);
    }),
});

/** "Tire seal pit - EXAMPLE", "EXAMPLE: footing", "(sample)". A word, not a substring: "sampler" is fine. */
export { EXAMPLE_LINE_RE } from "../takeoff/history";
export const estimateTakeoffSave = defineTool({
  name: "estimate_takeoff_save",
  title: "Save a takeoff",
  description:
    "Saves takeoff lines with mode upsert, the default, or mode replace, and stores a drawing PDF when one is sent.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    revision: z.string().trim().max(120).optional(),
    scales: z
      .array(
        z.object({
          sheet: z.string().trim().min(1).max(80),
          scale: z.any(),
          source: z.enum(["title_block", "dimensioned_string"]).optional(),
        }),
      )
      .max(200)
      .optional(),
    profile: z.enum(["as_drawn", "estimator"]).optional(),
    forms_faces: z.union([z.literal(1), z.literal(2)]).optional(),
    mode: takeoffMode,
    lines: takeoffLines,
    drawing: drawingUpload,
    file: drawingFile,
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("estimate_takeoff_save", ctx, { jobNumber: args.job_number, companyId: args.company_id }, async (sb) => {
      let committed = false;
      try {
        let job;
        try {
          job = await resolveJob(sb, args.job_number, args.company_id, "write");
        } catch (e) {
          const message = e instanceof Error ? e.message : "";
          if (/No job /i.test(message))
            return missingJobCard(args.job_number, message, await existingJobs(sb));
          throw e;
        }
        const drawing = drawingWithFile(args.drawing, args.file);
        const mode = args.mode ?? "upsert";
        // Placeholder lines never reach a job's takeoff: they pad the drawing lines and survive into the bid.
        const examples = args.lines.filter((l) => EXAMPLE_LINE_RE.test(l.item ?? ""));
        if (examples.length)
          throw new ToolError(
            `Example lines are not saved on a job: ${examples
              .slice(0, 5)
              .map((l) => `"${l.item}"`)
              .join(
                ", ",
              )}${examples.length > 5 ? ` and ${examples.length - 5} more` : ""}. Remove the EXAMPLE tag, or leave the line out. Nothing was saved.`,
          );
        const prior = await load(sb, job.job_id);
        const saved = await savedProfileRecord(sb, job.job_id);
        const convention = conventionFor(
          args.profile ?? saved?.profile ?? "as_drawn",
          args.forms_faces ?? saved?.forms_faces,
        );
        if (args.profile)
          await rpc(sb, "mcp_estimate_profile_save", {
            _job: job.job_id,
            _profile: args.profile,
            _faces: args.forms_faces ?? convention.forms_faces,
          }).catch((e: unknown) => {
            if (e instanceof ToolError && /not available/.test(e.message)) return null;
            throw e;
          });
        if (args.lines.filter((l) => l.geometry).length > 20)
          throw new ToolError(
            "Save up to 20 located lines at a time so every point can be checked against the drawing.",
          );
        const beforeGeometry = await engineSnapshot(sb, job.job_id);
        const located = new Map<
          number,
          {
            page: Awaited<ReturnType<typeof loadStoredPage>>;
            geometry: NonNullable<(typeof args.lines)[number]["geometry"]>;
            qty: number;
          }
        >();
        const inputs = await Promise.all(
          args.lines.map(async (line, index) => {
            if (!line.geometry) return asLine(line);
            if (!beforeGeometry)
              throw new ToolError(
                "Drawing measurement storage is unavailable. No geometry was saved.",
              );
            if (!line.line_no)
              throw new ToolError("A located line needs its stable line_no before saving.");
            if (
              beforeGeometry.geometry.some(
                (g) =>
                  g.line_id === beforeGeometry.lines.find((l) => l.line_no === line.line_no)?.id &&
                  g.status !== "rejected",
              )
            )
              throw new ToolError(
                "This line already has geometry. Edit its exact revision with takeoff_geometry before changing its measured record.",
              );
            const page = await loadStoredPage(sb, job, line.sheet, line.geometry.source_id);
            const cal = beforeGeometry.calibrations.find(
              (c) =>
                c.id === line.geometry!.calibration_id &&
                c.source_id === page.source.id &&
                c.page === page.page,
            );
            const measured = measure(page.space, line.geometry.shape, cal);
            await verifyLocatedShape(page, line.geometry.shape);
            const depth = line.geometry.shape.depth;
            if (
              depth &&
              !(await drawingRecords(sb, job)).some(
                (s) => s.id === depth.source_id && s.sheets.includes(depth.sheet),
              )
            )
              throw new ToolError("The depth must cite a stored sheet on this job.");
            if (
              line.measure_type &&
              { count: "EA", linear: "LF", area: "SF", volume: "CY" }[line.measure_type] !==
                measured.unit
            )
              throw new ToolError("Geometry must match the line measurement type.");
            if (
              line.unit &&
              ![
                measured.unit,
                measured.unit === "EA" ? "EACH" : measured.unit === "LF" ? "FT" : measured.unit,
              ].includes(line.unit.toUpperCase())
            )
              throw new ToolError("Geometry and takeoff line units must match.");
            located.set(line.line_no, { page, geometry: line.geometry, qty: measured.value });
            return asLine({
              ...line,
              qty: measured.value,
              value: measured.value,
              unit: measured.unit,
              op: "as_read",
              inputs: [],
              missing_input: "estimator acceptance of geometry",
              note: (
                (line.note || "") + " Supplied quantity ignored; computed from geometry."
              ).trim(),
            });
          }),
        );
        const account = accountTakeoffLines(inputs, convention, prior.lines, mode);
        for (const line_no of located.keys())
          if (
            account.rejected.some((r) => r.line_no === line_no) ||
            !account.lines.some((l) => l.line_no === line_no)
          )
            throw new ToolError(
              `Line ${line_no} was rejected. Its geometry was not saved; correct that takeoff line first.`,
            );
        const revision = args.revision ?? revisionUsed(prior.setup.documents);
        const scales = (args.scales ?? []).map((s) => ({ ...s, scale: normalizeScale(s.scale) }));
        let drawingName = "";
        const rememberDrawing = async () => {
          if (!drawing) return;
          const saved = await saveDrawing(sb, job, prior.setup.documents, drawing);
          drawingName = saved.stored.name;
        };
        if (account.saved === 0) {
          await rememberDrawing();
          if (beforeGeometry)
            return viewEngine(sb, job, await requiredSnapshot(sb, job), undefined, {
              report_title: drawingName ? "Drawing stored; takeoff review" : "Takeoff not changed",
              report_rows: account.statuses.map((r) => `L${r.line_no} · ${r.item} · ${r.status}`),
              save_account: account,
            });
          const state = settle(prior.lines, prior.gaps, prior.verdicts, {
            role: prior.setup.role,
            trades: prior.setup.trades,
          });
          const view = renderTakeoff(
            `${named(job)}`,
            prior.lines,
            state,
            revision,
            undefined,
            account,
          );
          return reply({
            ...view,
            text: drawingName ? `Drawing set stored: ${drawingName}.\n${view.text}` : view.text,
          });
        }
        if (beforeGeometry) {
          const geometries = [];
          for (const [line_no, entry] of located) {
            const evidence = await verifyLocatedShape(entry.page, entry.geometry.shape);
            geometries.push({
              line_no,
              shape: entry.geometry.shape,
              calibration_id: entry.geometry.calibration_id,
              source_id: entry.page.source.id,
              page: entry.page.page,
              width: entry.page.space.width,
              height: entry.page.space.height,
              evidence,
            });
          }
          await engineRpc(sb, "mcp_takeoff_write", {
            _job: job.job_id,
            _revision: revision,
            _scales: scales,
            _lines: account.lines,
            _geometries: geometries,
            _expected: beforeGeometry.takeoff_version ?? 0,
          });
        } else
          await rpc(sb, "mcp_estimate_takeoff_save", {
            _job: job.job_id,
            _revision: revision,
            _scales: scales,
            _lines: account.lines,
          });
        committed = true;
        await rememberDrawing();
        const loaded = await load(sb, job.job_id);
        const measurement = await engineSnapshot(sb, job.job_id);
        if (measurement) {
          await audit(sb, job, "estimate_takeoff_save", "save_estimate_takeoff", null);
          return viewEngine(sb, job, measurement, located.values().next().value?.page, {
            report_title: "Takeoff saved",
            save_account: account,
            report_rows: [
              ...(located.size
                ? [
                    "Supplied quantities for located lines were ignored. The proposals were calculated from their drawing geometry and still require estimator approval.",
                  ]
                : []),
              ...account.statuses.map((r) => `L${r.line_no} · ${r.item} · ${r.status}`),
            ],
          });
        }
        const state = settle(loaded.lines, loaded.gaps, loaded.verdicts, {
          role: loaded.setup.role,
          trades: loaded.setup.trades,
        });
        await audit(sb, job, "estimate_takeoff_save", "save_estimate_takeoff", null);
        const view = renderTakeoff(
          `${named(job)}`,
          loaded.lines,
          state,
          loaded.revision,
          mode,
          account,
        );
        return reply({
          ...view,
          text: drawingName ? `Drawing set stored: ${drawingName}.\n${view.text}` : view.text,
          structured: { ...view.structured, version: loaded.version, created: false },
        });
      } catch (e) {
        if (e instanceof WhichCompanyAsk) throw e;
        if (committed) {
          const partial = errorCard(
            "Takeoff saved; follow-up needs a retry",
            "The takeoff was saved, but its drawing import or follow-up could not be confirmed. Reload the takeoff and stored source library before retrying.",
          );
          return {
            ...partial,
            structuredContent: {
              ...partial.structuredContent,
              takeoff_saved: true,
              followup_confirmed: false,
            },
          };
        }
        const blocked = sheetAccessResult(e);
        if (blocked) return blocked;
        return errorCard("Takeoff", errorMessage(e, "The takeoff could not be saved."));
      }
    }),
});

export const estimateTakeoffGet = defineTool({
  name: "estimate_takeoff_get",
  title: "Read a takeoff",
  description:
    "Returns the saved takeoff for a job and includes a stored drawing page when a sheet is named or a line names a markup.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    sheet: z.string().trim().min(1).max(80).optional(),
    source_id: z.string().uuid().optional(),
  },
  annotations: READ,
  handler: (args, ctx) =>
    run("estimate_takeoff_get", ctx, { jobNumber: args.job_number, companyId: args.company_id }, async (sb) => {
      try {
        const job = await resolveJob(sb, args.job_number, args.company_id, "write");
        const loaded = await load(sb, job.job_id);
        await audit(sb, job, "estimate_takeoff_get", "view_estimate_takeoff", null);
        const measurement = await engineSnapshot(sb, job.job_id);
        if (measurement)
          return viewEngine(
            sb,
            job,
            measurement,
            args.sheet ? await loadStoredPage(sb, job, args.sheet, args.source_id) : undefined,
          );
        const withPages = async <R extends { content?: { type: string; text?: string }[] }>(
          result: R,
          lines: { sheet?: string | null; markup_ref?: string | null }[],
        ) => {
          const requested = sheetsForMarkup({ sheet: args.sheet, lines });
          if (!requested.length) return result;
          const pages = await loadSheetPages(
            sb,
            { company_id: job.company_id, job_id: job.job_id },
            loaded.setup.documents,
            requested,
          );
          return pages.length ? attachSheetPages(result, pages) : result;
        };
        if (!loaded.version) return withPages(emptyTakeoff(`${named(job)}`), []);
        const state = settle(loaded.lines, loaded.gaps, loaded.verdicts, {
          role: loaded.setup.role,
          trades: loaded.setup.trades,
        });
        const view = renderTakeoff(`${named(job)}`, loaded.lines, state, loaded.revision);
        return withPages(
          reply({
            ...view,
            structured: { ...view.structured, found: true, version: loaded.version },
          }),
          loaded.lines,
        );
      } catch (e) {
        if (e instanceof WhichCompanyAsk) throw e;
        const blocked = sheetAccessResult(e);
        if (blocked) return blocked;
        return errorCard("Takeoff", errorMessage(e, "The takeoff could not be read."));
      }
    }),
});

export const estimateTakeoffExport = defineTool({
  name: "estimate_takeoff_export",
  title: "Export a takeoff",
  description: "Exports the saved takeoff as CSV or a workbook layout.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    format: z.enum(["csv", "workbook"]).optional(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("estimate_takeoff_export", ctx, { jobNumber: args.job_number, companyId: args.company_id }, async (sb) => {
      try {
        const job = await resolveJob(sb, args.job_number, args.company_id, "write");
        const loaded = await load(sb, job.job_id);
        if (!loaded.lines.length)
          return errorCard(
            "Takeoff",
            "No takeoff is saved for this job yet. Nothing was exported.",
          );
        await audit(sb, job, "estimate_takeoff_export", "export_estimate_takeoff", null);
        const measurement = await engineSnapshot(sb, job.job_id);
        const links: Record<string, string> = {};
        if (measurement) {
          const refs = [
            ...new Set(
              measurement.geometry
                .filter(
                  (g) =>
                    g.source_id && g.page && g.status !== "rejected" && g.status !== "not_drawable",
                )
                .map((g) => `${g.source_id}:${g.page}`),
            ),
          ];
          const sources = await drawingRecords(sb, job);
          for (const ref of refs) {
            const [source_id, n] = ref.split(":"),
              sheet = sources.find((s) => s.id === source_id)?.sheets[Number(n) - 1];
            if (!sheet)
              throw new ToolError(
                "A measured sheet is unavailable. No incomplete takeoff export was returned.",
              );
            const exported = await (
              await import("../takeoff/export")
            ).exportMeasuredSheet(
              sb,
              job,
              await loadStoredPage(sb, job, sheet, source_id),
              measurement,
            );
            if (!exported.png_url)
              throw new ToolError(
                "The private sheet link could not be created. Retry the export without changing the original.",
              );
            links[ref] = exported.png_url;
          }
        }
        const view = measurement
          ? measurementExport(named(job), loaded.lines, measurement, args.format ?? "csv", links)
          : renderExport(`${named(job)}`, loaded.lines, args.format ?? "csv");
        if (measurement) {
          const csv = String(view.structured.csv ?? ""),
            spreadsheet = view.structured.spreadsheet as { xlsx_base64: string };
          const csvFile = await saveTakeoffArtifact(
            sb,
            job,
            `Takeoff-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`,
            new TextEncoder().encode(csv),
            "text/csv",
          );
          const book = await saveTakeoffArtifact(
            sb,
            job,
            `Takeoff-${new Date().toISOString().replace(/[:.]/g, "-")}.xlsx`,
            Uint8Array.from(atob(spreadsheet.xlsx_base64), (c) => c.charCodeAt(0)),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          );
          return viewEngine(sb, job, measurement, undefined, {
            report_title: "Measured takeoff export",
            takeoff_export: view.structured,
            downloads: [csvFile, book],
          });
        }
        return reply(view);
      } catch (e) {
        if (e instanceof WhichCompanyAsk) throw e;
        const blocked = sheetAccessResult(e);
        if (blocked) return blocked;
        return errorCard("Takeoff", errorMessage(e, "The takeoff could not be exported."));
      }
    }),
});

export const estimateGapAnalysis = defineTool({
  name: "estimate_gap_analysis",
  title: "Estimate gap analysis",
  description:
    "Reconciles the host AI's takeoff with drawings, notes, specifications, contract and agreed scope, saving cited findings and estimator questions that distinguish supported quantities from uncertain readings, missing requirements, conflicts and unavailable context without back-solving quantities or treating confidence as measured accuracy.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    items: z.array(gapIn).max(200),
    estimator_lines: z
      .array(
        z.object({
          item: z.string().trim().min(1).max(200),
          qty: z.number().finite().nullable().optional(),
          unit: z.string().trim().max(20).optional(),
          note: z.string().trim().max(1000).optional(),
          sheet: z.string().trim().max(80).optional(),
          detail: z.string().trim().max(80).optional(),
          callout: z.string().trim().max(300).optional(),
          drawing_low: z.number().finite().nullable().optional(),
          drawing_high: z.number().finite().nullable().optional(),
          drawing_defined: z.number().finite().nullable().optional(),
        }),
      )
      .max(200)
      .optional(),
    requirements: z
      .array(
        z.object({
          kind: z.string().trim().min(1).max(80),
          description: z.string().trim().max(200).optional(),
          title: z.string().trim().min(1).max(200),
          source_type: z.enum(["sheet", "spec", "contract"]),
          source_ref: z.string().trim().min(1).max(80),
          citation: z.string().trim().min(1).max(500),
        }),
      )
      .max(80)
      .optional(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("estimate_gap_analysis", ctx, { jobNumber: args.job_number, companyId: args.company_id }, async (sb) => {
      try {
        const job = await resolveJob(sb, args.job_number, args.company_id, "write");
        const prior = await load(sb, job.job_id);
        const implied = autoGaps(prior.lines, prior.setup.doc_review?.pairs ?? []);
        let clauses: { section: string; verbatim_text: string }[] = [];
        const cq = await sb
          .from("mcp_contract_clauses")
          .select("section, verbatim_text")
          .eq("job_id", job.job_id);
        if (!cq.error && Array.isArray(cq.data))
          clauses = cq.data as { section: string; verbatim_text: string }[];
        const found = requirementGaps(
          scanProject({ setup: prior.setup, clauses, findings: args.requirements }),
          prior.setup.role,
        );
        const reviewed = reviewEstimatorLines(
          (args.estimator_lines ?? []).map((line): EstimatorLine => ({
            item: line.item,
            qty: line.qty ?? null,
            unit: line.unit ?? "",
            note: line.note ?? null,
            sheet: line.sheet ?? null,
            detail: line.detail ?? null,
            callout: line.callout ?? null,
            drawingLow: line.drawing_low,
            drawingHigh: line.drawing_high,
            drawingDefined: line.drawing_defined,
          })),
        );
        const fromReview: GapIn[] = [
          ...reviewed.openQuestions.map((q) => ({
            kind: "verify" as const,
            category: "scale_or_dimension" as const,
            severity: "cannot_know" as const,
            title: q.title,
            reasoning: q.reasoning,
            sheet: q.sheet,
            detail: q.detail,
            spec_section: q.detail || "drawings",
            holds_bid: false,
            qty: null,
            unit: q.unit,
          })),
          ...reviewed.gaps.map((g) => ({
            kind: "verify" as const,
            category: "scope_seam" as const,
            severity: "soft" as const,
            title: g.item,
            reasoning: g.reason,
            sheet: g.sheet,
            spec_section: "estimator note",
            holds_bid: false,
          })),
        ];
        const merged = alignGapsToTakeoff(
          preserveGapList(
            prior.gaps,
            dedupeGaps([
              ...keepUnexplainedGaps(args.items as GapIn[], reviewed.explained),
              ...implied,
              ...found,
              ...fromReview,
            ]),
          ),
          prior.lines,
        );
        const gaps = prepareGaps(merged);
        await rpc(sb, "mcp_estimate_gaps_save", { _job: job.job_id, _items: gaps });
        const loaded = await load(sb, job.job_id);
        const state = settle(loaded.lines, loaded.gaps, loaded.verdicts, {
          role: loaded.setup.role,
          trades: loaded.setup.trades,
        });
        await audit(sb, job, "estimate_gap_analysis", "save_estimate_gaps", null);
        const view = renderGaps(`${named(job)}`, loaded.gaps, state, reviewed.outOfScope);
        return reply(view);
      } catch (e) {
        caught(e);
      }
    }),
});

export const estimateBidCheck = defineTool({
  name: "estimate_bid_check",
  title: "Sub bid check",
  description:
    "Checks each in-scope sub bid line against the takeoff for a general contractor or a self-performer and lists out-of-scope callouts in their own section.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    bids: z.array(subBid).max(40).optional(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("estimate_bid_check", ctx, { jobNumber: args.job_number, companyId: args.company_id }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id, "write");
      const loaded = await load(sb, job.job_id);
      const label = `${named(job)}`;
      const why = bidCheckRefusal(loaded.setup.role);
      if (why) {
        const view = renderBidCheck(label, loaded.setup.role, null, why);
        await audit(sb, job, "estimate_bid_check", "skip_estimate_bid_check", null);
        return reply(view);
      }
      const bids = args.bids?.length ? asBids(args.bids) : loaded.setup.sub_bids;
      if (!bids.length) {
        const view = renderBidCheck(
          label,
          loaded.setup.role,
          null,
          "No sub bids are on file. Nothing was checked.",
        );
        return reply(view);
      }
      await rpc(sb, "mcp_estimate_setup_save", { _job: job.job_id, _patch: { sub_bids: bids } });
      const result = checkBids(bids, loaded.lines);
      await audit(sb, job, "estimate_bid_check", "save_estimate_bid_check", null);
      const view = renderBidCheck(label, loaded.setup.role, result, null);
      return reply(view);
    }),
});

export const estimateItemMark = defineTool({
  name: "estimate_item_mark",
  title: "Estimator mark",
  description:
    "Records the estimator mark on an existing takeoff line or gap and does not create a gap or change its number.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    item_id: z.string().trim().min(1).max(40),
    mark: z.enum(["relevant", "not_relevant", "good_catch", "not_drawable"]),
    exception_kind: z.enum(["schedule_quantity", "spec_only", "allowance", "by_others"]).optional(),
    note: z.string().trim().max(1000).optional(),
    corrected_qty: z.number().finite().min(0).optional(),
    owner: z.string().trim().max(120).optional(),
  },
  annotations: MARK,
  handler: (args, ctx) =>
    run("estimate_item_mark", ctx, { jobNumber: args.job_number, companyId: args.company_id }, async (sb) => {
      try {
        const job = await resolveJob(sb, args.job_number, args.company_id, "write");
        const label = `${named(job)}`;
        const prior = await load(sb, job.job_id);
        const id = args.item_id.trim();
        const lineNo = /^T-(\d+)$/i.exec(id);
        const line = lineNo ? prior.lines.find((l) => l.line_no === Number(lineNo[1])) : undefined;
        const gap = prior.gaps.find((g) => g.ref.toLowerCase() === id.toLowerCase());
        if (!line && !gap) {
          const state = settle(prior.lines, prior.gaps, prior.verdicts, {
            role: prior.setup.role,
            trades: prior.setup.trades,
          });
          const view = renderMark(label, null, prior.accuracy, state);
          return reply(view);
        }
        const measurement = await engineSnapshot(sb, job.job_id);
        if (args.mark === "not_drawable") {
          if (!line || !measurement || !args.exception_kind || !args.note?.trim())
            throw new ToolError(
              "Choose an existing takeoff line, a non-drawable basis and record the estimator's reason.",
            );
          await engineRpc(sb, "mcp_takeoff_geometry_save", {
            _job: job.job_id,
            _operation: "not_drawable",
            _expected: 0,
            _record: {
              line_no: line.line_no,
              takeoff_version: measurement.takeoff_version,
              exception_kind: args.exception_kind,
              reason: args.note,
              quantity: args.corrected_qty,
            },
          });
          return viewEngine(sb, job, await requiredSnapshot(sb, job));
        }
        if (measurement && line && args.corrected_qty != null)
          throw new ToolError(
            "Change measured quantity by editing its geometry. A typed correction cannot override the drawing measurement.",
          );
        if (args.mark === "not_relevant" && !args.note?.trim())
          throw new ToolError(NOT_RELEVANT_ASK);
        if (args.corrected_qty != null)
          formatQty(args.corrected_qty, line?.unit ?? gap?.unit ?? null);
        await rpc(sb, "mcp_estimate_verdict_save", {
          _job: job.job_id,
          _kind: line ? "line" : "gap",
          _line_no: line?.line_no ?? null,
          _gap: gap?.ref ?? null,
          _item: line?.item ?? gap?.title,
          _mark: args.mark,
          _note: args.note ?? null,
          _qty: args.corrected_qty ?? null,
          _owner: args.owner ?? null,
        });
        const loaded = await load(sb, job.job_id);
        const state = settle(loaded.lines, loaded.gaps, loaded.verdicts, {
          role: loaded.setup.role,
          trades: loaded.setup.trades,
        });
        const item =
          state.items.find((i) => i.ref === (line ? `T-${line.line_no}` : gap!.ref)) ?? null;
        await audit(
          sb,
          job,
          "estimate_item_mark",
          "save_estimate_verdict",
          line ? `T-${line.line_no}` : (gap?.ref ?? null),
        );
        const view = renderMark(label, item, loaded.accuracy, state);
        if (measurement)
          return viewEngine(sb, job, await requiredSnapshot(sb, job), undefined, {
            report_title: "Estimator review",
            mark_result: view.structured,
          });
        return reply(view);
      } catch (e) {
        caught(e);
      }
    }),
});

export const estimateBuild = defineTool({
  name: "estimate_build",
  title: "Estimate summary",
  description:
    "Builds the estimate summary from settled quantities and the contractor rates as a landscape PDF.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    rates: z.array(rateIn).max(400).optional(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("estimate_build", ctx, { jobNumber: args.job_number, companyId: args.company_id }, async (sb) => {
      try {
        const job = await resolveJob(sb, args.job_number, args.company_id, "write");
        const loaded = await load(sb, job.job_id);
        const measurement = await engineSnapshot(sb, job.job_id);
        if (measurement && !measurementStatus(measurement).settled)
          return viewEngine(sb, job, measurement);
        const state = measurement
          ? measuredSettlement(loaded, measurement)
          : settle(loaded.lines, loaded.gaps, loaded.verdicts, {
              role: loaded.setup.role,
              trades: loaded.setup.trades,
            });
        const rates: RateIn[] = (args.rates ?? []).map((r) => ({
          ...r,
          rate: r.rate ?? null,
          bought: r.bought ?? null,
        }));
        const view = renderSummary(`${named(job)}`, state, rates, loaded.revision);
        if (measurement) await appendMeasuredSheets(sb, job, measurement, view);
        await rpc(sb, "mcp_estimate_setup_save", {
          _job: job.job_id,
          _patch: {
            summary: measurement
              ? {
                  ...view.structured,
                  pdf_volumes: (view.structured.pdf_volumes as { url?: string }[] | undefined)?.map(
                    artifactRecord,
                  ),
                }
              : view.structured,
            summary_version: loaded.version,
          },
        });
        await audit(sb, job, "estimate_build", "save_estimate_summary", null);
        if (measurement) {
          const rows = view.structured.rows as
            { title: string; qty: string; rate: string; extension: string | null }[] | undefined;
          return viewEngine(sb, job, measurement, undefined, {
            report_title: view.structured.draft ? "Estimate summary · Draft" : "Estimate summary",
            estimate_summary: view.structured,
            downloads: view.structured.pdf_volumes,
            report_rows: (rows ?? []).map(
              (r) =>
                `${r.title} · ${r.qty} · Rate ${r.rate}${r.extension ? ` · Extension ${r.extension}` : ""}`,
            ),
          });
        }
        return reply(view);
      } catch (e) {
        caught(e);
      }
    }),
});

export const estimateStatus = defineTool({
  name: "estimate_status",
  title: "Estimate status",
  description: "Returns the open, settled and dropped counts for an estimate.",
  inputSchema: { job_number: jobNumber, company_id: companyId },
  annotations: READ,
  handler: (args, ctx) =>
    run("estimate_status", ctx, { jobNumber: args.job_number, companyId: args.company_id }, async (sb) => {
      let job;
      try {
        job = await resolveJob(sb, args.job_number, args.company_id, "write");
      } catch (e) {
        const message = e instanceof Error ? e.message : "";
        if (/No job /i.test(message)) return noEstimate(args.job_number);
        throw e;
      }
      const loaded = await load(sb, job.job_id);
      if (!loaded.version && loaded.lines.length === 0) return noEstimate(`${named(job)}`);
      const measurement = await engineSnapshot(sb, job.job_id);
      if (measurement) return viewEngine(sb, job, measurement);
      const state = settle(loaded.lines, loaded.gaps, loaded.verdicts, {
        role: loaded.setup.role,
        trades: loaded.setup.trades,
      });
      await audit(sb, job, "estimate_status", "view_estimate_status", null);
      const view = renderStatus(`${named(job)}`, state, loaded.accuracy);
      return reply(view);
    }),
});

const drawingPoint = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
});
const drawingAnnotation = z.object({
  label: z.string().trim().min(1).max(60),
  text: z.string().trim().min(1).max(1000),
  location: z.string().trim().max(200).optional(),
  severity: z.enum(["callout", "risk", "delay"]).default("callout"),
  geometry: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("pin"), point: drawingPoint }),
      z.object({ kind: z.literal("line"), points: z.array(drawingPoint).min(2).max(100) }),
      z.object({ kind: z.literal("area"), points: z.array(drawingPoint).min(3).max(100) }),
    ])
    .optional(),
});

function drawingReply(
  card: CardModel,
  extra: Record<string, JsonValueInput> = {},
  png?: Uint8Array,
) {
  const html = renderHtml(card);
  // Some hosts give the app structured data without forwarding the image content block.
  // Keep the original image for model vision and include the same bytes for the app.
  const preview = png
    ? { type: "image" as const, data: bytesToBase64(png), mimeType: "image/png" as const }
    : undefined;
  return {
    ...text(`${renderMarkdown(card)}\n\n${htmlBlock(html)}`),
    content: [
      { type: "text" as const, text: `${renderMarkdown(card)}\n\n${htmlBlock(html)}` },
      ...(preview ? [preview] : []),
    ],
    structuredContent: { card, html, ...extra, ...(preview ? { drawing_preview: preview } : {}) },
  };
}

function storedDrawingReply(
  job: { job_number: string; company_id: string; job_id: string; name: string },
  stored: Awaited<ReturnType<typeof storeDrawingSet>>,
  requestedSheet?: string,
) {
  const sheets = stored.sheets ?? [];
  const needsIndex =
    !sheets.length || (stored.pageCount != null && sheets.length !== stored.pageCount);
  const context = {
    job_number: job.job_number,
    company_id: job.company_id,
    source_id: stored.record.id,
  };
  return drawingReply(
    {
      state: needsIndex ? "ask" : "result",
      title: needsIndex
        ? "Drawing stored — sheet names needed"
        : stored.duplicate
          ? "Drawing set recognized"
          : "Drawing set stored",
      job: named(job),
      kpis: [
        { label: "Source revision", value: String(stored.record.version) },
        { label: "Indexed sheets", value: String(sheets.length) },
        ...(stored.pageCount ? [{ label: "PDF pages", value: String(stored.pageCount) }] : []),
      ],
      sections: [
        {
          heading: "Drawing set",
          kind: "list",
          rows: [
            {
              cells: [
                stored.name,
                stored.duplicate
                  ? "Identical PDF already stored; no second file uploaded."
                  : "PDF copied into secure job storage.",
              ],
            },
            { cells: ["Source file", "Unchanged"] },
            ...(stored.record.source_url
              ? [{ cells: ["Original source link"], href: stored.record.source_url }]
              : []),
          ],
        },
        ...(sheets.length
          ? [
              {
                heading: "Sheet index",
                kind: "list" as const,
                rows: sheets.map((sheet, i) => ({ cells: [sheet, `PDF page ${i + 1}`] })),
              },
            ]
          : []),
      ],
      ...(needsIndex
        ? {
            ask: {
              prompt: `What are the ${stored.pageCount ?? "PDF"} sheet names, in PDF page order? Save the answer once below; this PDF is already stored.`,
            },
          }
        : {}),
      next_move: needsIndex
        ? "Sheet names are needed before this set can be marked up. No older drawing was substituted; no re-upload is needed."
        : "Choose a stored sheet below to inspect it before markup.",
    },
    {
      stored: true,
      index_synced: true,
      source: stored.record as unknown as JsonValueInput,
      source_id: stored.record.id,
      duplicate: stored.duplicate,
      sheet_index_required: needsIndex,
      page_count: stored.pageCount ?? null,
      drawing_source_context: context,
      ...(needsIndex
        ? { sheet_index_context: { ...context, page_count: stored.pageCount ?? null } }
        : {}),
      ...(requestedSheet ? { requested_sheet: requestedSheet } : {}),
    },
  );
}

/** A one-time direct upload link for the drawing card. Absent when the server has no signing key. */
async function directUpload(job: { company_id: string; job_id: string }): Promise<Record<string, JsonValueInput>> {
  const secret = drawingUploadSecret();
  if (!secret) return {};
  return { direct_upload: await signDrawingUpload(job, secret) };
}

type ImportUpload = ReturnType<typeof drawingWithFile>;
/**
 * Confirm a PDF the card already sent to the direct upload route. Only the small path and
 * the route's signed receipt (path, sha256, size) cross the tool call. The object is
 * checked with a storage listing, never downloaded, so a 70 MB set is not held in memory.
 */
async function withStagedDrawing(
  sb: Sb,
  job: { company_id: string; job_id: string },
  upload: ImportUpload,
): Promise<ImportUpload> {
  if (!upload?.staged_path && !upload?.upload_receipt) return upload;
  if (upload.content_base64 || upload.source_url || upload.file)
    throw new ToolError(
      "Provide one drawing source: the direct upload, PDF bytes, or a source link. Nothing was stored.",
    );
  const secret = drawingUploadSecret();
  const receipt =
    secret && upload.upload_receipt ? await verifyDrawingReceipt(upload.upload_receipt, secret) : null;
  if (!receipt || receipt.company_id !== job.company_id || receipt.job_id !== job.job_id)
    throw new ToolError(
      "That upload is not valid for this job or has expired. Choose the PDF again. Nothing was stored.",
    );
  if (upload.staged_path !== receipt.path)
    throw new ToolError("The uploaded drawing is not on this job. Nothing was stored.");
  const dir = receipt.path.slice(0, receipt.path.lastIndexOf("/"));
  const listed = await sb.storage.from("athena-drawings").list(dir, { search: "source.pdf", limit: 2 });
  const object = listed.data?.find((o) => o.name === "source.pdf");
  const size = Number((object?.metadata as { size?: number } | undefined)?.size);
  if (listed.error || !object || (Number.isFinite(size) && size !== receipt.size))
    throw new ToolError("The uploaded drawing could not be found. Choose the PDF again. Nothing was stored.");
  const { staged_path: _p, upload_receipt: _r, ...rest } = upload;
  return {
    ...rest,
    staged: {
      path: receipt.path,
      content_hash: receipt.content_hash,
      size: receipt.size,
      page_count: receipt.page_count ?? null,
    },
  };
}

export const drawingSetImport = defineTool({
  name: "drawing_set_import",
  title: "Store a drawing set",
  description:
    "Stores an attached drawing PDF once and returns its source_id, asks once for missing sheet names in PDF page order, and reads or indexes that stored source by source_id without re-uploading; a direct PDF upload card is available and Drive/Dropbox links are optional.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    drawing: drawingUpload,
    file: drawingFile,
    stored_filename: z.string().trim().min(1).max(200).optional(),
    source_id: z.string().uuid().optional(),
    sheets: z.array(z.string().trim().min(1).max(40)).min(1).max(400).optional(),
  },
  annotations: { ...SAVE, openWorldHint: true },
  handler: (args, ctx) =>
    run("drawing_set_import", ctx, { jobNumber: args.job_number, companyId: args.company_id }, async (sb) => {
      let uploadContext: { job_number: string; company_id: string } | undefined;
      let imported: Awaited<ReturnType<typeof storeDrawingSet>> | undefined;
      let selectedStored:
        | {
            job: Awaited<ReturnType<typeof resolveJob>>;
            source: Awaited<ReturnType<typeof drawingRecords>>[number];
          }
        | undefined;
      try {
        const job = await resolveJob(sb, args.job_number, args.company_id, "write");
        uploadContext = { job_number: job.job_number, company_id: job.company_id };
        const prior = await load(sb, job.job_id);
        const upload = await withStagedDrawing(
          sb,
          job,
          drawingWithFile(args.drawing, args.file, args.sheets),
        );
        let indexed: Awaited<ReturnType<typeof storeDrawingSet>> | undefined;
        if (args.source_id || args.stored_filename) {
          if (upload)
            throw new ToolError(
              "Choose a stored source or a new upload, not both. Nothing was changed.",
            );
          if (!args.source_id && !args.sheets?.length)
            throw new ToolError(
              "To index a stored set, give its filename and sheets in PDF page order, without another upload.",
            );
          const same = (name: string) => name.toLowerCase() === args.stored_filename!.toLowerCase();
          const records = await drawingRecords(sb, job);
          const record = records.find((row) =>
            args.source_id ? row.id === args.source_id : same(row.filename),
          );
          const legacy = args.source_id
            ? undefined
            : prior.setup.documents.find((doc) => same(doc.name));
          const path = record?.path ?? legacy?.path;
          if (!path || !drawingOwned(path, job.company_id, job.job_id))
            throw new ToolError(
              "That drawing source is not stored on this job. No other set was selected.",
            );
          if (record) selectedStored = { job, source: record };
          if (args.source_id && record && !args.sheets?.length)
            return storedDrawingReply(job, await readStoredDrawingSet(sb, job, record));
          indexed = await indexStoredDrawingSet(sb, job, {
            path,
            filename: record?.filename ?? legacy!.name,
            sheets: args.sheets!,
            record,
            complete: !!args.source_id,
          });
        }
        if (!upload && !indexed)
          return drawingReply(
            {
              state: "ask",
              title: "Store your drawing PDF",
              job: named(job),
              sections: [
                {
                  heading: "Direct upload",
                  kind: "list",
                  rows: [
                    {
                      cells: [
                        "Choose the PDF in this card, then store it on this job.",
                        "Up to 100 MB. A Drive or Dropbox link is optional. No drawing has been stored by this request.",
                      ],
                    },
                  ],
                },
              ],
            },
            { stored: false, upload_context: uploadContext, ...(await directUpload(job)) },
          );
        const stored = indexed ?? (await storeDrawingSet(sb, job, upload!, prior.setup.documents));
        imported = stored;
        // Registry is authoritative. Keep the #190 document index in sync for takeoff reads.
        await rpc(sb, "mcp_estimate_setup_save", {
          _job: job.job_id,
          _patch: { documents: withDrawingPath(prior.setup.documents, stored) },
        });
        return storedDrawingReply(job, stored);
      } catch (e) {
        if (e instanceof WhichCompanyAsk) throw e;
        if (imported)
          return drawingReply(
            {
              state: "result",
              title: "Drawing stored; takeoff index needs a retry",
              sections: [
                {
                  heading: "Stored source",
                  kind: "list",
                  rows: [
                    {
                      cells: [
                        imported.name,
                        "The original PDF and its source record are stored. The legacy takeoff index could not be updated.",
                      ],
                    },
                    { cells: ["Open this stored source for markup; a new upload is not needed."] },
                  ],
                },
              ],
            },
            {
              stored: true,
              index_synced: false,
              source: imported.record as unknown as JsonValueInput,
              duplicate: imported.duplicate,
            },
          );
        if (selectedStored) {
          const source = selectedStored.source;
          const result = storedDrawingReply(selectedStored.job, {
            name: source.filename,
            path: source.path,
            sheets: source.sheets,
            record: source,
            duplicate: true,
          });
          const message = errorMessage(
            e,
            "The sheet index could not be changed. No re-upload is needed.",
          );
          result.structuredContent.card.sections?.unshift({
            heading: "Sheet index not changed",
            kind: "list",
            rows: [{ cells: [message] }],
          });
          const { card, html: _html, ...facts } = result.structuredContent;
          return drawingReply(card, { ...facts, index_synced: false, index_error: message });
        }
        const failed = errorCard(
          "Drawing set",
          errorMessage(e, "The drawing could not be imported."),
        );
        return {
          ...failed,
          structuredContent: {
            ...failed.structuredContent,
            stored: false,
            import_failed: true,
            ...(uploadContext ? { upload_context: uploadContext } : {}),
          },
        };
      }
    }),
});

export const drawingMarkup = defineTool({
  name: "drawing_markup",
  title: "Mark up a stored drawing",
  description:
    "Prepares the stored sheet image and findings for inspection, then saves supplied pins, lines and areas in a dated copy using normalized 0..1 coordinates from the original image top-left, requiring source_id or source_filename to save the exact set and otherwise returning a source-selection preview, with unlocated findings kept in the key rather than guessed.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    sheet: z.string().trim().min(1).max(80),
    source_id: z.string().uuid().optional(),
    source_filename: z.string().trim().min(1).max(200).optional(),
    operation: z.enum(["prepare", "save"]).default("save"),
    annotations: z.array(drawingAnnotation).max(100).optional(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("drawing_markup", ctx, { jobNumber: args.job_number, companyId: args.company_id }, async (sb) => {
      try {
        const job = await resolveJob(sb, args.job_number, args.company_id, "write");
        const prior = await load(sb, job.job_id);
        let source: Awaited<ReturnType<typeof storedSheet>>;
        try {
          source = await storedSheet(sb, job, prior.setup.documents, args.sheet, {
            sourceId: args.source_id,
            filename: args.source_filename,
          });
        } catch (e) {
          if (e instanceof SheetPreviewUnavailable) {
            const blocked = sheetAccessResult(e);
            if (blocked) return blocked;
          }
          if (e instanceof DrawingSheetIndexRequired)
            // Build the "sheet names needed" reply from the saved record. Re-reading
            // a large original here (download + hash + parse) can exhaust the worker.
            return storedDrawingReply(
              job,
              {
                name: e.record.filename,
                path: e.record.path,
                sheets: e.record.sheets,
                record: e.record,
                duplicate: true,
                pageCount: undefined,
              },
              args.sheet,
            );
          throw e;
        }
        const measurement = await engineSnapshot(sb, job.job_id);
        // prepare is the findings preview; only a save without annotations opens the measured takeoff.
        if (measurement && !args.annotations && args.operation !== "prepare") {
          const page = await loadStoredPage(sb, job, source.sheet, source.record.id);
          const extra =
            args.operation === "save" &&
            (args.source_id || args.source_filename) &&
            measurement.geometry.some(
              (g) =>
                g.source_id === source.record.id &&
                g.page === source.page &&
                g.status !== "rejected" &&
                g.shape.kind !== "not_drawable",
            )
              ? {
                  export: await (
                    await import("../takeoff/export")
                  ).exportMeasuredSheet(sb, job, page, measurement),
                }
              : {};
          const view = await viewEngine(sb, job, measurement, page, extra),
            picture = view.content.find((c) => c.type === "image");
          const exported = extra.export as
            { id: string; path: string; created_at: string } | undefined;
          return {
            ...view,
            _meta: drawingCardResultMeta,
            structuredContent: {
              ...(view.structuredContent as Record<string, JsonValueInput>),
              source: {
                ...source.record,
                company_id: job.company_id,
                job_id: job.job_id,
                sheet: source.sheet,
                page: source.page,
                revision: source.record.version,
              },
              sheet: source.sheet,
              page: source.page,
              job_number: job.job_number,
              company_id: job.company_id,
              saved: !!exported,
              drawing_source_context: {
                job_number: job.job_number,
                company_id: job.company_id,
                source_id: source.record.id,
              },
              ...(picture ? { drawing_preview: picture } : {}),
              ...(exported
                ? {
                    markup: {
                      id: exported.id,
                      kind: "markup",
                      parent_id: source.record.id,
                      path: exported.path,
                      created_at: exported.created_at,
                    },
                  }
                : {}),
            } as unknown as JsonValueInput,
          };
        }
        if (measurement && args.annotations?.some((a) => /^L\d+$|^T-\d+$/i.test(a.label)))
          throw new ToolError(
            "Takeoff highlights are derived from measured geometry. Edit that line with takeoff_geometry; drawing_markup annotations are for separate findings and risks.",
          );
        const annotations =
          args.annotations ?? savedDrawingAnnotations(source.sheet, prior.lines, prior.gaps);
        if (annotations.length > 100)
          throw new ToolError(
            "This sheet has over 100 findings. Select up to 100 annotations for each markup version.",
          );
        const needsSource = !args.source_id && !args.source_filename;
        if (args.operation === "prepare" || needsSource) {
          const preview = withRevisionNotice(
            drawingMarkupCard(named(job), source.record, source.sheet, annotations),
            source.redirectNotice,
          );
          if (needsSource) {
            preview.state = "ask";
            preview.next_move =
              "This preview uses the named stored set, not an upload whose import failed. Select this source before saving a dated markup; locate any unpositioned findings on the sheet.";
          }
          return drawingReply(
            preview,
            {
              saved: false,
              source: source.record as unknown as JsonValueInput,
              source_selection_required: needsSource,
              sheet: source.sheet,
              page: source.page,
              job_number: job.job_number,
              company_id: job.company_id,
              drawing_source_context: {
                job_number: job.job_number,
                company_id: job.company_id,
                source_id: source.record.id,
              },
              drawing_annotations: annotations as unknown as JsonValueInput,
            },
            source.png,
          );
        }
        const saved = await saveDrawingMarkup(sb, job, source, annotations);
        return drawingReply(
          withRevisionNotice(
            drawingMarkupCard(named(job), source.record, source.sheet, annotations, saved),
            source.redirectNotice,
          ),
          {
            saved: true,
            markup: saved.record as unknown as JsonValueInput,
            source: source.record as unknown as JsonValueInput,
            original_unchanged: true,
            drawing_source_context: {
              job_number: job.job_number,
              company_id: job.company_id,
              source_id: source.record.id,
            },
          },
          saved.png,
        );
      } catch (e) {
        if (e instanceof WhichCompanyAsk) throw e;
        const blocked = sheetAccessResult(e);
        if (blocked) return blocked;
        return errorCard(
          "Drawing markup",
          errorMessage(e, "The stored sheet could not be marked up."),
        );
      }
    }),
});
