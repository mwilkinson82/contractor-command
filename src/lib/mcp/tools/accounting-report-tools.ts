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
    "Reads a job ledger, dated billing versus receipts, retainage, current posted costs, unpaid balances where supported, separate PO commitments and current budget comparison. Opens a private report with accountant CSV download. Missing cost coverage stays unknown; not a complete P&L.",
  inputSchema: {
    job_number: z.string().trim().min(1).max(40).optional(),
    company_id: z.string().uuid().optional(),
    from: accountingDate.optional(),
    as_of: accountingDate.optional(),
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
          ...(report.from ? { from: report.from } : {}),
        });
        const url = `https://app.meetathena.io/r/job/${job.job_id}/accounting?${query}`;
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
            } as never,
          },
          "Return complete ordinary Markdown text and the private report/CSV link. Do not generate a visual app as a substitute for the text. Preserve Unknown, currency, date basis and completeness limitations. Billed revenue is not earned revenue. Settlements and PO commitments are never extra actual costs. The provisional billed less recorded costs is not a complete P&L. Source IDs and versions support drill-down. Do not combine currencies or invent missing costs. AP currency provenance is reviewed submission, not independent document verification. AP range values select effective current versions and are not journal movements. Keep unsupported net AP and settlement allocation Unknown. Follow nextPage for more ledger rows; summary totals always cover all read sources.",
        );
      },
    ),
});
