import { fieldPayAppCardModel, presentPayApp } from "../pay-app-card";
// Superintendent tools. Same gate as the others: run() checks auth, the call cap and membership.
// Super can write field data here. Existing tools still treat super as read-only.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { DEFAULT_TZ, todayIn } from "../deadlines";
import { productionPeriod, productionRef } from "../production-summary";
import { productionClient, productionReportUrl, readSavedProduction } from "../../production-report";
import { previewDailyReminderCard, type ReminderStatus } from "../field-reminder";
import { fetchAllowedFile } from "../file-upload";
import { drawingFile } from "../drawing-file-input";
import { dbError, isMissingFunction, run, text, type Sb } from "../guard";
import { FULL_ACCESS_MESSAGE, audit, jobTimeZone, named, prefix, resolveJob, type Job } from "../jobs";
import { photoLogPdf } from "../photo-pdf";
import { pdfContractorBrand } from "../document-email-brand";
import { dailyRangePdf, type PdfPhoto, type PdfPhotoSkip } from "../../daily-range-pdf";
import { DAILY_RANGE_MAX_DAYS, PHOTO_MODES, dailyRangeClient, dailyRangePdfName, dailyRangeUrl, readDailyRange } from "../../daily-range-report";
import { FILE_MAX_BYTES, FileRejected, decodeBase64, fmtDate, kindAllowed, validateFile } from "../file-share";
import { LOOKAHEAD_PDF_EMAIL_RULE } from "../email-safety";
import { storeFile } from "./file-tools";
import { signedJobPages } from "../board-url";
import type { BoardPage } from "../board-link";
import { isUuid } from "../../report-pages";
import { retainagePct, type SovLineIn } from "../sov";
import {
  PayAppMismatch,
  assembleDaily,
  linkAnswer,
  savedLink,
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
  photoImageInfo,
  photoQualityProblem,
  PHOTO_MAX_BYTES,
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
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const SAVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;
const PHOTO_BUCKET = "athena-progress";

const workIn = z.object({
  work: z.string().trim().min(1).max(400),
  sov_item: z.string().trim().max(40).nullable().optional(),
  activity_id: z.string().trim().max(40).nullable().optional(),
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

/** Photos page narrowed to one day and/or opened on one photo. Keeps the page's own query (its access token). */
export function photoPageHref(url: string | null, date?: string | null, id?: string | null): string | null {
  if (!url) return null;
  const [base, hash] = url.split("#");
  const parsed = new URL(base, "https://athena.invalid");
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) parsed.searchParams.set("date", date);
  const path = base.startsWith("http") ? parsed.toString() : `${parsed.pathname}${parsed.search}`;
  const anchor = id ? `photo-${id}` : hash;
  return anchor ? `${path}#${anchor}` : path;
}

/** The photos page with the Add photos form open for that date and place, for a chat that can't pass the file. */
export function photoAddHref(url: string | null, date?: string | null, area?: string | null): string | null {
  const page = photoPageHref(url, date);
  if (!page) return null;
  const [base] = page.split("#");
  const parsed = new URL(base, "https://athena.invalid");
  parsed.searchParams.set("add", "1");
  if (area?.trim()) parsed.searchParams.set("area", area.trim().slice(0, 160));
  return base.startsWith("http") ? parsed.toString() : `${parsed.pathname}${parsed.search}`;
}

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

type SavedLine = { sov_item: string | null; activity_id: string | null; qty: number | null; unit: string | null; pct_complete: number | null; report_date: string };

async function savedLines(sb: Sb, jobId: string): Promise<SavedLine[]> {
  const [days, lines] = await Promise.all([
    sb.from("mcp_daily_reports").select("id, report_date").eq("job_id", jobId),
    sb.from("mcp_daily_work_lines").select("daily_id, sov_item, activity_id, qty, unit, pct_complete").eq("job_id", jobId),
  ]);
  if (days.error) throw new Error(days.error.message);
  if (lines.error) throw new Error(lines.error.message);
  const dateOf = new Map(((days.data ?? []) as { id: string; report_date: string }[]).map((d) => [d.id, d.report_date]));
  return ((lines.data ?? []) as { daily_id: string; sov_item: string | null; activity_id: string | null; qty: number | null; unit: string | null; pct_complete: number | null }[])
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
  // The member said this job has no schedule of values / no CPM schedule: lines save without that link.
  no_sov: z.boolean().optional(),
  no_cpm: z.boolean().optional(),
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
  description: "Saves a daily report (crew, work done, weather, deliveries, issues) to the job after the superintendent confirms it, so it shows on the job board.",
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
        _lines: draft.work.map((w) => ({ work: w.work, sov_item: savedLink(w.sov_item), activity_id: savedLink(w.activity_id), qty: w.qty, unit: w.unit, crew: w.crew, hours: w.hours, pct_complete: w.pct_complete })),
      });
      await audit(sb, job, "daily_report_save", "save_daily", saved.id);
      const url = boardHref(await boardPages(sb, job), "daily");
      return guide(
        { ...text([...(url ? [`Styled daily (private to your company): ${url}`] : []), dailyCard(`${named(job)} `, day, { ...draft, follow_ups: [], ready: true }, true)].join("\n")), structuredContent: { saved: true, id: saved.id, report_date: day, lines: saved.lines, rates: draft.work.map(rateFromLine).filter(Boolean) } },
        "Saved. Production rates are available to estimating. Percent complete is ready for the pay app and the schedule update. The saved schedule is not changed by this save. If the superintendent shared progress photos for this day that are not saved yet, save each one with progress_photo_save using the attached file; the daily alone does not store them.",
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
  title: "Daily progress preview",
  description: "Previews reported daily progress against the SOV and does not save a formal payment application or certificate; use payment_application_read and payment_application_record for that workflow.",
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
          { ...presented, structuredContent: { ...presented.structuredContent, period_to: period, pay_app: { ...app, previous_certificates: null, current_payment_due: null, prior_reported_progress: app.previous_certificates, calculated_progress_difference: app.current_payment_due, checks: app.checks.map((check) => check.replace(/Current payment/g, "Calculated progress difference").replace(/previous certificates/gi, "prior reported progress")), evidence_note: "Daily progress is not an issued invoice, certificate, or payment receipt." }, ties: app.completed_and_stored !== null && app.retainage !== null } },
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
      const body = rows.length ? rows.map((r) => `- ${r.report_date} · ${r.work} · ${productionRef(r.sov_item, r.activity_id)}: ${shown(r.qty)} ${r.unit}, crew ${shown(r.crew)}, ${shown(r.man_hours)} reported person-hours, ${shown(r.qty_per_man_hour)} ${r.unit} per person-hour (saved daily).`) : ["No saved production rows for this period."];
      const totals = groups.map((g) => `- ${productionRef(g.sov_item, g.activity_id)}${g.sov_item || g.activity_id ? "" : ` (${g.work})`}: ${shown(g.quantity)} ${g.unit} / ${shown(g.reported_person_hours)} reported person-hours = ${shown(g.actual_rate)} ${g.unit} per person-hour.`);
      const notes = [complete ? "Coverage: saved rate rows for all daily reports in the selected period, read at request time." : "Coverage is incomplete: at least one daily has more than 80 rate rows; totals cover only the rows shown.", "References are reported, not approved mappings. Person-hours are summed work-line hours and can overlap. Corrections replace earlier saved rows; prior revisions are not available. Planned rates and earned value are unknown."];
      return guide({ ...text([`${prefix(job)}Production from ${period.from} through ${period.to} (${timeZone})`, ...notes, `Production report (sign in with project access): ${reportUrl}`, ...body, ...(totals.length ? ["Reported work-line totals:", ...totals] : [])].join("\n")), structuredContent: { period, time_zone_used: timeZone, complete, reports_count, rows, groups, report_url: reportUrl, planned_rate: null, earned_value: null, source: "current_saved_dailies", references: "reported_unverified" } }, "Show the period and coverage, keep unlike units separate, and explain reported person-hours may overlap. Do not infer prior revisions, planned rates, earned value, invoices or payments.");
    }),
});

