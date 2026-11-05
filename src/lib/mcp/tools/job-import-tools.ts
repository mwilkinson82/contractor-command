// Job import: bring a whole job in from another system in one reviewed batch.
// Step review stages the batch and shows one card; step save writes it all in
// one database transaction, only with the member's yes and that card's key.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { looseBoolean } from "../loose-boolean";
import { dbError, isMissingFunction, run, text, type Sb } from "../guard";
import {
  WhichCompanyAsk,
  audit,
  companyForCreate,
  currentCompany,
  memberCompanies,
  rememberCompany,
} from "../jobs";
import { guide } from "../visible";
import { kindsOfWorkGate } from "../work-gate";
import { pmReachable, pmSetupNext, readTeammates } from "../pm-setup";
import { drawingFile } from "../drawing-file-input";
import { fetchAllowedFile } from "../file-upload";
import { FileRejected } from "../file-share";
import type { CardModel, CardSection } from "../cards/model";
import { renderHtml } from "../cards/html";
import { htmlBlock, renderMarkdown } from "../cards/markdown";
import { applyCardClosing } from "../cards/silence";
import { cardWidgetMeta } from "../cards/widget";
import { IMPORT_SOURCES, ImportInputError, type ImportJob } from "../../job-import/model";
import { fromOverwatch } from "../../job-import/overwatch";
import { SHEET_KINDS, fromSpreadsheets } from "../../job-import/spreadsheet";
import { readImportFile, type ReadFile, type ScheduleFile } from "../../job-import/files";
import {
  RETRY_DOCUMENTS,
  documentsKey,
  documentsResultSection,
  documentsSection,
  jobDocuments,
  storeImportDocuments,
  type DocumentsOutcome,
} from "../job-import-documents";
import { fromMspdi, fromXer, isMspdi, isXer } from "../../job-import/schedule-files";
import {
  appliedCard,
  nothingToSave,
  planImport,
  planScheduleReplace,
  reviewCard,
  type ImportContext,
} from "../../job-import/plan";

const SAVE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;
const JOB_NUMBER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
/** An attached export file; the package itself stays under the stage's 6 MB cap. */
const FILE_MAX_BYTES = 20 * 1024 * 1024;

export const OVERWATCH_EXPORT_HOW =
  "In Overwatch, open the job, click ··· at the top of the project page and choose Export for Athena. It downloads one file (a .json, or a .zip when the job has its contract or specs in the file room); attach that file here.";
export const PROCORE_EXPORT_HOW =
  "In Procore, open the project and download: the schedule's original .xer or .mpp file (Documents > Schedules, or ask your scheduler), the Budget as CSV, the latest owner invoice as CSV, Change Orders as CSV, RFIs as CSV, Submittals as XLSX, and Inspections, Observations, Punch List and Commitments as CSV. Put them in one ZIP (or use the Project Archive ZIP Procore emails) and attach it here.";
export const BUILDERTREND_EXPORT_HOW =
  "In Buildertrend, open the job and export to Excel: the Schedule (List view, More Actions, Export to Excel), the Job Costing Budget, the Estimate, Change Orders and Daily Logs, showing every column in each saved view first. Put them in one ZIP and attach it here.";
export const FULL_ACCESS_HOW =
  "Importing onto a job that's already in Athena needs full access to that job. Ask your company's owner to add you to the job, or to run the import. Nothing was saved.";

export const JOB_IMPORT_RULE = ` When a member asks to import, move, migrate or bring a job over from Overwatch, Procore, Buildertrend or a spreadsheet, call job_import with step review and the export they supplied (the attached file as file when the host offers it, otherwise its text as export_text), then show its card. If they have no export yet, tell them how to get one from their system, one step at a time: Overwatch: ${OVERWATCH_EXPORT_HOW} Procore: ${PROCORE_EXPORT_HOW} Buildertrend: ${BUILDERTREND_EXPORT_HOW} One file per review: a ZIP of several exports, an Excel workbook, a P6 .xer, an MS Project XML or a CSV; Athena recognizes each file from its columns. After the card, offer to add what the card says is missing. Save only after a separate yes to that card, with step save, the batch_id and the import_key it returned; when it returned documents_key, also pass documents_key and the same attached file again as file. Only when the member asks in their own words to replace or redo a job's schedule from the export, and the job's CPM came from an import, call review with replace_schedule true; ask them first and say that the imported CPM gets a new recalculated version and earlier versions stay in history. Never use replace_schedule otherwise. Never call save in the same turn as review. Approved change orders arrive inside the SOV and contract; open ones arrive as unsent PCO drafts. Nothing is emailed or sent.`;

