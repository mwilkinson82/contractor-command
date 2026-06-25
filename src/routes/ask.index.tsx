import { createFileRoute, redirect } from "@tanstack/react-router";
import { createThread, listThreads } from "@/lib/ask.functions";

export const Route = createFileRoute("/ask/")({
  validateSearch: (search: Record<string, unknown>): { diagnosis?: string } => ({
    diagnosis: typeof search.diagnosis === "string" ? search.diagnosis : undefined,
  }),
  beforeLoad: async ({ search }) => {
    if (search.diagnosis) {
      const { id } = await createThread({
        data: { title: "COS Navigator diagnosis", source: "operating_playbook" },
      });
      throw redirect({
        to: "/ask/$threadId",
        params: { threadId: id },
        search: { diagnosis: search.diagnosis },
      });
    }

    // Send users to their most recent conversation by default — only
    // create a brand-new thread when they have none yet.
    const threads = await listThreads();
    const target = threads[0]?.id ?? (await createThread({ data: { source: "ask_index" } })).id;
    throw redirect({ to: "/ask/$threadId", params: { threadId: target } });
  },
  component: () => null,
});
