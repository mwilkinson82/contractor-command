import { createFileRoute, notFound } from "@tanstack/react-router";
import { ReportPageView } from "@/components/athena/ReportPage";
import { isUuid } from "@/lib/report-pages";

export const Route = createFileRoute("/r/portfolio/$companyId")({
  head: () => ({ meta: [{ title: "Athena portfolio" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: ({ params }) => {
    if (!isUuid(params.companyId)) throw notFound();
  },
  component: PortfolioReportPage,
});

function PortfolioReportPage() {
  const { companyId } = Route.useParams();
  return <ReportPageView page="portfolio" companyId={companyId} />;
}
