import { createFileRoute, redirect } from "@tanstack/react-router";
import { createThread, listThreads } from "@/lib/ask.functions";

export const Route = createFileRoute("/ask/")({
  beforeLoad: async () => {
    // Send users to their most recent conversation by default — only
    // create a brand-new thread when they have none yet.
    const threads = await listThreads();
    const target = threads[0]?.id ?? (await createThread({ data: { source: "ask_index" } })).id;
    throw redirect({ to: "/ask/$threadId", params: { threadId: target } });
  },
  component: () => null,
});
