import { createFileRoute, notFound } from "@tanstack/react-router";
import { RequestLogPage } from "@/components/athena/RequestLogPage";
import { isUuid } from "@/lib/report-pages";
import { readBoardToken } from "@/lib/mcp/board-url";

export const Route = createFileRoute("/r/job/$jobId/rfcs")({
  head: () => ({ meta: [{ title: "Athena RFC log" }, { name: "robots", content: "noindex" }] }),
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
    <RequestLogPage
      jobId={Route.useParams().jobId}
      kind="rfc"
      token={readBoardToken(Route.useSearch())}
    />
  );
}