/** What the server can embed without a canvas: JPEG and PNG as stored, inside one shared byte budget. */
const PDF_PHOTO_BUDGET = FILE_MAX_BYTES - 1_500_000;
async function serverPdfPhotos(sb: Sb, photos: { id: string; storage_path: string; mime_type: string; size_bytes: number | null }[]) {
  const out = new Map<string, PdfPhoto | PdfPhotoSkip>();
  let used = 0;
  let skipped = 0;
  for (const p of photos) {
    const format = p.mime_type === "image/jpeg" ? "JPEG" : p.mime_type === "image/png" ? "PNG" : null;
    if (!format) { out.set(p.id, { reason: "Photo on file in Athena in a format this PDF can't draw. Open the report page to include it." }); skipped++; continue; }
    // PNG is recompressed inside the PDF, so it counts a little heavier than its file.
    const cost = Math.ceil((p.size_bytes ?? 0) * (format === "PNG" ? 1.3 : 1));
    if (!p.size_bytes || used + cost > PDF_PHOTO_BUDGET) { out.set(p.id, { reason: "Photo on file in Athena. Left out to keep this PDF under 10 MB. The report page's Download PDF includes every photo." }); skipped++; continue; }
    const file = await sb.storage.from(PHOTO_BUCKET).download(p.storage_path);
    if (file.error || !file.data) { out.set(p.id, { reason: "Photo on file in Athena. It could not be read for this PDF." }); skipped++; continue; }
    out.set(p.id, { data: new Uint8Array(await file.data.arrayBuffer()), format });
    used += cost;
  }
  return { photos: out, skipped };
}

