// Phase 3: living logs. log_get is read-only; log_save writes one entry after the user's yes, with base_version.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, text } from "../guard";
import { audit, jobTimeZone, prefix, resolveJob, type Job } from "../jobs";
import { guide } from "../visible";
import { caller, rpc } from "../accounting/db";
import { accountingScope, requireApproved, requireBase, versionStamp } from "../accounting/foundations";
import { LOG_LABEL, LOG_TYPES, LOG_VIEW_SPEC, alert, daysOpen, entryNumber, nextMoveFor, overdueAcross, summary, type LogEntry, type LogType } from "../accounting/logs";
import { todayIn } from "../deadlines";
import type { Sb } from "../guard";

const companyId = z.string().trim().min(1).max(200).optional().describe("Only needed if you belong to more than one company.");
const jobNumber = z.string().trim().min(1).max(40).describe("Job number, exact match (e.g. 2701).");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const logType = z.enum(LOG_TYPES);

type Ver = { version: number; at: string; by: string | null; what: string };
type Listed = { entries: (LogEntry & { id: string })[]; versions: Record<string, Ver> };

export async function logsFor(sb: Sb, job: Job, t: LogType | null): Promise<Listed> {
  const r = await rpc<Listed>(sb, "mcp_log_list", { _job: job.job_id, _log_type: t });
  return { entries: r?.entries ?? [], versions: r?.versions ?? {} };
}

export const logGet = defineTool({
  name: "log_get",
  title: "Show a living log, or what's overdue across all logs",
  description: "One log (RFI, submittal, change order, transmittal, pay app, notice) as one styled view with its summary strip, or every log with the overdue list across all of them (\"What's overdue on 2701?\"). Viewing never changes the master. Supers can see logs (no dollars). Read-only.",
  inputSchema: { job_number: jobNumber, company_id: companyId, log_type: logType.optional().describe("Leave out for all logs."), as_of: date.optional() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    run("log_get", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      accountingScope(job, "schedule_logs");
      const tz = await jobTimeZone(sb, job.job_id);
      const asOf = args.as_of ?? todayIn(tz);
      const { entries, versions } = await logsFor(sb, job, args.log_type ?? null);
      const types = args.log_type ? [args.log_type] : LOG_TYPES.filter((t) => entries.some((e) => e.log_type === t));
      const out: string[] = [...LOG_VIEW_SPEC];
      for (const t of types) {
        const es = entries.filter((e) => e.log_type === t);
        const v = versions[`log:${t}`];
        const s = summary(es, asOf);
        out.push(`${LOG_LABEL[t]} · ${job.job_number} · v${v?.version ?? 0}${v ? ` · Last updated ${versionStamp(v.at, tz, v.by)}` : ""}`);
        out.push(`Open ${s.open} · Overdue ${s.overdue} · Closed this month ${s.closed_this_month} · Avg days to answer ${s.avg_days_to_answer ?? "–"}`);
        for (const e of es) { const a = alert(e, asOf); out.push(`- ${e.number} ${e.title} · ${e.ball_in_court ? `${e.ball_in_court.name}${e.ball_in_court.company ? `, ${e.ball_in_court.company}` : ""}` : "–"} · due ${e.due ?? "Needed"} · ${daysOpen(e, asOf)} days open · ${e.status}${a.on ? ` · ALERT ${a.reason}` : ""}`); }
      }
      const over = overdueAcross(entries, asOf);
      if (!args.log_type) out.push(`Overdue across all logs: ${over.length}`, ...over.map((o) => `- ${o.number} ${o.title}: ${o.reason}`));
      await audit(sb, job, "log_get", "view_log", null);
      return guide({ ...text(`${prefix(job)}${out.join("\n")}`), structuredContent: { as_of: asOf, entries: entries.map((e) => ({ ...e, days_open: daysOpen(e, asOf), alert: alert(e, asOf) })), versions, overdue: over } }, `Next move: ${nextMoveFor(over)}`);
    }),
});

const person = z.object({ name: z.string().trim().min(1).max(120), company: z.string().trim().max(120).nullable().optional() });

export const logSave = defineTool({
  name: "log_save",
  title: "Add or update a log entry (after approval)",
  description: "Adds an entry (the next per-job number is assigned) or updates one (answer, close, ball in court, due date, notice sent). Call only after the user says yes, with the log's current version as base_version. Full job access only.",
  inputSchema: {
    job_number: jobNumber, company_id: companyId, approved: z.literal(true), base_version: z.number().int().min(0),
    log_type: logType, id: z.string().uuid().optional().describe("Entry to update; leave out to add."),
    title: z.string().trim().min(1).max(200).optional(), opened: date.optional(), due: date.nullable().optional().describe("From the contract clause. Null shows Needed."),
    closed: date.nullable().optional(), status: z.string().trim().max(40).optional(), ball_in_court: person.optional(),
    condition_precedent: z.boolean().optional(), sent: date.nullable().optional(), spec_section: z.string().trim().max(20).optional(), revision: z.number().int().min(0).max(99).optional(),
    change: z.string().trim().min(1).max(300).describe("What changed, for the change log."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: (args, ctx) =>
    run("log_save", ctx, { jobNumber: args.job_number }, async (sb) => {
      requireApproved(args);
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      accountingScope(job, "write");
      const { entries, versions } = await logsFor(sb, job, args.log_type);
      requireBase(LOG_LABEL[args.log_type], versions[`log:${args.log_type}`]?.version ?? 0, args.base_version);
      let number: string | null = null;
      if (!args.id) {
        if (!args.title || !args.opened) throw new ToolError("A new entry needs a title and the date it was sent or opened. Nothing was saved.");
        const n = await rpc<number>(sb, "mcp_next_number", { _company: job.company_id, _job: job.job_id, _seq_type: `log:${args.log_type}` });
        number = entryNumber(args.log_type, n, { spec_section: args.spec_section, revision: args.revision });
      } else if (!entries.some((e) => e.id === args.id)) throw new ToolError("That entry is not in this log. Nothing was saved.");
      if (args.closed && args.opened && args.closed < args.opened) throw new ToolError("The closed date is before the opened date. Nothing was saved.");
      const me = await caller(sb, job.company_id, ctx.getUserId?.());
      const { job_number: _j, company_id: _c, approved: _a, base_version: _b, change, spec_section: _s, revision: _r, ...entry } = args;
      const r = await rpc<{ id: string; version: number }>(sb, "mcp_log_save", { _job: job.job_id, _base_version: args.base_version, _entry: entry, _number: number, _what: change, _who: me.name, _tz: await jobTimeZone(sb, job.job_id) });
      await audit(sb, job, "log_save", "save_log_entry", r.id);
      return text(`${prefix(job)}${LOG_LABEL[args.log_type]} v${r.version}: ${number ? `${number} added` : "entry updated"}. ${change}`);
    }),
});

export const LOG_TOOLS = [logGet, logSave];
