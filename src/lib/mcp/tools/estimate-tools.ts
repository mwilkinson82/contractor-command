// Estimating role. Same gate as the other tools: run() checks auth, the call cap and the membership entitlement.
import { ToolError, defineTool, type JsonValueInput } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { BidError, requirementGaps, scanProject } from "../estimating-bid";
import { keepUnexplainedGaps, reviewEstimatorLines, type EstimatorLine } from "../estimating-method";
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
  autoGaps,
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
  rejectPlaceholderLines,
  renderIntake,
  renderMark,
  renderStatus,
  renderSummary,
  renderTakeoff,
  reuseWarning,
  revisionUsed,
  settle,
  type DocReview,
  type GapIn,
  type LineIn,
  type RateIn,
  type Setup,
  type StoredLine,
  type SubBid,
} from "../estimating";
import { dbError, isMissingFunction, run, text, type Sb } from "../guard";
import { audit, prefix, resolveJob } from "../jobs";
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
const takeoffLines = z.array(lineIn).min(1).max(400).superRefine((lines, ctx) => {
  lines.forEach((line, i) => {
    const label = lineLabel(line, i);
    if (line.method != null && (typeof line.method !== "string" || line.method.trim().length > 200)) {
      ctx.addIssue({
        code: "custom",
        path: [i, "method"],
        message: `${label}: method must be plain words, at most 200 characters, or leave it off.`,
      });
    }
    if (line.missing_input != null && (typeof line.missing_input !== "string" || line.missing_input.trim().length > 120)) {
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
      const name = typeof input.name === "string" ? input.name.trim() : input.name == null ? "" : String(input.name);
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
    const data = await rpc<{ found?: boolean; profile?: string; forms_faces?: number }>(sb, "mcp_estimate_profile_get", {
      _job: jobId,
    });
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
    "Asks scope, role and profile, and warns before reusing a takeoff already on the job.",
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
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("estimate_intake", ctx, { jobNumber: args.job_number }, async (sb) => {
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
          text: [warning, ...pending.map((q) => `- ${q}`)].join("\n"),
          structured: { complete: false, reused: false, saved: false },
          guidance: [
            "Ask reuse or fresh before using the takeoff on file. Do not assume self-performer.",
          ],
        });
      }
      const setup: Setup = {
        role: args.role ?? prior.setup.role,
        trades: args.trades ?? prior.setup.trades,
        bid_due: args.bid_due ?? prior.setup.bid_due,
        delivery_method: args.delivery_method ?? prior.setup.delivery_method,
        documents: args.documents ?? prior.setup.documents,
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
      if (args.documents) patch.documents = args.documents;
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
      const view = renderIntake(`${prefix(job)}${job.name}`, setup, profile, forms);
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
      return reply({
        ...view,
        text: fresh ? `${fresh}\n${view.text}` : view.text,
        structured: { ...view.structured, reuse: args.reuse ?? null },
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
    run("estimate_doc_review", ctx, { jobNumber: args.job_number }, async (sb) => {
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
      const view = renderDocReview(`${prefix(job)}${job.name}`, review, prior.setup.documents);
      return reply(view);
    }),
});

export const estimateTakeoffSave = defineTool({
  name: "estimate_takeoff_save",
  title: "Save a takeoff",
  description: "Saves takeoff lines with mode upsert, the default, or mode replace.",
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
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("estimate_takeoff_save", ctx, { jobNumber: args.job_number }, async (sb) => {
      try {
        const job = await resolveJob(sb, args.job_number, args.company_id, "write");
        const mode = args.mode ?? "upsert";
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
        const account = accountTakeoffLines(args.lines.map(asLine), convention, prior.lines, mode);
        const lines = account.lines;
        const revision = args.revision ?? revisionUsed(prior.setup.documents);
        const scales = (args.scales ?? []).map((s) => ({ ...s, scale: normalizeScale(s.scale) }));
        if (account.saved === 0) {
          const state = settle(prior.lines, prior.gaps, prior.verdicts, { role: prior.setup.role, trades: prior.setup.trades });
          return reply(renderTakeoff(`${prefix(job)}${job.name}`, prior.lines, state, revision, mode, account));
        }
        await rpc(sb, "mcp_estimate_takeoff_save", {
          _job: job.job_id,
          _revision: revision,
          _scales: scales,
          _lines: lines,
        });
        const loaded = await load(sb, job.job_id);
        const state = settle(loaded.lines, loaded.gaps, loaded.verdicts, {
          role: loaded.setup.role,
          trades: loaded.setup.trades,
        });
        await audit(sb, job, "estimate_takeoff_save", "save_estimate_takeoff", null);
        const view = renderTakeoff(
          `${prefix(job)}${job.name}`,
          loaded.lines,
          state,
          loaded.revision,
          mode,
          account,
        );
        return reply({ ...view, structured: { ...view.structured, version: loaded.version } });
      } catch (e) {
        caught(e);
      }
    }),
});

export const estimateTakeoffGet = defineTool({
  name: "estimate_takeoff_get",
  title: "Read a takeoff",
  description: "Returns the saved takeoff for a job.",
  inputSchema: { job_number: jobNumber, company_id: companyId },
  annotations: READ,
  handler: (args, ctx) =>
    run("estimate_takeoff_get", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id, "write");
      const loaded = await load(sb, job.job_id);
      await audit(sb, job, "estimate_takeoff_get", "view_estimate_takeoff", null);
      if (!loaded.version) return emptyTakeoff(`${prefix(job)}${job.name}`);
      const state = settle(loaded.lines, loaded.gaps, loaded.verdicts, {
        role: loaded.setup.role,
        trades: loaded.setup.trades,
      });
      const view = renderTakeoff(`${prefix(job)}${job.name}`, loaded.lines, state, loaded.revision);
      return reply({
        ...view,
        structured: { ...view.structured, found: true, version: loaded.version },
      });
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
  annotations: READ,
  handler: (args, ctx) =>
    run("estimate_takeoff_export", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id, "write");
      const loaded = await load(sb, job.job_id);
      if (!loaded.lines.length)
        throw new ToolError("No takeoff is saved for this job yet. Nothing was exported.");
      await audit(sb, job, "estimate_takeoff_export", "export_estimate_takeoff", null);
      const view = renderExport(`${prefix(job)}${job.name}`, loaded.lines, args.format ?? "csv");
      return reply(view);
    }),
});

export const estimateGapAnalysis = defineTool({
  name: "estimate_gap_analysis",
  title: "Estimate gap analysis",
  description: "Saves sheet-cited gaps after reading the estimator's basis notes and scope callouts, and must not back-solve a quantity to the estimator's number when the drawings do not define it.",
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
    run("estimate_gap_analysis", ctx, { jobNumber: args.job_number }, async (sb) => {
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
          (args.estimator_lines ?? []).map(
            (line): EstimatorLine => ({
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
            }),
          ),
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
        const merged = preserveGapList(
          prior.gaps,
          dedupeGaps([
            ...keepUnexplainedGaps(args.items as GapIn[], reviewed.explained),
            ...implied,
            ...found,
            ...fromReview,
          ]),
        );
        const gaps = prepareGaps(merged);
        await rpc(sb, "mcp_estimate_gaps_save", { _job: job.job_id, _items: gaps });
        const loaded = await load(sb, job.job_id);
        const state = settle(loaded.lines, loaded.gaps, loaded.verdicts, {
          role: loaded.setup.role,
          trades: loaded.setup.trades,
        });
        await audit(sb, job, "estimate_gap_analysis", "save_estimate_gaps", null);
        const view = renderGaps(`${prefix(job)}${job.name}`, loaded.gaps, state, reviewed.outOfScope);
        return reply(view);
      } catch (e) {
        caught(e);
      }
    }),
});

export const estimateBidCheck = defineTool({
  name: "estimate_bid_check",
  title: "Sub bid check",
  description: "Checks each in-scope sub bid line against the takeoff for a general contractor job and lists out-of-scope callouts in their own section.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    bids: z.array(subBid).max(40).optional(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("estimate_bid_check", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id, "write");
      const loaded = await load(sb, job.job_id);
      const label = `${prefix(job)}${job.name}`;
      if (loaded.setup.role !== "gc") {
        const why =
          loaded.setup.role === "self_performer"
            ? "Bid check is for a general contractor. This job is set up as a self-performer. Nothing was checked."
            : "Save the intake and set the role to general contractor before a bid check. Nothing was checked.";
        const view = renderBidCheck(label, loaded.setup.role, null, why);
        await audit(sb, job, "estimate_bid_check", "skip_estimate_bid_check", null);
        return reply(view);
      }
      const bids = args.bids?.length ? asBids(args.bids) : loaded.setup.sub_bids;
      if (!bids.length) {
        const view = renderBidCheck(
          label,
          "gc",
          null,
          "No sub bids are on file. Nothing was checked.",
        );
        return reply(view);
      }
      await rpc(sb, "mcp_estimate_setup_save", { _job: job.job_id, _patch: { sub_bids: bids } });
      const result = checkBids(bids, loaded.lines);
      await audit(sb, job, "estimate_bid_check", "save_estimate_bid_check", null);
      const view = renderBidCheck(label, "gc", result, null);
      return reply(view);
    }),
});

