import { fieldPayAppCardModel, presentPayApp } from "../pay-app-card";
// Superintendent tools. Same gate as the others: run() checks auth, the call cap and membership.
// Super can write field data here. Existing tools still treat super as read-only.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { DEFAULT_TZ, todayIn } from "../deadlines";
import { productionPeriod } from "../production-summary";
import { productionClient, productionReportUrl, readSavedProduction } from "../../production-report";
import { previewDailyReminderCard, type ReminderStatus } from "../field-reminder";
import { FileRejected, decodeBase64 } from "../file-share";
import { dbError, isMissingFunction, run, text, type Sb } from "../guard";
import { FULL_ACCESS_MESSAGE, audit, jobTimeZone, named, prefix, resolveJob, type Job } from "../jobs";
import { photoLogPdf } from "../photo-pdf";
import { signedJobPages } from "../board-url";
import type { BoardPage } from "../board-link";
import { isUuid } from "../../report-pages";
import { retainagePct, type SovLineIn } from "../sov";
import {
  PayAppMismatch,
  assembleDaily,
  buildFieldPayApp,
  dailyCard,
  fieldAccess,
  fieldBoardCard,
  fieldCard,
  fieldMoney,
  photoGate,
  progressByItem,
  projectField,
  rateFromLine,
  scheduleProposals,
  sniffPhoto,
  type FieldSource,
} from "../superintendent";
import { guide } from "../visible";
import { listCompaniesAndJobs, namedOrSoleJob } from "./workflow-tools";
import { whichJobAsk } from "../which-job";
import { renderHtml } from "../cards/html";
import { htmlBlock, renderMarkdown } from "../cards/markdown";
import type { CardModel } from "../cards/model";

const jobNumber = z.string().trim().min(1).max(40);
const companyId = z.string().trim().min(1).max(200).optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const READ = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;
const SAVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;
const PHOTO_BUCKET = "athena-progress";

const workIn = z.object({
  work: z.string().trim().min(1).max(400),
  sov_item: z.string().trim().max(20).nullable().optional(),
  activity_id: z.string().trim().max(20).nullable().optional(),
  qty: z.number().nullable().optional(),
  unit: z.string().trim().max(20).nullable().optional(),
  crew: z.number().nullable().optional(),
  hours: z.number().nullable().optional(),
  pct_complete: z.number().min(0).max(100).nullable().optional(),
});

async function call<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>)(fn, args);
  if (error) {
    if (isMissingFunction(error)) throw new ToolError("This isn't available yet. Nothing was changed.");
    dbError(error);
  }
  return data as T;
}

function assertField(job: Job) {
  if (fieldAccess(job.scope) !== "field") throw new ToolError(FULL_ACCESS_MESSAGE);
}

async function boardPages(sb: Sb, job: Job): Promise<Partial<Record<BoardPage, string>>> {
  if (!isUuid(job.job_id)) return {};
  return signedJobPages((fn, args) => sb.rpc(fn, args), job.job_id, job.scope);
}

const boardHref = (pages: Partial<Record<BoardPage, string>>, page: BoardPage) => pages[page] ?? null;

const FIELD_TITLE = "Superintendent field board";
const FIELD_DESCRIPTION =
  'Shows the explicitly requested superintendent field board, also called the field board, the super board, or the superintendent board, including the super\'s plan and what the crew is doing; generic "give me the job board" or "open the project board" requests use report_page_link with page "home" instead.';
const FIELD_ALIAS_DESCRIPTION =
  'Shows an explicitly requested field board, super board, superintendent board, super\'s plan, or what the crew is doing for a job; generic "give me the job board" or "open the project board" requests use report_page_link with page "home" instead.';

async function showFieldBoard(tool: "superintendent_view" | "field_board", sb: Sb, args: { job_number: string; company_id?: string }) {
  const job = await resolveJob(sb, args.job_number, args.company_id);
  assertField(job);
  const raw = await call<FieldSource & { time_zone?: string | null; items?: { id?: string | null; action?: string; owner?: string | null; due?: string | null }[] }>(sb, "mcp_field_board", { _job: job.job_id });
  let zone = DEFAULT_TZ;
  try { zone = raw.time_zone?.trim() ? raw.time_zone : await jobTimeZone(sb, job.job_id); todayIn(zone); } catch { zone = DEFAULT_TZ; }
  const today = todayIn(zone);
  const board = projectField({ ...raw, today });
      await audit(sb, job, tool, "view_field", null);
      const pages = await boardPages(sb, job);
      const field = boardHref(pages, "field");
      const links = {
        field,
        daily: boardHref(pages, "daily"),
        photos: boardHref(pages, "photos"),
        items: boardHref(pages, "items"),
        ior: boardHref(pages, "ior"),
      };
  const card = fieldBoardCard(prefix(job), board, raw.items ?? [], today, links);
  return guide(
    {
      ...text(fieldCard(prefix(job), board, raw.items ?? [], today, links)),
      structuredContent: {
        window: board.window,
        activities: board.rows,
        outside: board.outside,
        page_url: field,
        dashboard_url: field,
        no_financials: true,
        card,
      },
    },
    "Phone-width card. No dollars on this board. Red only for a delay or an overdue item. Each line links to its detail on the dashboard.",
  );
}

