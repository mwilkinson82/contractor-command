// Fragnet preview and save. The host calls these instead of calculating the CPM itself.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { renderHtml } from "../cards/html";
import { htmlBlock, renderMarkdown } from "../cards/markdown";
import { dbError, run, text, type Sb } from "../guard";
import { FULL_ACCESS_MESSAGE, audit, named, resolveJob, type Job } from "../jobs";
import { checkSave, type Activity, type LivingData } from "../living";
import { guide } from "../visible";
import {
  FragnetError,
  buildFragnet,
  fragnetCard,
  fragnetForecast,
  fragnetHolidays,
  readFragActivities,
  type FragActivity,
  type FragnetPlan,
  type FragnetRequest,
} from "../fragnet";

const jobNumber = z.string().trim().min(1).max(40);
const companyId = z.string().trim().min(1).max(200).optional();
const activityId = z.string().trim().min(1).max(20);
const READ = { readOnlyHint: true, openWorldHint: false, idempotentHint: true } as const;
const SAVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;

const fields = {
  job_number: jobNumber,
  company_id: companyId,
  description: z.string().trim().min(1).max(500),
  duration_workdays: z.number().int().min(1).max(2000),
  successors: z.array(activityId).min(1).max(30),
  predecessor: activityId.optional(),
};

type Got = {
  found: boolean;
  version?: number;
  data_date?: string | null;
  contract_total?: number | null;
  contract_completion_date?: string | null;
  data?: LivingData;
};

async function rpc<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);
  if (error) dbError(error);
  return data as T;
}

async function whoAmI(sb: Sb, job: Job, userId: string | undefined): Promise<string | null> {
  if (!userId) return null;
  const { data } = await sb.from("mcp_company_members").select("display_name, role").eq("company_id", job.company_id).eq("user_id", userId).maybeSingle();
  if (!data) return null;
  const role = data.role === "pm" ? "PM" : data.role === "all_access" ? "All-access" : String(data.role).charAt(0).toUpperCase() + String(data.role).slice(1);
  return `${data.display_name} (${role})`;
}

type FragArgs = {
  job_number: string;
  company_id?: string;
  description: string;
  duration_workdays: number;
  successors: string[];
  predecessor?: string;
};

function requestOf(args: FragArgs): FragnetRequest {
  return { description: args.description, duration: args.duration_workdays, successors: args.successors, predecessor: args.predecessor ?? null };
}

function present(plan: FragnetPlan, job: Job, saved: boolean, version: number | null) {
  const card = fragnetCard(plan, { job: named(job), saved, version });
  const html = renderHtml(card);
  return { card, html, body: `${renderMarkdown(card)}\n\n${htmlBlock(html)}` };
}

async function loadPlan(sb: Sb, job: Job, request: FragnetRequest): Promise<{ got: Got; plan: FragnetPlan; activities: FragActivity[] }> {
  if (job.scope === "contract") throw new ToolError(FULL_ACCESS_MESSAGE);
  const got = await rpc<Got>(sb, "mcp_living_report_get", { _job: job.job_id, _type: "cpm", _version: null });
  if (!got.found) throw new ToolError("No saved schedule on this job yet. Nothing was saved.");
  const activities = readFragActivities(got.data?.activities);
  if (!activities.length) throw new ToolError("No saved schedule on this job yet. Nothing was saved.");
  try {
    return { got, plan: buildFragnet(activities, request, fragnetHolidays(got.data)), activities };
  } catch (e) {
    if (e instanceof FragnetError) throw new ToolError(e.message);
    throw e;
  }
}

const guidancePreview =
  "Preview only. Nothing was written. Show this fragnet card as written. Ask the member whether to save it. Only after a yes, call fragnet_save with the same job, description, duration, successors, and predecessor, and confirm true.";
const guidanceSaved =
  "The fragnet is saved on the CPM and a delay event is recorded. Show this card. Do not run another forward pass.";

