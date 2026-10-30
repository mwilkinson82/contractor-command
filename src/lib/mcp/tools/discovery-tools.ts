import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, type Sb } from "../guard";
import { memberCompanies, resolveJob, type MemberCompany } from "../jobs";
import { drawingRecords } from "../drawing-set";
import type { CardModel } from "../cards/model";
import { renderHtml } from "../cards/html";
import { renderMarkdown } from "../cards/markdown";
import { cardWidgetMeta } from "../cards/widget";
import { guide } from "../visible";
import { JOBS_RESPONSE_GUIDANCE, jobsResponseText, jobsLegacyHtml } from "../jobs-response";

const READ = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const companyId = z.string().trim().min(1).max(200).optional();

/** An explicit read filter never writes the member's saved current company. */
export function discoveryCompanies(companies: MemberCompany[], named?: string): MemberCompany[] {
  if (!named?.trim()) return companies;
  const want = named.trim().toLowerCase();
  const id = companies.find((c) => c.id.toLowerCase() === want);
  const matches = id ? [id] : companies.filter((c) => c.name.trim().toLowerCase() === want);
  if (matches.length !== 1)
    throw new ToolError("Choose one of your companies by its exact name or company ID.");
  return matches;
}

function shown<T extends Record<string, unknown>>(card: CardModel, facts: T) {
  return {
    content: [{ type: "text" as const, text: renderMarkdown(card) }],
    structuredContent: { ...facts, card, html: renderHtml(card) },
    _meta: cardWidgetMeta,
  };
}

export async function readJobs(sb: Sb, named?: string) {
  const companies = discoveryCompanies(await memberCompanies(sb), named);
  let jobs: { job_number: string; name: string | null; company_id: string }[] = [];
  if (companies.length) {
    const { data, error } = await sb
      .from("mcp_jobs")
      .select("job_number, name, company_id")
      .in(
        "company_id",
        companies.map((c) => c.id),
      );
    if (error) throw new Error(error.message);
    jobs = ((data ?? []) as typeof jobs).sort(
      (a, b) =>
        a.company_id.localeCompare(b.company_id) || a.job_number.localeCompare(b.job_number),
    );
  }
  const grouped = companies.map((c) => ({
    ...c,
    jobs: jobs.filter((j) => j.company_id === c.id),
  }));
  const counts = { jobs: jobs.length, companies: companies.length };
  const response = jobsResponseText(grouped, counts, !!named);
  return guide(
    {
      content: [{ type: "text" as const, text: response }],
      structuredContent: { companies: grouped, jobs, counts, html: jobsLegacyHtml(response) },
    },
    JOBS_RESPONSE_GUIDANCE,
  );
}

export const jobsList = defineTool({
  name: "jobs_list",
  title: "List my jobs",
  description:
    "Lists every job the member can access across all their companies, grouped by company, or filters to an explicitly named company without changing their current company.",
  inputSchema: { company_id: companyId },
  annotations: READ,
  handler: (args, ctx) => run("jobs_list", ctx, {}, (sb) => readJobs(sb, args.company_id)),
});

export async function readDrawingSets(sb: Sb, jobNumber: string, named?: string) {
  const companies = discoveryCompanies(await memberCompanies(sb), named);
  // Validate an explicit filter independently; resolveJob's general conversational
  // fallback must not silently substitute a different company for this read.
  const job = await resolveJob(sb, jobNumber, companies.length === 1 ? companies[0].id : undefined);
  if (!companies.some((c) => c.id === job.company_id))
    throw new ToolError("That job is not in the selected company.");
  const sources = (await drawingRecords(sb, job)).map((s) => ({
    source_id: s.id,
    filename: s.filename,
    revision: s.version,
    sheets: s.sheets,
    created_at: s.created_at,
  }));
  const card: CardModel = {
    state: "result",
    show_state: false,
    title: "Stored drawing sets",
    job: `${job.job_number} · ${job.name}`,
    kpis: [{ label: "Stored sets", value: String(sources.length) }],
    sections: sources.length
      ? sources.map((s) => ({
          heading: `${s.filename} · Revision ${s.revision}`,
          kind: "list" as const,
          rows: [
            { cells: ["Stored", s.created_at] },
            {
              cells: ["Sheets", s.sheets.length ? s.sheets.join(", ") : "Sheet names not indexed"],
            },
            // This identifier is the member-requested reference for subsequent
            // drawing calls, rather than an internal ID to hide in a label.
            { cells: ["Source ID", s.source_id], raw: true },
          ],
        }))
      : [
          {
            heading: "Drawing library",
            kind: "list" as const,
            rows: [{ cells: ["No drawing set is stored on this job."] }],
          },
        ],
  };
  return shown(card, { job_number: job.job_number, company_id: job.company_id, sources });
}

export const drawingSetsList = defineTool({
  name: "drawing_sets_list",
  title: "List stored drawing sets",
  description:
    "Lists a job's stored drawing sets with source IDs, revisions and sheet names without importing, indexing, downloading or changing a drawing.",
  inputSchema: { job_number: z.string().trim().min(1).max(40), company_id: companyId },
  annotations: READ,
  handler: (args, ctx) =>
    run("drawing_sets_list", ctx, { jobNumber: args.job_number }, (sb) =>
      readDrawingSets(sb, args.job_number, args.company_id),
    ),
});