type SavedLine = { sov_item: string; activity_id: string; qty: number | null; unit: string | null; pct_complete: number | null; report_date: string };

async function savedLines(sb: Sb, jobId: string): Promise<SavedLine[]> {
  const [days, lines] = await Promise.all([
    sb.from("mcp_daily_reports").select("id, report_date").eq("job_id", jobId),
    sb.from("mcp_daily_work_lines").select("daily_id, sov_item, activity_id, qty, unit, pct_complete").eq("job_id", jobId),
  ]);
  if (days.error) throw new Error(days.error.message);
  if (lines.error) throw new Error(lines.error.message);
  const dateOf = new Map(((days.data ?? []) as { id: string; report_date: string }[]).map((d) => [d.id, d.report_date]));
  return ((lines.data ?? []) as { daily_id: string; sov_item: string; activity_id: string; qty: number | null; unit: string | null; pct_complete: number | null }[])
    .map((l) => ({ ...l, qty: l.qty == null ? null : Number(l.qty), pct_complete: l.pct_complete == null ? null : Number(l.pct_complete), report_date: dateOf.get(l.daily_id) ?? "" }))
    .filter((l) => l.report_date);
}

async function loadSov(sb: Sb, jobId: string): Promise<{ lines: SovLineIn[]; fee: number | null; retainage: number | null }> {
  const [jr, facts] = await Promise.all([
    sb.from("mcp_jobs").select("sov_fee_pct").eq("id", jobId).maybeSingle(),
    sb.from("mcp_job_facts").select("key, value, module").eq("job_id", jobId),
  ]);
  if (jr.error || facts.error) throw new Error(jr.error?.message || facts.error?.message);
  const rows = (facts.data ?? []) as { key: string; value: unknown; module: string }[];
  const lines = rows.filter((f) => f.module === "sov").map((f) => {
    const v = (f.value ?? {}) as { executed_change_order?: string; fee_included?: boolean; description?: string | null; billable_value?: number | null };
    return { executed_change_order: v.executed_change_order, fee_included: v.fee_included, item_no: f.key, description: v.description ?? null, scheduled_value: typeof v.billable_value === "number" ? v.billable_value : null };
  });
  const feeRaw = (jr.data as { sov_fee_pct?: number | null } | null)?.sov_fee_pct;
  const fee = feeRaw == null ? null : Number(feeRaw);
  const ret = rows.find((f) => f.key === "retainage");
  const retText = typeof ret?.value === "string" ? ret.value : ret?.value != null ? JSON.stringify(ret.value) : null;
  return { lines, fee: Number.isFinite(fee) ? fee : null, retainage: retainagePct(retText) };
}

export const superintendentView = defineTool({
  name: "superintendent_view",
  title: FIELD_TITLE,
  description: FIELD_DESCRIPTION,
  inputSchema: { job_number: jobNumber, company_id: companyId },
  annotations: READ,
  handler: (args, ctx) =>
    run("superintendent_view", ctx, { jobNumber: args.job_number }, (sb) => showFieldBoard("superintendent_view", sb, args)),
});

export const fieldBoard = defineTool({
  name: "field_board",
  title: "Field board",
  description: FIELD_ALIAS_DESCRIPTION,
  inputSchema: { job_number: jobNumber, company_id: companyId },
  annotations: READ,
  handler: (args, ctx) =>
    run("field_board", ctx, { jobNumber: args.job_number }, (sb) => showFieldBoard("field_board", sb, args)),
});