export const dailyReportExport = defineTool({
  name: "daily_report_export",
  title: "Daily reports for a date range (PDF)",
  description: `Builds every saved daily report from date_from through date_to (up to ${DAILY_RANGE_MAX_DAYS} days) into one PDF with work lines and that day's progress photos, for pay apps, T&M change orders and disputes, and returns a download link plus the printable page.`,
  inputSchema: {
    job_number: jobNumber.optional(),
    company_id: companyId,
    date_from: date,
    date_to: date,
    photos: z.enum(PHOTO_MODES).optional(),
    expires_in_days: z.number().int().min(1).max(90).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  handler: (args, ctx) =>
    run("daily_report_export", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await fieldJob(sb, "daily_report_export", args);
      if (!isJob(job)) return job;
      const mode = args.photos ?? "all";
      let report: Awaited<ReturnType<typeof readDailyRange>>;
      try { report = await readDailyRange(dailyRangeClient(sb), job.job_id, { from: args.date_from, to: args.date_to, photos: mode }); }
      catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (/^(Choose|Use valid|This range)/.test(message)) throw new ToolError(`${message} Nothing was made.`);
        throw error;
      }
      const page = dailyRangeUrl(job.job_id, report.period, mode);
      const span = `${report.period.from} to ${report.period.to}`;
      const counts = `${report.dailies_count} saved ${report.dailies_count === 1 ? "daily" : "dailies"}, ${report.no_daily_dates.length} ${report.no_daily_dates.length === 1 ? "day" : "days"} with no daily${mode === "none" ? "" : `, ${report.photos_count} ${report.photos_count === 1 ? "photo" : "photos"}`}`;
      if (!kindAllowed("report", job.scope)) {
        await audit(sb, job, "daily_report_export", "view_daily_range", null);
        return guide(
          { ...text([`${prefix(job)}Daily reports ${span}: ${counts}.`, `Printable report with Download PDF (sign in with project access): ${page}`].join("\n")), structuredContent: { pdf: false, page_url: page, period: report.period, dailies_count: report.dailies_count, photos_count: report.photos_count, no_daily_dates: report.no_daily_dates } },
          "Superintendent access can open the page to print or download it. A shareable file link needs full job access.",
        );
      }
      const embed = await serverPdfPhotos(sb, report.days.flatMap((d) => d.photos));
      const bytes = dailyRangePdf(report, embed.photos, await pdfContractorBrand(sb, job.company_id));
      let f: ReturnType<typeof validateFile>;
      try { f = validateFile(bytes, dailyRangePdfName(job.job_number, report.period.from, report.period.to)); }
      catch (e) { if (e instanceof FileRejected) throw new ToolError(`${e.message} Use the report page's Download PDF instead: ${page}`); throw e; }
      const { id, link, exp } = await storeFile(sb, job, "report", f, bytes, args.expires_in_days);
      await audit(sb, job, "daily_report_export", "share_daily_range_pdf", id);
      return guide(
        {
          ...text([
            `${prefix(job)}Daily reports PDF ready: ${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB). ${counts}.`,
            ...(embed.skipped ? [`${embed.skipped} ${embed.skipped === 1 ? "photo is" : "photos are"} listed with their details but not drawn in this file. The report page's Download PDF includes every photo.`] : []),
            `Download: ${link}`,
            `The link works until ${fmtDate(exp)}. Anyone with it can download the file.`,
            `Printable report (sign in with project access): ${page}`,
          ].join("\n")),
          structuredContent: { pdf: true, download_url: link, filename: f.name, mime_type: f.mime, size_bytes: f.size, page_url: page, period: report.period, photos: mode, dailies_count: report.dailies_count, photos_count: report.photos_count, photos_not_drawn: embed.skipped, no_daily_dates: report.no_daily_dates, expires_at: exp.toISOString(), attached: false },
        },
        `Give the member the download link and the page. Days with no saved daily are listed in the PDF; never fill them in. ${LOOKAHEAD_PDF_EMAIL_RULE(link, f.name)}`,
      );
    }),
});

