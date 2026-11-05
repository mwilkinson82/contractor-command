import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import {
  GETTING_STARTED_GUIDANCE,
  claimGettingStarted,
  firstJobCard,
  firstJobGuidance,
  memberJobs,
  renderGettingStarted,
  sourceGuidanceCard,
  startedWithJobsCard,
} from "../getting-started";
import { run, text, type Sb } from "../guard";
import { guide } from "../visible";
import type { CardSection } from "../cards/model";

const READ = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
export async function gettingStartedReply(
  sb: Sb,
  focus: "overview" | "documents" | "cost_codes" = "overview",
  /** Hello only: what came back since yesterday, shown under the saved jobs. */
  since?: (sb: Sb) => Promise<CardSection | null>,
) {
  await claimGettingStarted(sb);
  const found = await memberJobs(sb as never);
  const base =
    focus !== "overview"
      ? sourceGuidanceCard(focus, found)
      : found.jobs.length
        ? startedWithJobsCard(found.jobs)
        : firstJobCard(found.company);
  const extra = since && focus === "overview" && found.jobs.length ? await since(sb) : null;
  const card = extra
    ? {
        ...base,
        sections: [
          ...(base.sections ?? []).slice(0, 1),
          extra,
          ...(base.sections ?? []).slice(1),
        ],
      }
    : base;
  return guide(
    {
      ...text(renderGettingStarted(card)),
      structuredContent: { card, branch: found.jobs.length ? "resume" : "first_job", focus },
    },
    found.jobs.length || focus !== "overview"
      ? GETTING_STARTED_GUIDANCE
      : firstJobGuidance(found.company),
  );
}

export const gettingStarted = defineTool({
  name: "getting_started",
  title: "Start or resume with Athena",
  description:
    "Opens onboarding for Hey Athena, let's get started, let's get started, how does Athena work, or help getting started, taking priority over a generic greeting or proactive morning brief; shows saved jobs or first-job guidance and explains current document and cost-code routes without creating records, starting meetings or importing data.",
  inputSchema: { focus: z.enum(["overview", "documents", "cost_codes"]).optional() },
  annotations: READ,
  handler: (args, ctx) =>
    run("getting_started", ctx, undefined, async (sb) => {
      return gettingStartedReply(sb, args.focus);
    }),
});