export const superintendentActivity = defineTool({
  name: "superintendent_activity",
  title: "Self-perform or sub on an activity",
  description: "Saves whether an activity is self-perform or a sub, and the crew size.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    activity_id: z.string().trim().min(1).max(20),
    self_perform: z.boolean(),
    sub_name: z.string().trim().max(120).nullable().optional(),
    crew_size: z.number().positive().max(500).nullable().optional(),
    confirmed: z.boolean(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("superintendent_activity", ctx, { jobNumber: args.job_number }, async (sb) => {
      if (args.confirmed !== true) throw new ToolError("Ask the superintendent to confirm this activity first. Nothing was saved.");
      const job = await resolveJob(sb, args.job_number, args.company_id);
      assertField(job);
      if (args.self_perform && args.sub_name?.trim()) throw new ToolError("A self-perform activity has no sub. Nothing was saved.");
      if (!args.self_perform && !args.sub_name?.trim()) throw new ToolError("Name the sub on this activity. Nothing was saved.");
      await call(sb, "mcp_field_activity_save", { _job: job.job_id, _activity: args.activity_id, _self: args.self_perform, _sub: args.sub_name ?? null, _crew: args.crew_size ?? null });
      await audit(sb, job, "superintendent_activity", "save_field_activity", args.activity_id);
      const who = args.self_perform ? "Self-perform" : `Sub ${args.sub_name?.trim()}`;
      return guide(
        { ...text(`${prefix(job)}Activity saved. ${who}.${args.crew_size != null && args.self_perform ? ` Crew ${args.crew_size}.` : ""}`), structuredContent: { activity_id: args.activity_id, self_perform: args.self_perform, sub_name: args.self_perform ? null : args.sub_name ?? null, crew_size: args.crew_size ?? null } },
        "Saved. Show the field board again if they want to see it.",
      );
    }),
});

function whichDaily(tool: string, body: string) {
  const lines = body.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("- "));
  const card: CardModel = {
    state: "ask",
    title: "Which job?",
    show_state: false,
    ask: { prompt: whichJobAsk(tool) },
    sections: [{ heading: "Jobs", kind: "list", rows: lines.map((line) => ({ cells: [line.replace(/^- /, "")], tone: "action" as const })) }],
    next_move: "Name the job.",
  };
  return guide(
    { ...text(`${renderMarkdown(card)}\n\n${htmlBlock(renderHtml(card))}`), structuredContent: { card, which_job: true } },
    "Wait for the job.",
  );
}

async function fieldJob(sb: Sb, tool: string, args: { job_number?: string; company_id?: string }): Promise<Job | ReturnType<typeof whichDaily>> {
  const picked = await namedOrSoleJob(sb, args.job_number, args.company_id);
  if (!picked) return whichDaily(tool, await listCompaniesAndJobs(sb, args.company_id, tool));
  const job = await resolveJob(sb, picked.job_number, picked.company_id);
  assertField(job);
  return job;
}

function isJob(value: Job | ReturnType<typeof whichDaily>): value is Job {
  return "job_id" in value;
}

const dailyFields = {
  job_number: jobNumber.optional(),
  company_id: companyId,
  report_date: date.optional(),
  transcript: z.string().trim().max(20000).optional(),
  weather: z.string().trim().max(500).optional(),
  manpower: z.string().trim().max(500).optional(),
  subs_on_site: z.string().trim().max(1000).optional(),
  deliveries: z.string().trim().max(1000).optional(),
  issues: z.string().trim().max(2000).optional(),
  delays: z.string().trim().max(2000).optional(),
  safety: z.string().trim().max(1000).optional(),
  work: z.array(workIn).max(80).optional(),
};

export const dailyReportDraft = defineTool({
  name: "daily_report_draft",
  title: "Assemble a daily report",
  description: "Assembles a daily report from a transcript or typed notes and lists what is still missing.",
  inputSchema: dailyFields,
  annotations: READ,
  handler: (args, ctx) =>
    run("daily_report_draft", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await fieldJob(sb, "daily_report_draft", args);
      if (!isJob(job)) return job;
      const zone = await jobTimeZone(sb, job.job_id);
      const day = args.report_date ?? todayIn(zone);
      const draft = assembleDaily(args);
      await audit(sb, job, "daily_report_draft", "draft_daily", null);
      return guide(
        { ...text(dailyCard(`${named(job)} `, day, draft, false)), structuredContent: { saved: false, report_date: day, ready: draft.ready, follow_ups: draft.follow_ups, draft } },
        draft.ready ? "The daily is complete. Ask the superintendent to confirm, and only after a yes call daily_report_save with confirmed true." : "Ask every still-needed question. Do not save yet.",
      );
    }),
});

