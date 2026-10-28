import type { AccountingSources, BillingReportSource } from "../../src/lib/accounting-report";
export const job = "00000000-0000-4000-8000-000000000801";
export const company = "00000000-0000-4000-8000-000000000802";
export function sources(): AccountingSources {
  const invoice = (id: string, extra: Record<string, unknown> = {}) => ({
    job_id: job,
    id,
    kind: "invoice",
    document_number: id,
    credit_for: null,
    versions: [
      {
        version: 1,
        status: "submitted",
        invoice_date: "2026-10-01",
        effective_date: "2026-10-01",
        source: "Synthetic original",
        gross_cents: 10000,
        withheld_cents: 1000,
        released_cents: 0,
        net_due_cents: 9000,
        ...extra,
      },
    ],
  });
  return {
    jobId: job,
    companyId: company,
    capturedAt: "2026-10-28T14:00:00.000Z",
    billing: {
      currency: "USD",
      invoices: [invoice("inv"), invoice("void", { status: "void" })],
      receipts: [
        {
          id: "rcpt",
          job_id: job,
          receipt_date: "2026-10-10",
          amount_cents: 4000,
          source: "Synthetic check",
        },
      ],
      allocations: [
        {
          id: "alloc",
          job_id: job,
          receipt_id: "rcpt",
          invoice_id: "inv",
          effective_date: "2026-10-10",
          amount_cents: 3000,
          reversal_of: null,
          source: "Synthetic remittance",
        },
      ],
      receipt_reversals: [],
    } as BillingReportSource,
    budgets: [{ job_id: job, key: "03-100", status: "known", value: { amount: 100 } }],
    costs: {
      available: true,
      data: {
        currency: "USD",
        currency_verified: true,
        records: [
          {
            id: "bill",
            kind: "supplier_bill",
            posted_version: 1,
            versions: [
              {
                version: 2,
                facts: {
                  kind: "supplier_bill",
                  description: "Unposted correction",
                  counterparty_name: "Synthetic supplier",
                  incurred_on: "2026-10-02",
                  amount_cents: 5000,
                  allocations: [{ job_id: job, cost_code: "03-100", amount_cents: 5000 }],
                },
              },
              {
                version: 1,
                facts: {
                  kind: "supplier_bill",
                  description: "Synthetic concrete",
                  counterparty_name: "Synthetic supplier",
                  incurred_on: "2026-10-02",
                  amount_cents: 3000,
                  allocations: [{ job_id: job, cost_code: "03-100", amount_cents: 3000 }],
                },
              },
            ],
            payments: [
              {
                id: "pay",
                amount_cents: 1000,
                paid_on: "2026-10-20",
                reference: "Synthetic settlement",
                corrected: false,
                shared: false,
              },
            ],
          },
        ],
      },
    },
    orders: {
      available: true,
      data: {
        orders: [
          {
            job_id: job,
            company_id: company,
            id: "po",
            number: "SYN-PO-1",
            versions: [
              {
                version: 1,
                status: "approved",
                order_date: "2026-10-01",
                created_at: "2026-10-01T12:00:00Z",
                lines: [
                  { description: "Synthetic concrete", quantity: 2.5, unit_price_cents: 2000 },
                ],
              },
            ],
          },
        ],
      },
    },
  };
}
