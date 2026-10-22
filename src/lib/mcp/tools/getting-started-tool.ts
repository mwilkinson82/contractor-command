// Help that shows the start card again. The first tool call also shows it once.
import { defineTool } from "@lovable.dev/mcp-js";
import { claimGettingStarted, gettingStartedCard, renderGettingStarted } from "../getting-started";
import { run, text } from "../guard";

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const gettingStarted = defineTool({
  name: "getting_started",
  title: "How to start an ask",
  description: "Shows how to start every ask with @Athena so the ask reaches Athena.",
  inputSchema: {},
  annotations: READ,
  handler: (args, ctx) =>
    run("getting_started", ctx, undefined, async (sb) => {
      void args;
      await claimGettingStarted(sb);
      const card = gettingStartedCard();
      return { ...text(renderGettingStarted(card)), structuredContent: { card } };
    }),
});