export const dailyReportSave = defineTool({
  name: "daily_report_save",
  title: "Save a confirmed daily report",
  description: "Saves a daily report after the superintendent confirms it.",
  inputSchema: { ...dailyFields, confirmed: z.boolean() },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("daily_report_save", ctx, { jobNumber: args.job_number }, async (sb) => {
      if (args.confirmed !== true) throw new ToolError("Ask the superintendent to confirm this daily first. Nothing was saved.");
      const job = await fieldJob(sb, "daily_report_save", args);
      if (!isJob(job)) return job;
      const zone = await jobTimeZone(sb, job.job_id);
      const day = args.report_date ?? todayIn(zone);
      const draft = assembleDaily(args);
      if (!draft.ready) throw new ToolError(`${prefix(job)}Not saved.\n${draft.follow_ups.map((q) => `- ${q}`).join("\n")}`);
      const saved = await call<{ id: string; lines: number }>(sb, "mcp_daily_report_save", {
        _job: job.job_id, _date: day, _confirmed: true,
        _weather: draft.weather, _manpower: draft.manpower, _subs: draft.subs_on_site, _deliveries: draft.deliveries,
        _issues: draft.issues, _delays: draft.delays, _safety: draft.safety, _transcript: args.transcript ?? null,
        _lines: draft.work.map((w) => ({ work: w.work, sov_item: w.sov_item, activity_id: w.activity_id, qty: w.qty, unit: w.unit, crew: w.crew, hours: w.hours, pct_complete: w.pct_complete })),
      });
      await audit(sb, job, "daily_report_save", "save_daily", saved.id);
      const url = boardHref(await boardPages(sb, job), "daily");
      return guide(
        { ...text([...(url ? [`Styled daily (private to your company): ${url}`] : []), dailyCard(`${named(job)} `, day, { ...draft, follow_ups: [], ready: true }, true)].join("\n")), structuredContent: { saved: true, id: saved.id, report_date: day, lines: saved.lines, rates: draft.work.map(rateFromLine).filter(Boolean) } },
        "Saved. Production rates are available to estimating. Percent complete is ready for the pay app and the schedule update. The saved schedule is not changed by this save.",
      );
    }),
});

export const dailyReportGet = defineTool({
  name: "daily_report_get",
  title: "Saved daily report",
  description: "Returns a saved daily report for a job and date.",
  inputSchema: { job_number: jobNumber.optional(), company_id: companyId, report_date: date.optional() },
  annotations: READ,
  handler: (args, ctx) =>
    run("daily_report_get", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await fieldJob(sb, "daily_report_get", args);
      if (!isJob(job)) return job;
      const zone = await jobTimeZone(sb, job.job_id);
      const day = args.report_date ?? todayIn(zone);
      const got = await call<{ found: boolean; weather?: string; manpower?: string; subs_on_site?: string; deliveries?: string; issues?: string; delays?: string; safety?: string; lines?: { work: string; sov_item: string; activity_id: string; qty: number; unit: string; crew: number; hours: number; pct_complete: number | null }[] }>(sb, "mcp_daily_report_get", { _job: job.job_id, _date: day });
      await audit(sb, job, "daily_report_get", "view_daily", null);
      if (!got.found) return guide({ ...text(`${prefix(job)}No daily is saved for ${day}.`), structuredContent: { found: false, report_date: day } }, "Nothing saved for that date.");
      const draft = assembleDaily({ ...got, work: got.lines ?? [] });
      const url = boardHref(await boardPages(sb, job), "daily");
      return guide(
        { ...text([...(url ? [`Styled daily (private to your company): ${url}`] : []), dailyCard(`${named(job)} `, day, { ...draft, follow_ups: [], ready: true }, true)].join("\n")), structuredContent: { found: true, report_date: day, daily: got } },
        "Show the card as saved.",
      );
    }),
});