/** Fills the job's contract completion from the saved import, only when the job has none. */
export async function fillCompletion(sb: Sb, batch: string): Promise<void> {
  try {
    await (
      sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ error: unknown }>
    )("mcp_job_import_completion", { _batch: batch });
  } catch {
    // The import is already saved; the CPM shows the completion as Needed until it is set.
  }
}

async function call<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (
    sb.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>
  )(fn, args);
  if (error) {
    if (isMissingFunction(error))
      throw new ToolError("Job import isn't switched on yet. Nothing was changed.");
    dbError(error);
  }
  return data as T;
}

/** The card after an imported CPM is replaced with the source's recalculated schedule. */
export function replacedCard(result: Record<string, unknown>, jobNumber: string): CardModel {
  const version = Number(result.cpm_version ?? 0);
  const prior = Number(result.replaced_version ?? 0);
  const rows = result.already_applied
    ? ["This replacement was already saved. Nothing more to save."]
    : [
        `CPM version ${version} saved: ${Number(result.schedule_activities ?? 0)} activities, recalculated${result.data_date ? ` at data date ${String(result.data_date)}` : ""} with the export's baseline as BL1.`,
        `Version ${prior} and every earlier version stay in the CPM's history.`,
      ];
  return {
    state: "result",
    title: `Job ${jobNumber}'s CPM replaced`,
    show_state: false,
    job: jobNumber,
    kpis: [],
    sections: [
      { heading: "Saved", kind: "list", rows: rows.map((r) => ({ cells: [r], tone: "known" })) },
    ],
    next_move: `Next: want me to open job ${jobNumber}'s schedule so you can check the forecast and the longest path?`,
  };
}

function cardResult(card: CardModel, extra: Record<string, unknown>, rule: string) {
  const html = renderHtml({ ...card, show_state: false });
  const shown = applyCardClosing(`${renderMarkdown(card)}\n\n${htmlBlock(html)}`, false);
  return guide(
    { ...text(shown), structuredContent: { card, html, ...extra }, _meta: { ...cardWidgetMeta } },
    rule,
  );
}

const sheet = z.object({
  kind: z.enum(SHEET_KINDS).optional(),
  text: z.string().min(1).max(1_000_000),
  name: z.string().trim().max(120).optional(),
});

