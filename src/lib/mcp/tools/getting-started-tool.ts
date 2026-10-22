// Help that shows the start card again, then routes let's-get-started.
// No jobs: the existing company or first-job setup. Jobs: the morning meeting or the which-job card.
import { defineTool } from "@lovable.dev/mcp-js";
import { inferCard } from "../cards/infer";
import { renderHtml } from "../cards/html";
import { htmlBlock, renderMarkdown } from "../cards/markdown";
import type { CardModel } from "../cards/model";
import {
  branchGettingStarted,
  claimGettingStarted,
  firstJobCard,
  firstJobGuidance,
  renderGettingStarted,
} from "../getting-started";
import { run, text, type Sb } from "../guard";
import { guide } from "../visible";
import { startMorning } from "./flow-tools";

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

function cardResult(card: CardModel, guidance: string) {
  return guide(
    { ...text(renderGettingStarted(card)), structuredContent: { card, branch: card.title } },
    guidance,
  );
}

function whichJobResult(body: string) {
  const card = inferCard("pm_morning", body, {});
  const html = renderHtml(card);
  return guide(
    {
      ...text(`${renderMarkdown(card)}\n\n${htmlBlock(html)}`),
      structuredContent: { card, html, branch: "which_job", which_job: true },
    },
    "When they name the job, call pm_morning with that job_number. Do not fill job_number from earlier chat.",
  );
}

export const gettingStarted = defineTool({
  name: "getting_started",
  title: "Hey Athena, getting started, let's get going, let's get started",
  description: "Routes Hey Athena, getting started, let's get going, and let's get started to first-job setup or the morning meeting.",
  inputSchema: {},
  annotations: READ,
  handler: (args, ctx) =>
    run("getting_started", ctx, undefined, async (sb) => {
      void args;
      await claimGettingStarted(sb);
      return branchGettingStarted(
        sb as Sb,
        async (jobNumber) => {
          const morning = await startMorning(sb, jobNumber);
          if (jobNumber) return morning;
          const block = (morning as { content?: { text?: string }[] }).content?.find((c) => c.text)?.text ?? "";
          return whichJobResult(block.split("\n---\n")[0]);
        },
        (company) => cardResult(firstJobCard(company), firstJobGuidance(company)),
      );
    }),
});
