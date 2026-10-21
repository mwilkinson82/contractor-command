// Phase 5 tools: job cost import and the ledger. Dollars: full job access only (owner, all-access, accounting, a PM on own job).
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, text, type Sb } from "../guard";
import { audit, jobTimeZone, prefix, resolveJob, type Job } from "../jobs";
import { guide } from "../visible";
import { caller, rpc, rpcSoft } from "../accounting/db";
import { fmt, fmtBp, toCents } from "../accounting/cents";
import { accountingScope, requireApproved, requireBase, versionStamp } from "../accounting/foundations";
import { LEDGER_VIEW_SPEC, fileFormat, ledgerMath, overUnderLabel, type CostRow, type LedgerLine } from "../accounting/ledger";
import { payAppsFor } from "./payapp-tools";

const companyId = z.string().trim().min(1).max(200).optional().describe("Only needed if you belong to more than one company.");
const jobNumber = z.string().trim().min(1).max(40).describe("Job number, exact match (e.g. 2701).");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const money = z.union([z.number(), z.string()]);

type Stored = { version: number; at: string | null; by: string | null; contract_sum: number; estimate_total: number; retainage_held: number; lines: LedgerLine[]; import: { rows: CostRow[]; control_total: number; source: string } | null };

export async function stored(sb: Sb, job: Job): Promise<Stored | null> { return rpcSoft<Stored>(sb, "mcp_ledger_get", { _job: job.job_id }); }

export async function compute(sb: Sb, job: Job, s: Pick<Stored, "contract_sum" | "estimate_total" | "retainage_held" | "lines" | "import">) {
  const cert = (await payAppsFor(sb, job)).filter((a) => a.certified).sort((a, b) => b.app_no - a.app_no)[0];
  return ledgerMath({ contract_sum: s.contract_sum, estimate_total: s.estimate_total, lines: s.lines, costs: s.import?.rows ?? [], import_control_total: s.import?.control_total ?? 0, certified_billed_to_date: cert?.g702.l4 ?? 0, certified_retainage: cert?.g702.l5 ?? 0, retainage_held: s.retainage_held });
}

function render(job: Job, r: Awaited<ReturnType<typeof compute>>, head: string) {
  return [
    ...LEDGER_VIEW_SPEC, head,
    `Contract ${fmt(r.job.contract)} · Estimate ${fmt(r.job.estimate)} · Cost ${fmt(r.job.cost)} · Billed ${fmt(r.job.billed)} · Earned ${fmt(r.job.earned)} · ${overUnderLabel(r.job.over_under)}`,
    ...r.lines.map((l) => `- ${l.code} ${l.description} · cost ${fmtBp(l.cost_bp)} · billed ${fmtBp(l.billed_bp)} · earned ${fmt(l.earned)}${l.alert ? ` · ALERT fade ${fmtBp(l.ahead_bp)} ahead` : ""}`),
    ...r.ties.map((t) => `${t.ok ? "✓" : "✗"} ${t.id} ${t.label}${t.ok ? "" : ` · misses by ${fmt(Math.abs(t.diff))}`}`),
    ...r.blocks.map((b) => `BLOCK ${b}`),
  ].join("\n");
}

const lineIn = z.object({ code: z.string().trim().min(1).max(20), description: z.string().trim().max(120), contract: money, estimate: money, cost_to_date: money, billed_to_date: money });
const toLine = (l: z.infer<typeof lineIn>): LedgerLine => ({ code: l.code, description: l.description, contract: toCents(l.contract), estimate: toCents(l.estimate), cost_to_date: toCents(l.cost_to_date), billed_to_date: toCents(l.billed_to_date) });

