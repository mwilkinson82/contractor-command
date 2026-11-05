import { PaymentApplicationsPage } from "@/components/athena/PaymentApplicationsPage";
import { AccountingRecordPage } from "@/components/athena/AccountingRecordPage";
import { accountingContextDates, accountingTargetFromSearch } from "@/lib/accounting-record-target";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { ReportPageView } from "@/components/athena/ReportPage";
import { hostedPageName, isUuid, type AnyPage } from "@/lib/report-pages";
import { JOB_BOARD_PAGES } from "@/lib/board-sign-in";
import { PurchaseOrdersPage } from "@/components/athena/PurchaseOrdersPage";
import { ProductionReportPage } from "@/components/athena/ProductionReportPage";
import { AccountingReportPage } from "@/components/athena/AccountingReportPage";
import { BillingEvidencePage } from "@/components/athena/BillingEvidencePage";
import { JobHome } from "@/components/athena/JobHome";
import { JobEstimatePage } from "@/components/athena/JobEstimatePage";
import { GapCheckPage } from "@/components/athena/GapCheckPage";
import { DailyRangeReportPage } from "@/components/athena/DailyRangeReportPage";
import { ProjectRecordPage } from "@/components/athena/ProjectRecordPage";
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
      !(JOB_BOARD_PAGES as readonly string[]).includes(page)
    )
      throw notFound();
  },
  component: JobReportPage,
});

function JobReportPage() {
  const { jobId, page } = Route.useParams();
  const search = Route.useSearch();
  const token = readBoardToken(search);
  if (hostedPageName(page) === "payment-applications")
    return (
      <PaymentApplicationsPage
        key={`${jobId}:${JSON.stringify(search)}`}
        jobId={jobId}
        search={search}
      />
    );
  if (hostedPageName(page) === "production")
    return (
      <ProductionReportPage jobId={jobId} from={search.from} to={search.to} range={search.range} />
    );
  if (hostedPageName(page) === "daily-log")
    return (
      <DailyRangeReportPage
        jobId={jobId}
        from={search.from}
        to={search.to}
        photos={search.photos}
      />
    );
  if (hostedPageName(page) === "record")
    return <ProjectRecordPage jobId={jobId} from={search.from} to={search.to} />;
  if (hostedPageName(page) === "accounting") {
    let selected = null;
    let recordDates = {};
    try {
      selected = accountingTargetFromSearch(search);
      if (selected) recordDates = accountingContextDates(search);
    } catch {
      return (
        <AccountingRecordPage key={JSON.stringify(search)} jobId={jobId} target={null} invalid />
      );
    }
    if (selected)
      return (
        <AccountingRecordPage
          key={`${jobId}:${JSON.stringify(search)}`}
          jobId={jobId}
          target={selected}
          dates={recordDates}
        />
      );
    return (
      <AccountingReportPage
        key={`${jobId}:${JSON.stringify(search)}`}
        jobId={jobId}
        initialFrom={search.from}
        initialAsOf={search.as_of}
        initialPage={search.ledger_page}
        initialReportType={search.report_type}
        initialCurrency={search.currency}
        initialVendor={search.vendor}
        initialCostCode={search.cost_code}
      />
    );
  }
  if (hostedPageName(page) === "home") return <JobHome jobId={jobId} token={token} />;
  if (hostedPageName(page) === "estimate") return <JobEstimatePage jobId={jobId} />;
  if (hostedPageName(page) === "gap-check") return <GapCheckPage jobId={jobId} />;
  if (hostedPageName(page) === "buyout")
    return <PurchaseOrdersPage jobId={jobId} initialTab="suppliers" />;
  if (hostedPageName(page) === "purchase-orders") return <PurchaseOrdersPage jobId={jobId} />;
  if (hostedPageName(page) === "billing-records") return <BillingEvidencePage jobId={jobId} />;
  return (
    <ReportPageView
      page={hostedPageName(page) as AnyPage}
      jobId={jobId}
      token={token}
      reportDate={search.date}
      layout={search.layout}
    />
  );
}
