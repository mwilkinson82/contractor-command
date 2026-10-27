// Morning brief tools. Settings are per user. The brief is built on request. Nothing is sent.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorCard, errorMessage } from "../error-card";
import { run } from "../guard";
import { resolveJob } from "../jobs";
import { gettingStartedReply } from "./getting-started-tool";
import { loadMorningBrief, presentSettings, readBriefSettings, saveBriefSettings } from "../morning-brief-load";

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const companyId = z.string().trim().max(200).optional();
const jobNumber = z.string().trim().min(1).max(40).optional();

async function requestedBrief(sb: Parameters<typeof loadMorningBrief>[0], args: { company_id?: string; job_number?: string }) {
  const job = args.job_number ? await resolveJob(sb, args.job_number, args.company_id) : null;
  return loadMorningBrief(sb, args.company_id, job ? { job_id: job.job_id, job_number: job.job_number, company_id: job.company_id } : undefined);
}

export const athenaHello = defineTool({
  name: "athena_hello",
  title: "Athena hello",
  description:
    "Opens compact saved-job and next-action guidance for a simple hello, Hey Athena, Athina, Athen or Atena; also safely handles Hey Athena, let's get started if this greeting tool is selected instead of getting_started; never starts a morning brief or creates records, and explicit Good morning Athena or morning-brief requests use morning_brief.",
  inputSchema: { company_id: companyId, job_number: jobNumber },
  annotations: READ,
  handler: (args, ctx) =>
    run("athena_hello", ctx, {}, (sb) => {
      // Retain the existing argument schema for connected hosts; entry shows saved choices.
      void args;
      return gettingStartedReply(sb);
    }),
});

export const MORNING_BRIEF_DESCRIPTION =
  "Builds the member's construction morning brief across every job in every company they belong to, grouped by company when there is more than one, when they say Athena, good morning, Good morning Athena, Morning Athena, Athina what's on my hitlist this morning, Athen good morning, Atena good morning, hitlist, morning briefing, what's on my plate today, overdue, or today's deadlines on my jobs, Athena leads, the card always keeps the heading From your inbox and calendar, and when Gmail and Calendar can be read the placeholder rows are replaced with emails that came in overnight, unanswered emails that need a reply, and today's meetings, and when they cannot the placeholder rows stay and no error text is written, then the job side follows with the schedule, notices, submittals due, overdue items, and what happened yesterday versus what is due today, the reply is the full styled HTML card every time they ask, including From your inbox and calendar, and nothing is sent, with job_number for a named-job brief or without it for the all-job portfolio brief; generic greetings and get-started requests use getting_started or athena_hello instead, even after the briefing time.";

export const morningBrief = defineTool({
  name: "morning_brief",
  title: "Morning brief",
  description: MORNING_BRIEF_DESCRIPTION,
  inputSchema: { company_id: companyId, job_number: jobNumber },
  annotations: READ,
  handler: (args, ctx) =>
    run("morning_brief", ctx, {}, async (sb) => {
      try {
        return await requestedBrief(sb, args);
      } catch (e) {
        return errorCard("Morning brief", errorMessage(e, "The morning brief could not be opened."));
      }
    }),
});

export const morningBriefSettings = defineTool({
  name: "morning_brief_settings",
  title: "Morning briefing time",
  description:
    "Reads or sets this member's morning briefing time and on or off switch, including when they say set my morning briefing to 6am, and shows the saved setting without sending anything.",
  inputSchema: {
    action: z.enum(["get", "set"]).optional(),
    enabled: z.boolean().optional(),
    send_time: z.string().trim().max(20).optional(),
    time_zone: z.string().trim().max(80).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: (args, ctx) =>
    run("morning_brief_settings", ctx, {}, async (sb) => {
      try {
        const setting = args.action === "set" || args.enabled != null || !!args.send_time?.trim() || !!args.time_zone?.trim();
        const saved = setting
          ? await saveBriefSettings(sb, { enabled: args.enabled, send_time: args.send_time, time_zone: args.time_zone })
          : await readBriefSettings(sb);
        return presentSettings(saved);
      } catch (e) {
        return errorCard("Morning briefing", errorMessage(e, "The morning briefing setting could not be opened."));
      }
    }),
});