export const fieldPayApp = defineTool({
  name: "field_pay_app",
  title: "Pay app from daily progress",
  description: "Builds the next pay application from saved daily progress so it ties to the schedule of values.",
  inputSchema: { job_number: jobNumber, company_id: companyId, period_to: date.optional() },
  annotations: READ,
  handler: (args, ctx) =>
    run("field_pay_app", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      assertField(job);
      const lines = await savedLines(sb, job.job_id);
      const period = args.period_to ?? lines.map((l) => l.report_date).sort().at(-1) ?? todayIn(await jobTimeZone(sb, job.job_id));
      const current = progressByItem(lines, [], period);
      const priorDate = lines.map((l) => l.report_date).filter((d) => d < period).sort().at(-1) ?? null;
      const previous = priorDate ? progressByItem(lines, [], priorDate) : [];
      await audit(sb, job, "field_pay_app", "view_pay_app", null);
      if (!fieldMoney(job.scope)) {
        const presented = presentPayApp({
          state: "result", show_state: false, title: `Progress for the next pay app · ${period}`, job: named(job),
          sections: [{ heading: "Percents only. Dollar columns stay with the PM.", kind: "table", columns: ["Item", "Complete", "Installed"], rows: current.map((r) => ({ cells: [r.item_no, r.pct == null ? "Needed" : `${r.pct}%`, r.qty == null ? "Needed" : `${r.qty} ${lines.find((l) => l.sov_item === r.item_no)?.unit ?? ""}`.trim()] })) }],
        });
        return guide({ ...presented, structuredContent: { ...presented.structuredContent, period_to: period, no_financials: true, rows: current } }, "Super view: percents and quantities only. Do not add dollar figures.");
      }
      const sov = await loadSov(sb, job.job_id);
      try {
        const app = buildFieldPayApp(sov.lines, sov.fee, sov.retainage, current, previous);
        const url = boardHref(await boardPages(sb, job), "payapp");
        const presented = presentPayApp(fieldPayAppCardModel(named(job), period, app, url));
        return guide(
          { ...presented, structuredContent: { ...presented.structuredContent, period_to: period, pay_app: { ...app, previous_certificates: null, current_payment_due: null, prior_reported_progress: app.previous_certificates, calculated_progress_difference: app.current_payment_due, checks: app.checks.map((check) => check.replace(/Current payment/g, "Calculated progress difference").replace(/previous certificates/gi, "prior reported progress")), evidence_note: "Daily progress is not an issued invoice, certificate, or payment receipt." }, ties: true } },
          "Show reported progress as a calculation, not issued billing, a certificate, or payment received.",
        );
      } catch (e) {
        if (e instanceof PayAppMismatch) throw new ToolError(`${prefix(job)}The pay app does not tie, so it is not shown.\n${e.message}`);
        throw e;
      }
    }),
});

export const fieldScheduleFeed = defineTool({
  name: "field_schedule_feed",
  title: "Schedule percent from dailies",
  description: "Returns activity percent complete from saved dailies for the schedule update.",
  inputSchema: { job_number: jobNumber, company_id: companyId },
  annotations: READ,
  handler: (args, ctx) =>
    run("field_schedule_feed", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      assertField(job);
      const [lines, cpm] = await Promise.all([
        savedLines(sb, job.job_id),
        call<{ found?: boolean; data?: { activities?: { id: string; name?: string; pct_complete?: number | null }[] } }>(sb, "mcp_living_report_get", { _job: job.job_id, _type: "cpm", _version: null }),
      ]);
      const acts = cpm.data?.activities ?? [];
      const proposals = scheduleProposals(acts, lines);
      await audit(sb, job, "field_schedule_feed", "view_schedule_feed", null);
      const nameOf = new Map(acts.map((a) => [a.id, a.name?.trim() || ""]));
      const body = proposals.length
        ? proposals.map((p) => `- ${nameOf.get(p.activity_id) || "Activity"}: ${p.from_pct == null ? "no saved percent" : `${p.from_pct}%`} → ${p.to_pct}% as of ${p.report_date}`)
        : ["No percent complete is on a saved daily yet."];
      return guide(
        { ...text([`${prefix(job)}Schedule update from dailies`, "The saved schedule is unchanged.", ...body].join("\n")), structuredContent: { proposals, schedule_unchanged: true } },
        "Do not write the CPM from this. The PM approves a schedule update separately.",
      );
    }),
});

export const fieldProductionRates = defineTool({
  name: "field_production_rates",
  title: "Production rates from dailies",
  description: "Returns production rates from confirmed daily hours and quantities.",
  inputSchema: { job_number: jobNumber, company_id: companyId },
  annotations: READ,
  handler: (args, ctx) =>
    run("field_production_rates", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      if (fieldAccess(job.scope) === "none") throw new ToolError(FULL_ACCESS_MESSAGE);
      const { data, error } = await sb.from("mcp_production_rates").select("work, sov_item, activity_id, qty, unit, crew, hours, man_hours, qty_per_man_hour, created_at").eq("job_id", job.job_id).order("created_at", { ascending: false }).limit(100);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { work: string; sov_item: string; activity_id: string; qty: number; unit: string; crew: number; hours: number; man_hours: number; qty_per_man_hour: number }[];
      await audit(sb, job, "field_production_rates", "view_production_rates", null);
      const shown = (n: number) => String(Math.round(Number(n) * 100) / 100);
      const body = rows.length
        ? rows.map((r) => `- ${r.work}: ${shown(r.qty)} ${r.unit} / ${shown(r.man_hours)} man-hours = ${shown(r.qty_per_man_hour)} ${r.unit} per man-hour`)
        : ["No production rates yet. They appear when a daily is confirmed."];
      return guide(
        { ...text([`${prefix(job)}Production rates`, ...body].join("\n")), structuredContent: { rates: rows } },
        "Estimating can use these rates. They are quantities per man-hour, not dollar rates.",
      );
    }),
});

