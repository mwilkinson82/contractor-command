// 0.8.13: job cadence. Saved on the job as one known fact (mcp_job_facts, module scope, key job_cadence) through
// the existing mcp_set_facts function, so no new table or column. Reminders reuse open items (mcp_add_item),
// created only after the PM's clear yes.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, run, text, type Sb } from "../guard";
import { audit, jobTimeZone, prefix, resolveJob, type Job } from "../jobs";
import { todayIn } from "../deadlines";
import { guide } from "../visible";
import { CADENCE_FACT_KEY, CADENCE_ITEMS, CADENCE_REMINDER_ASK, CADENCE_SETUP_SPEC, cadenceCardLines, nextCadenceDate, nextCadenceItem, type Cadence, type CadenceKey } from "../coach";

const jobNumber = z.string().trim().min(1).max(40).describe("Job number, exact match (e.g. 2701).");
const companyId = z.string().trim().min(1).max(200).optional().describe("Only needed if you belong to more than one company. Pass the company name exactly as Athena lists it.");
const item = (d: string) => z.string().trim().min(1).max(200).optional().describe(d);
const READ_WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
// Ask-first: ChatGPT and Claude confirm destructive tools with the member before calling.
const CONFIRM = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

async function rpc<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);
  if (error) dbError(error);
  return data as T;
}

export async function loadCadence(sb: Sb, job: Job): Promise<Cadence> {
  const { data } = await sb.from("mcp_job_facts").select("value, status").eq("job_id", job.job_id).eq("module", "scope").eq("key", CADENCE_FACT_KEY).maybeSingle();
  const row = data as { value?: unknown; status?: string } | null;
  return row?.status === "known" && row.value && typeof row.value === "object" ? (row.value as Cadence) : {};
}

function cadenceResult(job: Job, c: Cadence, head: string) {
  const next = nextCadenceItem(c);
  const items = CADENCE_ITEMS.map((i) => ({ key: i.key, label: i.label, value: c[i.key] ?? null, default: i.default }));
  if (next) {
    const n = CADENCE_ITEMS.findIndex((i) => i.key === next.key) + 1;
    return guide(
      { ...text(`${prefix(job)}${head}Job cadence ${n} of 6: ${next.ask}\nSuggested: ${next.default}`), structuredContent: { complete: false, next_item: next.key, cadence: items } },
      ...CADENCE_SETUP_SPEC,
      `Ask only this one question now (with the suggested default), then save the answer with job_cadence action save, ${next.key}.`,
    );
  }
  return guide(
    { ...text(`${prefix(job)}${head}${cadenceCardLines(c).join("\n")}\n\n${CADENCE_REMINDER_ASK}`), structuredContent: { complete: true, next_item: null, cadence: items, reminders_ask: CADENCE_REMINDER_ASK } },
    `Show the styled "Job cadence" card (white card, navy title, blue #2563EB labels, gray values) and ask "${CADENCE_REMINDER_ASK}" Call job_cadence_reminders with approved true only after a clear yes. If "Not now", say in one line why reminders help (so nothing slips) and move on.`,
  );
}

