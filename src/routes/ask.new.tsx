import { createFileRoute, redirect } from "@tanstack/react-router";
import { createThread } from "@/lib/ask.functions";

export const Route = createFileRoute("/ask/new")({
  beforeLoad: async () => {
    const { id } = await createThread({ data: {} });
    throw redirect({ to: "/ask/$threadId", params: { threadId: id } });
  },
  component: () => null,
});
