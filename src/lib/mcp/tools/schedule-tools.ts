import { assertScheduleCompany } from "../schedule-job";
import { defineTool, ToolError, type JsonValueInput } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, run, text } from "../guard";
import { resolveJob, named, FULL_ACCESS_MESSAGE } from "../jobs";
import { scheduleRequest, scheduleDate } from "../schedule-schema";
import {
  prepareSchedule,
  schedulePortfolio,
  starterWbs,
  ScheduleInputError,
} from "../schedule-control";
import type { LivingData } from "../living";
import { loadJobSourceClauses } from "../source-clauses";
import { draftScheduleNotice } from "../schedule-notice";

const json = (value: unknown): JsonValueInput => JSON.parse(JSON.stringify(value));

/** Preparation is read-only. The existing approved save tool remains the only write path. */
export const scheduleWorkflow = defineTool({
  name: "schedule_workflow",
  title: "Prepare WBS, schedule update or delay comparison",
  description:
    "Reviews a job's schedule or prepares a calculated WBS, progress, baseline, delay scenario or source-grounded draft notice without saving or sending.",
  inputSchema: {
    job_number: z.string().trim().min(1).max(40),
    company_id: z.string().trim().min(1).max(200).optional(),
    action: z.enum(["inspect", "prepare", "draft_notice"]),
    base_version: z.number().int().min(0).optional(),
    version: z.number().int().min(1).optional(),
    request: scheduleRequest.optional(),
    event: z
      .object({
        id: z.string().trim().min(1).max(80),
        description: z.string().trim().min(1).max(2000),
        delay_start: scheduleDate.nullable(),
        affected_activity_ids: z.array(z.string().max(20)).min(1).max(100),
        source_refs: z.array(z.string().max(300)).max(30),
      })
      .strict()
      .optional(),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run("schedule_workflow", ctx, { jobNumber: args.job_number, sweep: false }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      await assertScheduleCompany(sb, job, args.company_id);
      if (job.scope !== "full") throw new ToolError(FULL_ACCESS_MESSAGE);
      if (args.action !== "inspect" && args.version != null)
        throw new ToolError(
          "Revisions and notices use the current saved version; historical versions are view-only.",
        );
      const got = await sb.rpc("mcp_living_report_get", {
        _job: job.job_id,
        _type: "cpm",
        _version: args.version ?? null,
      });
      if (got.error) dbError(got.error);
      const saved = got.data as {
        found: boolean;
        version?: number;
        data?: LivingData;
        data_date?: string | null;
      };
      const version = saved.found ? saved.version! : 0;
      if (args.action !== "inspect" && args.base_version !== version)
        throw new ToolError(
          `This schedule is v${version}. Load that version before preparing a revision or notice.`,
        );
      if (args.action === "inspect")
        return {
          ...text(
            `${named(job)} · Schedule ${saved.found ? `v${version}` : "not saved"}. Review the WBS and missing inputs before preparation. No changes saved.`,
          ),
          structuredContent: {
            found: saved.found,
            version,
            data: json(saved.data ?? null),
            starter_wbs: starterWbs(),
            portfolio_contract: schedulePortfolio(saved.data ?? null, {
              company_id: job.company_id,
              job_id: job.job_id,
              version,
              data_date: saved.data_date ?? null,
            }),
            next: "Prepare with explicit calendars/project start for calculation, or organize only to retain imported dates. Review, then save using living_report_save with the identical schedule_request, base_version and approved=true.",
          },
        };
      if (args.action === "draft_notice") {
        if (!args.event || args.request)
          throw new ToolError(
            "Supply the reported event for a draft notice, without a revision request.",
          );
        const ids = new Set((saved.data?.activities ?? []).map((a) => a.id));
        for (const id of args.event.affected_activity_ids)
          if (!ids.has(id))
            throw new ToolError(`Affected activity ${id} is not in this job's saved schedule.`);
        const sources = await loadJobSourceClauses(sb, job, args.company_id);
        const draft = draftScheduleNotice({
          job_label: named(job),
          event: args.event,
          clauses: sources.clauses,
          source_issues: sources.problems,
          data: saved.data ?? null,
        });
        return {
          ...text(draft.body),
          structuredContent: {
            draft_only: true,
            sent: false,
            saved: false,
            base_version: version,
            ...draft,
          },
        };
      }
      if (!args.request || args.event)
        throw new ToolError("Supply one schedule request to prepare.");
      if (saved.data_date && args.request.data_date < saved.data_date)
        throw new ToolError("Revision data date cannot precede the current saved data date.");
      try {
        const prepared = prepareSchedule(
          saved.data ?? null,
          version,
          args.request,
          saved.data_date,
        );
        return {
          ...text(
            `${named(job)} · Draft, not saved · based on v${version}.\nOperation: ${args.request.operation}. ${prepared.changes.length} activities changed.\nCalculation: ${prepared.control.calculation.status}.${prepared.control.analysis ? `\nModeled completion movement: ${prepared.control.analysis.impact_calendar_days} calendar days (${prepared.control.analysis.prior_completion} → ${prepared.control.analysis.updated_completion}). ${prepared.control.analysis.limitation}` : ""}\n${prepared.missing.map((m) => `Needed: ${m}`).join("\n")}\nReview this draft before saving. No notice sent.`,
          ),
          structuredContent: {
            saved: false,
            base_version: version,
            prepared: json(prepared),
            save: {
              tool: "living_report_save",
              report_type: "cpm",
              base_version: version,
              schedule_request: args.request,
              approval_required: true,
              what_changed_required: true,
            },
            portfolio_contract: schedulePortfolio(prepared.data, {
              company_id: job.company_id,
              job_id: job.job_id,
              version,
              data_date: args.request.data_date,
            }),
          },
        };
      } catch (e) {
        if (e instanceof ScheduleInputError) throw new ToolError(e.message);
        throw e;
      }
    }),
});
