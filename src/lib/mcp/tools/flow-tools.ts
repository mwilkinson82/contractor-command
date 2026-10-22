// Guided meetings. Each stage is one server-built card. The sample path on job 2701 writes nothing.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { renderHtml } from "../cards/html";
import { inferCard } from "../cards/infer";
import { htmlBlock, renderMarkdown } from "../cards/markdown";
import { CARD_WIDGET_URI, cardWidgetMeta } from "../cards/widget";
import { CARD_SHOWN, CARD_SHOWN_PICK, applyCardClosing } from "../cards/silence";
import { signedJobPages } from "../board-url";
import { applyMeetingFigures, buildFlowCard } from "../flows/build";
import { isUuid } from "../../report-pages";
import { job2701FlowData } from "../flows/job-2701";
import { loadFlowData, saveFlowNote } from "../flows/load";
import { STAGE_LABEL, stagesFor, type FlowData, type FlowName } from "../flows/types";
import { run, text, type Sb } from "../guard";
import { FULL_ACCESS_MESSAGE, audit, resolveJob } from "../jobs";
import { listCompaniesAndJobs, listedJobs } from "./workflow-tools";
import { guide } from "../visible";

const jobNumber = z.string().trim().min(1).max(40).optional();
const companyId = z.string().trim().min(1).max(200).optional();
const note = z.string().trim().max(4000).optional();
const crewMode = z.enum(["subcontract", "self_perform"]).optional();
const sample = z.literal(true).optional();
const figure = z.number().min(0).max(1_000_000_000).optional();
const percent = z.number().min(0).max(100).optional();
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

function present(flow: FlowName, stage: string, data: FlowData) {
  const card = buildFlowCard(flow, stage, data);
  const html = renderHtml(card);
  const stages = [...stagesFor(flow)];
  const next = stages[stages.indexOf(stage) + 1] ?? null;
  const body = applyCardClosing(`${renderMarkdown(card)}\n\n${htmlBlock(html)}`, false);
  return guide(
    {
      structuredContent: {
        card,
        html,
        flow,
        stage,
        stages,
        next_stage: next,
        sample: data.sample,
        logged: data.logged,
        "openai/outputTemplate": CARD_WIDGET_URI,
      },
      _meta: { ...cardWidgetMeta },
      content: [{ type: "text" as const, text: body, _meta: { ...cardWidgetMeta } }],
    },
    next
      ? `When the PM continues, call ${flow} with stage ${next} only. Do not add field readiness, financial, open actions, or closeout. Record a planned bill and a realistic bill as plan and realistic on stage accounting. Do not call living_report_save for those two figures. ${CARD_SHOWN}`
      : CARD_SHOWN,
  );
}

/** Phrases that must route a greeting to the morning hitlist, including misspellings. */
export const ATHENA_GREETING_PHRASES = [
  "Athena, good morning",
  "Hey Athena",
  "Good morning Athena",
  "Morning Athena",
  "Athena at the start or mid-sentence",
  "Athina",
  "Athen",
  "Atena",
] as const;

export const MORNING_HITLIST_TITLE = "Athena, good morning, Hey Athena, Good morning Athena, Morning Athena, Athina, Athen, Atena";

export const MORNING_HITLIST_DESCRIPTION =
  "Athena answers Athena, good morning, Hey Athena, Good morning Athena, Morning Athena, Athena at the start or mid-sentence, and misspellings Athina, Athen, and Atena, plus hitlist, morning briefing, what's on my plate today, overdue, and today's deadlines on my jobs, as the construction job hitlist, not email or calendar.";

function sealedCard(card: ReturnType<typeof inferCard>, pick: boolean) {
  const html = renderHtml(card);
  const body = applyCardClosing(`${renderMarkdown(card)}\n\n${htmlBlock(html)}`, pick);
  return guide(
    {
      structuredContent: { card, html, ...(pick ? { which_job: true } : {}), "openai/outputTemplate": CARD_WIDGET_URI },
      _meta: { ...cardWidgetMeta },
      content: [{ type: "text" as const, text: body, _meta: { ...cardWidgetMeta } }],
    },
    pick ? CARD_SHOWN_PICK : CARD_SHOWN,
  );
}

/** A greeting with no other ask: the morning hitlist when one job is in view, otherwise the which-job card. */
export async function morningGreeting(sb: Sb, companyId?: string) {
  const jobs = await listedJobs(sb, companyId);
  if (jobs.length === 1) return lead("pm_morning", { job_number: jobs[0].job_number, company_id: companyId }, sb);
  const listing = await listCompaniesAndJobs(sb, companyId, "pm_morning");
  return sealedCard(inferCard("athena_morning_hitlist", listing), true);
}

