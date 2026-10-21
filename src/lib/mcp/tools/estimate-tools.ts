// Estimating role. Same gate as the other tools: run() checks auth, the call cap and the membership entitlement.
import { ToolError, defineTool, type JsonValueInput } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { requirementGaps, scanProject } from "../estimating-bid";
import {
  ESTIMATE_QUANTITY_REQUIRED,
  ESTIMATE_VIEW_SPEC,
  EstimateError,
  assignGapRefs,
  autoGaps,
  checkBids,
  estimateLayout,
  formatQty,
  parseState,
  prepareGaps,
  prepareLines,
  renderBidCheck,
  renderDocReview,
  renderExport,
  renderGaps,
  renderIntake,
  renderMark,
  renderStatus,
  renderSummary,
  renderTakeoff,
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
const checkKey = z.enum(["cf", "if", "fs", "fr", "fd", "tp", "cp", "ts", "td", "sg", "us", "ew"]);
const qtyInput = z.object({
  name: z.string().trim().min(1).max(80),
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
  range: z.string().trim().max(40).optional(),
  measure_type: z.enum(["count", "linear", "area", "volume"]).optional(),
  sheet: z.string().trim().min(1).max(80),
  detail: z.string().trim().max(80).optional(),
  spec_section: z.string().trim().max(80).optional(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  scale: z.string().trim().max(40).optional(),
  method: z.string().trim().max(200).optional(),
  markup_ref: z.string().trim().max(40).optional(),
  location_text: z.string().trim().max(200).optional(),
  missing_input: z.string().trim().max(120).optional(),
  exclusion: z.string().trim().max(300).optional(),
  checklist_key: checkKey.optional(),
  element: z.string().trim().max(80).optional(),
  trade: z.string().trim().max(80).optional(),
  note: z.string().trim().max(500).optional(),
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
  value: l.value ?? null,
  inputs: l.inputs?.map((i) => ({
    name: i.name,
    value: i.value,
    unit: i.unit ?? null,
    sheet: i.sheet ?? null,
    detail: i.detail ?? null,
  })),
});
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
  if (e instanceof EstimateError) throw new ToolError(e.message);
  throw e;
}

export const estimateIntake = defineTool({
  name: "estimate_intake",
  title: "Estimating intake",
  description: "Saves the estimating role, trades, bid date and document list for a job.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    role: z.enum(["gc", "self_performer"]),
    trades: z.array(z.string().trim().min(1).max(80)).max(40),
    bid_due: date.optional(),
    delivery_method: z.string().trim().max(80).optional(),
    documents: z.array(doc).max(200),
    sub_bids: z.array(subBid).max(40).optional(),
    workbook_note: z.string().trim().max(300).optional(),
    in_scope: z.array(z.string().trim().min(1).max(200)).max(40).optional(),
    out_scope: z.array(z.string().trim().min(1).max(200)).max(40).optional(),
    assumptions: z.array(z.string().trim().min(1).max(300)).max(40).optional(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("estimate_intake", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id, "write");
      const setup: Setup = {
        role: args.role,
        trades: args.trades,
        bid_due: args.bid_due ?? null,
        delivery_method: args.delivery_method ?? null,
        documents: args.documents,
        sub_bids: asBids(args.sub_bids ?? []),
        workbook_note: args.workbook_note ?? null,
        in_scope: args.in_scope ?? [],
        out_scope: args.out_scope ?? [],
        assumptions: args.assumptions ?? [],
        doc_review: null,
        summary_version: null,
      };
      await rpc(sb, "mcp_estimate_setup_save", {
        _job: job.job_id,
        _patch: {
          role: setup.role,
          trades: setup.trades,
          bid_due: setup.bid_due,
          delivery_method: setup.delivery_method,
          documents: setup.documents,
          sub_bids: setup.sub_bids,
          workbook_note: setup.workbook_note,
          in_scope: setup.in_scope,
          out_scope: setup.out_scope,
          assumptions: setup.assumptions,
        },
      });
      await audit(sb, job, "estimate_intake", "save_estimate_intake", null);
      const view = renderIntake(`${prefix(job)}${job.name}`, setup);
      return reply(view);
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
          schedules: z.array(z.string().trim().max(120)).max(40).optional(),
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
        sheets: args.sheets,
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
  description: "Saves takeoff lines and computes deduced quantities from measured inputs.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    revision: z.string().trim().max(120).optional(),
    scales: z
      .array(
        z.object({
          sheet: z.string().trim().min(1).max(80),
          scale: z.string().trim().min(1).max(40),
          source: z.enum(["title_block", "dimensioned_string"]).optional(),
        }),
      )
      .max(200)
      .optional(),
    lines: z.array(lineIn).min(1).max(400),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("estimate_takeoff_save", ctx, { jobNumber: args.job_number }, async (sb) => {
      try {
        const job = await resolveJob(sb, args.job_number, args.company_id, "write");
        const prior = await load(sb, job.job_id);
        const lines: StoredLine[] = prepareLines(args.lines.map(asLine));
        const revision = args.revision ?? revisionUsed(prior.setup.documents);
        await rpc(sb, "mcp_estimate_takeoff_save", {
          _job: job.job_id,
          _revision: revision,
          _scales: args.scales ?? [],
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
  description: "Saves gap items that cite the drawing sheet and the spec section.",
  inputSchema: { job_number: jobNumber, company_id: companyId, items: z.array(gapIn).max(200) },
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
          scanProject({ setup: prior.setup, clauses }),
          prior.setup.role,
        );
        const merged = assignGapRefs(
          prior.gaps,
          dedupeGaps([...(args.items as GapIn[]), ...implied, ...found]),
        );
        const gaps = prepareGaps(merged);
        await rpc(sb, "mcp_estimate_gaps_save", { _job: job.job_id, _items: gaps });
        const loaded = await load(sb, job.job_id);
        const state = settle(loaded.lines, loaded.gaps, loaded.verdicts, {
          role: loaded.setup.role,
          trades: loaded.setup.trades,
        });
        await audit(sb, job, "estimate_gap_analysis", "save_estimate_gaps", null);
        const view = renderGaps(`${prefix(job)}${job.name}`, loaded.gaps, state);
        return reply(view);
      } catch (e) {
        caught(e);
      }
    }),
});

export const estimateBidCheck = defineTool({
  name: "estimate_bid_check",
  title: "Sub bid check",
  description: "Checks each sub bid line against the takeoff for a general contractor job.",
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
  description: "Records the estimator mark on a takeoff line or a gap.",
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
          throw new ToolError("Say why this is not relevant. Nothing was changed.");
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
  description: "Builds the estimate summary from settled quantities and the contractor rates.",
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
      const job = await resolveJob(sb, args.job_number, args.company_id, "write");
      const loaded = await load(sb, job.job_id);
      const state = settle(loaded.lines, loaded.gaps, loaded.verdicts, {
        role: loaded.setup.role,
        trades: loaded.setup.trades,
      });
      await audit(sb, job, "estimate_status", "view_estimate_status", null);
      const view = renderStatus(`${prefix(job)}${job.name}`, state, loaded.accuracy);
      return reply(view);
    }),
});
