import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountingReports } from "@/components/athena/AccountingReports";
import { accountingCsv, buildAccountingReport, type AccountingSources } from "./accounting-report";
import { attachVersionedAp, buildVersionedApReport } from "./accounting-ap-versioned";
import {
  defaultReportFilters,
  readableAccountingCsv,
  readableAccountingReport,
} from "./accounting-readable";

const job = "00000000-0000-4000-8000-000000000001";
const company = "00000000-0000-4000-8000-000000000002";
const secret = "PRIVATE_INTERNAL_EVIDENCE_CANARY";
const invoiceVersion = (version: number, effective_date: string, net_due_cents: number) => ({
  version,
  effective_date,
  invoice_date: "2026-09-01",
  status: "submitted" as const,
  gross_cents: net_due_cents + 10000,
  net_due_cents,
  withheld_cents: 10000,
  released_cents: 0,
  source: secret,
});
const source: AccountingSources = {
  jobId: job,
  companyId: company,
  capturedAt: "2026-10-30T12:00:00Z",
  budgets: [{ job_id: job, key: "26", status: "known", value: { amount: 500 } }],
  costs: { available: false, reason: secret },
  orders: {
    available: true,
    data: {
      orders: [
        {
          job_id: job,
          company_id: company,
          id: "po",
          number: "PO-001",
          versions: [
            {
              version: 1,
              status: "approved",
              created_at: "2026-09-01T00:00:00Z",
              order_date: "2026-09-01",
              lines: [{ description: secret, quantity: 1, unit_price_cents: 20000 }],
            },
            {
              version: 2,
              status: "draft",
              created_at: "2026-10-02T00:00:00Z",
              order_date: "2026-10-02",
              lines: [{ description: secret, quantity: 1, unit_price_cents: 90000 }],
            },
          ],
        },
      ],
    },
  },
  billing: {
    currency: "USD",
    invoices: [
      {
        job_id: job,
        id: "invoice",
        document_number: "INV-001",
        kind: "invoice",
        credit_for: null,
        versions: [invoiceVersion(2, "2026-10-10", 110000), invoiceVersion(1, "2026-09-01", 90000)],
      },
      {
        job_id: job,
        id: "credit",
        document_number: "CR-001",
        kind: "credit",
        credit_for: "invoice",
        versions: [
          {
            ...invoiceVersion(1, "2026-10-03", 10000),
            invoice_date: "2026-10-03",
            status: "posted",
            gross_cents: null,
            withheld_cents: null,
            released_cents: null,
          },
        ],
      },
    ],
    receipts: [
      {
        job_id: job,
        id: "receipt",
        receipt_date: "2026-09-02",
        amount_cents: 60000,
        source: secret,
      },
    ],
    receipt_reversals: [
      {
        job_id: job,
        id: "receipt-reversal",
        receipt_id: "receipt",
        effective_date: "2026-10-06",
        amount_cents: 5000,
        source: secret,
      },
    ],
    allocations: [
      {
        job_id: job,
        id: "allocation",
        invoice_id: "invoice",
        receipt_id: "receipt",
        effective_date: "2026-09-03",
        amount_cents: 40000,
        reversal_of: null,
        source: secret,
      },
      {
        job_id: job,
        id: "allocation-reversal",
        invoice_id: "invoice",
        receipt_id: "receipt",
        effective_date: "2026-10-05",
        amount_cents: 10000,
        reversal_of: "allocation",
        source: secret,
      },
    ],
  },
};
function snapshot() {
  const version = (number: number, currency: string | null, allocations: string[]) => ({
    version: number,
    recorded_at: "2026-10-29T00:00:00Z",
    reason: null,
    incurred_on: "2026-09-15",
    currency_code: currency,
    currency_source: currency ? "reviewed_submission" : "unknown",
    amount_cents: allocations.reduce((n, x) => n + BigInt(x), 0n).toString(),
    document_reference: secret,
    counterparty_name: "Vendor Alpha",
    allocations: allocations.map((amount_cents, i) => ({
      job_id: job,
      cost_code: i ? "27" : "26",
      amount_cents,
    })),
  });
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
          id: "usd",
          kind: "supplier_bill",
          posted_version: 2,
          versions: [version(1, "USD", ["10000", "5000"]), version(2, "USD", ["10000", "8000"])],
          posting_events: [
            {
              version: 1,
              posted_at: "2026-10-29T00:00:00Z",
              accounting_effective_on: "2026-09-15",
            },
            {
              version: 2,
              posted_at: "2026-10-29T00:00:00Z",
              accounting_effective_on: "2026-10-12",
            },
          ],
          payments: [],
          shared_allocations: [],
        },
        {
          id: "cad",
          kind: "supplier_bill",
          posted_version: 1,
          versions: [version(1, "CAD", ["22500"])],
          posting_events: [
            {
              version: 1,
              posted_at: "2026-10-29T00:00:00Z",
              accounting_effective_on: "2026-09-15",
            },
          ],
          payments: [],
          shared_allocations: [],
        },
        {
          id: "legacy",
          kind: "supplier_bill",
          posted_version: 1,
          versions: [version(1, null, ["8000"])],
          posting_events: [
            { version: 1, posted_at: "2026-10-29T00:00:00Z", accounting_effective_on: null },
          ],
          payments: [],
          shared_allocations: [],
        },
      ],
    },
  };
}
function report(from?: string, asOf = "2026-10-30") {
  const r = buildAccountingReport(structuredClone(source), { from, asOf });
  const ap = buildVersionedApReport(snapshot(), job, asOf, from ?? null, company);
  expect(ap).not.toBeNull();
  return attachVersionedAp(r, ap!);
}
const values = (from?: string) =>
  new Map(
    readableAccountingReport(report(from), "receivables").metrics.map((m) => [m.label, m.amount]),
  );
