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
  withMemoryOffer,
} from "../getting-started";
import { run, text } from "../guard";
import { guide } from "../visible";

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

function cardResult(card: CardModel, guidance: string, lead = "") {
  const shown = lead ? `${lead}\n\n${renderGettingStarted(card)}` : renderGettingStarted(card);
  return guide(
    { ...text(shown), structuredContent: { card, branch: card.title } },
    guidance,
  );
}

export const gettingStarted = defineTool({
  name: "getting_started",
  title: "Hey Athena, let's get started",
  description:
    "Shows the get-started card for Hey Athena, let's get started, Athena, let's get started, and @Athena let's get started, never opening with a which-job picker and never asking which job's morning hitlist, using first-job or company setup when there are no jobs, and otherwise showing the @Athena example lines, the offer to save When I say Athena, always use the Athena connector and how to remove it, then the morning meeting on that same card.",
  inputSchema: {},
  annotations: READ,
  handler: (args, ctx) =>
    run("getting_started", ctx, undefined, async (sb) => {
      void args;
      await claimGettingStarted(sb);
      const found = await memberJobs(sb as never);
      if (!found.jobs.length) return withMemoryOffer(cardResult(firstJobCard(found.company), firstJobGuidance(found.company)));
      const card = startedWithJobsCard(found.jobs);
      const one = found.jobs.length === 1 ? found.jobs[0].job_number : null;
      return withMemoryOffer(cardResult(
        card,
        one
          ? `The morning meeting on the card is ${one}. Save nothing until they say yes.`
          : `The jobs are listed under Morning meeting. Save nothing until they say yes.`,
      ));
    }),
});
