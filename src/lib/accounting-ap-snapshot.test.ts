import { describe, expect, it } from "vitest";
import { apReportingCapability } from "./accounting-ap-snapshot";
import { sources, job, company } from "../../tests/fixtures/accounting-evidence";
import { buildAccountingReport } from "./accounting-report";
import { readAccountingReport, type AccountingIO } from "./accounting-report-read";
const time = "2026-10-28T14:00:00.000Z";
const snapshot = () => ({
  snapshot_version: 1,
  complete: true,
  status: "complete",
  company_id: company,
  job_id: job,
  ap: {
    coverage: "athena_cost_records_only",
    external_accounting_coverage: false,
    currency: null as string | null,
    currency_verified: false,
    cents_encoding: "decimal_string",
    accounting_effective_date_available: false,
    settlement_allocation_by_job_available: false,
    original_evidence_coverage: false,
    shared_payment_conservation_available: false,
    records: [
      {
        id: "synthetic-cost",
        kind: "supplier_bill",
        posted_version: 1,
        versions: [
          {
            version: 1,
            recorded_at: time,
            reason: null,
            amount_cents: "9000000000000",
            document_reference: null,
            counterparty_name: "Synthetic supplier",
            allocations: [{ job_id: job, cost_code: "03-100", amount_cents: "9000000000000" }],
          },
        ],
        posting_events: [{ version: 1, posted_at: time }],
        accounting_approvals: [],
        business_approvals: [],
        payments: [
          {
            id: "synthetic-pay",
            amount_cents: "1000",
            paid_on: "2026-10-28",
            reference: "synthetic",
            recorded_at: time,
            shared: false,
            correction: {
              id: "synthetic-correction",
              corrected_at: time,
              reason: "synthetic correction",
            },
          },
        ],
        shared_allocations: [],
      },
    ],
  },
});
describe("PR351 reconciliation snapshot monetary capability gate", () => {
  it("recognizes decimal-string evidence without inferring USD or accounting effective dates", () => {
    const raw = snapshot();
    const before = JSON.stringify(raw);
    const result = apReportingCapability(raw, job, company);
    expect(result.available).toBe(false);
    if (result.available) throw new Error();
    for (const reason of [
      "verified USD currency",
      "accounting effective dates",
      "job settlement allocations",
      "shared-payment conservation",
      "timestamps are not accounting effective dates",
    ])
      expect(result.reason).toContain(reason);
    expect(result.reason).not.toContain("synthetic-cost");
    expect(JSON.stringify(raw)).toBe(before);
  });
  it.each([
    null,
    {},
    { snapshot_version: 2, complete: false, status: "unavailable" },
    { snapshot_version: 1, complete: false, status: "unavailable" },
  ])("keeps unavailable or unsupported evidence unavailable", (raw) => {
    expect(apReportingCapability(raw, job, company).available).toBe(false);
  });
  it("rejects company/job mismatches without returning source rows", () => {
    const raw = snapshot();
    raw.company_id = "00000000-0000-4000-8000-000000000888";
    expect(apReportingCapability(raw, job, company)).toMatchObject({
      available: false,
      reason: expect.stringContaining("scope does not match"),
    });
    raw.company_id = company;
    raw.job_id = raw.company_id;
    expect(apReportingCapability(raw, job, company).available).toBe(false);
  });
  it("does not enable a monetary adapter merely because flags are changed or a foreign currency is supplied", () => {
    const raw = snapshot();
    raw.ap.currency = "EUR";
    raw.ap.currency_verified = true;
    expect(apReportingCapability(raw, job, company)).toMatchObject({
      available: false,
      reason: expect.stringContaining("verified USD currency"),
    });
    raw.ap.currency = "USD";
    raw.ap.accounting_effective_date_available = true;
    raw.ap.settlement_allocation_by_job_available = true;
    raw.ap.shared_payment_conservation_available = true;
    expect(apReportingCapability(raw, job, company)).toMatchObject({
      available: false,
      reason: expect.stringContaining("monetary adapter has not been validated"),
    });
  });
  it("withholds AP, cost-code totals and provisional result in the live reader with no partial-reader fallback", async () => {
    const s = sources();
    const names: string[] = [];
    const io: AccountingIO = {
      rpc: async (name) => {
        names.push(name);
        return {
          data:
            name === "mcp_billing_evidence_get"
              ? s.billing
              : name === "mcp_cost_reconciliation_snapshot"
                ? snapshot()
                : s.orders.available
                  ? s.orders.data
                  : null,
          error: null,
        };
      },
      budgetPage: async () => ({ data: s.budgets, error: null }),
    };
    const report = await readAccountingReport(
      io,
      job,
      { asOf: "2026-10-28" },
      company,
      new Date(time),
    );
    for (const key of ["actual_costs", "unpaid_costs", "provisional_result"])
      expect(report.metrics.find((m) => m.key === key)?.cents).toBeNull();
    expect(report.costCodes[0].recordedCostCents).toBeNull();
    expect(report.rows.some((r) => r.id.includes("synthetic-cost"))).toBe(false);
    expect(names).toContain("mcp_cost_reconciliation_snapshot");
    expect(names).not.toContain("mcp_cost_submission_read");
    expect(report.metrics.find((m) => m.key === "billed_gross")?.cents).toBe(10000);
  });
  it("the normalized monetary model itself requires explicit verified USD evidence", () => {
    const s = sources();
    if (!s.costs.available) throw new Error();
    Object.assign(s.costs.data, { currency: null, currency_verified: false });
    expect(() => buildAccountingReport(s, { asOf: "2026-10-28" })).toThrow();
  });
});
