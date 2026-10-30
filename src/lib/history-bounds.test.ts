import { describe, expect, it, vi } from "vitest";
import { readAccountingReport, type AccountingIO } from "./accounting-report-read";
import { buildVersionedApReport } from "./accounting-ap-versioned";
import { readableAccountingCsv, defaultReportFilters } from "./accounting-readable";
import { readDailyIndex } from "./daily-report-workspace";
import type { ProductionClient } from "./production-report";
const job = "00000000-0000-4000-8000-000000000001";
const company = "00000000-0000-4000-8000-000000000002";
const now = new Date("2026-10-30T12:00:00Z");
const emptyBilling = () => ({
  currency: "USD",
  invoices: [],
  receipts: [],
  allocations: [],
  receipt_reversals: [],
});
function accountingFixture(count: number, billing: unknown = emptyBilling()) {
  const rows = Array.from({ length: count }, (_, n) => ({
    job_id: job,
    key: String(n).padStart(5, "0"),
    status: "known",
    value: { amount: 1 },
  }));
  const budgetPage = vi.fn(async (_job: string, start: number, end: number) => ({
    data: rows.slice(start, end + 1),
    error: null,
  }));
  const rpc = vi.fn(async (name: string) =>
    name === "mcp_billing_evidence_get"
      ? { data: billing, error: null }
      : { data: null, error: { code: "PGRST202", message: "not installed" } },
  );
  return { rpc, budgetPage } satisfies AccountingIO;
}
function apFixture(count: number, records = 1) {
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
      records: Array.from({ length: records }, (_, r) => ({
        id: `bill-${r}`,
        kind: "supplier_bill",
        posted_version: count,
        versions: Array.from({ length: count }, (_, n) => ({
          version: count - n,
          recorded_at: "2026-10-30T00:00:00Z",
          reason: null,
          incurred_on: "2026-10-01",
          currency_code: "USD",
          currency_source: "reviewed_submission",
          amount_cents: String(count - n),
          document_reference: null,
          counterparty_name: "Synthetic vendor",
          allocations: [{ job_id: job, cost_code: "26", amount_cents: String(count - n) }],
        })),
        posting_events: Array.from({ length: count }, (_, n) => ({
          version: n + 1,
          posted_at: "2026-10-30T00:00:00Z",
          accounting_effective_on: count > 1 && n === count - 1 ? "2026-10-31" : "2026-10-01",
        })),
        payments: [],
        shared_allocations: [],
      })),
    },
  };
}
describe("explicit history, pagination and source bounds", () => {
  it.each([2047, 10000])(
    "reads every one of %i budget rows across bounded pages without partial totals",
    async (count) => {
      const io = accountingFixture(count);
      const report = await readAccountingReport(io, job, { asOf: "2026-10-30" }, company, now);
      expect(report.metrics.find((m) => m.key === "budget")?.cents).toBe(count * 100);
      expect(report.costCodes).toHaveLength(count);
      expect(report.costCodes.at(-1)?.code).toBe(String(count - 1).padStart(5, "0"));
      expect(io.budgetPage).toHaveBeenCalledTimes(Math.floor(count / 500) + 1);
      for (const [n, call] of io.budgetPage.mock.calls.entries())
        expect(call).toEqual([job, n * 500, n * 500 + 499]);
      const csv = readableAccountingCsv(
        report,
        "costs",
        defaultReportFilters,
        "Synthetic bounded report",
      );
      expect(csv).toContain(String(count - 1).padStart(5, "0"));
      expect(csv.trim().split("\r\n")).toHaveLength(count + 1);
    },
  );
  it("refuses 10001 budgets without reading or returning partial AP/PO totals", async () => {
    const io = accountingFixture(10001);
    await expect(
      readAccountingReport(io, job, { asOf: "2026-10-30" }, company, now),
    ).rejects.toThrow("Budget row limit exceeded");
    expect(io.rpc.mock.calls.map((c) => c[0])).toEqual(["mcp_billing_evidence_get"]);
  });
  it.each([10000, 10001])(
    "reports or explicitly refuses %i receipts, never silently truncating",
    async (count) => {
      const io = accountingFixture(0, {
        ...emptyBilling(),
        receipts: Array.from({ length: count }, (_, n) => ({
          job_id: job,
          id: `receipt-${n}`,
          receipt_date: "2026-10-01",
          amount_cents: 1,
          source: "Synthetic receipt",
        })),
      });
      if (count > 10000)
        await expect(
          readAccountingReport(io, job, { asOf: "2026-10-30" }, company, now),
        ).rejects.toThrow("row limit exceeded");
      else {
        const report = await readAccountingReport(io, job, { asOf: "2026-10-30" }, company, now);
        expect(report.rows.filter((r) => r.kind === "receipt")).toHaveLength(count);
        expect(report.metrics.find((m) => m.key === "receipts")?.cents).toBe(count);
      }
    },
  );
  it("refuses an oversized accounting evidence payload before any budget read", async () => {
    const io = accountingFixture(0, {
      ...emptyBilling(),
      receipts: [
        {
          job_id: job,
          id: "large",
          receipt_date: "2026-10-01",
          amount_cents: 1,
          source: "a".repeat(10_000_001),
        },
      ],
    });
    await expect(
      readAccountingReport(io, job, { asOf: "2026-10-30" }, company, now),
    ).rejects.toThrow("bounded report limit");
    expect(io.budgetPage).not.toHaveBeenCalled();
  });
  it("selects the effective current version across 1000 shuffled AP revisions and rejects 1001", () => {
    const r = buildVersionedApReport(apFixture(1000), job, "2026-10-30", null, company);
    expect(r?.rows).toHaveLength(1);
    expect(r?.rows[0]).toMatchObject({ version: 999, amountCents: "999" });
    expect(buildVersionedApReport(apFixture(1001), job, "2026-10-30", null, company)).toBeNull();
  });
  it("keeps an over-limit AP history unavailable through the actual report reader without partial totals", async () => {
    const io = accountingFixture(0);
    io.rpc.mockImplementation(async (name) =>
      name === "mcp_billing_evidence_get"
        ? { data: emptyBilling(), error: null }
        : name === "mcp_cost_reconciliation_snapshot"
          ? { data: apFixture(1001), error: null }
          : { data: null, error: { code: "PGRST202", message: "not installed" } },
    );
    const report = await readAccountingReport(io, job, { asOf: "2026-10-30" }, company, now);
    expect(report.ap).toBeUndefined();
    expect(report.metrics.find((m) => m.key === "actual_costs")?.cents).toBeNull();
    expect(report.metrics.find((m) => m.key === "unpaid_costs")?.cents).toBeNull();
  });
  it("includes 200 AP records and refuses 201 instead of presenting a partial amount", () => {
    expect(
      buildVersionedApReport(apFixture(1, 200), job, "2026-10-30", null, company)?.groups[0]
        .postedCents,
    ).toBe("200");
    expect(buildVersionedApReport(apFixture(1, 201), job, "2026-10-30", null, company)).toBeNull();
  });
  it("enforces the exact 2MiB versioned AP byte boundary without a partial latest-version fallback", () => {
    const raw = { ...apFixture(1), padding: "" };
    raw.padding = "a".repeat(2097152 - new TextEncoder().encode(JSON.stringify(raw)).byteLength);
    expect(new TextEncoder().encode(JSON.stringify(raw))).toHaveLength(2097152);
    expect(buildVersionedApReport(raw, job, "2026-10-30", null, company)?.rows[0].version).toBe(1);
    raw.padding += "a";
    expect(buildVersionedApReport(raw, job, "2026-10-30", null, company)).toBeNull();
  });
  it.each([200, 201])(
    "discloses saved-date index coverage for %i supplied dates",
    async (count) => {
      const dates = Array.from({ length: count }, (_, n) => ({
        report_date: new Date(Date.UTC(2026, 9, 30 - n)).toISOString().slice(0, 10),
      }));
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: dates, error: null }),
      };
      const client = {
        rpc: async () => ({
          data: { page: "field", scope: "full", job_number: "BOUNDS" },
          error: null,
        }),
        from: () => chain,
      } as unknown as ProductionClient;
      const r = await readDailyIndex(client, job);
      expect(r.dates).toHaveLength(200);
      expect(r.complete).toBe(count === 200);
      expect(r.dates[0]).toBe("2026-10-30");
    },
  );
});