export const fieldProductionSummary = defineTool({
  name: "field_production_summary",
  title: "Production from saved daily reports",
  description: "Shows a period of reported quantities, person-hours and actual production rates from saved daily work. Defaults to the last seven days in the job time zone or standard default; use this_week for the calendar week or provide both dates for a period up to 31 days.",
  inputSchema: { job_number: jobNumber.optional(), company_id: companyId, from_date: date.optional(), to_date: date.optional(), range: z.enum(["last_7_days", "this_week"]).optional() },
  annotations: READ,
  handler: (args, ctx) =>
    run("field_production_summary", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await fieldJob(sb, "field_production_summary", args);
      if (!isJob(job)) return job;
      let period: { from: string; to: string };
      const timeZone = await jobTimeZone(sb, job.job_id);
      try { period = productionPeriod(args.from_date, args.to_date, todayIn(timeZone), args.range); }
      catch (error) { throw new ToolError(error instanceof Error ? error.message : "Choose a valid production period."); }
      const { complete, reports_count, rows, groups } = await readSavedProduction(productionClient(sb), job.job_id, period);
      const reportUrl = productionReportUrl(job.job_id, period);
      await audit(sb, job, "field_production_summary", "view_production_summary", null);
      const shown = (n: number | string) => String(Math.round(Number(n) * 100) / 100);
      const body = rows.length ? rows.map((r) => `- ${r.report_date} · ${r.work} · SOV ${r.sov_item}, activity ${r.activity_id}: ${shown(r.qty)} ${r.unit}, crew ${shown(r.crew)}, ${shown(r.man_hours)} reported person-hours, ${shown(r.qty_per_man_hour)} ${r.unit} per person-hour (saved daily).`) : ["No saved production rows for this period."];
      const totals = groups.map((g) => `- SOV ${g.sov_item}, activity ${g.activity_id}: ${shown(g.quantity)} ${g.unit} / ${shown(g.reported_person_hours)} reported person-hours = ${shown(g.actual_rate)} ${g.unit} per person-hour.`);
      const notes = [complete ? "Coverage: saved rate rows for all daily reports in the selected period, read at request time." : "Coverage is incomplete: at least one daily has more than 80 rate rows; totals cover only the rows shown.", "References are reported, not approved mappings. Person-hours are summed work-line hours and can overlap. Corrections replace earlier saved rows; prior revisions are not available. Planned rates and earned value are unknown."];
      return guide({ ...text([`${prefix(job)}Production from ${period.from} through ${period.to} (${timeZone})`, ...notes, `Production report (sign in with project access): ${reportUrl}`, ...body, ...(totals.length ? ["Reported work-line totals:", ...totals] : [])].join("\n")), structuredContent: { period, time_zone_used: timeZone, complete, reports_count, rows, groups, report_url: reportUrl, planned_rate: null, earned_value: null, source: "current_saved_dailies", references: "reported_unverified" } }, "Show the period and coverage, keep unlike units separate, and explain reported person-hours may overlap. Do not infer prior revisions, planned rates, earned value, invoices or payments.");
    }),
});