export const estimateItemMark = defineTool({
  name: "estimate_item_mark",
  title: "Estimator mark",
  description: "Records the estimator mark on an existing takeoff line or gap and does not create a gap or change its number.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    item_id: z.string().trim().min(1).max(40),
    mark: z.enum(["relevant", "not_relevant", "good_catch"]),
    note: z.string().trim().max(1000).optional(),
    corrected_qty: z.number().finite().min(0).optional(),
    owner: z.string().trim().max(120).optional(),
  },
  annotations: MARK,
  handler: (args, ctx) =>
    run("estimate_item_mark", ctx, { jobNumber: args.job_number }, async (sb) => {
      try {
        const job = await resolveJob(sb, args.job_number, args.company_id, "write");
        const label = `${prefix(job)}${job.name}`;
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
        return reply(view);
      } catch (e) {
        caught(e);
      }
    }),
});

export const estimateBuild = defineTool({
  name: "estimate_build",
  title: "Estimate summary",
  description: "Builds the estimate summary from settled quantities and the contractor rates as a landscape PDF.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    rates: z.array(rateIn).max(400).optional(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("estimate_build", ctx, { jobNumber: args.job_number }, async (sb) => {
      try {
        const job = await resolveJob(sb, args.job_number, args.company_id, "write");
        const loaded = await load(sb, job.job_id);
        const state = settle(loaded.lines, loaded.gaps, loaded.verdicts, {
          role: loaded.setup.role,
          trades: loaded.setup.trades,
        });
        const rates: RateIn[] = (args.rates ?? []).map((r) => ({
          ...r,
          rate: r.rate ?? null,
          bought: r.bought ?? null,
        }));
        const view = renderSummary(`${prefix(job)}${job.name}`, state, rates, loaded.revision);
        await rpc(sb, "mcp_estimate_setup_save", {
          _job: job.job_id,
          _patch: { summary: view.structured, summary_version: loaded.version },
        });
        await audit(sb, job, "estimate_build", "save_estimate_summary", null);
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
    run("estimate_status", ctx, { jobNumber: args.job_number }, async (sb) => {
      let job;
      try {
        job = await resolveJob(sb, args.job_number, args.company_id, "write");
      } catch (e) {
        const message = e instanceof Error ? e.message : "";
        if (/No job /i.test(message)) return noEstimate(args.job_number);
        throw e;
      }
      const loaded = await load(sb, job.job_id);
      if (!loaded.version && loaded.lines.length === 0) return noEstimate(`${prefix(job)}${job.name}`);
      const state = settle(loaded.lines, loaded.gaps, loaded.verdicts, {
        role: loaded.setup.role,
        trades: loaded.setup.trades,
      });
      await audit(sb, job, "estimate_status", "view_estimate_status", null);
      const view = renderStatus(`${prefix(job)}${job.name}`, state, loaded.accuracy);
      return reply(view);
    }),
});
