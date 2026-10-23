// Submittal log, import preview, and project-record search.
// Submittal writes record themselves in the database transaction. This file does not send email.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, isMissingFunction, run, text, type Sb } from "../guard";
import { FULL_ACCESS_MESSAGE, audit, jobTimeZone, prefix, resolveJob } from "../jobs";
import { signedJobPages } from "../board-url";
import { isUuid } from "../../report-pages";
import { listCompaniesAndJobs, namedOrSoleJob } from "./workflow-tools";
import { whichJobAsk } from "../which-job";
import { guide } from "../visible";
import type { CardModel } from "../cards/model";
import { renderHtml } from "../cards/html";
import { htmlBlock, renderMarkdown } from "../cards/markdown";
import { applyCardClosing } from "../cards/silence";
import { cardWidgetMeta } from "../cards/widget";
import {
  BALL_PARTIES,
  IMPORT_CONFIRM,
  PACKAGE_KINDS,
  PACKAGE_STATUSES,
  SAMPLE_SUBMITTALS_2701,
  SUBMITTAL_STATUSES,
  SUBMITTAL_TYPES,
  CHASE_ROLES,
  parseSubmittalImport,
  postureSentence,
  presentImportPreview,
  presentSubmittalLog,
  resolvePosture,
  type ImportDraft,
  type SubmittalRecord,
} from "../submittals";
import { isDisputeAsk, presentJobRecord, presentProjectRecord, type RecordEvent } from "../project-record";
import { money } from "../sov";
import { todayIn } from "../deadlines";
import { dueOf, isOverdue, openItemFeed } from "../open-feed";
import { scheduleSubmittalGroups, type ScheduleActivity, type TrackingItem } from "../schedule-submittals";

const jobNumber = z.string().trim().min(1).max(40);
const companyId = z.string().trim().min(1).max(200).optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const SAVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;

const packageItem = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(PACKAGE_KINDS),
  source_party: z.string().trim().min(1).max(120),
  file_ref: z.string().trim().max(500).nullable().optional(),
  status: z.enum(PACKAGE_STATUSES).optional(),
  required: z.boolean().optional(),
  requested_at: z.string().trim().max(40).nullable().optional(),
  received_at: z.string().trim().max(40).nullable().optional(),
  chase_role: z.enum(CHASE_ROLES).nullable().optional(),
  chase_name: z.string().trim().max(120).nullable().optional(),
  chase_email: z.string().trim().max(320).nullable().optional(),
  last_chased_at: z.string().trim().max(40).nullable().optional(),
  next_chase_at: date.nullable().optional(),
  chase_count: z.number().int().min(0).max(999).optional(),
});

async function call<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>)(fn, args);
  if (error) {
    if (isMissingFunction(error)) throw new ToolError("This isn't available yet. Nothing was changed.");
    dbError(error);
  }
  return data as T;
}

type LogPayload = {
  job_number?: string;
  job_name?: string;
  submittals?: SubmittalRecord[];
  today?: string;
  read_only?: boolean;
  posture?: string | null;
  posture_set?: string | null;
  public_job?: string | null;
  saved_id?: string;
};

async function boardFor(sb: Sb, job: { job_id: string; scope?: string | null }): Promise<string | null> {
  if (!isUuid(job.job_id) || (job.scope !== "full" && job.scope !== "super")) return null;
  const pages = await signedJobPages((fn, args) => sb.rpc(fn, args), job.job_id, job.scope);
  return pages.submittals ?? null;
}

function shown(
  payload: LogPayload,
  boardUrl: string | null,
  filter?: { status?: string | null; overdue?: boolean | null; ball?: string | null },
  note?: string,
  extra?: { schedule?: ScheduleActivity[]; tracking?: TrackingItem[] },
) {
  const today = (payload.today ?? "").slice(0, 10) || "1970-01-01";
  const posture = postureSentence(resolvePosture(payload.posture_set ?? payload.posture, payload.public_job));
  const logged = new Set((payload.submittals ?? []).map((row) => row.number.trim().toLowerCase()));
  const schedule = scheduleSubmittalGroups(extra?.schedule ?? []).filter((group) => !logged.has(group.id.trim().toLowerCase()));
  return presentSubmittalLog({
    jobNumber: payload.job_number ?? "",
    jobName: payload.job_name ?? "",
    rows: payload.submittals ?? [],
    today,
    boardUrl,
    readOnly: payload.read_only === true,
    note,
    posture,
    filter,
    schedule,
    tracking: extra?.tracking ?? [],
  });
}