export const fragnetPreview = defineTool({
  name: "fragnet_preview",
  title: "Fragnet preview",
  description: "Previews a delay fragnet on the saved CPM, including the new finish, the completion impact, and the critical path.",
  inputSchema: fields,
  annotations: READ,
  handler: (args, ctx) =>
    run("fragnet_preview", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      const { plan } = await loadPlan(sb, job, requestOf(args));
      await audit(sb, job, "fragnet_preview", "view_fragnet", null);
      const shown = present(plan, job, false, null);
      return guide(
        {
          ...text(shown.body),
          structuredContent: {
            card: shown.card,
            html: shown.html,
            preview: true,
            saved: false,
            fragnet_id: plan.delayId,
            predecessor: plan.predecessorId,
            successors: plan.successorIds,
            old_finish: plan.oldFinish,
            new_finish: plan.newFinish,
            impact_workdays: plan.impactWd,
            critical_path: plan.criticalPath,
            driven_ids: plan.drivenIds,
            moved: plan.moved,
            activities: plan.activities,
          },
        },
        guidancePreview,
      );
    }),
});

export const fragnetSave = defineTool({
  name: "fragnet_save",
  title: "Save fragnet",
  description: "Saves a delay fragnet on the job schedule after the member confirms the preview.",
  inputSchema: { ...fields, confirm: z.literal(true) },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("fragnet_save", ctx, { jobNumber: args.job_number }, async (sb) => {
      if (args.confirm !== true) throw new ToolError("Ask before saving the fragnet. Nothing was saved.");
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      const { got, plan } = await loadPlan(sb, job, requestOf(args));
      const holidays = plan.holidays;
      const next: LivingData = {
        ...(got.data ?? {}),
        activities: plan.activities as Activity[],
        tia: {
          ...(got.data?.tia ?? {}),
          fragnet: plan.delayId,
          prior_completion: plan.oldFinish,
          updated_completion: plan.newFinish,
          ...(holidays.length ? { holidays } : {}),
        },
        delay_analysis: {
          fragnet: plan.delayId,
          title: args.description,
          delay_workdays: args.duration_workdays,
          completion_impact_workdays: plan.impactWd,
          predecessor: plan.predecessorId,
          successors: plan.successorIds,
          start: plan.delay.start,
          finish: plan.delay.finish,
        },
      };
      const forecast = fragnetForecast(plan.activities);
      const contract = typeof got.contract_total === "number" ? Number(got.contract_total) : forecast;
      const chk = checkSave("cpm", next, got.data ?? null, contract);
      if (!chk.ok) {
        await audit(sb, job, "fragnet_save", "fragnet_refused", null);
        throw new ToolError(`Not saved. ${chk.problems.join(" ")}`);
      }
      const who = await whoAmI(sb, job, ctx.getUserId?.());
      const what = `Added fragnet ${plan.delayId} (${args.duration_workdays} working days) ahead of ${plan.successorIds.join(", ")}.`;
      const saved = await rpc<{ id: string; version: number }>(sb, "mcp_living_report_save", {
        _job: job.job_id,
        _type: "cpm",
        _base_version: got.version ?? 0,
        _data: next,
        _data_date: got.data_date ?? null,
        _activity_count: plan.activities.length,
        _contract_total: contract,
        _forecast_total: chk.forecast_total,
        _what: what,
        _why: args.description,
        _who: who,
        _completion: null,
        _replace_completion: false,
      });
      let delayEventId: string | null = null;
      try {
        const event = await rpc<{ delay_event_id: string }>(sb, "mcp_delay_event_add", {
          _job: job.job_id,
          _d: {
            description: args.description,
            activity: `${plan.delayId} before ${plan.successorIds.join(", ")}`,
            start_date: plan.delay.start,
            days: args.duration_workdays,
            cause: args.description,
          },
          _notice: null,
          _claim: null,
        });
        delayEventId = event.delay_event_id;
      } catch (e) {
        // The CPM version is already saved. A second save would insert another fragnet.
        if (!(e instanceof ToolError)) throw e;
      }
      await audit(sb, job, "fragnet_save", "save_fragnet", saved.id);
      const shown = present(plan, job, true, saved.version);
      return guide(
        {
          ...text(shown.body),
          structuredContent: {
            card: shown.card,
            html: shown.html,
            preview: false,
            saved: true,
            version: saved.version,
            fragnet_id: plan.delayId,
            delay_event_id: delayEventId,
            predecessor: plan.predecessorId,
            successors: plan.successorIds,
            old_finish: plan.oldFinish,
            new_finish: plan.newFinish,
            impact_workdays: plan.impactWd,
            critical_path: plan.criticalPath,
            driven_ids: plan.drivenIds,
            moved: plan.moved,
            activities: plan.activities,
          },
        },
        guidanceSaved,
      );
    }),
});