async function lead(flow: FlowName, args: { job_number?: string; company_id?: string; stage?: string; note?: string; crew_mode?: "subcontract" | "self_perform"; sample?: true; plan?: number; realistic?: number; percent_complete?: number }, sb: Sb) {
  if (!args.job_number?.trim()) {
    if (flow === "pm_morning") return morningGreeting(sb, args.company_id);
    return text(await listCompaniesAndJobs(sb, args.company_id, flow));
  }
  const stages = stagesFor(flow);
  const stage = args.stage ?? stages[0];
  if (!stages.includes(stage)) throw new ToolError(`That stage is not in this meeting. The stages are ${stages.map((s) => STAGE_LABEL[s]).join(", ")}.`);
  const job = await resolveJob(sb, args.job_number!, args.company_id);
  if (job.scope === "contract") throw new ToolError(FULL_ACCESS_MESSAGE);
  if (args.sample === true && job.job_number !== "2701") throw new ToolError("The sample walkthrough is only on job 2701.");
  const selfPerform = args.crew_mode === "self_perform";
  const data = args.sample === true
    ? job2701FlowData({ selfPerform, note: args.note ?? null, sample: true })
    : await loadFlowData(sb as never, { job_id: job.job_id, job_number: job.job_number, name: job.name, scope: job.scope ?? "" }, selfPerform);
  if (args.sample !== true && args.note) {
    data.note = args.note;
    const card = buildFlowCard(flow, stage, data);
    const saved = await saveFlowNote(sb as never, job.job_id, flow, stage, args.note, { stage, note: args.note, ior: data.iorNow, risks: card.alerts ?? [] });
    data.itemFiled = saved.item;
    data.logged = saved.item && saved.snapshot;
  }
  if (args.sample !== true) await audit(sb, job, flow, `guided_${stage}`, null);
  if (!data.showMoney) data.money = { plan: null, realistic: null, billed: null, contract: null, remaining: null, retentionHeld: null, retentionReleasable: data.money.retentionReleasable };
  applyMeetingFigures(data, args);
  if (args.sample !== true && isUuid(job.job_id) && (job.scope === "full" || job.scope === "super")) {
    const links = await signedJobPages((fn, a) => sb.rpc(fn, a), job.job_id, job.scope);
    data.fieldUrl = links.field ?? null;
    data.itemsUrl = links.items ?? null;
    data.iorUrl = links.ior ?? null;
    data.dailyUrl = links.daily ?? null;
    data.photosUrl = links.photos ?? null;
  }
  return present(flow, stage, data);
}

export const pmMeeting = defineTool({
  name: "pm_meeting",
  title: "Run construction PM meeting (Athena)",
  description: "Runs the construction PM meeting in Athena, the job meeting on the schedule rather than a calendar appointment, when someone says run my PM meeting or start the project meeting, through schedule progress, the locked lookahead, subs suppliers and crews, change orders, billing, and the IOR, and must not fill job_number from chat context or build a generic meeting widget.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    stage: z.enum(["progress", "schedule", "change_orders", "accounting", "ior"]).optional(),
    note,
    crew_mode: crewMode,
    sample,
    plan: figure,
    realistic: figure,
    percent_complete: percent,
  },
  annotations: READ,
  handler: (args, ctx) =>
    run("pm_meeting", ctx, { jobNumber: args.job_number }, async (sb) => lead("pm_meeting", args, sb)),
});

export const pmMorning = defineTool({
  name: "athena_morning_hitlist",
  title: MORNING_HITLIST_TITLE,
  description: MORNING_HITLIST_DESCRIPTION,
  inputSchema: { job_number: jobNumber, company_id: companyId, stage: z.enum(["schedule", "crews", "risks", "spillover", "log"]).optional(), note, crew_mode: crewMode, sample },
  annotations: READ,
  handler: (args, ctx) =>
    run("athena_morning_hitlist", ctx, { jobNumber: args.job_number }, async (sb) => lead("pm_morning", args, sb)),
});

export const pmEvening = defineTool({
  name: "pm_evening",
  title: "Evening wrap-up",
  description: "Runs the construction project evening wrap-up for a job the member just named, through dailies, photos, risks, what happened, schedule disruptions, and the log, and must not fill job_number from chat context or hand the request to a calendar.",
  inputSchema: { job_number: jobNumber, company_id: companyId, stage: z.enum(["dailies", "photos", "risks", "happened", "disruptions", "log"]).optional(), note, crew_mode: crewMode, sample },
  annotations: READ,
  handler: (args, ctx) =>
    run("pm_evening", ctx, { jobNumber: args.job_number }, async (sb) => lead("pm_evening", args, sb)),
});
