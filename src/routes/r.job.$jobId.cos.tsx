import { createFileRoute, notFound } from "@tanstack/react-router";
import { ChangeOrderLogPage } from "@/components/athena/ChangeOrderLogPage";
import { isUuid } from "@/lib/report-pages";
import { readBoardToken } from "@/lib/mcp/board-url";

export const Route = createFileRoute("/r/job/$jobId/cos")({
  head: () => ({
    meta: [{ title: "Athena change-order log" }, { name: "robots", content: "noindex" }],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    t: typeof search.t === "string" ? search.t : undefined,
  }),
  beforeLoad: ({ params }) => {
    if (!isUuid(params.jobId)) throw notFound();
  },
  component: Page,
});
function Page() {
  return (
    <ChangeOrderLogPage jobId={Route.useParams().jobId} token={readBoardToken(Route.useSearch())} />
  );
}
