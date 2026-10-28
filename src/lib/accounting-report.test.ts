import { describe, expect, it } from "vitest";
import { sources, job } from "../../tests/fixtures/accounting-evidence";
import {
  accountingCsv,
  accountingPage,
  buildAccountingReport,
  sumCents,
} from "./accounting-report";
const options = { asOf: "2026-10-28" };
const metric = (s = sources(), key = "actual_costs", o = options) =>
  buildAccountingReport(s, o).metrics.find((m) => m.key === key)!.cents;

describe("accounting evidence read model", () => {
  it("keeps billing, retainage, receipts, settlements and commitments distinct", () => {
    const report = buildAccountingReport(sources(), options);
    expect(Object.fromEntries(report.metrics.map((m) => [m.key, m.cents]))).toMatchObject({
      billed_gross: 10000,
      receipts: 4000,
      unpaid_invoices: 6000,
      unapplied_receipts: 1000,
      retainage: 1000,
      actual_costs: 3000,
      unpaid_costs: 2000,
      commitments: 5000,
      budget: 10000,
      provisional_result: 7000,
    });
    expect(report.costCodes).toEqual([
      { code: "03-100", budgetCents: 10000, recordedCostCents: 3000, remainingCents: 7000 },
    ]);
    expect(report.rows.find((r) => r.kind === "posted_cost")?.source).toContain(
      "later unposted correction excluded",
    );
  });
  it("selects highest effective revision and does not include future corrections", () => {
    const s = sources();
    const original = s.billing.invoices[0].versions[0];
    s.billing.invoices[0].versions = [
      { ...original, version: 2, effective_date: "2026-10-29", gross_cents: 20000 },
      original,
    ];
    expect(metric(s, "billed_gross")).toBe(10000);
    s.billing.invoices[0].versions.reverse();
    s.billing.invoices[0].versions[1].effective_date = "2026-10-28";
    expect(metric(s, "billed_gross")).toBe(20000);
  });
  it("does not turn unknown history or missing fields into zeros", () => {
    const s = sources();
    s.billing.invoices = [];
    s.billing.receipts = [];
    s.billing.allocations = [];
    s.costs = { available: false, reason: "AP not installed" };
    s.orders = { available: false, reason: "PO not installed" };
    s.budgets[0].value = { amount: null };
    for (const m of buildAccountingReport(s, options).metrics) expect(m.cents).toBeNull();
  });
  it("null monetary values and unsafe aggregates remain unknown", () => {
    const s = sources();
    s.billing.invoices[0].versions[0].gross_cents = null;
    expect(metric(s, "billed_gross")).toBeNull();
    expect(sumCents([Number.MAX_SAFE_INTEGER, 1])).toBeNull();
    expect(sumCents([1, null])).toBeNull();
  });
  it("converts decimal budgets exactly and rejects fractional cents rather than rounding", () => {
    const s = sources();
    s.budgets[0].value = { amount: 0.29 };
    expect(metric(s, "budget")).toBe(29);
    for (const amount of [0.001, 0.000000001, 90_000_000_001]) {
      s.budgets[0].value = { amount };
      expect(metric(s, "budget")).toBeNull();
    }
  });
  it("rejects mixed currencies and project/PO company mismatch", () => {
    const s = sources();
    s.billing.currency = "EUR" as "USD";
    expect(() => buildAccountingReport(s, options)).toThrow();
    s.billing.currency = "USD";
    s.billing.receipts[0].job_id = "other";
    expect(() => buildAccountingReport(s, options)).toThrow(/another project/);
    s.billing.receipts[0].job_id = job;
    if (s.orders.available) s.orders.data.orders[0].company_id = "other";
    expect(() => buildAccountingReport(s, options)).toThrow(/another company/);
  });
  it("applies partial allocation reversals, receipt reversals and credits once", () => {
    const s = sources();
    s.billing.allocations.push({
      ...s.billing.allocations[0],
      id: "alloc-rev",
      amount_cents: 1000,
      reversal_of: "alloc",
      effective_date: "2026-10-15",
    });
    s.billing.receipt_reversals.push({
      job_id: job,
      id: "rcpt-rev",
      receipt_id: "rcpt",
      amount_cents: 500,
      effective_date: "2026-10-16",
      source: "Synthetic reversal",
    });
    s.billing.invoices.push({
      ...s.billing.invoices[0],
      id: "credit",
      kind: "credit",
      credit_for: "inv",
      versions: [{ ...s.billing.invoices[0].versions[0], status: "posted", net_due_cents: 1000 }],
    });
    expect(metric(s, "unpaid_invoices")).toBe(6000);
    expect(metric(s, "receipts")).toBe(3500);
    expect(metric(s, "unapplied_receipts")).toBe(1500);
    expect(metric(s, "provisional_result")).toBe(6000);
  });
  it("inclusive dates affect period activity, while balances remain cumulative", () => {
    const report = buildAccountingReport(sources(), { from: "2026-10-10", asOf: "2026-10-28" });
    expect(report.metrics.find((m) => m.key === "receipts")?.cents).toBe(4000);
    expect(report.metrics.find((m) => m.key === "billed_gross")?.cents).toBeNull();
    expect(report.metrics.find((m) => m.key === "unpaid_invoices")?.cents).toBe(6000);
    const historical = buildAccountingReport(sources(), { asOf: "2026-10-09" });
    expect(historical.metrics.find((m) => m.key === "unpaid_invoices")?.cents).toBe(9000);
    expect(historical.metrics.find((m) => m.key === "actual_costs")?.cents).toBeNull();
    expect(historical.limitations.join(" ")).toContain("omits posting timestamps");
  });
  it("rejects invalid dates, future cutoffs and reversed ranges", () => {
    for (const date of ["2026-02-30", "2026-10-29", "bad"])
      expect(() => buildAccountingReport(sources(), { asOf: date })).toThrow();
    expect(() =>
      buildAccountingReport(sources(), { from: "2026-10-28", asOf: "2026-10-27" }),
    ).toThrow();
  });
  it("company-paid and reimbursement costs post once, corrected payments do not settle", () => {
    const s = sources();
    if (!s.costs.available) throw new Error();
    const bill = s.costs.data.records[0];
    bill.payments[0].corrected = true;
    expect(metric(s, "unpaid_costs")).toBe(3000);
    bill.kind = "company_paid_expense";
    bill.versions.forEach((v) => (v.facts.kind = "company_paid_expense"));
    expect(metric(s, "actual_costs")).toBe(3000);
    expect(metric(s, "unpaid_costs")).toBe(0);
    bill.kind = "reimbursable_expense";
    bill.versions.forEach((v) => (v.facts.kind = "reimbursable_expense"));
    bill.payments[0].corrected = false;
    expect(metric(s, "actual_costs")).toBe(3000);
    expect(metric(s, "unpaid_costs")).toBe(2000);
  });
  it("accepts a source-recorded missing AP document reference without losing cost coverage", () => {
    const s = sources();
    if (!s.costs.available) throw new Error();
    s.costs.data.records[0].versions.forEach((v) => {
      v.facts.document_reference = null;
    });
    expect(metric(s, "actual_costs")).toBe(3000);
    expect(
      buildAccountingReport(s, options).rows.find((r) => r.kind === "posted_cost")?.source,
    ).toContain("reference missing");
  });
  it("uses explicit job cost allocations but refuses to prorate split-job settlement", () => {
    const s = sources();
    if (!s.costs.available) throw new Error();
    const posted = s.costs.data.records[0].versions[1].facts;
    posted.allocations = [
      { job_id: job, cost_code: "03-100", amount_cents: 2000 },
      { job_id: "other", cost_code: "03-100", amount_cents: 1000 },
    ];
    expect(metric(s, "actual_costs")).toBe(2000);
    expect(metric(s, "unpaid_costs")).toBeNull();
    const report = buildAccountingReport(s, options);
    expect(report.rows.find((r) => r.kind === "settlement_evidence")?.amountCents).toBeNull();
  });
  it("rejects malformed posting references, allocations, duplicate IDs and overpayment", () => {
    const s = sources();
    if (!s.costs.available) throw new Error();
    const record = s.costs.data.records[0];
    record.posted_version = 3;
    expect(() => buildAccountingReport(s, options)).toThrow(/version unavailable/);
    record.posted_version = 1;
    record.versions[1].facts.amount_cents = 3001;
    expect(() => buildAccountingReport(s, options)).toThrow(/reconcile/);
    record.versions[1].facts.amount_cents = 3000;
    record.payments[0].amount_cents = 4000;
    expect(() => buildAccountingReport(s, options)).toThrow(/exceeds/);
    record.payments[0].amount_cents = 1000;
    s.billing.receipts.push(s.billing.receipts[0]);
    expect(() => buildAccountingReport(s, options)).toThrow(/Duplicate/);
  });
  it("does not invent PO fractional-cent rounding or revoke earlier approvals for a draft", () => {
    const s = sources();
    if (!s.orders.available) throw new Error();
    const po = s.orders.data.orders[0];
    po.versions.push({ ...po.versions[0], version: 2, status: "draft" });
    expect(metric(s, "commitments")).toBe(5000);
    po.versions[0].lines[0].quantity = 0.0001;
    expect(metric(s, "commitments")).toBeNull();
  });
  it("paginates detail without changing full-source totals or export", () => {
    const s = sources();
    for (let i = 0; i < 110; i++)
      s.billing.receipts.push({ ...s.billing.receipts[0], id: `r-${i}` });
    const report = buildAccountingReport(s, options);
    expect(accountingPage(report).rows).toHaveLength(50);
    expect(accountingPage(report).nextPage).toBe(2);
    expect(accountingPage(report, 3).nextPage).toBeNull();
    expect(accountingCsv(report)).toContain("r-109");
    expect(report.metrics.find((m) => m.key === "receipts")?.cents).toBe(444000);
  });
  it("neutralizes formula prefixes and quotes embedded newlines, quotes and commas", () => {
    const s = sources();
    s.billing.receipts[0].source = ' \t=HYPERLINK("bad"),\nnext';
    const report = buildAccountingReport(s, options);
    const csv = accountingCsv(report);
    expect(csv).toContain('"\' \t=HYPERLINK(""bad""),\nnext"');
    expect(csv).toContain("Incomplete billing/cost basis");
    expect(csv).toContain("amount_cents");
    expect(csv).toContain("USD");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).not.toContain("NaN");
  });
});