export function readExport(args: {
  source: (typeof IMPORT_SOURCES)[number];
  export_text?: string;
  sheets?: z.infer<typeof sheet>[];
  /** A P6 .xer or MS Project XML schedule that came with the export. */
  schedule_file?: ScheduleFile | null;
  job_number?: string;
  job_name?: string;
  customer?: string;
  original_contract?: number;
  retainage_pct?: number;
  daily_days?: number;
}): ImportJob {
  if (args.source === "overwatch") {
    if (!args.export_text?.trim())
      throw new ImportInputError(`Attach the Overwatch job export. ${OVERWATCH_EXPORT_HOW}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(args.export_text);
    } catch {
      throw new ImportInputError(
        "The Overwatch export isn't valid JSON. Export the job again and attach the file as it came.",
      );
    }
    return fromOverwatch(parsed, {
      dailyDays: args.daily_days,
      jobNumber: args.job_number,
      jobName: args.job_name,
    });
  }
  const text = args.export_text?.trim() ? args.export_text : "";
  const scheduleFile =
    args.schedule_file ??
    (isXer(text)
      ? { kind: "xer" as const, text, name: "the P6 file" }
      : isMspdi(text)
        ? { kind: "mspdi" as const, text, name: "the MS Project file" }
        : null);
  const sheets = args.sheets?.length ? args.sheets : text && !scheduleFile ? [{ text }] : [];
  const schedule = scheduleFile
    ? (scheduleFile.kind === "xer" ? fromXer : fromMspdi)(scheduleFile.text, {
        system: args.source,
        jobNumber: args.job_number,
        jobName: args.job_name,
      })
    : null;
  if (schedule && !sheets.length) return schedule;
  const jobNumber = args.job_number || schedule?.job.job_number;
  const jobName = args.job_name || schedule?.job.name;
  if (!jobNumber || !jobName)
    throw new ImportInputError(
      "Which job number and job name should this be in Athena? The export files don't carry them.",
    );
  const job = fromSpreadsheets(sheets, {
    system: args.source,
    job_number: jobNumber,
    name: jobName,
    customer: args.customer ?? null,
    original_contract: args.original_contract ?? null,
    retainage_pct: args.retainage_pct ?? null,
    completion_date: schedule?.job.completion_date ?? null,
  });
  return schedule ? withScheduleFile(job, schedule, scheduleFile!.name) : job;
}

/** The native schedule file wins over a schedule spreadsheet: it carries logic, calendar and data date. */
export function withScheduleFile(job: ImportJob, schedule: ImportJob, name: string): ImportJob {
  if (job.schedule.length)
    job.problems.push(
      `The schedule comes from ${name}, which keeps the logic and calendar; the schedule spreadsheet is left out.`,
    );
  job.schedule = schedule.schedule;
  job.schedule_wbs = schedule.schedule_wbs;
  job.schedule_calendar = schedule.schedule_calendar;
  job.schedule_data_date = schedule.schedule_data_date;
  job.job.completion_date ??= schedule.job.completion_date;
  job.problems = job.problems.filter((p) => !/carries no working calendar/.test(p));
  job.problems.push(...schedule.problems);
  job.held.push(...schedule.held);
  for (const [table, rows] of Object.entries(schedule.archive)) job.archive[table] = rows;
  return job;
}

/** The PM question after an import, or null when the job's PM can already be emailed. */
async function importPmAsk(
  sb: Sb,
  result: Record<string, unknown>,
): Promise<{ note: string; ask: string } | null> {
  const jobId = typeof result.job_id === "string" ? result.job_id : null;
  if (!jobId) return null;
  const { data, error } = await sb
    .from("mcp_jobs")
    .select("company_id, pm_name, pm_email, pm_user_id")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !data) return null;
  const j = data as {
    company_id: string;
    pm_name: string | null;
    pm_email: string | null;
    pm_user_id: string | null;
  };
  if (pmReachable(j)) return null;
  const next = pmSetupNext(
    { pm: j.pm_name, pm_email: j.pm_email, pm_is_member: false },
    await readTeammates(sb, j.company_id),
  );
  return { note: next.lines.join(" "), ask: next.guidance.join(" ") };
}

/** The job number the Overwatch export carries itself, before any number named at import time. */
export function overwatchJobNumber(exportText: string | undefined): string | null {
  try {
    const p = (JSON.parse(exportText ?? "") as { project?: { job_number?: unknown } }).project;
    const n = typeof p?.job_number === "string" ? p.job_number.trim() : "";
    return n || null;
  } catch {
    return null;
  }
}

const sameName = (a: string, b: string) => {
  const norm = (x: string) =>
    x
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const x = norm(a);
  const y = norm(b);
  return !x || !y || x === y || x.includes(y) || y.includes(x);
};

/**
 * Lines for "Check before you say yes" when the export may be headed to the
 * wrong job: a job number that differs from the export's own, or an existing
 * Athena job whose name doesn't match the export's.
 */
export function destinationChecks(input: {
  source: string;
  exportNumber: string | null;
  exportName: string;
  target: string;
  context: ImportContext;
}): string[] {
  const { exportNumber, exportName, target, context } = input;
  const from = input.source === "overwatch" ? "Overwatch" : "the export";
  const out: string[] = [];
  const named = exportName ? ` (${exportName})` : "";
  if (exportNumber && exportNumber.toLowerCase() !== target.toLowerCase()) {
    out.push(
      context.job_exists
        ? `This export is job ${exportNumber}${named} in ${from}, going onto Athena job ${target}${context.name ? `, ${context.name}` : ""}. Say yes only if that's the right job.`
        : `This export is job ${exportNumber}${named} in ${from}. There is no job ${target} in Athena yet, so this makes a new job ${target}. If you meant a job that's already in Athena, tell me its number.`,
    );
  } else if (context.job_exists && context.name && !sameName(context.name, exportName)) {
    out.push(
      `Athena's job ${target} is named ${context.name}, and this export is ${exportName || "unnamed"}. Say yes only if they're the same job.`,
    );
  }
  return out;
}