describe("integrated accounting presentation and export reconciliation", () => {
  it("keeps cumulative balances stable when activity start moves, selecting immutable effective revisions", () => {
    for (const start of [undefined, "2026-10-01", "2026-10-20"]) {
      const view = values(start);
      expect(view.get("Unpaid recorded invoices as-of")).toBe("$700.00");
      expect(view.get("Net receipts through as-of")).toBe("$550.00");
      expect(view.get("Applied cash through as-of")).toBe("$300.00");
      expect(view.get("Unapplied recorded receipts as-of")).toBe("$250.00");
      expect(view.get("Recorded retainage held as-of")).toBe("$100.00");
    }
    expect(values("2026-10-01").get("Recorded net receipts")).toBe("-$50.00");
    expect(values("2026-10-20").get("Recorded net receipts")).toBe("Unknown");
    const earlier = readableAccountingReport(report(undefined, "2026-10-01"), "statement");
    expect(earlier.tables[0].rows[0]).toEqual([
      "INV-001",
      "2026-09-01",
      "$1,000.00",
      "$500.00",
      "1",
    ]);
  });
  it("counts the selected posted AP version/allocation once, keeping drafts, commitments and currencies separate", () => {
    const r = report("2026-10-01");
    expect(r.ap!.rows.filter((x) => x.currency === "USD").map((x) => x.version)).toEqual([2, 2]);
    const costs = readableAccountingReport(r, "costs");
    expect(costs.metrics[0].amount).toBe("USD 180.00");
    expect(costs.metrics[1].amount).toBe("USD 180.00");
    expect(r.metrics.find((m) => m.key === "commitments")!.cents).toBe(20000);
    expect(
      readableAccountingReport(r, "summary").metrics.find((m) => m.label.includes("commitments"))
        ?.amount,
    ).toBe("$200.00");
    const cad = readableAccountingReport(r, "costs", { ...defaultReportFilters, currency: "CAD" });
    expect(cad.metrics[0].amount).toBe("CAD 225.00");
    expect(cad.metrics[1].amount).toBe("Unknown");
    expect(cad.tables[0].rows[0][1]).toBe("Unknown");
    expect(
      readableAccountingReport(r, "receivables", { ...defaultReportFilters, currency: "CAD" })
        .tables,
    ).toEqual([]);
    expect(
      readableAccountingReport(r, "costs", { ...defaultReportFilters, currency: "unknown" })
        .metrics[0].amount,
    ).toBe("Unknown");
  });
  it("withholds absent slices and vendor budgets without broadening stale selections", () => {
    for (const vendor of ["Vendor Alpha", "Removed vendor"]) {
      const v = readableAccountingReport(report(), "costs", {
        currency: "USD",
        vendor,
        costCode: "26",
      });
      expect(v.tables[0].rows.every((row) => row[1] === "Unknown" && row[3] === "Unknown")).toBe(
        true,
      );
      if (vendor === "Removed vendor") expect(v.metrics[0].amount).toBe("Unknown");
    }
    expect(
      readableAccountingReport(report(), "costs", {
        currency: "USD",
        vendor: "",
        costCode: "Removed code",
      }).tables[0].rows,
    ).toEqual([]);
  });
  it("renders and exports customer statements without internal evidence, costs, budgets or private links", () => {
    const r = report();
    r.limitations.push(secret, "/r/job/private-evidence");
    const before = accountingCsv(r);
    const html = renderToStaticMarkup(
      createElement(AccountingReports, {
        report: r,
        identity: "2810 · Synthetic review",
        initialType: "statement",
        evidence: createElement("div", null, secret, "/r/job/private-evidence"),
      }),
    );
    expect(html).toContain("INV-001");
    for (const content of [
      html,
      JSON.stringify(readableAccountingReport(r, "statement")),
      ...[
        {},
        { basis: false },
        { basis: true, tableIndex: 0 },
        { basis: true, tableIndex: 99 },
      ].map((fields) =>
        readableAccountingCsv(
          r,
          "statement",
          defaultReportFilters,
          "2810 · Synthetic review",
          fields as { basis: boolean; tableIndex?: number },
        ),
      ),
    ]) {
      for (const forbidden of [
        secret,
        "Vendor Alpha",
        "/r/job/private-evidence",
        "Posted AP allocations",
        "Current saved cost budget",
        "USD 180.00",
        "CAD 225.00",
      ])
        expect(content).not.toContain(forbidden);
    }
    expect(accountingCsv(r)).toBe(before);
    expect(before).toContain(secret);
  });
  it("distinguishes an evidenced zero net receipt from an empty receipt history", () => {
    const zero = structuredClone(source);
    zero.billing.receipts[0].amount_cents = 5000;
    zero.billing.allocations = [];
    const entered = buildAccountingReport(zero, { asOf: "2026-10-30" });
    const view = readableAccountingReport(entered, "receivables");
    expect(view.metrics.find((m) => m.label === "Net receipts through as-of")?.amount).toBe(
      "$0.00",
    );
    zero.billing.receipts = [];
    zero.billing.receipt_reversals = [];
    const absent = readableAccountingReport(
      buildAccountingReport(zero, { asOf: "2026-10-30" }),
      "receivables",
    );
    expect(absent.metrics.find((m) => m.label === "Net receipts through as-of")?.amount).toBe(
      "Unknown",
    );
  });
  it("exports complete rectangular tables with formula-safe labels, not repeated report totals", () => {
    const r = report();
    r.rows.push(
      ...Array.from({ length: 55 }, (_, i) => ({
        ...r.rows.find((x) => x.kind === "billed")!,
        id: `extra:${i}`,
        label: `INV-EXTRA-${i}`,
      })),
    );
    const csv = readableAccountingCsv(r, "statement", defaultReportFilters, "=PROJECT()");
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(57);
    expect([...new Set(lines.map((line) => [...line.matchAll(/"(?:[^"]|"")*"/g)].length))]).toEqual(
      [12],
    );
    expect(csv).toContain("INV-EXTRA-54");
    expect(csv).toContain("'=PROJECT()");
    expect(csv).not.toContain("Unpaid recorded invoices as-of");
    const html = renderToStaticMarkup(
      createElement(AccountingReports, {
        report: r,
        identity: "Synthetic",
        initialType: "statement",
        evidence: null,
      }),
    );
    expect(html).toContain("INV-EXTRA-54");
    expect(html).toContain('class="af-print-only"');
  });
});
