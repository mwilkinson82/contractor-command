import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  productionClient,
  productionDailyPath,
  productionReportPath,
  readProductionReport,
  type ProductionReport,
  type ProductionOptions,
} from "@/lib/production-report";
import { projectReadRecovery } from "@/lib/project-read-recovery";
import { BoardSignIn } from "./BoardSignIn";
import { ProjectReadUnavailable } from "./ProjectReadUnavailable";

const number = (value: number | string) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value));
const day = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));

export function ProductionReportView({ report }: { report: ProductionReport }) {
  return (
    <>
      <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[#64748B]">
        <p>
          {day(report.period.from)} – {day(report.period.to)}
        </p>
        <p>{report.time_zone_used}</p>
        <p>
          {report.reports_count} saved{" "}
          {report.reports_count === 1 ? "daily report" : "daily reports"} · {report.rows.length}{" "}
          production rows
        </p>
      </div>
      <section
        className="mt-6 rounded-xl border border-[#DCE3EC] bg-[#F8FAFC] p-4 text-sm"
        aria-label="Production coverage"
      >
        <p className="font-semibold">
          {report.complete ? "Selected-period coverage" : "Incomplete coverage"}
        </p>
        <p className="mt-1 text-[#52647A]">
          {report.complete
            ? "Saved rate rows from every daily report in this period, read at request time."
            : "The supported daily or production-row limit was reached. Only the rows shown contribute to these totals."}
        </p>
        <p className="mt-2 text-xs text-[#64748B]">
          Read{" "}
          {new Date(report.captured_at).toLocaleString("en-US", {
            timeZone: report.time_zone_used,
          })}{" "}
          ({report.time_zone_used}). Refresh to read current saved records.
        </p>
      </section>
      <section className="mt-8" aria-labelledby="actual-production-heading">
        <h2 id="actual-production-heading" className="text-xl font-semibold">
          Actual production
        </h2>
        <p className="mt-2 text-sm text-[#64748B]">
          Each unit and reported SOV/activity reference is kept separate. Period rates use total
          quantity ÷ total reported person-hours.
        </p>
        {!report.rows.length ? (
          <p className="mt-5 rounded-xl border border-[#DCE3EC] p-5">
            No saved production rows for this period.
          </p>
        ) : null}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {report.groups.map((group) => (
            <article
              key={JSON.stringify([group.sov_item, group.activity_id, group.unit])}
              className="rounded-xl border border-[#DCE3EC] bg-white p-5"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">
                {group.unit} per person-hour
              </p>
              <p className="mt-2 text-4xl font-semibold tracking-tight text-[#183453]">
                {number(group.actual_rate)}
              </p>
              <p className="mt-3 text-sm">
                {number(group.quantity)} {group.unit}{" "}
                <span className="text-[#64748B]">
                  ÷ {number(group.reported_person_hours)} reported person-hours
                </span>
              </p>
              <p className="mt-3 border-t border-[#E6EBF1] pt-3 text-xs text-[#64748B]">
                Reported SOV {group.sov_item} · Activity {group.activity_id} · {group.records} work{" "}
                {group.records === 1 ? "line" : "lines"}
              </p>
            </article>
          ))}
        </div>
      </section>
      {report.rows.length ? (
        <section className="mt-8" aria-labelledby="source-production-heading">
          <h2 id="source-production-heading" className="text-xl font-semibold">
            Daily work behind the rates
          </h2>
          <div className="mt-4 divide-y divide-[#E6EBF1] rounded-xl border border-[#DCE3EC] bg-white">
            {report.rows.map((row) => (
              <article key={row.id} className="p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold">{day(row.report_date)}</h3>
                  <a
                    className="text-sm font-medium text-[#1E5FED] underline-offset-4 hover:underline"
                    href={productionDailyPath(report.job_id, row.report_date)}
                  >
                    Open source daily
                  </a>
                </div>
                <p className="mt-2 break-words text-sm">{row.work}</p>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-[#64748B]">Installed</dt>
                    <dd className="mt-1 font-medium">
                      {number(row.qty)} {row.unit}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[#64748B]">Crew × hours each</dt>
                    <dd className="mt-1 font-medium">
                      {number(row.crew)} × {number(row.hours)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[#64748B]">Reported person-hours</dt>
                    <dd className="mt-1 font-medium">{number(row.man_hours)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[#64748B]">Actual rate</dt>
                    <dd className="mt-1 font-medium">
                      {number(row.qty_per_man_hour)} {row.unit}/person-hour
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-[#64748B]">
                  Reported SOV {row.sov_item} · Activity {row.activity_id}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <section
        className="mt-8 border-t border-[#E6EBF1] pt-5 text-sm text-[#52647A]"
        aria-label="Production basis and limitations"
      >
        <h2 className="font-semibold text-[#183453]">Basis and limitations</h2>
        <p className="mt-2">
          Person-hours are summed work-line hours and may overlap. They are not a unique payroll
          total. SOV and activity references are reported, not approved mappings.
        </p>
        <p className="mt-2">
          Corrections replace the current saved rows. Prior revisions are not available here.
        </p>
        <p className="mt-2">
          Planned productivity, labor cost, cost variance and earned value: unavailable. This report
          does not establish billing or payments.
        </p>
      </section>
    </>
  );
}

export function ProductionReportPage({
  jobId,
  from,
  to,
  range,
}: {
  jobId: string;
  from?: string;
  to?: string;
  range?: string;
}) {
  const { session, loading } = useAuth();
  const query = useQuery({
    queryKey: ["production-report", jobId, session?.user.id, from ?? "", to ?? "", range ?? ""],
    enabled: !loading && !!session,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: () => {
      if (range && range !== "last_7_days" && range !== "this_week")
        throw new Error("Choose a valid production period.");
      return readProductionReport(productionClient(supabase), jobId, {
        from_date: from || undefined,
        to_date: to || undefined,
        range: range as ProductionOptions["range"],
      });
    },
  });
  const search = new URLSearchParams({
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(range ? { range } : {}),
  }).toString();
  const returnTo = `${productionReportPath(jobId)}${search ? `?${search}` : ""}`;
  if (loading)
    return (
      <main className="p-8" role="status">
        Checking project access…
      </main>
    );
  if (!session || (query.error && projectReadRecovery(true, query.error) === "sign-in"))
    return <BoardSignIn returnTo={returnTo} />;
  const report = query.error ? undefined : query.data;
  if (
    query.error &&
    !query.data &&
    !query.error.message.startsWith("Choose") &&
    !query.error.message.startsWith("Provide") &&
    !query.error.message.startsWith("Use valid")
  )
    return <ProjectReadUnavailable />;
  return (
    <main className="min-h-screen min-w-0 [overflow-wrap:anywhere] [&_*]:min-w-0 bg-[#F6F8FB] px-4 py-7 text-[#183453] sm:px-6">
      <div className="mx-auto max-w-5xl rounded-2xl border border-[#DCE3EC] bg-white px-5 py-6 sm:px-8 sm:py-8">
        <nav
          aria-label="Project navigation"
          className="mb-6 flex flex-wrap gap-5 text-sm text-[#1E5FED]"
        >
          <a href={`/r/job/${jobId}/home`} className="hover:underline">
            Project home
          </a>
          <a href={`/r/job/${jobId}/daily`} className="hover:underline">
            Daily reports
          </a>
        </nav>
        {report?.company ? (
          <p className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">
            {report.company}
          </p>
        ) : null}
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Production</h1>
        {report ? (
          <p className="mt-2 text-base text-[#52647A]">
            {report.job_number} · {report.job_name}
          </p>
        ) : null}
        <form
          action={productionReportPath(jobId)}
          method="get"
          className="mt-6 flex flex-wrap items-end gap-3 border-b border-[#E6EBF1] pb-6 text-sm"
        >
          <label>
            From
            <input
              className="mt-1 block min-h-10 rounded-lg border border-[#CBD5E1] bg-white px-3 py-2"
              type="date"
              name="from"
              required
              defaultValue={from ?? report?.period.from ?? ""}
            />
          </label>
          <label>
            Through
            <input
              className="mt-1 block min-h-10 rounded-lg border border-[#CBD5E1] bg-white px-3 py-2"
              type="date"
              name="to"
              required
              defaultValue={to ?? report?.period.to ?? ""}
            />
          </label>
          <button
            className="min-h-10 rounded-lg bg-[#183453] px-4 py-2 font-medium text-white"
            type="submit"
          >
            Read production
          </button>
          <button
            className="min-h-10 px-2 py-2 text-[#1E5FED] disabled:opacity-50"
            type="button"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Refresh
          </button>
        </form>
        {query.isFetching ? (
          <p className="mt-5 text-sm text-[#64748B]" role="status">
            Reading current saved production…
          </p>
        ) : null}
        {query.error ? (
          <p className="mt-5 text-sm" role="alert">
            {query.error.message}
          </p>
        ) : report ? (
          <ProductionReportView report={report} />
        ) : !query.isFetching ? (
          <p className="mt-5">Production report unavailable.</p>
        ) : null}
      </div>
    </main>
  );
}