type StoredPhoto = { id: string; taken_on: string; area: string; work: string | null; removed_at: string | null };
type LoosePhotos = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: unknown) => { eq: (c: string, v: unknown) => { maybeSingle: () => PromiseLike<{ data: unknown; error: { message: string } | null }> } };
    };
  };
};

/** One progress photo on this job, removed or not, or null. */
async function photoOnJob(sb: Sb, jobId: string, id: string): Promise<StoredPhoto | null> {
  const { data, error } = await (sb as unknown as LoosePhotos)
    .from("mcp_progress_photos")
    .select("id,taken_on,area,work,removed_at")
    .eq("job_id", jobId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new ToolError("Athena couldn't read that photo. Nothing was changed.");
  return (data as StoredPhoto | null) ?? null;
}

const photoLabel = (p: StoredPhoto) => `${p.area} (${p.taken_on})`;
const photoId = z.string().trim().uuid();

export const progressPhotoSave = defineTool({
  name: "progress_photo_save",
  title: "Save a progress photo",
  description: "Stores the original progress photo attached in chat, passed as file, after its date and place on site are confirmed, or returns a link to add the original photo when the chat can't pass the file.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    // A photo attached in ChatGPT arrives as file (openai/fileParams), the original as uploaded. There is no
    // photo-bytes field: a model can't hand over a phone photo's bytes, only a small or broken copy of it.
    file: drawingFile,
    filename: z.string().trim().min(1).max(120).optional(),
    recognized: z.boolean().optional(),
    date_confirmed: z.boolean().optional(),
    confirmed: z.boolean().optional(),
    taken_on: date.optional(),
    area: z.string().trim().max(160).optional(),
    work: z.string().trim().max(400).optional(),
    sov_item: z.string().trim().max(40).optional(),
    activity_id: z.string().trim().max(40).optional(),
    client_safe: z.boolean().optional(),
    // Replacing a saved photo: its id from progress_photos, and the member's yes after Athena asks.
    replaces_photo_id: photoId.optional(),
    replace_confirmed: z.boolean().optional(),
    replace_reason: z.string().trim().max(400).optional(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("progress_photo_save", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      assertField(job);
      // "none" means the job has no SOV or CPM; the photo saves without that link.
      const sovItem = savedLink(linkAnswer(args.sov_item));
      const activityId = savedLink(linkAnswer(args.activity_id));
      const zone = await jobTimeZone(sb, job.job_id);
      const gate = photoGate({ ...args, uploaded_at: new Date().toISOString(), time_zone: zone });
      if (!gate.ok) {
        return guide(
          { ...text([`${prefix(job)}Photo not saved.`, ...gate.questions.map((q) => `- ${q}`)].join("\n")), structuredContent: { saved: false, taken_on: gate.taken_on, questions: gate.questions, client_safe: false } },
          "Do not store the photo until the date and the place are confirmed. The date defaults to the upload time because the camera date is not available.",
        );
      }
      // A replacement is checked and confirmed before anything is stored.
      const old = args.replaces_photo_id ? await photoOnJob(sb, job.job_id, args.replaces_photo_id) : null;
      if (args.replaces_photo_id && !old) throw new ToolError("The photo to replace isn't on this job. Nothing was saved.");
      if (old?.removed_at) throw new ToolError(`The ${photoLabel(old)} photo was already removed. Nothing was saved.`);
      if (old && args.replace_confirmed !== true) {
        return guide(
          { ...text([`${prefix(job)}Photo not saved yet.`, `- Replace the ${photoLabel(old)} photo with this one? The old photo is kept in the job's record, marked as replaced, and leaves the gallery and the daily.`].join("\n")), structuredContent: { saved: false, replace_question: true, replaces: { id: old.id, taken_on: old.taken_on, area: old.area }, client_safe: false } },
          "Ask the member to confirm the replacement in their own words, then call again with replace_confirmed true. Never confirm it for them.",
        );
      }
      const photosPage = boardHref(await boardPages(sb, job), "photos");
      const addHref = photoAddHref(photosPage, gate.taken_on, args.area);
      const addInstead = addHref ? ` Add the original photo from the phone here instead: ${addHref}` : "";
      if (!args.file) {
        return guide(
          { ...text([`${prefix(job)}Photo not saved: this chat didn't pass the photo file to Athena.`, ...(addHref ? [`Add the original photo from the phone here (sign in with project access): ${addHref}`] : []), "The date and place you confirmed are filled in on that page."].join("\n")), structuredContent: { saved: false, needs_upload: true, upload_url: addHref, taken_on: gate.taken_on, area: args.area, client_safe: false } },
          "Give the member the link to add the original photo. Don't describe, recreate or re-encode the picture, and don't say it was saved.",
        );
      }
      const filename = args.filename ?? args.file.file_name ?? "progress.jpg";
      let bytes: Uint8Array;
      try { bytes = await fetchAllowedFile(args.file.download_url, PHOTO_MAX_BYTES); }
      catch (e) { throw new ToolError((e instanceof FileRejected ? e.message.replace(/Nothing was stored\.?$/, "Nothing was saved.") : "Athena couldn't read the attached photo. Nothing was saved.") + addInstead); }
      // A chat attachment's name may not carry the real type, so trust its bytes.
      const sniffed = sniffPhoto(bytes, filename) ?? sniffPhoto(bytes, "a.jpg") ?? sniffPhoto(bytes, "a.png") ?? sniffPhoto(bytes, "a.webp");
      if (!sniffed) throw new ToolError("Use a JPEG, PNG or WebP photo under 8 MB. Nothing was saved." + addInstead);
      // The first bytes alone can look like a photo. Check the whole picture is there and is the original size.
      const image = photoImageInfo(bytes, sniffed.ext);
      const problem = photoQualityProblem(image);
      if (problem) throw new ToolError(problem + addInstead);
      const id = crypto.randomUUID();
      const path = `${job.company_id}/${job.job_id}/${id}/progress.${sniffed.ext}`;
      const up = await sb.storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: sniffed.mime, upsert: false, cacheControl: "no-store" });
      if (up.error) throw new ToolError("The photo wasn't stored. Nothing was saved.");
      try {
        const row = await call<{ linked_daily: boolean; client_safe: boolean }>(sb, "mcp_progress_photo_create", {
          _id: id, _job: job.job_id, _taken: gate.taken_on, _area: args.area, _work: args.work ?? null, _sov: sovItem,
          _activity: activityId, _client_safe: args.client_safe === true, _path: path, _mime: sniffed.mime, _size: bytes.length,
        });
        const signed = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600);
        await audit(sb, job, "progress_photo_save", "save_photo", id);
        const url = photoPageHref(photosPage, gate.taken_on, id);
        let replaced: string | null = null;
        if (old) {
          const why = args.replace_reason?.trim() || "Replaced with the original photo file";
          try {
            await call(sb, "mcp_progress_photo_remove", { _id: old.id, _reason: why, _replaced_by: id });
            replaced = `Replaced the ${photoLabel(old)} photo. The old one is kept in the job's record, marked as replaced.`;
          } catch (e) {
            replaced = `The new photo is saved, but the ${photoLabel(old)} photo wasn't replaced: ${e instanceof Error ? e.message : "Athena couldn't change it."}`;
          }
        }
        return guide(
          { ...text([...(url ? [`Styled photo gallery (private to your company): ${url}`] : []), `${prefix(job)}Photo saved for ${gate.taken_on} at ${args.area} (${image!.width} × ${image!.height} pixels).`, row.linked_daily ? "Linked to that day's daily." : "No daily is saved for that date yet. It joins that day's daily when the daily is saved.", args.client_safe === true ? "Marked client-safe." : "Internal only.", ...(replaced ? [replaced] : [])].join("\n")), structuredContent: { saved: true, id, taken_on: gate.taken_on, area: args.area, width: image!.width, height: image!.height, client_safe: row.client_safe, linked_daily: row.linked_daily, url: signed.data?.signedUrl ?? null, expires_in: 3600, ...(old ? { replaced: replaced?.startsWith("Replaced ") === true, replaced_photo_id: old.id } : {}) } },
          "The picture link is private and expires. Client-safe is off unless they asked for it.",
        );
      } catch (e) {
        await sb.storage.from(PHOTO_BUCKET).remove([path]);
        throw e;
      }
    }),
});

