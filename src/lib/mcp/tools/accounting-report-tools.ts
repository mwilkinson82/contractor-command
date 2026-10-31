import { accountingRecordUrl, ledgerRecordUrl } from "../../accounting-record-target";
import { REPORT_TYPES, readableAccountingReport } from "../../accounting-readable";
import { apMoney } from "../../accounting-ap-versioned";
import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, text } from "../guard";
import { resolveJob } from "../jobs";
import { guide } from "../visible";
import {
  accountingDate,
  accountingMoney,
  accountingPage,
  validateAccountingDates,
  AccountingDateRangeError,
} from "../../accounting-report";
import { accountingIO, readAccountingReport } from "../../accounting-report-read";

export const accountingReport = defineTool({
  name: "accounting_report",
  title: "Job accounting evidence and accountant export",
  description:
    "Reads a job ledger, dated billing versus receipts, retainage, current posted costs, unpaid balances where supported, separate PO commitments and current budget comparison. Opens a private report with accountant CSV download. For a customer statement use report_type statement; other modes are summary, receivables, costs and evidence. Missing cost coverage stays unknown; not a complete P&L.",
  inputSchema: {
    job_number: z.string().trim().min(1).max(40).optional(),
    company_id: z.string().uuid().optional(),
    from: accountingDate.optional(),
    as_of: accountingDate.optional(),
    report_type: z
      .enum(
        Object.keys(REPORT_TYPES) as [keyof typeof REPORT_TYPES, ...(keyof typeof REPORT_TYPES)[]],
      )
      .optional(),
    page: z.number().int().min(1).default(1),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run(
      "accounting_report",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id, sweep: false },
      async (sb) => {
        if (!args.job_number)
          return guide(
            {
              ...text("Which job should I use for the accounting report?"),
              structuredContent: { missing: ["job_number"] },
            },
            "Ask only for the job. Default to all entered evidence through today unless the member requests dates; do not ask for amounts or invent missing coverage.",
          );
        const now = new Date();
        const dates = { from: args.from, asOf: args.as_of ?? now.toISOString().slice(0, 10) };
        try {
          validateAccountingDates(dates, now.toISOString().slice(0, 10));
        } catch (error) {
          if (error instanceof AccountingDateRangeError) throw new ToolError(error.message);
          throw error;
        }
        const job = await resolveJob(sb, args.job_number, args.company_id, "full");
        const report = await readAccountingReport(
          accountingIO(sb),
          job.job_id,
          dates,
          job.company_id,
          now,
        );
        const query = new URLSearchParams({
          as_of: report.asOf,
          report_type: args.report_type ?? "summary",
          ...(report.from ? { from: report.from } : {}),
        });
        const url = `https://app.meetathena.io/r/job/${job.job_id}/accounting?${query}`;
        if (args.report_type === "statement") {
          const statement = readableAccountingReport(report, "statement");
          return guide(
            {
              ...text(
                `Customer statement for ${job.job_number}: ${url}\n${statement.metrics.map((m) => `${m.label}: ${m.amount}`).join("\n")}`,
              ),
              structuredContent: {
                job_id: job.job_id,
                report_type: "statement",
                report_url: url,
                statement,
              } as never,
            },
            "Open the Customer Statement link, not the billing-record list. This customer-safe statement excludes internal cost and budget evidence; it is not bank verification or a historical close.",
          );
        }
        const ledger = accountingPage(report, args.page);
        const ap = report.ap
          ? {
              ...report.ap,
              costCodes: report.ap.costCodes.slice(
                ((args.page ?? 1) - 1) * 50,
                (args.page ?? 1) * 50,
              ),
              cost_code_pagination: { totalRows: report.ap.costCodes.length },
              rows: report.ap.rows.slice(((args.page ?? 1) - 1) * 50, (args.page ?? 1) * 50),
              pagination: {
                totalRows: report.ap.rows.length,
                nextPage:
                  (args.page ?? 1) * 50 < report.ap.rows.length ? (args.page ?? 1) + 1 : null,
              },
            }
          : undefined;
        return guide(
          {
            ...text(
              `${job.job_number} · Accounting evidence · ${report.ap ? "AR/budget/PO USD; AP by reviewed currency" : "USD"}\n${report.from ?? "Inception"} through ${report.asOf} (inclusive)\n${report.metrics.map((m) => `${m.label}: ${accountingMoney(m.cents)}`).join("\n")}\n\n${report.basis}\n${report.limitations.join("\n")}\n\nAP currency groups: ${report.ap?.groups.map((g) => `${g.currency ?? "Unknown"}: ${apMoney(g.postedCents, g.currency)} posted as-of; net AP Unknown`).join("; ") ?? "Unavailable"}\nPrivate report and accountant CSV: ${url}\nLedger page ${ledger.page}: ${ledger.rows.length} of ${ledger.totalRows} rows; totals include all source rows.`,
            ),
            structuredContent: {
              ...report,
              ap,
              rows: ledger.rows,
              costCodes: report.costCodes.slice(((args.page ?? 1) - 1) * 50, (args.page ?? 1) * 50),
              cost_code_pagination: {
                totalRows: report.costCodes.length,
                page: args.page ?? 1,
                nextPage:
                  (args.page ?? 1) * 50 < report.costCodes.length ? (args.page ?? 1) + 1 : null,
              },
              pagination: { ...ledger, rows: undefined },
              report_url: url,
              record_links: [
                ...ledger.rows.flatMap((r) => {
                  const link = ledgerRecordUrl(job.job_id, r, {
                    from: report.from || undefined,
                    as_of: report.asOf,
                  });
                  return link
                    ? [{ label: `${r.label}${r.version ? ` · v${r.version}` : ""}`, url: link }]
                    : [];
                }),
                ...(ap?.rows.map((r) => ({
                  label: `${r.reference || r.counterparty} · v${r.version}`,
                  url: accountingRecordUrl(
                    job.job_id,
                    { kind: "payable", id: r.recordId, version: r.version },
                    { as_of: report.asOf, from: report.from || undefined },
                  ),
                })) ?? []),
              ],
            } as never,
          },
          "Return complete ordinary Markdown text and the private report/CSV link. Do not generate a visual app as a substitute for the text. Preserve Unknown, currency, date basis and completeness limitations. Billed revenue is not earned revenue. Settlements and PO commitments are never extra actual costs. The provisional billed less recorded costs is not a complete P&L. Source IDs and versions support drill-down. Do not combine currencies or invent missing costs. AP currency provenance is reviewed submission, not independent document verification. AP range values select effective current versions and are not journal movements. Keep unsupported net AP and settlement allocation Unknown. Follow nextPage for more ledger rows; summary totals always cover all read sources.",
        );
      },
    ),
});