const withSection = (list: CardModel["sections"], at: number, section: CardSection) => {
  const out = [...(list ?? [])];
  out.splice(at, 0, section);
  return out;
};

/** Re-reads the attached export at save and stores its contract and spec files. Never throws. */
async function saveDocuments(
  sb: Sb,
  args: {
    file?: { download_url: string; file_name?: string };
    documents_key?: string;
    batch_id?: string;
  },
  result: Record<string, unknown>,
  jobNumber: string,
): Promise<DocumentsOutcome> {
  const none: DocumentsOutcome = { stored: [], skipped: [], failed: [], note: null };
  if (!args.file?.download_url)
    return args.documents_key
      ? {
          ...none,
          note: "The contract and spec files weren't saved because the export wasn't attached again. The import is saved; attach the same export and say save the documents.",
          retry: RETRY_DOCUMENTS,
        }
      : {
          ...none,
          retry: `No file came with this save, so no documents were attached. If the review card listed a contract or specs to save: ${RETRY_DOCUMENTS}`,
        };
  let read: ReadFile;
  try {
    const bytes = await fetchAllowedFile(args.file.download_url, FILE_MAX_BYTES);
    read = await readImportFile(bytes, args.file.file_name ?? "export");
  } catch {
    return {
      ...none,
      note: "The import is saved, but the export couldn't be read again, so its contract and spec files weren't saved. Attach it again and say save the documents.",
      retry: RETRY_DOCUMENTS,
    };
  }
  return storeImportDocuments(sb, {
    documents: read.documents,
    documentsKey: args.documents_key,
    batchId: args.batch_id ?? "",
    result,
    jobNumber,
  });
}

