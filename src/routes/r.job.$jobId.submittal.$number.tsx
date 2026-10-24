import { createFileRoute, notFound } from "@tanstack/react-router";
import { SubmittalRecordView } from "@/components/athena/SubmittalRecordPage";
import { isUuid } from "@/lib/report-pages";
import { readBoardToken } from "@/lib/mcp/board-url";

// One address per submittal number: /r/job/<job>/submittal/<number>. Every submittal log row opens it.
export const Route = createFileRoute("/r/job/$jobId/submittal/$number")({
  head: () => ({ meta: [{ title: "Athena submittal" }, { name: "robots", content: "noindex" }] }),
  validateSearch: (search: Record<string, unknown>) => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(search))
      if (typeof value === "string") out[key] = value;
    return out;
  },
  beforeLoad: ({ params }) => {
    const number = params.number.trim();
    if (!isUuid(params.jobId) || !number || number.length > 40) throw notFound();
  },
  component: SubmittalRecordRoute,
});

function SubmittalRecordRoute() {
  const { jobId, number } = Route.useParams();
  const search = Route.useSearch();
  const token = readBoardToken(search);
  const packageId =
    search.open === "package" && isUuid(search.package_id ?? "") ? search.package_id : undefined;
  return (
    <SubmittalRecordView jobId={jobId} number={number.trim()} token={token} packageId={packageId} />
  );
}