export const jobCadence = defineTool({
  name: "job_cadence",
  title: "Job cadence",
  description:
    "Read or save the job cadence after the CPM is built: weekly PM/OAC meeting, two-week lookahead day, daily update time, morning briefing time, pay app dates (pencil draft, cutoff, submission) and the schedule update cycle. Ask the six one at a time with the suggested default; save each answer as you go. When all six are set, show the Job cadence card and ask whether to set them up as reminders. Saving the cadence never creates reminders.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    action: z.enum(["get", "save"]).describe("get: the saved cadence and the next question. save: record the answers given (any of the six)."),
    pm_meeting: item("Weekly PM/OAC meeting day and time, e.g. Tue 10:00."),
    lookahead_day: item("Two-week lookahead day, e.g. Thu, issued to subs Fri."),
    daily_update_time: item("When daily updates are due from the field, e.g. 4:00 PM daily."),
    morning_briefing_time: item("Morning briefing time, e.g. 7:00 AM workdays."),
    pay_app_dates: item("Pay app pencil draft day, cutoff and submission day, from the contract."),
    update_cycle: item("Schedule update cycle, e.g. monthly, data date = pay app cutoff."),
  },
  annotations: READ_WRITE,
  handler: (args, ctx) =>
    run("job_cadence", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id, args.action === "save" ? "write" : undefined);
      const saved = await loadCadence(sb, job);
      if (args.action === "get") {
        await audit(sb, job, "job_cadence", "view_cadence", null);
        return cadenceResult(job, saved, "");
      }
      const given: Cadence = {};
      for (const i of CADENCE_ITEMS) {
        const v = (args as Record<string, unknown>)[i.key];
        if (typeof v === "string" && v.trim()) given[i.key as CadenceKey] = v.trim();
      }
      if (!Object.keys(given).length) throw new ToolError("Give at least one cadence answer to save. Nothing was saved.");
      const merged: Cadence = { ...saved, ...given };
      await rpc(sb, "mcp_set_facts", { _job: job.job_id, _module: "scope", _facts: { [CADENCE_FACT_KEY]: merged }, _source: "member_answer" });
      await audit(sb, job, "job_cadence", "save_cadence", null);
      return cadenceResult(job, merged, `Saved: ${Object.keys(given).map((k) => CADENCE_ITEMS.find((i) => i.key === k)!.label).join(", ")}.\n`);
    }),
});

export const jobCadenceReminders = defineTool({
  name: "job_cadence_reminders",
  title: "Set up job cadence reminders (after a yes)",
  description:
    "REQUIRED: ask the PM first and call this only after they say yes to setting up the cadence reminders. Creates one open-item reminder per saved cadence item on the job (already-open reminders are kept, not duplicated). Never call it on your own.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    approved: z.literal(true).describe("true only after the PM said yes to setting up these reminders."),
    items: z.array(z.enum(CADENCE_ITEMS.map((i) => i.key) as [CadenceKey, ...CadenceKey[]])).max(6).optional().describe("Only these cadence items; default all six that are saved."),
  },
  annotations: CONFIRM,
  handler: (args, ctx) =>
    run("job_cadence_reminders", ctx, { jobNumber: args.job_number }, async (sb) => {
      if (args.approved !== true) throw new ToolError(`Ask the PM first: "${CADENCE_REMINDER_ASK}" Nothing was created.`);
      const job = await resolveJob(sb, args.job_number, args.company_id, "write");
      const c = await loadCadence(sb, job);
      const want = CADENCE_ITEMS.filter((i) => (!args.items?.length || args.items.includes(i.key)) && c[i.key]?.trim());
      if (!want.length) throw new ToolError("No cadence is saved yet. Set it up with job_cadence first. Nothing was created.");
      const today = todayIn(await jobTimeZone(sb, job.job_id));
      const made: { key: string; item_id: string; existing: boolean; needed_by: string }[] = [];
      for (const i of want) {
        const value = c[i.key]!.trim();
        const r = await rpc<{ item_id: string; existing: boolean; needed_by?: string }>(sb, "mcp_add_item", {
          _job: job.job_id,
          _f: {
            check_key: `cadence:${i.key}`, action: `${i.label}: ${value}`, kind: "general", category: "Job cadence",
            needed_by: nextCadenceDate(value, today), source: "member_answer", tool: "job_cadence_reminders", internal_only: false,
            why: "Job cadence the PM set up, so the meeting, lookahead, pay app and schedule update stay in sync.",
          },
        });
        made.push({ key: i.key, item_id: r.item_id, existing: !!r.existing, needed_by: r.needed_by ?? nextCadenceDate(value, today) });
      }
      await audit(sb, job, "job_cadence_reminders", "create_cadence_reminders", null);
      const lines = made.map((m) => `- ${CADENCE_ITEMS.find((i) => i.key === m.key)!.label}: ${m.existing ? "already set" : `reminder set, next ${m.needed_by}`}`);
      return { ...text(`${prefix(job)}Cadence reminders:\n${lines.join("\n")}`), structuredContent: { reminders: made } };
    }),
});