function cardResult(_body: string, card: CardModel, extra: Record<string, unknown> = {}) {
  const html = renderHtml({ ...card, show_state: false });
  const shown = applyCardClosing(`${renderMarkdown(card)}\n\n${htmlBlock(html)}`, false);
  return guide(
    {
      ...text(shown),
      structuredContent: { card, html, ...extra },
      _meta: { ...cardWidgetMeta },
    },
    "Show this card. Do not add text after it. Red only on an overdue row.",
  );
}

/** Saved submittal rows for one job. Select only: no lookahead, no board link, no living report. */
export async function readSubmittalRows(sb: Sb, jobId: string): Promise<SubmittalRecord[]> {
  const res = await sb
    .from("mcp_submittals")
    .select("id, number, revision, spec_section, title, submittal_type, status, ball_in_court, ball_in_court_name, source, required, required_by, submitted_on, due_back, returned_on, review_days")
    .eq("job_id", jobId)
    .order("number", { ascending: true })
    .limit(500);
  if (res.error) throw new Error(res.error.message);
  return ((res.data ?? []) as Partial<SubmittalRecord>[]).map((row) => ({
    id: String(row.id ?? ""),
    number: String(row.number ?? ""),
    revision: Number(row.revision ?? 0),
    transmittal_number: 0,
    spec_section: String(row.spec_section ?? ""),
    title: String(row.title ?? ""),
    submittal_type: String(row.submittal_type ?? "other"),
    status: String(row.status ?? "not_started"),
    ball_in_court: String(row.ball_in_court ?? "gc"),
    ball_in_court_name: row.ball_in_court_name ?? null,
    source: (row.source as SubmittalRecord["source"]) ?? "user",
    required: row.required !== false,
    required_by: row.required_by ?? null,
    submitted_on: row.submitted_on ?? null,
    due_back: (row.due_back ?? "").slice(0, 10) || null,
    returned_on: row.returned_on ?? null,
    review_days: row.review_days ?? null,
    package_items: [],
  }));
}

/** Same job lookup for every submittal tool and every host. A company id that does not own the number is ignored when the number exists once. */
export async function resolveSubmittalJob(sb: Sb, jobNumber: string | undefined, companyId: string | undefined, need?: "full") {
  const picked = await namedOrSoleJob(sb, jobNumber, companyId);
  if (!picked) return null;
  return resolveJob(sb, picked.job_number, picked.company_id, need);
}

function submittalViewOnly(args: { spec_section?: string; title?: string; number?: string; submittal_id?: string }): boolean {
  return !args.spec_section?.trim() && !args.title?.trim() && !args.number?.trim() && !args.submittal_id;
}

async function showListedLog(
  sb: Sb,
  job: { job_id: string; job_number: string; name: string; scope?: string | null },
  filter?: { status?: string | null; overdue?: boolean | null; ball?: string | null },
) {
  const [rows, zone] = await Promise.all([readSubmittalRows(sb, job.job_id), jobTimeZone(sb, job.job_id)]);
  const today = todayIn(zone);
  const presented = presentSubmittalLog({
    jobNumber: job.job_number,
    jobName: job.name,
    rows,
    today,
    boardUrl: null,
    readOnly: job.scope !== "full",
    filter,
  });
  return cardResult(presented.text, presented.card, { read_only: job.scope !== "full", job_id: job.job_id });
}

function whichJobCard(tool: "submittal_log" | "submittals_list" | "submittals_import" | "project_record_search", body: string) {
  const lines = body.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("- "));
  const card: CardModel = {
    state: "ask",
    title: "Which job?",
    show_state: false,
    ask: { prompt: whichJobAsk(tool) },
    sections: [{ heading: "Jobs", kind: "list", rows: lines.map((line) => ({ cells: [line.replace(/^- /, "")], tone: "action" })) }],
    next_move: "Name the job.",
  };
  return guide({ ...text(body), structuredContent: { card, which_job: true } }, "Wait for the job.");
}

