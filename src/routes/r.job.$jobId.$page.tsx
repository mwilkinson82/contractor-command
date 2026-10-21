import { createFileRoute, notFound } from "@tanstack/react-router";
import { ReportPageView } from "@/components/athena/ReportPage";
import { isUuid } from "@/lib/report-pages";

export const Route = createFileRoute("/r/job/$jobId/$page")({
  head: () => ({ meta: [{ title: "Athena report" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: ({ params }) => {
    if (!isUuid(params.jobId) || (params.page !== "ior" && params.page !== "schedule")) throw notFound();
  },
  component: JobReportPage,
});

function JobReportPage() {
  const { jobId, page } = Route.useParams();
  return <ReportPageView page={page as "ior" | "schedule"} jobId={jobId} />;
}
