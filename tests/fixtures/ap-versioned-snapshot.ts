export function versionedSnapshot() {
  const job = "00000000-0000-4000-8000-000000000801",
    company = "00000000-0000-4000-8000-000000000802";
  return {
    snapshot_version: 1,
    complete: true,
    status: "complete",
    company_id: company,
    job_id: job,
    ap: {
      coverage: "athena_cost_records_only",
      external_accounting_coverage: false,
      cents_encoding: "decimal_string",
      currency: null,
      currency_verified: false,
      currency_coverage: "per_version",
      accounting_effective_date_coverage: "per_posting",
      accounting_effective_date_available: true,
      settlement_allocation_by_job_available: false,
      shared_payment_conservation_available: false,
      original_evidence_coverage: false,
      records: [
        {
          id: "synthetic-posted",
          kind: "supplier_bill",
          posted_version: 1,
          versions: [
            {
              version: 1,
              recorded_at: "2026-10-28T12:00:00Z",
              reason: null,
              incurred_on: "2026-10-01",
              currency_code: "USD" as string | null,
              currency_source: "reviewed_submission",
              amount_cents: "3000",
              document_reference: null,
              counterparty_name: "Synthetic supplier",
              allocations: [{ job_id: job, cost_code: "03-100", amount_cents: "3000" }],
            },
          ],
          posting_events: [
            {
              version: 1,
              posted_at: "2026-10-28T12:00:00Z",
              accounting_effective_on: "2026-10-02" as string | null,
            },
          ],
          payments: [] as unknown[],
          shared_allocations: [] as unknown[],
        },
      ],
    },
  };
}
