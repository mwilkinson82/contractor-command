import { accountingRecordUrl, ledgerRecordUrl } from "@/lib/accounting-record-target";
import { REPORT_TYPES, type ReportType } from "@/lib/accounting-readable";
import { AccountingReports } from "./AccountingReports";
import { AccountingWorkspace } from "./AccountingWorkspace";
import { apMoney } from "@/lib/accounting-ap-versioned";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  accountingCsv,
  accountingSourceUrl,
  accountingMoney,
  accountingPage,
  type AccountingReport,
} from "@/lib/accounting-report";
import { accountingIO, readAccountingReport } from "@/lib/accounting-report-read";
import { BoardSignIn } from "./BoardSignIn";

export function AccountingReportView({
  report,
  page = 1,
  setPage,
  download,
}: {
  report: AccountingReport;
  page?: number;
  setPage?: (page: number) => void;
  download?: () => void;
}) {
  const ledger = accountingPage(report, page);
  return (
    <div className="af-report">
      <p className="af-capture mt-3 text-sm">
        {report.ap ? "AR/budget/PO: USD; AP by currency" : "USD"} · {report.from ?? "Inception"}{" "}
        through {report.asOf}, inclusive · Captured {report.capturedAt}
      </p>
      <p className="af-basis mt-3 text-sm">{report.basis}</p>
      <div className="af-actions mt-5 flex flex-wrap gap-4 text-sm">
        <a className="underline" href={`/r/job/${report.jobId}/home`}>
          Project home
        </a>
        <a className="underline" href={`/r/job/${report.jobId}/billing-records`}>
          Billing records and originals
        </a>
        <button className="underline" type="button" onClick={download} disabled={!download}>
          Download accountant CSV
        </button>
      </div>
      <h2 className="mt-8 text-lg font-semibold">Recorded amounts</h2>
      <div className="af-summary-table overflow-x-auto">
        <table className="mt-3 w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-2">Measure</th>
              <th className="p-2 text-right">USD</th>
              <th className="p-2">Basis</th>
            </tr>
          </thead>
          <tbody>
            {report.metrics.map((m) => (
              <tr key={m.key} className="border-b align-top">
                <th scope="row" className="p-2 font-normal">
                  {m.label}
                </th>
                <td className="p-2 text-right whitespace-nowrap">{accountingMoney(m.cents)}</td>
                <td className="p-2">{m.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.ap ? (
        <section aria-label="AP reviewed currency evidence">
          <h2 className="mt-8 text-lg font-semibold">Posted AP by reviewed currency</h2>
          <p className="mt-2 text-sm">{report.ap.basis}</p>
          {!report.ap.rows.length ? (
            <p className="mt-2 text-sm">
              No posted AP allocation evidence is dated through this cutoff. Monetary totals remain
              Unknown.
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="mt-3 w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2">Currency</th>
                  <th className="p-2">Posted as-of</th>
                  <th className="p-2">Known subset</th>
                  <th className="p-2">Selected range amounts</th>
                  <th className="p-2">Net AP</th>
                </tr>
              </thead>
              <tbody>
                {report.ap.groups.map((g) => (
                  <tr className="border-b" key={g.currency ?? "unknown"}>
                    <th className="p-2">{g.currency ?? "Unknown"}</th>
                    <td className="p-2">{apMoney(g.postedCents, g.currency)}</td>
                    <td className="p-2">
                      {apMoney(g.knownSubtotalCents, g.currency)}
                      {g.unknownRows ? ` · ${g.unknownRows} unknown rows` : ""}
                    </td>
                    <td className="p-2">{apMoney(g.selectedPeriodCents, g.currency)}</td>
                    <td className="p-2">Unknown</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="mt-5 font-semibold">AP cost codes by currency</h3>
          <div className="overflow-x-auto">
            <table className="mt-3 w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2">Currency</th>
                  <th className="p-2">Cost code</th>
                  <th className="p-2">Posted as-of</th>
                </tr>
              </thead>
              <tbody>
                {report.ap.costCodes.slice((page - 1) * 50, page * 50).map((c) => (
                  <tr className="border-b" key={`${c.currency}:${c.code}`}>
                    <td className="p-2">{c.currency ?? "Unknown"}</td>
                    <td className="p-2">{c.code}</td>
                    <td className="p-2">{apMoney(c.postedCents, c.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="mt-5 font-semibold">AP source evidence · page {page}</h3>
          <p className="mt-2 text-sm">
            {report.ap.rows.length} total AP allocation rows. The page controls below apply to both
            source tables.
          </p>
          <div className="overflow-x-auto">
            <table className="mt-3 w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2">Accounting effective</th>
                  <th className="p-2">Record/version/code</th>
                  <th className="p-2">Reviewed currency amount</th>
                  <th className="p-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {report.ap.rows.slice((page - 1) * 50, page * 50).map((r) => (
                  <tr className="border-b align-top" key={r.id} id={r.id}>
                    <td className="p-2">{r.effectiveOn ?? "Unknown"}</td>
                    <th className="p-2 font-normal">
                      <a
                        className="underline"
                        href={accountingRecordUrl(
                          report.jobId,
                          { kind: "payable", id: r.recordId, version: r.version },
                          { as_of: report.asOf, from: report.from || undefined },
                        )}
                      >
                        {r.reference || r.counterparty || "Supplier bill"} · v{r.version}
                      </a>{" "}
                      · {r.costCode}
                    </th>
                    <td className="p-2 whitespace-nowrap">{apMoney(r.amountCents, r.currency)}</td>
                    <td className="p-2">
                      <details>
                        <summary className="cursor-pointer underline">Read AP source</summary>
                        <p>{r.source}</p>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <h2 className="mt-8 text-lg font-semibold">Coverage and limitations</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
        {report.limitations.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <h2 className="mt-8 text-lg font-semibold">Current budget by cost code</h2>
      <p className="mt-2 text-sm">
        Compared with cumulative recorded posted costs through as-of. Unrecorded labor, burden,
        equipment and categories remain unknown. Remaining budget is not a forecast.
      </p>
      {report.costCodes.length ? (
        <div className="overflow-x-auto">
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-2">Cost code</th>
                <th className="p-2">Current budget</th>
                <th className="p-2">Recorded cost</th>
                <th className="p-2">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {report.costCodes.map((c) => (
                <tr className="border-b" key={c.code}>
                  <th className="p-2 font-normal" scope="row">
                    {c.code}
                  </th>
                  <td className="p-2">{accountingMoney(c.budgetCents)}</td>
                  <td className="p-2">{accountingMoney(c.recordedCostCents)}</td>
                  <td className="p-2">{accountingMoney(c.remainingCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm">
          No budget or cost-code evidence recorded. Totals remain unknown.
        </p>
      )}
      <h2 className="mt-8 text-lg font-semibold">Source ledger through as-of</h2>
      <p className="mt-2 text-sm">
        Page {ledger.page} · {ledger.totalRows} total rows. Summary and export use every source row.
        These different row types must not be summed together.
      </p>
      {ledger.rows.length ? (
        <div className="overflow-x-auto">
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-2">Date</th>
                <th className="p-2">Record</th>
                <th className="p-2">Type / code</th>
                <th className="p-2">USD amount</th>
                <th className="p-2">USD balance</th>
                <th className="p-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {ledger.rows.map((r) => (
                <tr className="border-b align-top" key={r.id} id={r.id}>
                  <td className="p-2 whitespace-nowrap">{r.date ?? "Unknown"}</td>
                  <th scope="row" className="p-2 font-normal">
                    {ledgerRecordUrl(report.jobId, r, {
                      as_of: report.asOf,
                      from: report.from || undefined,
                    }) ? (
                      <a
                        className="underline"
                        href={
                          ledgerRecordUrl(report.jobId, r, {
                            as_of: report.asOf,
                            from: report.from || undefined,
                          })!
                        }
                      >
                        {r.label}
                        {r.version ? ` · v${r.version}` : ""}
                      </a>
                    ) : (
                      <>
                        {r.label}
                        {r.version ? ` · v${r.version}` : ""}
                      </>
                    )}
                  </th>
                  <td className="p-2">
                    {r.kind.replaceAll("_", " ")}
                    {r.costCode ? ` · ${r.costCode}` : ""}
                    {r.category ? ` · ${r.category}` : ""}
                  </td>
                  <td className="p-2 whitespace-nowrap">{accountingMoney(r.amountCents)}</td>
                  <td className="p-2 whitespace-nowrap">{accountingMoney(r.balanceCents)}</td>
                  <td className="p-2">
                    <details>
                      <summary className="cursor-pointer underline">Read source evidence</summary>
                      <p className="mt-2 break-words">{r.source}</p>
                      <a
                        className="mt-2 inline-block underline"
                        href={accountingSourceUrl(report, r.id)}
                      >
                        Source permalink
                      </a>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm">No dated source rows available through this cutoff.</p>
      )}
      <div className="mt-4 flex gap-4 text-sm">
        <button
          type="button"
          className="underline disabled:opacity-40"
          disabled={page <= 1 || !setPage}
          onClick={() => setPage?.(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="underline disabled:opacity-40"
          disabled={
            (!ledger.nextPage && !(report.ap && page * 50 < report.ap.rows.length)) || !setPage
          }
          onClick={() => setPage?.(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function AccountingReportPage({
  jobId,
  initialFrom,
  initialAsOf,
  initialPage,
  initialReportType,
  initialCurrency,
  initialVendor,
  initialCostCode,
}: {
  jobId: string;
  initialFrom?: string;
  initialAsOf?: string;
  initialPage?: string;
  initialReportType?: string;
  initialCurrency?: string;
  initialVendor?: string;
  initialCostCode?: string;
}) {
  const { session, loading } = useAuth();
  const project = useQuery({
    queryKey: ["accounting-project-label", jobId, session?.user.id],
    enabled: !loading && !!session,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mcp_jobs")
        .select("job_number,name")
        .eq("id", jobId)
        .maybeSingle();
      if (error) throw new Error("Project name unavailable.");
      return data;
    },
  });
  const identity =
    !project.error && project.data
      ? `${project.data.job_number} · ${project.data.name || "Project name not recorded"}`
      : `Project ${jobId} · name unavailable`;
  const today = new Date().toISOString().slice(0, 10);
  const dates = { from: initialFrom ?? "", asOf: initialAsOf ?? today };
  const [page, setPage] = useState(
    initialPage && /^[1-9]\d{0,5}$/.test(initialPage) ? Number(initialPage) : 1,
  );
  const query = useQuery({
    queryKey: ["accounting-report", jobId, session?.user.id, dates.from, dates.asOf],
    enabled: !loading && !!session,
    retry: false,
    staleTime: 0,
    queryFn: () =>
      readAccountingReport(accountingIO(supabase), jobId, {
        from: dates.from || undefined,
        asOf: dates.asOf,
      }),
  });
  useEffect(() => {
    if (!query.data || query.error || !window.location.hash) return;
    let id: string;
    try {
      id = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return;
    }
    if (!query.data.rows.some((r) => r.id === id) && !query.data.ap?.rows.some((r) => r.id === id))
      return;
    const element = document.getElementById(id);
    if (!element) return;
    element.querySelector("details")?.setAttribute("open", "");
    element.scrollIntoView({ block: "center" });
  }, [query.data, query.error, page]);
  if (loading)
    return (
      <AccountingWorkspace jobId={jobId} title="Job accounting evidence">
        <p role="status">Checking access…</p>
      </AccountingWorkspace>
    );
  if (!session)
    return (
      <BoardSignIn
        returnTo={`/r/job/${jobId}/accounting?${new URLSearchParams({ as_of: dates.asOf, ...(dates.from ? { from: dates.from } : {}), ...(initialPage ? { ledger_page: String(page) } : {}), ...(initialReportType ? { report_type: initialReportType } : {}), ...(initialCurrency ? { currency: initialCurrency } : {}), ...(initialVendor ? { vendor: initialVendor } : {}), ...(initialCostCode ? { cost_code: initialCostCode } : {}) })}${typeof window !== "undefined" ? window.location.hash : ""}`}
      />
    );
  function download() {
    if (!query.data || query.error) return;
    const blob = new Blob([accountingCsv(query.data)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `athena-accounting-${jobId}-${dates.asOf}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return (
    <AccountingWorkspace
      jobId={jobId}
      title="Project financial reports"
      description={<p className="af-project-id">{identity}</p>}
    >
      <form
        id="accounting-dates"
        action={`/r/job/${jobId}/accounting`}
        method="get"
        className="af-filters flex flex-wrap items-end gap-4 text-sm"
      >
        <label>
          From (optional)
          <input
            className="mt-1 block rounded border p-2"
            name="from"
            type="date"
            defaultValue={dates.from}
            max={today}
          />
        </label>
        <label>
          As of
          <input
            className="mt-1 block rounded border p-2"
            name="as_of"
            type="date"
            required
            defaultValue={dates.asOf}
            max={today}
          />
        </label>
        <button className="rounded bg-[#1E3A5F] px-4 py-2 text-white" type="submit">
          Read report
        </button>
        <button
          className="p-2 underline disabled:opacity-40"
          type="button"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh sources
        </button>
      </form>
      {query.isLoading ? (
        <p className="mt-6">Reading accounting evidence…</p>
      ) : query.error ? (
        <p role="alert" className="mt-6">
          {query.error.message}
        </p>
      ) : query.data ? (
        <AccountingReports
          key={`${jobId}:${dates.from}:${dates.asOf}`}
          report={query.data}
          identity={identity}
          initialType={
            initialPage || (typeof window !== "undefined" && window.location.hash)
              ? "evidence"
              : initialReportType && Object.hasOwn(REPORT_TYPES, initialReportType)
                ? (initialReportType as ReportType)
                : "summary"
          }
          initialFilters={{
            currency: initialCurrency || "USD",
            vendor: initialVendor || "",
            costCode: initialCostCode || "",
          }}
          evidence={
            <AccountingReportView
              report={query.data}
              page={page}
              setPage={setPage}
              download={download}
            />
          }
        />
      ) : (
        <p className="mt-6">Report unavailable.</p>
      )}
    </AccountingWorkspace>
  );
}
