// The get-started card comes first. Job setup or the morning meeting sits on that card.
// This tool does not open with a which-job picker.
import { defineTool } from "@lovable.dev/mcp-js";
import type { CardModel } from "../cards/model";
import {
  claimGettingStarted,
  firstJobCard,
  firstJobGuidance,
  memberJobs,
  renderGettingStarted,
  startedWithJobsCard,
} from "../getting-started";
import { run, text, type Sb } from "../guard";
import { guide } from "../visible";

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

function cardResult(card: CardModel, guidance: string) {
  return guide(
    { ...text(renderGettingStarted(card)), structuredContent: { card, branch: card.title } },
    guidance,
  );
}

export const gettingStarted = defineTool({
  name: "getting_started",
  title: "Hey Athena, let's get started",
  description:
    "Shows the get-started card for Hey Athena, let's get started, Athena, let's get started, and @Athena let's get started, never opening with a which-job picker, using first-job or company setup when there are no jobs, and otherwise showing the @Athena habit, the Try one lines, the memory-line offer, and the morning meeting, using the only job or listing several jobs inside that same card.",
  inputSchema: {},
  annotations: READ,
  handler: (args, ctx) =>
    run("getting_started", ctx, undefined, async (sb) => {
      void args;
      await claimGettingStarted(sb);
      const found = await memberJobs(sb as never);
      if (!found.jobs.length) return cardResult(firstJobCard(found.company), firstJobGuidance(found.company));
      const card = startedWithJobsCard(found.jobs);
      const one = found.jobs.length === 1 ? found.jobs[0].job_number : null;
      return cardResult(
        card,
        one
          ? `Show this card. The morning meeting is on ${one}. When they continue, call pm_morning with job_number ${one}. Do not ask which job.`
          : "Show this card. The jobs are listed on it. When they name one, call pm_morning with that job_number. Do not replace this card with a which-job card.",
      );
    }),
});
