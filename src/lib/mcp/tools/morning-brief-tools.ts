// Morning brief tools. Settings are per user. The brief is built on request. Nothing is sent.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorCard, errorMessage } from "../error-card";
import { run } from "../guard";
import { loadMorningBrief, presentSettings, readBriefSettings, saveBriefSettings } from "../morning-brief-load";

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const companyId = z.string().trim().max(200).optional();

export const athenaHello = defineTool({
  name: "athena_hello",
  title: "Athena hello",
  description:
    "Returns the styled morning brief when the user says Good morning Athena, Hey Athena, what's on my plate today?, good morning, hey Athena, hello, or a misspelling like Athina, Athen, or Atena, and a second good morning the same day stays the short reply.",
  inputSchema: { company_id: companyId },
  annotations: READ,
  handler: (args, ctx) =>
    run("athena_hello", ctx, {}, async (sb) => {
      try {
        return await loadMorningBrief(sb, args.company_id);
      } catch (e) {
        return errorCard("Athena hello", errorMessage(e, "The morning brief could not be opened."));
      }
    }),
});

export const MORNING_BRIEF_DESCRIPTION =
  "Builds the member's construction morning brief across every job in every company they belong to, grouped by company when there is more than one, when they say Athena, good morning, Good morning Athena, Hey Athena, what's on my plate today?, Morning Athena, Athena at the start or mid-sentence, Athina, Athen, Atena, hitlist, morning briefing, what's on my plate today, overdue, or today's deadlines on my jobs, Athena leads, the host fills From your inbox and calendar from its own Gmail and Calendar with emails that came in overnight, unanswered emails that need a reply, and today's meetings, and leaves that section out when Gmail or Calendar is not available and never renders an empty heading, then the job side follows with the schedule, notices, submittals due, overdue items, and what happened yesterday versus what is due today, the reply is one styled HTML card, a second good morning the same day stays the short reply, and nothing is sent.";

export const morningBrief = defineTool({
  name: "morning_brief",
  title: "Morning brief",
  description: MORNING_BRIEF_DESCRIPTION,
  inputSchema: { company_id: companyId },
  annotations: READ,
  handler: (args, ctx) =>
    run("morning_brief", ctx, {}, async (sb) => {
      try {
        return await loadMorningBrief(sb, args.company_id);
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