export const progressPhotoRemove = defineTool({
  name: "progress_photo_remove",
  title: "Remove a progress photo",
  description: "Removes a saved progress photo from the job's gallery and dailies after the member confirms, keeping it in the job's record with who removed it, when and why.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    photo_id: photoId,
    reason: z.string().trim().max(400).optional(),
    confirmed: z.boolean().optional(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("progress_photo_remove", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      assertField(job);
      const photo = await photoOnJob(sb, job.job_id, args.photo_id);
      if (!photo) throw new ToolError("That photo isn't on this job. Nothing was changed.");
      if (photo.removed_at) throw new ToolError(`The ${photoLabel(photo)} photo was already removed. Nothing was changed.`);
      const why = args.reason?.trim() ?? "";
      if (args.confirmed !== true || why.length < 3) {
        return guide(
          { ...text([`${prefix(job)}Photo not removed yet.`, `- Remove the ${photoLabel(photo)} photo from the gallery and the daily? It stays in the job's record, marked as removed.`, ...(why.length < 3 ? ["- Why is it being removed?"] : [])].join("\n")), structuredContent: { removed: false, question: true, photo: { id: photo.id, taken_on: photo.taken_on, area: photo.area } } },
          "Ask the member to confirm the removal and say why, in their own words, then call again with confirmed true and the reason. Never confirm it for them.",
        );
      }
      await call(sb, "mcp_progress_photo_remove", { _id: photo.id, _reason: why, _replaced_by: null });
      await audit(sb, job, "progress_photo_remove", "remove_photo", photo.id);
      return guide(
        { ...text([`${prefix(job)}Removed the ${photoLabel(photo)} photo from the gallery and the daily.`, "It's kept in the job's record with who removed it, when and why."].join("\n")), structuredContent: { removed: true, id: photo.id, taken_on: photo.taken_on, area: photo.area } },
        "Say it was removed from the gallery and daily and is kept in the record; don't say it was deleted.",
      );
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
      const oneDay = args.date_from && args.date_from === args.date_to ? args.date_from : null;
      const gallery = photoPageHref(boardHref(pages, "photos"), oneDay);
      const captions = photos.length ? photos.map((p) => {
        const label = [p.area, p.work].filter(Boolean).join(" · ") || "Progress photo";
        const href = photoPageHref(gallery, oneDay, p.id);
        const linked = href ? `[${label}](${href})` : label;
        return `- ${p.taken_on} · ${linked}${p.client_safe ? " · Client-safe" : " · Internal"}`;
      }) : ["No progress photos in this view."];
      const url = gallery;
      let pdf: string | null = null;
      if ((args.format ?? "gallery") === "pdf") {
        const bytes = photoLogPdf(`${job.job_number} progress photos`, photos, await pdfContractorBrand(sb, job.company_id));
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
