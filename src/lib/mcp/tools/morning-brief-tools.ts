// Morning brief tools. Settings are per user. The brief is built on request. Nothing is sent.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run } from "../guard";
import { loadMorningBrief, presentSettings, readBriefSettings, saveBriefSettings } from "../morning-brief-load";

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const companyId = z.string().trim().min(1).max(200).optional();

export const MORNING_BRIEF_DESCRIPTION =
  "Builds the member's morning brief across every job they can see when they say Athena, good morning, Hey Athena, Good morning Athena, Morning Athena, Athena at the start or mid-sentence, Athina, Athen, Atena, hitlist, morning briefing, what's on my plate today, overdue, or today's deadlines on my jobs, and this is the construction morning brief, not email or calendar, and nothing is sent.";

export const morningBrief = defineTool({
  name: "morning_brief",
  title: "Morning brief",
  description: MORNING_BRIEF_DESCRIPTION,
  inputSchema: { company_id: companyId },
  annotations: READ,
  handler: (args, ctx) =>
    run("morning_brief", ctx, {}, async (sb) => loadMorningBrief(sb, args.company_id)),
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
      const setting = args.action === "set" || args.enabled != null || !!args.send_time?.trim() || !!args.time_zone?.trim();
      const saved = setting
        ? await saveBriefSettings(sb, { enabled: args.enabled, send_time: args.send_time, time_zone: args.time_zone })
        : await readBriefSettings(sb);
      return presentSettings(saved);
    }),
});
