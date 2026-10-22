import { createFileRoute, notFound } from "@tanstack/react-router";
import { ReportPageView } from "@/components/athena/ReportPage";
import { JOB_PAGES, hostedPageName, isUuid, type AnyPage } from "@/lib/report-pages";

export const Route = createFileRoute("/r/job/$jobId/$page")({
  head: () => ({ meta: [{ title: "Athena report" }, { name: "robots", content: "noindex" }] }),
  // ChatGPT appends utm_source. It is not part of the page name and does not change access.
  validateSearch: (search: Record<string, unknown>) => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(search)) if (typeof value === "string") out[key] = value;
    return out;
  },
  beforeLoad: ({ params }) => {
    const page = hostedPageName(params.page);
    if (!isUuid(params.jobId) || !(JOB_PAGES as readonly string[]).includes(page)) throw notFound();
  },
  component: JobReportPage,
});

function JobReportPage() {
  const { jobId, page } = Route.useParams();
  return <ReportPageView page={hostedPageName(page) as AnyPage} jobId={jobId} />;
}

