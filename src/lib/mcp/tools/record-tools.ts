// Phase 6 tools: Project Record get (read-only) and save (a versioned snapshot after approval).
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, text, type Sb } from "../guard";
import { audit, jobTimeZone, prefix, resolveJob, type Job } from "../jobs";
import { guide } from "../visible";
import { caller, rpc, rpcSoft } from "../accounting/db";
import { fmt } from "../accounting/cents";
import { accountingScope, requireApproved, requireBase } from "../accounting/foundations";
import { R3_REFUSAL, RECORD_VIEW_SPEC, asksForDollars, buildRecord, type Audience, type SectionBody, type SectionKey } from "../accounting/project-record";
import { alert, overdueAcross, summary, LOG_LABEL } from "../accounting/logs";
import { arSection } from "../accounting/ar";
import { overUnderLabel } from "../accounting/ledger";
import { todayIn } from "../deadlines";
import { logsFor } from "./log-tools";
import { payAppsFor } from "./payapp-tools";
import { toReceivables } from "./ar-tools";
import { compute, stored } from "./ledger-tools";
import { paymentTermLines, retainageRuleLines, savedPaymentTerms, savedRetainageRule } from "./accounting-tools";

const companyId = z.string().trim().min(1).max(200).optional().describe("Only needed if you belong to more than one company.");
const jobNumber = z.string().trim().min(1).max(40).describe("Job number, exact match (e.g. 2701).");

type Body = Omit<SectionBody, "key">;

export async function composeRecord(sb: Sb, job: Job, asOf: string) {
  const audience: Audience = job.scope === "super" ? "super" : "full";
  const { entries } = await logsFor(sb, job, null);
  const over = overdueAcross(entries, asOf);
  const b: Partial<Record<SectionKey, Body>> = {
    summary: { lines: [`${job.job_number} ${job.name}`, `${over.length} overdue item${over.length === 1 ? "" : "s"} across all logs`], alerts: over.length },
    logs: { lines: (["rfi", "submittal", "change_order", "transmittal"] as const).map((t) => { const s = summary(entries.filter((e) => e.log_type === t), asOf); return `${LOG_LABEL[t]}: open ${s.open} · overdue ${s.overdue}`; }), alerts: over.filter((o) => o.log_type !== "notice").length },
    notices: { lines: entries.filter((e) => e.log_type === "notice" && !e.closed).map((e) => `${e.number} ${e.title} · due ${e.due ?? "Needed"}${alert(e, asOf).on ? ` · ALERT ${alert(e, asOf).reason}` : ""}`), alerts: entries.filter((e) => e.log_type === "notice" && alert(e, asOf).on).length },
  };
  if (audience === "full") {
    const [ret, terms, apps, ar, led] = await Promise.all([savedRetainageRule(sb, job), savedPaymentTerms(sb, job), payAppsFor(sb, job), rpcSoft<Parameters<typeof toReceivables>[0]>(sb, "mcp_ar_items", { _company: job.company_id, _job_number: job.job_number }), stored(sb, job)]);
    b.contract = { lines: [...retainageRuleLines(ret), ...paymentTermLines(terms)], alerts: 0 };
    b.pay_apps = { lines: apps.map((a) => `App ${String(a.app_no).padStart(2, "0")} · to ${a.period_to} · ${a.status} · due this period ${fmt(a.g702.l8)} · received ${fmt(a.received)}`), alerts: 0 };
    const r = toReceivables(ar ?? []);
    const sec = arSection(r.items, asOf);
    b.ar = { lines: sec.lines, alerts: sec.overdue.length };
    if (led?.version) { const m = await compute(sb, job, led); b.ledger = { lines: [`Earned ${fmt(m.job.earned)} · ${overUnderLabel(m.job.over_under)}`, ...m.lines.filter((l) => l.alert).map((l) => `ALERT ${l.code} fade`)], alerts: m.lines.filter((l) => l.alert).length + m.blocks.length }; }
  }
  return { audience, ...buildRecord(audience, b) };
}

export const projectRecordGet = defineTool({
  name: "project_record_get",
  title: "Show the Project Record",
  description: "The job's Project Record, sections in a fixed order. Owner, all-access and accounting see dollars on every job; a PM sees dollars on their own jobs (D9); supers see it with no dollar sections. If a super asks for dollars, pass their question as question and Athena declines. Read-only.",
  inputSchema: { job_number: jobNumber, company_id: companyId, question: z.string().max(500).optional() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    run("project_record_get", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      accountingScope(job, "schedule_logs");
      if (job.scope === "super" && args.question && asksForDollars(args.question)) return text(`${prefix(job)}${R3_REFUSAL}`);
      const r = await composeRecord(sb, job, todayIn(await jobTimeZone(sb, job.job_id)));
      if (!r.count.ok) throw new ToolError("The Project Record didn't build every section. Nothing is shown rather than a partial record.");
      await audit(sb, job, "project_record_get", "view_project_record", null);
      return guide({ ...text(`${prefix(job)}${[...RECORD_VIEW_SPEC, ...r.sections.flatMap((s, i) => [`${i + 1}. ${s.title}${s.alerts ? ` · ${s.alerts} alert${s.alerts === 1 ? "" : "s"}` : ""}`, ...s.lines.map((l) => `- ${l}`)])].join("\n")}`), structuredContent: { audience: r.audience, sections: r.sections, count: r.count } }, "Next move: offer the PDF.");
    }),
});

export const projectRecordSave = defineTool({
  name: "project_record_save",
  title: "Save a Project Record version (after approval)",
  description: "Saves the current Project Record as the next version with a change log line. Call only after the user says yes, with base_version. Full job access only.",
  inputSchema: { job_number: jobNumber, company_id: companyId, approved: z.literal(true), base_version: z.number().int().min(0), change: z.string().trim().min(1).max(300) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: (args, ctx) =>
    run("project_record_save", ctx, { jobNumber: args.job_number }, async (sb) => {
      requireApproved(args);
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      accountingScope(job, "dollars");
      const cur = (await rpcSoft<{ version: number }>(sb, "mcp_project_record_get", { _job: job.job_id }))?.version ?? 0;
      requireBase("Project Record", cur, args.base_version);
      const tz = await jobTimeZone(sb, job.job_id);
      const r = await composeRecord(sb, job, todayIn(tz));
      if (!r.count.ok) throw new ToolError(`The section count is off (${r.count.got} of ${r.count.expected}). Nothing was saved.`);
      const me = await caller(sb, job.company_id, ctx.getUserId?.());
      const v = await rpc<{ version: number }>(sb, "mcp_project_record_save", { _job: job.job_id, _base_version: args.base_version, _sections: r.sections, _what: args.change, _who: me.name, _tz: tz });
      await audit(sb, job, "project_record_save", "save_project_record", null);
      return text(`${prefix(job)}Project Record v${v.version} saved (${r.count.got} sections). ${args.change}`);
    }),
});

export const RECORD_TOOLS = [projectRecordGet, projectRecordSave];
