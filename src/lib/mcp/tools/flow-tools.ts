// Guided meetings. Each stage is one server-built card. The sample path on job 2701 writes nothing.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { renderHtml } from "../cards/html";
import { htmlBlock, renderMarkdown } from "../cards/markdown";
import { CARD_WIDGET_MIME, CARD_WIDGET_URI, cardWidgetHtml, cardWidgetMeta } from "../cards/widget";
import { buildFlowCard } from "../flows/build";
import { job2701FlowData } from "../flows/job-2701";
import { loadFlowData, saveFlowNote } from "../flows/load";
import { STAGE_LABEL, stagesFor, type FlowData, type FlowName } from "../flows/types";
import { run, text, type Sb } from "../guard";
import { FULL_ACCESS_MESSAGE, audit, resolveJob } from "../jobs";
import { listCompaniesAndJobs } from "./workflow-tools";
import { guide } from "../visible";

const jobNumber = z.string().trim().min(1).max(40).optional();
const companyId = z.string().trim().min(1).max(200).optional();
const note = z.string().trim().max(4000).optional();
const crewMode = z.enum(["subcontract", "self_perform"]).optional();
const sample = z.literal(true).optional();
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

function present(flow: FlowName, stage: string, data: FlowData) {
  const card = buildFlowCard(flow, stage, data);
  const html = renderHtml(card);
  const stages = [...stagesFor(flow)];
  const next = stages[stages.indexOf(stage) + 1] ?? null;
  const body = `${renderMarkdown(card)}\n\n${htmlBlock(html)}`;
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
      content: [
        {
          type: "resource" as const,
          resource: {
            uri: CARD_WIDGET_URI,
            mimeType: CARD_WIDGET_MIME,
            text: cardWidgetHtml(),
            _meta: { ...cardWidgetMeta },
          },
        },
        { type: "text" as const, text: body, _meta: { ...cardWidgetMeta } },
      ],
    },
    next
      ? `When the PM continues, call ${flow} with stage ${next} only. The PM meeting order is schedule progress, then the locked lookahead, then subs suppliers and crews, then change orders, accounting, and the IOR delta. Do not add field readiness, financial, open actions, or closeout. Show the card first, with no plain text before it.`
      : "This meeting is at its last stage. The order was schedule progress, the locked lookahead, subs suppliers and crews, change orders, accounting, then the IOR delta. Show the card first, with no plain text before it.",
  );
}

async function lead(flow: FlowName, args: { job_number?: string; company_id?: string; stage?: string; note?: string; crew_mode?: "subcontract" | "self_perform"; sample?: true }, sb: Sb) {
  if (!args.job_number?.trim()) return text(await listCompaniesAndJobs(sb, args.company_id));
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
  return present(flow, stage, data);
}

export const pmMeeting = defineTool({
  name: "pm_meeting",
  title: "PM meeting",
  description: "Runs the construction project manager meeting for a job the member just named, through schedule progress, the locked lookahead, subs suppliers and crews, change orders, billing, and the IOR, and must not fill job_number from chat context or hand the request to a calendar.",
  inputSchema: { job_number: jobNumber, company_id: companyId, stage: z.enum(["progress", "schedule", "change_orders", "accounting", "ior"]).optional(), note, crew_mode: crewMode, sample },
  annotations: WRITE,
  handler: (args, ctx) =>
    run("pm_meeting", ctx, { jobNumber: args.job_number }, async (sb) => lead("pm_meeting", args, sb)),
});

export const pmMorning = defineTool({
  name: "pm_morning",
  title: "PM morning meeting",
  description: "Runs the construction project morning meeting for a job the member just named, through the schedule, lookahead, crews, risks, and spillover, and must not fill job_number from chat context or hand the request to a calendar.",
  inputSchema: { job_number: jobNumber, company_id: companyId, stage: z.enum(["schedule", "crews", "risks", "spillover", "log"]).optional(), note, crew_mode: crewMode, sample },
  annotations: WRITE,
  handler: (args, ctx) =>
    run("pm_morning", ctx, { jobNumber: args.job_number }, async (sb) => lead("pm_morning", args, sb)),
});

export const pmEvening = defineTool({
  name: "pm_evening",
  title: "Evening wrap-up",
  description: "Runs the construction project evening wrap-up for a job the member just named, through dailies, photos, risks, what happened, schedule disruptions, and the log, and must not fill job_number from chat context or hand the request to a calendar.",
  inputSchema: { job_number: jobNumber, company_id: companyId, stage: z.enum(["dailies", "photos", "risks", "happened", "disruptions", "log"]).optional(), note, crew_mode: crewMode, sample },
  annotations: WRITE,
  handler: (args, ctx) =>
    run("pm_evening", ctx, { jobNumber: args.job_number }, async (sb) => lead("pm_evening", args, sb)),
});
