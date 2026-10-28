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
    "Reviews available accounting evidence and reports when exception findings are unavailable because a complete, consistent snapshot cannot be established. Does not repair records or move money.",
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
          `${job.job_number}: exception findings are unavailable because a complete, consistent evidence snapshot is not established.`,
          "This check changes no financial records. Recorded payment does not prove money transferred.",
          ...shown.map(
            (f) =>
              `- ${f.code} · ${f.record_ids.map((id) => id.slice(0, 8)).join(", ") || "source records"}: ${f.message}${f.amount_cents === undefined ? "" : ` ${dollars(f.amount_cents)}`}`,
          ),
          ...(ordered.length > shown.length
            ? [
                `Showing ${shown.length} of ${ordered.length}; ${shown.length < 50 ? "request a higher limit for more" : "inspect source records for the remaining items"}.`,
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
