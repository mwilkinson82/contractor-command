import { createFileRoute } from "@tanstack/react-router";
import { SchedulerRoughView } from "@/components/scheduler/SchedulerRoughView";

export const Route = createFileRoute("/scheduler-preview")({
  head: () => ({
    meta: [
      { title: "Scheduler Preview - ALP Contractor Circle" },
      {
        name: "description",
        content: "Rough CPM scheduler prototype using portable TypeScript logic.",
      },
    ],
  }),
  component: SchedulerRoughView,
});
