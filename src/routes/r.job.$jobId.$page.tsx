import { createFileRoute, notFound } from "@tanstack/react-router";
import { ReportPageView } from "@/components/athena/ReportPage";
import { JOB_PAGES, isUuid, type AnyPage } from "@/lib/report-pages";

export const Route = createFileRoute("/r/job/$jobId/$page")({
  head: () => ({ meta: [{ title: "Athena report" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: ({ params }) => {
    if (!isUuid(params.jobId) || !(JOB_PAGES as readonly string[]).includes(params.page)) throw notFound();
  },
  component: JobReportPage,
});

function JobReportPage() {
  const { jobId, page } = Route.useParams();
  return <ReportPageView page={page as AnyPage} jobId={jobId} />;
}

