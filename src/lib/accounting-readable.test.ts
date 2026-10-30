import { describe, expect, it } from "vitest";
import { buildAccountingReport, accountingCsv, type AccountingSources } from "./accounting-report";
import {
  readableAccountingCsv,
  readableAccountingReport,
  defaultReportFilters,
} from "./accounting-readable";
import type { ApCostRow } from "./accounting-ap-versioned";
const source: AccountingSources = {
  jobId: "job",
  capturedAt: "2026-10-30T12:00:00Z",
  budgets: [{ job_id: "job", key: "26", status: "known", value: { amount: 500 } }],
  costs: { available: false, reason: "AP unavailable" },
  orders: { available: false, reason: "Orders unavailable" },
  billing: {
    currency: "USD",
    invoices: [
      {
        job_id: "job",
        id: "inv",
        document_number: "INV-001",
        kind: "invoice",
        credit_for: null,
        versions: [
          {
            version: 1,
            status: "submitted",
            invoice_date: "2026-09-01",
            effective_date: "2026-09-01",
            gross_cents: 100000,
            net_due_cents: 90000,
            withheld_cents: 10000,
            released_cents: 0,
            source: "private invoice evidence",
          },
        ],
      },
    ],
    receipts: [
      {
        job_id: "job",
        id: "cash",
        receipt_date: "2026-09-02",
        amount_cents: 60000,
        source: "private cash note",
      },
    ],
    allocations: [
      {
        job_id: "job",
        id: "apply",
        receipt_id: "cash",
        invoice_id: "inv",
        effective_date: "2026-10-01",
        amount_cents: 40000,
        reversal_of: null,
        source: "private settlement note",
      },
    ],
    receipt_reversals: [],
  },
};
function fixture() {
  const report = buildAccountingReport(source, { from: "2026-10-01", asOf: "2026-10-30" });
  const rows: ApCostRow[] = [
    {
      id: "a",
      recordId: "a",
      version: 2,
      currency: "USD",
      costCode: "26",
      effectiveOn: "2026-10-10",
      incurredOn: "2026-10-01",
      amountCents: "10000",
      inPeriod: true,
      counterparty: "Alpha",
      reference: "A01",
      source: "private AP original",
    },
    {
      id: "b",
      recordId: "b",
      version: 1,
      currency: "USD",
      costCode: "27",
      effectiveOn: "2026-09-01",
      incurredOn: "2026-09-01",
      amountCents: "25000",
      inPeriod: false,
      counterparty: "Beta",
      reference: null,
      source: "private AP",
    },
    {
      id: "c",
      recordId: "c",
      version: 1,
      currency: "CAD",
      costCode: "26",
      effectiveOn: "2026-10-10",
      incurredOn: "2026-10-01",
      amountCents: "9000000000000",
      inPeriod: true,
      counterparty: "Alpha",
      source: "private CAD",
    },
    {
      id: "d",
      recordId: "d",
      version: 1,
      currency: null,
      costCode: "26",
      effectiveOn: null,
      incurredOn: null,
      amountCents: null,
      inPeriod: null,
      counterparty: "Alpha",
      source: "unknown currency",
    },
  ];
  report.ap = {
    rows,
    groups: [],
    costCodes: [],
    hasUnknown: true,
    basis: "current versions, never recording date",
    limitations: [],
  };
  return report;
}
describe("readable accounting reports", () => {
  it("keeps period activity separate from cumulative AR and cash, without double counting allocations", () => {
    const view = readableAccountingReport(fixture(), "receivables");
    const value = (label: string) => view.metrics.find((m) => m.label === label)?.amount;
    expect(value("Unpaid recorded invoices as-of")).toBe("$500.00");
    expect(value("Unapplied recorded receipts as-of")).toBe("$200.00");
    expect(value("Net receipts through as-of")).toBe("$600.00");
    expect(value("Applied cash through as-of")).toBe("$400.00");
    expect(value("Recorded net receipts")).toBe("Unknown");
    expect(value("Recorded retainage held as-of")).toBe("$100.00");
  });
  it("intersects vendor, code and currency; does not carry a whole budget into a vendor slice", () => {
    const view = readableAccountingReport(fixture(), "costs", {
      currency: "USD",
      vendor: "Alpha",
      costCode: "26",
    });
    expect(view.tables[1].rows).toEqual([["Alpha", "A01", "2026-10-10", "26", "USD 100.00", "v2"]]);
    expect(view.tables[0].rows[0]).toEqual(["26", "Unknown", "USD 100.00", "Unknown"]);
    expect(view.metrics.find((m) => m.label.includes("through as-of"))?.amount).toBe("USD 100.00");
    const empty = readableAccountingReport(fixture(), "costs", {
      currency: "USD",
      vendor: "Beta",
      costCode: "26",
    });
    expect(empty.metrics[0].amount).toBe("Unknown");
    expect(empty.tables[1].rows).toEqual([]);
  });
  it("preserves exact large currency amounts and unknown versus zero", () => {
    const cad = readableAccountingReport(fixture(), "costs", {
      ...defaultReportFilters,
      currency: "CAD",
    });
    expect(cad.metrics[0].amount).toBe("CAD 90,000,000,000.00");
    expect(cad.tables[0].rows[0][1]).toBe("Unknown");
    const unknown = readableAccountingReport(fixture(), "costs", {
      ...defaultReportFilters,
      currency: "unknown",
    });
    expect(unknown.metrics[0].amount).toBe("Unknown");
    expect(unknown.tables[1].rows).toHaveLength(1);
  });
  it("customer statement contains no internal financial data, private source notes or URLs", () => {
    const report = fixture();
    const csv = readableAccountingCsv(
      report,
      "statement",
      defaultReportFilters,
      "2810 · Willow Creek",
    );
    expect(csv).toContain("INV-001");
    expect(csv).toContain("2810 · Willow Creek");
    expect(csv).not.toContain("private invoice evidence");
    expect(csv).not.toContain("private cash note");
    expect(csv).not.toContain("private AP");
    expect(csv).not.toContain("/r/job/");
    expect(csv).not.toContain('$500.00","USD","Known saved budget');
    expect(readableAccountingReport(report, "statement").customerSafe).toBe(true);
  });
  it("readable export preserves the source report and original evidence export byte-for-byte", () => {
    const report = fixture();
    const before = accountingCsv(report);
    const snapshot = structuredClone(report);
    const csv = readableAccountingCsv(
      report,
      "costs",
      { ...defaultReportFilters, currency: "CAD" },
      "Project name",
    );
    expect(csv).toContain("CAD 90,000,000,000.00");
    expect(csv).not.toContain("'9000000000000");
    expect(report).toEqual(snapshot);
    expect(accountingCsv(report)).toBe(before);
  });
});