export const jobImport = defineTool({
  name: "job_import",
  title: "Import a job from Overwatch, Procore or a spreadsheet",
  description:
    "Brings a whole job into Athena from an Overwatch, Procore, Buildertrend or spreadsheet export, showing one review card first and saving it all at once only after a separate yes.",
  inputSchema: {
    step: z.enum(["review", "save", "cancel"]),
    source: z.enum(IMPORT_SOURCES).optional(),
    company_id: z.string().trim().min(1).max(200).optional(),
    job_number: z.string().trim().max(40).optional(),
    job_name: z.string().trim().max(200).optional(),
    customer: z.string().trim().max(200).optional(),
    original_contract: z.number().min(0).max(90_000_000_000).optional(),
    retainage_pct: z.number().min(0).max(100).optional(),
    export_text: z.string().max(2_000_000).optional(),
    file: drawingFile,
    sheets: z.array(sheet).max(20).optional(),
    daily_days: z.number().int().min(0).max(3650).optional(),
    batch_id: z.string().uuid().optional(),
    import_key: z.string().trim().max(64).optional(),
    documents_key: z.string().trim().max(64).optional(),
    confirmed: looseBoolean().optional(),
    replace_schedule: looseBoolean().optional(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("job_import", ctx, { jobNumber: args.job_number }, async (sb) => {
      if (args.step === "cancel") {
        if (!args.batch_id)
          throw new ToolError("Which import should I cancel? Nothing was changed.");
        await call(sb, "mcp_job_import_cancel", { _batch: args.batch_id });
        return { ...text("Import cancelled. Nothing was saved.") };
      }
      if (args.step === "save") {
        if (!args.batch_id || !args.import_key)
          throw new ToolError(
            "Save needs the batch_id and import_key from the review card. Nothing was saved.",
          );
        if (args.confirmed !== true)
          throw new ToolError(
            "Save only after the member says yes to the review card. Nothing was saved.",
          );
        if (args.replace_schedule === true) {
          const replaced = await call<Record<string, unknown>>(
            sb,
            "mcp_job_import_replace_schedule",
            { _batch: args.batch_id, _hash: args.import_key, _confirmed: true },
          );
          if (!replaced.already_applied) await fillCompletion(sb, args.batch_id);
          return cardResult(
            replacedCard(replaced, String(replaced.job_number ?? args.job_number ?? "")),
            { written: !replaced.already_applied, result: replaced },
            "Show this card. Do not add text after it.",
          );
        }
        const result = await call<Record<string, unknown>>(sb, "mcp_job_import_apply", {
          _batch: args.batch_id,
          _hash: args.import_key,
          _confirmed: true,
        });
        const jobNumber = String(result.job_number ?? args.job_number ?? "");
        // The source's contract completion goes on the CPM header when the job has none.
        // Best effort: an older database without the function, or any refusal, changes nothing.
        if (!result.already_applied) await fillCompletion(sb, args.batch_id);
        const card = appliedCard(result, jobNumber, args.source ?? "overwatch");
        // The export's contract and spec files go on the saved job; a failure here never undoes the import.
        const documents = await saveDocuments(sb, args, result, jobNumber);
        const docSection = documentsResultSection(documents);
        if (docSection) card.sections = withSection(card.sections, 1, docSection);
        // Client approvals and notices email the job's PM, so a job that came in without one gets the PM question.
        const pmAsk = await importPmAsk(sb, result);
        return cardResult(
          card,
          { written: !result.already_applied, result, documents },
          pmAsk
            ? `Show this card. Then, in one short line, say: "${pmAsk.note}" and ask the PM question: ${pmAsk.ask}`
            : "Show this card. Do not add text after it.",
        );
      }

      // review
      if (!args.source)
        throw new ToolError(
          "Which system is this export from: Overwatch, Procore, Buildertrend or a spreadsheet?",
        );
      let exportText = args.export_text;
      let sheets = args.sheets;
      let scheduleFile: ScheduleFile | null = null;
      let read: ReadFile | null = null;
      const fileNotes: string[] = [];
      let imported: ImportJob;
      try {
        if (!exportText?.trim() && !sheets?.length && args.file?.download_url) {
          let bytes: Uint8Array;
          try {
            bytes = await fetchAllowedFile(args.file.download_url, FILE_MAX_BYTES);
          } catch (e) {
            if (e instanceof FileRejected)
              throw new ToolError(e.message.replace(/stored/, "saved"));
            throw e;
          }
          read = await readImportFile(bytes, args.file.file_name ?? "export");
          if (args.source === "overwatch")
            exportText =
              read.overwatch ??
              new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "");
          sheets = read.sheets;
          scheduleFile = read.schedule;
          fileNotes.push(...read.problems);
          if (args.source !== "overwatch" && !sheets.length && !scheduleFile)
            throw new ImportInputError(
              "Athena found no export it can read in that file. Attach the CSV or Excel exports, a ZIP of them, or the P6 .xer schedule.",
            );
        }
        imported = readExport({
          ...args,
          export_text: exportText,
          sheets,
          schedule_file: scheduleFile,
          source: args.source,
        });
        imported.problems.push(...fileNotes.slice(0, 200 - imported.problems.length));
      } catch (e) {
        if (e instanceof ImportInputError) throw new ToolError(`${e.message} Nothing was saved.`);
        throw e;
      }
      const jobNumber = imported.job.job_number.trim();
      if (!JOB_NUMBER.test(jobNumber))
        throw new ToolError(
          "Which job number should this be in Athena? Use 1-40 letters, digits, dots, dashes or underscores. Nothing was saved.",
        );
      if (!imported.job.name.trim()) imported.job.name = jobNumber;

      const companies = await memberCompanies(sb);
      let namedId: string | null = null;
      if (args.company_id?.trim()) {
        const want = args.company_id.trim().toLowerCase();
        const byName = companies.filter((c) => c.name.trim().toLowerCase() === want);
        namedId =
          companies.find((c) => c.id === want)?.id ?? (byName.length === 1 ? byName[0].id : null);
        if (!namedId)
          throw new ToolError("You aren't a member of that company. Nothing was saved.");
      }
      const choice = companyForCreate({ companies, activeId: await currentCompany(sb), namedId });
      if ("ask" in choice)
        throw new WhichCompanyAsk(
          jobNumber,
          choice.ask.map((c) => ({
            company_id: c.id,
            company_name: c.name,
            job_name: imported.job.name,
          })),
          true,
        );
      await rememberCompany(sb, choice.companyId);
      const gate = await kindsOfWorkGate(sb, choice.companyId, ctx.getUserId?.(), {
        what: `job ${jobNumber} is imported`,
        resume: `call job_import step review again with the same export.`,
      });
      if (gate) return guide(gate);

      const context = await call<ImportContext>(sb, "mcp_job_import_context", {
        _company: choice.companyId,
        _job_number: jobNumber,
        _source: imported.source.system,
      });
      if (context.job_exists && context.scope !== "full") throw new ToolError(FULL_ACCESS_HOW);
      const replacing = args.replace_schedule === true;
      const plan = replacing
        ? planScheduleReplace(imported, context)
        : planImport(imported, context);
      plan.fixes.unshift(
        ...destinationChecks({
          source: imported.source.system,
          exportNumber: args.source === "overwatch" ? overwatchJobNumber(exportText) : null,
          exportName: imported.job.name,
          target: jobNumber,
          context,
        }),
      );
      const card = reviewCard(plan, jobNumber, context.job_exists);
      const empty = nothingToSave(plan);
      // Contract and spec files are stored only by a normal import's save, never at review.
      const storing = !!read?.documents.length && !replacing && !empty;
      if (read) {
        let onJob: Awaited<ReturnType<typeof jobDocuments>> = [];
        if (read.documents.length && context.job_exists && context.job_id)
          onJob = await jobDocuments(sb, context.job_id, choice.companyId).catch(() => []);
        const docSection = await documentsSection(read, storing, onJob);
        if (docSection) {
          const at = (card.sections ?? []).findIndex((s) => s.heading === "Will be saved");
          card.sections = withSection(card.sections, at + 1, docSection);
        }
      }
      if (empty)
        return cardResult(
          card,
          { written: false, nothing_new: true },
          "Show this card. Do not add text after it.",
        );
      const staged = await call<{ batch_id: string; package_hash: string; expires_at: string }>(
        sb,
        "mcp_job_import_stage",
        {
          _company: choice.companyId,
          _job_number: jobNumber,
          _package: plan.package,
        },
      );
      await audit(sb, null, "job_import", "review", staged.batch_id, choice.companyId);
      return cardResult(
        card,
        {
          written: false,
          batch_id: staged.batch_id,
          import_key: staged.package_hash,
          expires_at: staged.expires_at,
          counts: plan.counts,
          ...(storing
            ? { documents_key: await documentsKey(staged.batch_id, read!.documents) }
            : {}),
        },
        replacing
          ? "Show this card. Do not add text after it. Replace the CPM only after a separate yes to this card, with step save, replace_schedule true, this batch_id and import_key; the review expires in 15 minutes."
          : `Show this card. Do not add text after it. Save only after a separate yes, with step save, this batch_id and import_key${storing ? ", and this documents_key with the same file again as file" : ""}; the review expires in 15 minutes.`,
      );
    }),
});
