import { useState } from "react";
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
    <>
      <p className="mt-3 text-sm">
        USD · {report.from ?? "Inception"} through {report.asOf}, inclusive · Captured{" "}
        {report.capturedAt}
      </p>
      <p className="mt-3 text-sm">{report.basis}</p>
      <div className="mt-5 flex flex-wrap gap-4 text-sm">
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
      <div className="overflow-x-auto">
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
                    {r.label}
                    {r.version ? ` · v${r.version}` : ""}
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
          disabled={!ledger.nextPage || !setPage}
          onClick={() => ledger.nextPage && setPage?.(ledger.nextPage)}
        >
          Next
        </button>
      </div>
    </>
  );
}

export function AccountingReportPage({
  jobId,
  initialFrom,
  initialAsOf,
  initialPage,
}: {
  jobId: string;
  initialFrom?: string;
  initialAsOf?: string;
  initialPage?: string;
}) {
  const { session, loading } = useAuth();
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
  if (loading) return <main className="p-8">Checking access…</main>;
  if (!session)
    return (
      <BoardSignIn
        returnTo={`/r/job/${jobId}/accounting?${new URLSearchParams({ as_of: dates.asOf, ...(dates.from ? { from: dates.from } : {}), ledger_page: String(page) })}`}
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
    <main className="mx-auto max-w-6xl bg-white px-5 py-8 text-[#1E3A5F]">
      <h1 className="text-2xl font-semibold">Job accounting evidence</h1>
      <p className="mt-2 text-sm">Project {jobId}</p>
      <form
        action={`/r/job/${jobId}/accounting`}
        method="get"
        className="mt-5 flex flex-wrap items-end gap-4 text-sm"
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
        <AccountingReportView
          report={query.data}
          page={page}
          setPage={setPage}
          download={download}
        />
      ) : (
        <p className="mt-6">Report unavailable.</p>
      )}
    </main>
  );
}