export const submittalLog = defineTool({
  name: "submittal_log",
  title: "Hey Athena, log a submittal",
  description: "Adds, updates, or resubmits a job submittal when someone says Hey Athena, log a submittal, or uses a misspelling such as submital, submittle, sumittal, or submittall.",
  inputSchema: {
    action: z.enum(["add", "update", "resubmit"]),
    job_number: jobNumber.optional(),
    company_id: companyId,
    submittal_id: z.string().uuid().optional(),
    number: z.string().trim().max(40).optional(),
    revision: z.number().int().min(0).max(99).optional(),
    spec_section: z.string().trim().max(40).optional(),
    title: z.string().trim().max(200).optional(),
    submittal_type: z.enum(SUBMITTAL_TYPES).optional(),
    status: z.enum(SUBMITTAL_STATUSES).optional(),
    ball_in_court: z.enum(BALL_PARTIES).optional(),
    ball_in_court_name: z.string().trim().max(120).nullable().optional(),
    source: z.enum(["spec_derived", "user", "imported"]).optional(),
    required: z.boolean().optional(),
    not_required_reason: z.string().trim().max(500).nullable().optional(),
    spec_excerpt: z.string().trim().max(2000).nullable().optional(),
    required_by: date.nullable().optional(),
    submitted_on: date.nullable().optional(),
    returned_on: date.nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    review_days: z.number().int().min(1).max(365).optional(),
    posture: z.enum(["strict", "advisory"]).nullable().optional(),
    package_items: z.array(packageItem).max(40).optional(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("submittal_log", ctx, { jobNumber: args.job_number }, async (sb) => {
      const view = submittalViewOnly(args);
      const job = await resolveSubmittalJob(sb, args.job_number, args.company_id, view ? undefined : "full");
      if (!job) return whichJobCard("submittal_log", await listCompaniesAndJobs(sb, args.company_id, "submittal_log"));
      if (view) {
        if (job.scope !== "full" && job.scope !== "super") throw new ToolError(FULL_ACCESS_MESSAGE);
        return showListedLog(sb, job);
      }
      const payload = { ...args };
      delete payload.job_number;
      delete payload.company_id;
      const saved = await call<LogPayload>(sb, "mcp_submittal_log", { _job: job.job_id, _action: args.action, _payload: payload });
      if (!(saved.submittals ?? []).length) saved.submittals = await readSubmittalRows(sb, job.job_id);
      await audit(sb, job, "submittal_log", args.action, saved.saved_id ?? null);
      const row = (saved.submittals ?? []).find((item) => item.id === saved.saved_id);
      const note = row ? `Saved ${row.number} revision ${row.revision}, ${row.title}. Transmittal T-${row.transmittal_number}.` : "Saved.";
      const presented = shown(saved, await boardFor(sb, job), undefined, note);
      return cardResult(presented.text, presented.card, { saved_id: saved.saved_id ?? null, read_only: false });
    }),
});

export const submittalsList = defineTool({
  name: "submittals_list",
  title: "Submittal log and overdue submittals",
  description: "Lists a job's saved submittal log, one row at a time with number, title, status, ball in court, due date, and overdue, for a job number such as 2701, and resolves that number when it exists on exactly one company even if another company is active.",
  inputSchema: {
    job_number: jobNumber.optional(),
    company_id: companyId,
    status: z.enum(SUBMITTAL_STATUSES).optional(),
    overdue: z.boolean().optional(),
    ball_in_court: z.enum(BALL_PARTIES).optional(),
  },
  annotations: READ,
  handler: (args, ctx) =>
    run("submittals_list", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveSubmittalJob(sb, args.job_number, args.company_id);
      if (!job) return whichJobCard("submittals_list", await listCompaniesAndJobs(sb, args.company_id, "submittals_list"));
      if (job.scope !== "full" && job.scope !== "super") throw new ToolError(FULL_ACCESS_MESSAGE);
      // mcp_submittals for this job id only. Company membership is the row policy (full or super).
      // The living-report reader is not called: it returns the whole CPM and its change log and can sit until the host times out.
      return showListedLog(sb, job, { status: args.status, overdue: args.overdue, ball: args.ball_in_court });
    }),
});

export const submittalsImport = defineTool({
  name: "submittals_import",
  title: "Import or paste a submittal log",
  description: "Previews a CSV or pasted submittal log and writes it only after a separate yes.",
  inputSchema: {
    job_number: jobNumber.optional(),
    company_id: companyId,
    text: z.string().trim().min(1).max(100000),
    confirmed: z.boolean().optional(),
    import_key: z.string().trim().max(20).optional(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("submittals_import", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveSubmittalJob(sb, args.job_number, args.company_id, "full");
      if (!job) return whichJobCard("submittals_import", await listCompaniesAndJobs(sb, args.company_id, "submittals_import"));
      const current = await call<LogPayload>(sb, "mcp_submittal_rows", { _job: job.job_id });
      const preview = parseSubmittalImport(args.text, (current.submittals ?? []).map((row) => ({ number: row.number, revision: row.revision })));
      const card = presentImportPreview(current.job_number ?? job.job_number, current.job_name ?? job.name, preview);
      if (args.confirmed !== true || args.import_key !== preview.key) {
        return cardResult(card.text, card.card, { import_key: preview.key, written: false, ready: preview.ready.length });
      }
      if (!preview.ready.length) return cardResult(card.text, card.card, { import_key: preview.key, written: false, ready: 0 });
      let last: LogPayload = current;
      for (const row of preview.ready) {
        const payload: ImportDraft = row;
        last = await call<LogPayload>(sb, "mcp_submittal_log", { _job: job.job_id, _action: "import", _payload: payload });
      }
      await audit(sb, job, "submittals_import", "import", null);
      const note = `Imported ${preview.ready.length} submittals. ${preview.problems.length} rows still need a fix.`;
      const presented = shown(last, await boardFor(sb, job), undefined, note);
      return cardResult(presented.text, presented.card, { written: true, import_key: preview.key });
    }),
});

export const projectRecordSearch = defineTool({
  name: "project_record_search",
  title: "Project record for disputes and claims",
  description: "Shows the job record with the schedule of values, open items, and overdue items, and shows the dispute and claim file only when the member asks for disputes or claims, resolving a unique job number such as 2701 across companies.",
  inputSchema: {
    job_number: jobNumber.optional(),
    company_id: companyId,
    from: date.optional(),
    to: date.optional(),
    kind: z.string().trim().max(40).optional(),
    text: z.string().trim().max(200).optional(),
  },
  annotations: READ,
  handler: (args, ctx) =>
    run("project_record_search", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveSubmittalJob(sb, args.job_number, args.company_id);
      if (!job) return whichJobCard("project_record_search", await listCompaniesAndJobs(sb, args.company_id, "project_record_search"));
      if (!isDisputeAsk(args.kind, args.text)) {
        const zone = await jobTimeZone(sb, job.job_id);
        const today = todayIn(zone);
        const [facts, items] = await Promise.all([
          sb.from("mcp_job_facts").select("key, value").eq("job_id", job.job_id).eq("module", "sov"),
          sb.from("mcp_open_items").select("id, action, needed_by, due_date, updated_at, owner, accountable").eq("job_id", job.job_id).eq("status", "open").limit(200),
        ]);
        if (facts.error) throw new Error(facts.error.message);
        if (items.error) throw new Error(items.error.message);
        const total = ((facts.data ?? []) as { value?: { billable_value?: number | null } }[]).reduce((sum, row) => {
          const value = row.value?.billable_value;
          return typeof value === "number" ? sum + value : sum;
        }, 0);
        const hasMoney = job.scope === "full" && ((facts.data ?? []) as unknown[]).length > 0;
        const feed = openItemFeed((items.data ?? []) as { id: string; action: string; needed_by?: string | null; due_date?: string | null; updated_at?: string | null; owner?: string | null; accountable?: string | null }[], today);
        const presented = presentJobRecord({
          jobNumber: job.job_number,
          jobName: job.name,
          contractTotal: hasMoney ? money(total) : null,
          open: feed.counts.open,
          overdue: feed.counts.overdue,
          items: feed.items.map((item) => ({
            action: item.action,
            due: dueOf(item),
            overdue: isOverdue(item, today),
          })),
        });
        return cardResult(presented.text, presented.card, { record: "job" });
      }
      const payload = await call<{ job_number?: string; job_name?: string; events?: RecordEvent[] }>(sb, "mcp_project_record_search", {
        _job: job.job_id,
        _from: args.from ?? null,
        _to: args.to ?? null,
        _kind: args.kind ?? null,
        _q: args.text ?? null,
      });
      const presented = presentProjectRecord({
        jobNumber: payload.job_number ?? prefix(job).replace(/ – $/, ""),
        jobName: payload.job_name ?? job.name,
        events: payload.events ?? [],
      });
      return cardResult(presented.text, presented.card, { events: payload.events ?? [] });
    }),
});

export const SAMPLE_JOB_2701 = "2701";
export { SAMPLE_SUBMITTALS_2701, IMPORT_CONFIRM };
