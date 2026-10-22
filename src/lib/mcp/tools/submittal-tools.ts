// Submittal log, import preview, and project-record search.
// Submittal writes record themselves in the database transaction. This file does not send email.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, isMissingFunction, run, text, type Sb } from "../guard";
import { FULL_ACCESS_MESSAGE, audit, prefix, resolveJob } from "../jobs";
import { signedJobPages } from "../board-url";
import { isUuid } from "../../report-pages";
import { listCompaniesAndJobs } from "./workflow-tools";
import { whichJobAsk } from "../which-job";
import { guide } from "../visible";
import type { CardModel } from "../cards/model";
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
import { presentProjectRecord, type RecordEvent } from "../project-record";

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

function shown(payload: LogPayload, boardUrl: string | null, filter?: { status?: string | null; overdue?: boolean | null; ball?: string | null }, note?: string) {
  const posture = postureSentence(resolvePosture(payload.posture_set ?? payload.posture, payload.public_job));
  return presentSubmittalLog({
    jobNumber: payload.job_number ?? "",
    jobName: payload.job_name ?? "",
    rows: payload.submittals ?? [],
    today: (payload.today ?? "").slice(0, 10) || "1970-01-01",
    boardUrl,
    readOnly: payload.read_only === true,
    note,
    posture,
    filter,
  });
}

function cardResult(body: string, card: CardModel, extra: Record<string, unknown> = {}) {
  return guide(
    { ...text(body), structuredContent: { card, ...extra } },
    "Show this card. Do not add text after it. Red only on an overdue row.",
  );
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
      if (!args.job_number?.trim()) return whichJobCard("submittal_log", await listCompaniesAndJobs(sb, args.company_id, "submittal_log"));
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      const payload = { ...args };
      delete payload.job_number;
      delete payload.company_id;
      const saved = await call<LogPayload>(sb, "mcp_submittal_log", { _job: job.job_id, _action: args.action, _payload: payload });
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
  description: "Lists a job's submittal log, including what submittals are overdue and the submittal log for a job number such as 2701.",
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
      if (!args.job_number?.trim()) return whichJobCard("submittals_list", await listCompaniesAndJobs(sb, args.company_id, "submittals_list"));
      const job = await resolveJob(sb, args.job_number, args.company_id);
      if (job.scope !== "full" && job.scope !== "super") throw new ToolError(FULL_ACCESS_MESSAGE);
      const payload = await call<LogPayload>(sb, "mcp_submittal_rows", { _job: job.job_id });
      const presented = shown(payload, await boardFor(sb, job), { status: args.status, overdue: args.overdue, ball: args.ball_in_court });
      return cardResult(presented.text, presented.card, { read_only: payload.read_only === true });
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
      if (!args.job_number?.trim()) return whichJobCard("submittals_import", await listCompaniesAndJobs(sb, args.company_id, "submittals_import"));
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
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
  description: "Searches the project record for a job by date, kind, or words, including the dispute and claim history.",
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
      if (!args.job_number?.trim()) return whichJobCard("project_record_search", await listCompaniesAndJobs(sb, args.company_id, "project_record_search"));
      const job = await resolveJob(sb, args.job_number, args.company_id);
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
