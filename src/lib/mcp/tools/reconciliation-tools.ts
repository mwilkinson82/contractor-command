import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, text } from "../guard";
import { resolveJob } from "../jobs";
import { guide } from "../visible";
import { readReconciliation } from "../reconciliation-read";
import { dollars } from "../reconciliation";

export const accountingReconciliation = defineTool({
  name: "accounting_reconciliation",
  title: "Review project accounting exceptions",
  description:
    "Reviews recorded billing and AP exceptions from complete scoped snapshots and reports unavailable coverage. Does not repair records or move money.",
  inputSchema: {
    job_number: z.string().trim().min(1).max(40),
    company_id: z.string().trim().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(50).default(12),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run(
      "accounting_reconciliation",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id, sweep: false },
      async (sb) => {
        const job = await resolveJob(sb, args.job_number, args.company_id, "full");
        const result = await readReconciliation(sb, job);
        const ordered = [...result.findings].sort(
          (a, b) => Number(b.severity === "attention") - Number(a.severity === "attention"),
        );
        const shown = ordered.slice(0, args.limit ?? 12);
        const lines = [
          ordered.length > 0
            ? `${job.job_number}: ${ordered.length} review item${ordered.length === 1 ? "" : "s"} in available billing and AP evidence.`
            : `${job.job_number}: no review items in the checks available below; unavailable coverage remains unknown.`,
          "This check changes no financial records. Recorded payment does not prove money transferred.",
          ...shown.map(
            (f) =>
              `- ${f.code} · ${f.record_ids.map((id) => id.slice(0, 8)).join(", ") || "source records"}: ${f.message}${f.amount_cents === undefined ? "" : f.currency_code ? ` ${f.currency_code} ${dollars(f.amount_cents).replace("$", "")}` : ` ${dollars(f.amount_cents)}`}`,
          ),
          ...(ordered.length > shown.length
            ? [
                `Showing ${shown.length} of ${ordered.length}; ${shown.length < 50 ? "request a higher limit for more" : "inspect source records for the remaining items"}.`,
              ]
            : []),
          ...result.ap_currency_totals.map(
            (t) =>
              `AP posted job allocations (${t.currency_code}): supplier bills ${t.currency_code} ${dollars(t.supplier_bill_cents).replace("$", "")}; reimbursements ${t.currency_code} ${dollars(t.reimbursable_expense_cents).replace("$", "")}; company-paid expenses ${t.currency_code} ${dollars(t.company_paid_expense_cents).replace("$", "")}.`,
          ),
          ...(result.ap_unknown_currency_records
            ? [
                `${result.ap_unknown_currency_records} posted job record(s) have unknown currency and are excluded from currency totals.`,
              ]
            : []),
          ...(result.ap_unknown_effective_dates
            ? [
                `${result.ap_unknown_effective_dates} posted job record(s) have no known accounting effective date.`,
              ]
            : []),
          ...(result.ap_settlement_unchecked_records
            ? [
                `${result.ap_settlement_unchecked_records} whole-record settlement comparison(s) were withheld.`,
              ]
            : []),
          ...Object.entries(result.coverage).map(
            ([key, value]) => `${key}: ${value.state}. ${value.reason}`,
          ),
          result.consistency,
          `Billing source records: ${result.records_url}`,
          ...(result.coverage.ap.state === "checked"
            ? [
                "AP source: read job cost records for this company and job; no AP record page is available.",
              ]
            : []),
          "Missing history remains unknown. Review an exact source record before proposing a correction.",
        ];
        return guide(
          {
            ...text(lines.join("\n")),
            structuredContent: {
              ...result,
              findings: shown,
              reported_findings: ordered.length,
              total_findings: null,
              truncated: ordered.length > shown.length,
              job_id: job.job_id,
              company_id: job.company_id,
            } as never,
          },
          "Show the exception summary, source links and all unavailable coverage. No automatic repairs, payment execution or approval. Do not claim complete accounting, verified refunds or bank settlement. Use source_tool to inspect exact records; request confirmation only through a supported correction review workflow after re-reading current evidence.",
        );
      },
    ),
});
