// Job import: bring a whole job in from another system in one reviewed batch.
// Step review stages the batch and shows one card; step save writes it all in
// one database transaction, only with the member's yes and that card's key.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
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
import { pmReachable, pmSetupNext, readTeammates } from "../pm-setup";
import { drawingFile } from "../drawing-file-input";
import { fetchAllowedFile } from "../file-upload";
import { FileRejected } from "../file-share";
import type { CardModel } from "../cards/model";
import { renderHtml } from "../cards/html";
import { htmlBlock, renderMarkdown } from "../cards/markdown";
import { applyCardClosing } from "../cards/silence";
import { cardWidgetMeta } from "../cards/widget";
import { IMPORT_SOURCES, ImportInputError, type ImportJob } from "../../job-import/model";
import { fromOverwatch } from "../../job-import/overwatch";
import { SHEET_KINDS, fromSpreadsheets } from "../../job-import/spreadsheet";
import {
  appliedCard,
  nothingToSave,
  planImport,
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
  "In Overwatch, open the job, click ··· at the top of the project page and choose Export for Athena. It downloads one .json file; attach that file here.";
export const FULL_ACCESS_HOW =
  "Importing onto a job that's already in Athena needs full access to that job. Ask your company's owner to add you to the job, or to run the import. Nothing was saved.";

export const JOB_IMPORT_RULE = ` When a member asks to import, move, migrate or bring a job over from Overwatch, Procore, Buildertrend or a spreadsheet, call job_import with step review and the export they supplied (the attached file as file when the host offers it, otherwise its text as export_text), then show its card. If they have no export yet, tell them how to get one: ${OVERWATCH_EXPORT_HOW} Save only after a separate yes to that card, with step save, the batch_id and the import_key it returned. Never call save in the same turn as review. Approved change orders arrive inside the SOV and contract; open ones arrive as unsent PCO drafts. Nothing is emailed or sent.`;

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

function cardResult(card: CardModel, extra: Record<string, unknown>, rule: string) {
  const html = renderHtml({ ...card, show_state: false });
  const shown = applyCardClosing(`${renderMarkdown(card)}\n\n${htmlBlock(html)}`, false);
  return guide(
    { ...text(shown), structuredContent: { card, html, ...extra }, _meta: { ...cardWidgetMeta } },
    rule,
  );
}

const sheet = z.object({
  kind: z.enum(SHEET_KINDS),
  text: z.string().min(1).max(1_000_000),
  name: z.string().trim().max(120).optional(),
});

export function readExport(args: {
  source: (typeof IMPORT_SOURCES)[number];
  export_text?: string;
  sheets?: z.infer<typeof sheet>[];
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
  const sheets = args.sheets?.length
    ? args.sheets
    : args.export_text?.trim()
      ? [{ kind: "sov" as const, text: args.export_text }]
      : [];
  if (!args.job_number || !args.job_name)
    throw new ImportInputError("Give the job number and job name for a spreadsheet import.");
  return fromSpreadsheets(sheets, {
    system: args.source,
    job_number: args.job_number,
    name: args.job_name,
    customer: args.customer ?? null,
    original_contract: args.original_contract ?? null,
    retainage_pct: args.retainage_pct ?? null,
  });
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
    sheets: z.array(sheet).max(6).optional(),
    daily_days: z.number().int().min(0).max(3650).optional(),
    batch_id: z.string().uuid().optional(),
    import_key: z.string().trim().max(64).optional(),
    confirmed: z.boolean().optional(),
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
        const result = await call<Record<string, unknown>>(sb, "mcp_job_import_apply", {
          _batch: args.batch_id,
          _hash: args.import_key,
          _confirmed: true,
        });
        const jobNumber = String(result.job_number ?? args.job_number ?? "");
        const card = appliedCard(result, jobNumber, args.source ?? "overwatch");
        // Client approvals and notices email the job's PM, so a job that came in without one gets the PM question.
        const pmAsk = await importPmAsk(sb, result);
        return cardResult(
          card,
          { written: !result.already_applied, result },
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
      if (!exportText?.trim() && !args.sheets?.length && args.file?.download_url) {
        try {
          const bytes = await fetchAllowedFile(args.file.download_url, FILE_MAX_BYTES);
          exportText = new TextDecoder("utf-8", { fatal: false })
            .decode(bytes)
            .replace(/^\uFEFF/, "");
        } catch (e) {
          if (e instanceof FileRejected) throw new ToolError(e.message.replace(/stored/, "saved"));
          throw e;
        }
      }
      let imported: ImportJob;
      try {
        imported = readExport({ ...args, export_text: exportText, source: args.source });
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

      const context = await call<ImportContext>(sb, "mcp_job_import_context", {
        _company: choice.companyId,
        _job_number: jobNumber,
        _source: imported.source.system,
      });
      if (context.job_exists && context.scope !== "full") throw new ToolError(FULL_ACCESS_HOW);
      const plan = planImport(imported, context);
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
      if (nothingToSave(plan))
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
        },
        "Show this card. Do not add text after it. Save only after a separate yes, with step save, this batch_id and import_key; the review expires in 15 minutes.",
      );
    }),
});
