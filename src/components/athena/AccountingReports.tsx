import { accountingModeLocation, ledgerRecordUrl } from "@/lib/accounting-record-target";
import { useMemo, useState, type ReactNode } from "react";
import type { AccountingReport } from "@/lib/accounting-report";
import {
  REPORT_TYPES,
  defaultReportFilters,
  readableAccountingCsv,
  readableAccountingReport,
  reportingChoices,
  type ReportType,
  type ReportFilters,
} from "@/lib/accounting-readable";

function downloadText(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function AccountingReports({
  report,
  identity,
  initialType = "summary",
  initialFilters = defaultReportFilters,
  evidence,
}: {
  report: AccountingReport;
  identity: string;
  initialType?: ReportType;
  initialFilters?: ReportFilters;
  evidence: ReactNode;
}) {
  const [type, setType] = useState<ReportType>(initialType);
  const [filters, setFilters] = useState(initialFilters);
  const [showBasis, setShowBasis] = useState(true);
  const [page, setPage] = useState(1);
  const choices = useMemo(() => reportingChoices(report), [report]);
  const invoiceLinks = useMemo(
    () =>
      report.rows
        .filter((r) => r.kind === "billed")
        .map((r) =>
          ledgerRecordUrl(report.jobId, r, { from: report.from || undefined, as_of: report.asOf }),
        ),
    [report],
  );
  const view = useMemo(
    () => (type === "evidence" ? null : readableAccountingReport(report, type, filters)),
    [report, type, filters],
  );
  const maxPage = Math.max(1, ...(view?.tables ?? []).map((t) => Math.ceil(t.rows.length / 50)));
  const visiblePage = Math.min(page, maxPage);
  const featured =
    view?.metrics
      .filter((m) =>
        type === "summary"
          ? [
              "Recorded gross billed",
              "Recorded net receipts",
              "Current saved cost budget",
            ].includes(m.label) || m.label.startsWith("Recorded posted costs")
          : type === "receivables" || type === "statement"
            ? [
                "Unpaid recorded invoices as-of",
                "Net receipts through as-of",
                "Unapplied recorded receipts as-of",
                "Recorded retainage held as-of",
              ].includes(m.label)
            : m.label !== "Profit / margin",
      )
      .slice(0, 4) ?? [];
  const additional = view?.metrics.filter((m) => !featured.includes(m)) ?? [];
  function selectType(value: ReportType) {
    window.location.assign(accountingModeLocation(window.location.href, value));
    setType(value);
    setFilters(defaultReportFilters);
    setPage(1);
  }
  return (
    <div className="af-report af-readable">
      <div className="af-report-controls" aria-label="Report controls">
        <label>
          Report type
          <select
            name="report_type"
            form="accounting-dates"
            value={type}
            onChange={(e) => selectType(e.target.value as ReportType)}
          >
            {Object.entries(REPORT_TYPES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {type !== "evidence" && (
          <>
            <label>
              Currency
              <select
                name="currency"
                form="accounting-dates"
                value={filters.currency}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, currency: e.target.value }));
                  setPage(1);
                }}
                disabled={type === "statement" || type === "receivables"}
              >
                {[
                  ...new Set([...choices.currencies, filters.currency]),
                  ...(report.ap?.rows.some((r) => r.currency === null) ? ["unknown"] : []),
                ].map((c) => (
                  <option key={c} value={c}>
                    {c === "unknown" ? "Unknown currency" : c}
                  </option>
                ))}
              </select>
            </label>
            {type === "costs" && (
              <>
                <label>
                  Vendor
                  <select
                    name="vendor"
                    form="accounting-dates"
                    value={filters.vendor}
                    onChange={(e) => {
                      setFilters((f) => ({ ...f, vendor: e.target.value }));
                      setPage(1);
                    }}
                  >
                    <option value="">All vendors</option>
                    {[
                      ...new Set([...choices.vendors, ...(filters.vendor ? [filters.vendor] : [])]),
                    ].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Cost code
                  <select
                    name="cost_code"
                    form="accounting-dates"
                    value={filters.costCode}
                    onChange={(e) => {
                      setFilters((f) => ({ ...f, costCode: e.target.value }));
                      setPage(1);
                    }}
                  >
                    <option value="">All cost codes</option>
                    {[
                      ...new Set([
                        ...choices.costCodes,
                        ...(filters.costCode ? [filters.costCode] : []),
                      ]),
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </>
        )}
      </div>
      <nav className="af-report-tabs" aria-label="Accounting reports">
        {Object.entries(REPORT_TYPES).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-current={type === value ? "page" : undefined}
            onClick={() => selectType(value as ReportType)}
          >
            {label}
          </button>
        ))}
      </nav>
      {view ? (
        <>
          <div className="af-report-toolbar">
            <div>
              <h2>{view.title}</h2>
              <p>{identity}</p>
            </div>
            <div className="af-report-buttons">
              <details>
                <summary>Choose fields</summary>
                <label className="af-check">
                  <input
                    type="checkbox"
                    checked={showBasis}
                    onChange={(e) => setShowBasis(e.target.checked)}
                  />{" "}
                  Measure basis
                </label>
                <p>Measure, value, currency, dates and report notes stay visible.</p>
              </details>
              <button
                type="button"
                onClick={() => {
                  if (type !== "evidence")
                    downloadText(
                      readableAccountingCsv(report, type, filters, identity, { basis: showBasis }),
                      `athena-${type}-${report.jobId}-${report.asOf}.csv`,
                    );
                }}
              >
                Download report CSV
              </button>
              <button type="button" onClick={() => window.print()}>
                Print / save PDF
              </button>
            </div>
          </div>
          <div className="af-report-notes">
            {view.notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </div>
          <section className="af-report-cards" aria-label="Financial measures">
            {featured.map((m) => (
              <article key={m.label}>
                <h3>{m.label}</h3>
                <p className="af-value">{m.amount}</p>
                {showBasis && <p>{m.basis}</p>}
              </article>
            ))}
          </section>
          {additional.length > 0 && (
            <section className="af-readable-table">
              <h2>Additional recorded measures</h2>
              <div
                className="overflow-x-auto"
                role="region"
                aria-label="Additional recorded measures"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Measure</th>
                      <th>Value</th>
                      {showBasis && <th>Basis</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {additional.map((m) => (
                      <tr key={m.label}>
                        <th scope="row">{m.label}</th>
                        <td className="af-money-cell">{m.amount}</td>
                        {showBasis && <td>{m.basis}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {view.tables.map((table, tableIndex) => (
            <section className="af-readable-table" key={table.title}>
              <div className="af-report-toolbar">
                <h2>{table.title}</h2>
                <button
                  type="button"
                  className="af-table-export"
                  onClick={() => {
                    if (type !== "evidence")
                      downloadText(
                        readableAccountingCsv(report, type, filters, identity, {
                          basis: showBasis,
                          tableIndex,
                        }),
                        `athena-${type}-table-${tableIndex + 1}-${report.jobId}-${report.asOf}.csv`,
                      );
                  }}
                >
                  Download these rows CSV
                </button>
              </div>
              {table.rows.length ? (
                <div
                  className="overflow-x-auto"
                  role="region"
                  aria-label={table.title}
                  tabIndex={0}
                >
                  <table>
                    <thead>
                      <tr>
                        {table.headers.map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row, i) => (
                        <tr
                          key={i}
                          className={
                            i < (visiblePage - 1) * 50 || i >= visiblePage * 50
                              ? "af-print-only"
                              : undefined
                          }
                        >
                          {row.map((value, j) =>
                            j === 0 ? (
                              <th scope="row" key={j}>
                                {table.title === "Recorded invoice balances" && invoiceLinks[i] ? (
                                  <a className="underline" href={invoiceLinks[i]!}>
                                    {value}
                                  </a>
                                ) : (
                                  value
                                )}
                              </th>
                            ) : (
                              <td
                                key={j}
                                className={
                                  /^-?(?:[A-Z]{3} |\$)[\d,.]+$/.test(value)
                                    ? "af-money-cell"
                                    : undefined
                                }
                              >
                                {value}
                              </td>
                            ),
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="af-empty">
                  No matching recorded evidence. Amounts remain unknown; no zero is inferred.
                </p>
              )}
              <p className="af-table-count">
                {table.rows.length} recorded rows.{" "}
                {table.rows.length > 50
                  ? `Page ${visiblePage}. Row export includes every matching row; printing includes all displayed tables.`
                  : "Row export includes every matching row. Printing includes all tables."}
              </p>
            </section>
          ))}
          {view.tables.some((t) => t.rows.length > 50) && (
            <nav className="af-report-buttons" aria-label="Report table pages">
              <button
                type="button"
                disabled={visiblePage <= 1}
                onClick={() => setPage(visiblePage - 1)}
              >
                Previous
              </button>
              <span>Page {visiblePage}</span>
              <button
                type="button"
                disabled={view.tables.every((t) => visiblePage * 50 >= t.rows.length)}
                onClick={() => setPage(visiblePage + 1)}
              >
                Next
              </button>
            </nav>
          )}
          {!view.customerSafe && (
            <details className="af-report-limitations">
              <summary>Full coverage and limitations</summary>
              <ul>
                {report.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </details>
          )}
          <p className="af-report-footnote">
            {view.customerSafe
              ? "Prepared locally for review. No external sharing or sending is enabled."
              : "Full accounting evidence and the original accountant CSV remain available in the report selector."}
          </p>
        </>
      ) : (
        evidence
      )}
    </div>
  );
}
