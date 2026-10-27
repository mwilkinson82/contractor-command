import { createFileRoute, notFound } from "@tanstack/react-router";
import { ReportPageView } from "@/components/athena/ReportPage";
import { JOB_PAGES, hostedPageName, isUuid, type AnyPage } from "@/lib/report-pages";
import { BillingEvidencePage } from "@/components/athena/BillingEvidencePage";
import { JobHome } from "@/components/athena/JobHome";
import { readBoardToken } from "@/lib/mcp/board-url";

export const Route = createFileRoute("/r/job/$jobId/$page")({
  head: () => ({ meta: [{ title: "Athena report" }, { name: "robots", content: "noindex" }] }),
  // ChatGPT appends utm_source. It is not part of the page name and does not change access.
  validateSearch: (search: Record<string, unknown>) => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(search))
      if (typeof value === "string") out[key] = value;
    return out;
  },
  beforeLoad: ({ params }) => {
    const page = hostedPageName(params.page);
    if (
      !isUuid(params.jobId) ||
      (page !== "home" &&
        page !== "billing-records" &&
        !(JOB_PAGES as readonly string[]).includes(page))
    )
      throw notFound();
  },
  component: JobReportPage,
});

function JobReportPage() {
  const { jobId, page } = Route.useParams();
  const token = readBoardToken(Route.useSearch());
  if (hostedPageName(page) === "home") return <JobHome jobId={jobId} token={token} />;
  if (hostedPageName(page) === "billing-records") return <BillingEvidencePage jobId={jobId} />;
  return <ReportPageView page={hostedPageName(page) as AnyPage} jobId={jobId} token={token} />;
}