export const jobCostsImport = defineTool({
  name: "job_costs_import",
  title: "Import job costs (after approval)",
  description: "Stores the job cost rows from the accounting export (the host reads the file) with the export's printed control total. Replaces the previous import; the ledger re-ties on the next preview. Call only after the user says yes. Full job access only.",
  inputSchema: { job_number: jobNumber, company_id: companyId, approved: z.literal(true), source: z.string().trim().min(1).max(200).describe("File name of the export."), control_total: money, rows: z.array(z.object({ code: z.string().trim().min(1).max(20), amount: money, date, vendor: z.string().max(120).optional(), ref: z.string().max(60).optional() })).min(1).max(5000) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    run("job_costs_import", ctx, { jobNumber: args.job_number }, async (sb) => {
      requireApproved(args);
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      accountingScope(job, "dollars");
      const rows = args.rows.map((r) => ({ ...r, amount: toCents(r.amount) }));
      const total = toCents(args.control_total);
      const got = rows.reduce((s, r) => s + r.amount, 0);
      await rpc(sb, "mcp_job_costs_import", { _job: job.job_id, _source: args.source, _rows: rows, _control_total: total });
      await audit(sb, job, "job_costs_import", "import_job_costs", null);
      return guide(text(`${prefix(job)}Imported ${rows.length} cost rows from ${args.source}: ${fmt(got)} against a control total of ${fmt(total)}${got === total ? " (ties)." : `. It misses by ${fmt(Math.abs(got - total))}; the ledger can't be saved until it ties.`}`), "Next move: run ledger_preview.");
    }),
});

export const ledgerGet = defineTool({
  name: "ledger_get",
  title: "Show the job cost ledger",
  description: "The saved ledger with cost-to-cost earned, over/under billing, fade and ties T1–T7. Files: Excel by default; a Google Sheet only when Drive is connected and the user asks. Dollars: supers can't see it. Read-only.",
  inputSchema: { job_number: jobNumber, company_id: companyId, google_sheet: z.boolean().optional().describe("The user asked for a Google Sheet."), drive_connected: z.boolean().optional() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    run("ledger_get", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      accountingScope(job, "dollars");
      const s = await stored(sb, job);
      if (!s || !s.version) return guide(text(`${prefix(job)}No ledger saved yet.`), "Next move: import job costs, then ledger_preview.");
      const r = await compute(sb, job, s);
      const tz = await jobTimeZone(sb, job.job_id);
      const f = fileFormat(!!args.drive_connected, !!args.google_sheet);
      await audit(sb, job, "ledger_get", "view_ledger", null);
      return guide({ ...text(`${prefix(job)}${render(job, r, `Job Cost Ledger · ${job.job_number} · v${s.version}${s.at ? ` · Last updated ${versionStamp(s.at, tz, s.by)}` : ""}`)}\nFile: ${f.format === "xlsx" ? `${job.job_number}-Ledger.xlsx` : "Google Sheet"} (${f.reason})`), structuredContent: { version: s.version, job: r.job, lines: r.lines, ties: r.ties, blocks: r.blocks, file: f } }, r.blocks.length ? "Next move: fix the tie that misses before anything is saved." : "Next move: offer the file.");
    }),
});

const ledgerArgs = { job_number: jobNumber, company_id: companyId, contract_sum: money, estimate_total: money, retainage_held: money, lines: z.array(lineIn).min(1).max(500) };

export const ledgerPreview = defineTool({
  name: "ledger_preview",
  title: "Preview a ledger update",
  description: "Computes the ledger from these lines, the latest cost import and the last certified pay app, with every tie. Saves nothing. Read-only.",
  inputSchema: ledgerArgs,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    run("ledger_preview", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      accountingScope(job, "dollars");
      const s = await stored(sb, job);
      const r = await compute(sb, job, { contract_sum: toCents(args.contract_sum), estimate_total: toCents(args.estimate_total), retainage_held: toCents(args.retainage_held), lines: args.lines.map(toLine), import: s?.import ?? null });
      return guide({ ...text(`${prefix(job)}${render(job, r, `Job Cost Ledger preview · ${job.job_number} · base v${s?.version ?? 0}`)}`), structuredContent: { base_version: s?.version ?? 0, job: r.job, ties: r.ties, blocks: r.blocks } }, r.blocks.length ? "Next move: this can't be saved until every tie passes." : "Next move: ask \"Save this ledger?\" On yes call ledger_save.");
    }),
});

export const ledgerSave = defineTool({
  name: "ledger_save",
  title: "Save the ledger (after approval)",
  description: "Saves the next ledger version. Refuses when any tie misses by even $0.01. Call only after the user says yes, with base_version. Full job access only.",
  inputSchema: { ...ledgerArgs, approved: z.literal(true), base_version: z.number().int().min(0), change: z.string().trim().min(1).max(300) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: (args, ctx) =>
    run("ledger_save", ctx, { jobNumber: args.job_number }, async (sb) => {
      requireApproved(args);
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      accountingScope(job, "dollars");
      const s = await stored(sb, job);
      requireBase("Job Cost Ledger", s?.version ?? 0, args.base_version);
      const next = { contract_sum: toCents(args.contract_sum), estimate_total: toCents(args.estimate_total), retainage_held: toCents(args.retainage_held), lines: args.lines.map(toLine), import: s?.import ?? null };
      const r = await compute(sb, job, next);
      if (r.blocks.length) throw new ToolError(`${r.blocks.join(" ")} Nothing was saved.`);
      const me = await caller(sb, job.company_id, ctx.getUserId?.());
      const v = await rpc<{ version: number }>(sb, "mcp_ledger_save", { _job: job.job_id, _base_version: args.base_version, _ledger: { contract_sum: next.contract_sum, estimate_total: next.estimate_total, retainage_held: next.retainage_held, lines: next.lines }, _ties: r.ties, _what: args.change, _who: me.name, _tz: await jobTimeZone(sb, job.job_id) });
      await audit(sb, job, "ledger_save", "save_ledger", null);
      return text(`${prefix(job)}Job Cost Ledger v${v.version} saved. Earned ${fmt(r.job.earned)} · ${overUnderLabel(r.job.over_under)}.`);
    }),
});

export const LEDGER_TOOLS = [jobCostsImport, ledgerGet, ledgerPreview, ledgerSave];