export const progressPhotoSave = defineTool({
  name: "progress_photo_save",
  title: "Save a progress photo",
  description: "Stores a progress photo after its date and place on site are confirmed.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    filename: z.string().trim().min(1).max(120),
    content_base64: z.string().min(1).max(12_000_000),
    recognized: z.boolean().optional(),
    date_confirmed: z.boolean().optional(),
    confirmed: z.boolean().optional(),
    taken_on: date.optional(),
    area: z.string().trim().max(160).optional(),
    work: z.string().trim().max(400).optional(),
    sov_item: z.string().trim().max(20).optional(),
    activity_id: z.string().trim().max(20).optional(),
    client_safe: z.boolean().optional(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("progress_photo_save", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      assertField(job);
      const zone = await jobTimeZone(sb, job.job_id);
      const gate = photoGate({ ...args, uploaded_at: new Date().toISOString(), time_zone: zone });
      if (!gate.ok) {
        return guide(
          { ...text([`${prefix(job)}Photo not saved.`, ...gate.questions.map((q) => `- ${q}`)].join("\n")), structuredContent: { saved: false, taken_on: gate.taken_on, questions: gate.questions, client_safe: false } },
          "Do not store the photo until the date and the place are confirmed. The date defaults to the upload time because the camera date is not available.",
        );
      }
      let bytes: Uint8Array;
      try { bytes = decodeBase64(args.content_base64); } catch (e) { throw new ToolError(e instanceof FileRejected ? "The photo data isn't valid. Nothing was saved." : "The photo data isn't valid. Nothing was saved."); }
      const sniffed = sniffPhoto(bytes, args.filename);
      if (!sniffed) throw new ToolError("Use a JPEG, PNG or WebP photo under 8 MB. Nothing was saved.");
      const id = crypto.randomUUID();
      const path = `${job.company_id}/${job.job_id}/${id}/progress.${sniffed.ext}`;
      const up = await sb.storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: sniffed.mime, upsert: false, cacheControl: "no-store" });
      if (up.error) throw new ToolError("The photo wasn't stored. Nothing was saved.");
      try {
        const row = await call<{ linked_daily: boolean; client_safe: boolean }>(sb, "mcp_progress_photo_create", {
          _id: id, _job: job.job_id, _taken: gate.taken_on, _area: args.area, _work: args.work ?? null, _sov: args.sov_item ?? null,
          _activity: args.activity_id ?? null, _client_safe: args.client_safe === true, _path: path, _mime: sniffed.mime, _size: bytes.length,
        });
        const signed = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600);
        await audit(sb, job, "progress_photo_save", "save_photo", id);
        const url = boardHref(await boardPages(sb, job), "photos");
        return guide(
          { ...text([...(url ? [`Styled photo gallery (private to your company): ${url}`] : []), `${prefix(job)}Photo saved for ${gate.taken_on} at ${args.area}.`, row.linked_daily ? "Linked to that day's daily." : "No daily is saved for that date yet.", args.client_safe === true ? "Marked client-safe." : "Internal only."].join("\n")), structuredContent: { saved: true, id, taken_on: gate.taken_on, area: args.area, client_safe: row.client_safe, linked_daily: row.linked_daily, url: signed.data?.signedUrl ?? null, expires_in: 3600 } },
          "The picture link is private and expires. Client-safe is off unless they asked for it.",
        );
      } catch (e) {
        await sb.storage.from(PHOTO_BUCKET).remove([path]);
        throw e;
      }
    }),
});

export const progressPhotos = defineTool({
  name: "progress_photos",
  title: "Progress photo gallery or PDF",
  description: "Returns progress photos for a date range, item, or area.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    date_from: date.optional(),
    date_to: date.optional(),
    item: z.string().trim().max(80).optional(),
    area: z.string().trim().max(160).optional(),
    client_safe: z.boolean().optional(),
    format: z.enum(["gallery", "pdf"]).optional(),
  },
  annotations: READ,
  handler: (args, ctx) =>
    run("progress_photos", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      assertField(job);
      const rows = await call<{ id: string; taken_on: string; area: string; work: string | null; sov_item: string | null; activity_id: string | null; client_safe: boolean; storage_path: string }[]>(sb, "mcp_progress_photos_list", {
        _job: job.job_id, _from: args.date_from ?? null, _to: args.date_to ?? null, _item: args.item ?? null, _area: args.area ?? null, _client_safe: args.client_safe ?? null,
      });
      const photos = await Promise.all(rows.map(async (p) => {
        const signed = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(p.storage_path, 3600);
        return { ...p, url: signed.data?.signedUrl ?? null };
      }));
      await audit(sb, job, "progress_photos", "view_photos", null);
      const pages = await boardPages(sb, job);
      const gallery = boardHref(pages, "photos");
      const captions = photos.length ? photos.map((p) => {
        const label = [p.area, p.work].filter(Boolean).join(" · ") || "Progress photo";
        const href = gallery ? `${gallery}#photo-${p.id}` : null;
        const linked = href ? `[${label}](${href})` : label;
        return `- ${p.taken_on} · ${linked}${p.client_safe ? " · Client-safe" : " · Internal"}`;
      }) : ["No progress photos in this view."];
      const url = boardHref(pages, "photos");
      let pdf: string | null = null;
      if ((args.format ?? "gallery") === "pdf") {
        const bytes = photoLogPdf(`${job.job_number} progress photos`, photos);
        const id = crypto.randomUUID();
        const path = `${job.company_id}/${job.job_id}/${id}/photo-log.pdf`;
        const up = await sb.storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: false, cacheControl: "no-store" });
        if (up.error) throw new ToolError("The photo log wasn't stored.");
        const signed = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600);
        pdf = signed.data?.signedUrl ?? null;
      }
      return guide(
        { ...text([...(url ? [`Styled photo gallery (private to your company): ${url}`] : []), `${prefix(job)}Progress photos`, ...captions].join("\n")), structuredContent: { format: args.format ?? "gallery", photos, pdf_url: pdf, page_url: url } },
        "Show a gallery from the private picture links, or the PDF when one was asked for. Links expire.",
      );
    }),
});

type ReminderPreview = { enabled: boolean; send_local: string; time_zone: string | null; last_sent_on: string | null; job_number: string; job_name: string; recipients: { email: string; name: string | null }[] };

export const dailyReminder = defineTool({
  name: "daily_reminder",
  title: "Daily report reminder",
  description: "Reads or sets when the in-chat daily reminder appears.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    action: z.enum(["get", "set"]),
    enabled: z.boolean().optional(),
    send_time: z.string().trim().max(8).optional(),
    time_zone: z.string().trim().max(80).optional(),
    confirmed: z.boolean().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: (args, ctx) =>
    run("daily_reminder", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      assertField(job);
      if (args.action === "get") {
        const preview = await call<ReminderPreview>(sb, "mcp_field_reminder_preview", { _job: job.job_id });
        await audit(sb, job, "daily_reminder", "view_reminder", null);
        return guide(
          { ...text(`${prefix(job)}Daily reminder is ${preview.enabled ? "on" : "off"} at ${preview.send_local} local time. It shows in the chat. Nothing is emailed.`), structuredContent: { ...preview, sent: false, mode: "card" } },
          "Off until this job turns it on. Do not email this reminder.",
        );
      }
      if (args.confirmed !== true) throw new ToolError("Ask the superintendent to confirm the reminder change first. Nothing was saved.");
      if (args.enabled == null) throw new ToolError("Say whether the reminder is on or off. Nothing was saved.");
      const saved = await call<{ enabled: boolean; send_local: string; time_zone: string | null }>(sb, "mcp_daily_reminder_save", {
        _job: job.job_id, _enabled: args.enabled, _send: args.send_time ?? null, _tz: args.time_zone ?? null,
      });
      await audit(sb, job, "daily_reminder", "save_reminder", null);
      return guide(
        { ...text(`${prefix(job)}Daily reminder is ${saved.enabled ? "on" : "off"} at ${saved.send_local} local time. It shows in the chat. Nothing is emailed.`), structuredContent: { ...saved, sent: false, mode: "card" } },
        "Saving the setting does not send email.",
      );
    }),
});

export const dailyReminderRun = defineTool({
  name: "daily_reminder_run",
  title: "Preview the in-chat daily reminder",
  description: "Previews the in-chat daily reminder without sending email.",
  inputSchema: { job_number: jobNumber, company_id: companyId, preview: z.boolean().optional() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    run("daily_reminder_run", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      assertField(job);
      await audit(sb, job, "daily_reminder_run", args.preview ? "preview_reminder" : "skip_reminder", null);
      if (args.preview !== true) {
        return guide(
          { ...text(`${prefix(job)}Daily reminders show in the chat. Nothing was sent.`), structuredContent: { sent: 0, preview: false, mode: "card" } },
          "Do not email a reminder. The card appears on the first tool call after the job's reminder time.",
        );
      }
      let status: ReminderStatus | null = null;
      try {
        const { data, error } = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>)("mcp_daily_reminder_status", { _job_number: job.job_number });
        if (!error && data && typeof data === "object" && (data as ReminderStatus).found) status = data as ReminderStatus;
      } catch {
        status = null;
      }
      const shown = previewDailyReminderCard({ jobNumber: job.job_number, jobName: status?.job_name || job.name, status });
      return guide(
        { ...text(shown.text), structuredContent: { sent: 0, preview: true, mode: "card", daily_reminder_card: shown.card, daily_reminder_action: "daily_report_draft" } },
        "This is a preview of the in-chat card. Do not email it. Card shown. Do not add text.",
      );
    }),
});
