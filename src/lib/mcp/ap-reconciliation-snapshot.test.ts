import { describe, expect, it } from "vitest";
import { reconcileApSnapshot } from "./ap-reconciliation-snapshot";
import { COST_CURRENCIES } from "./ap-supported-currencies";
import { readFileSync } from "node:fs";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { company_id: id(1), job_id: id(2) };
const row = () => ({
  id: id(3),
  kind: "supplier_bill",
  posted_version: 1,
  versions: [
    {
      version: 1,
      recorded_at: "2026-10-28T00:00:00Z",
      reason: null as string | null,
      incurred_on: "2026-10-28" as string | null,
      currency_code: "USD" as string | null,
      currency_source: "reviewed_submission",
      amount_cents: "10000",
      document_reference: "Bill-1",
      counterparty_name: "Synthetic vendor",
      allocations: [{ job_id: scope.job_id, cost_code: "FUEL", amount_cents: "10000" }],
    },
  ],
  accounting_approvals: [{ version: 1, approved_at: "2026-10-28T00:00:00Z" }],
  posting_events: [
    {
      version: 1,
      posted_at: "2026-10-28T00:00:00Z",
      accounting_effective_on: null as string | null,
    },
  ],
  business_approvals: [],
  payments: [
    {
      id: id(4),
      amount_cents: "4000",
      paid_on: "2026-10-28",
      reference: "CHK-1",
      recorded_at: "2026-10-28T01:00:00Z",
      correction: null,
      shared: false,
    },
  ],
  shared_allocations: [],
});
const fixture = () => ({
  snapshot_version: 1,
  complete: true,
  status: "complete",
  ...scope,
  ap: {
    currency: null,
    currency_verified: false,
    currency_coverage: "per_version",
    cents_encoding: "decimal_string",
    coverage: "athena_cost_records_only",
    external_accounting_coverage: false,
    shared_payment_conservation_available: false,
    settlement_allocation_by_job_available: false,
    accounting_effective_date_available: false,
    accounting_effective_date_coverage: "per_posting",
    original_evidence_coverage: false,
    records: [row()],
  },
});
const check = (data: unknown) => reconcileApSnapshot(data, scope);
describe("PR351 v1 snapshot consumer", () => {
  it("compares a single-currency recorded payable and labels payment currency inference", () => {
    const r = check(fixture());
    expect(r.coverage.state).toBe("checked");
    expect(r.coverage.reason).toMatch(/not independently verified/);
    expect(r.findings.find((f) => f.code === "ap_unmatched")).toMatchObject({
      amount_cents: "6000",
      currency_code: "USD",
    });
    expect(r.findings.find((f) => f.code === "ap_unmatched")?.message).toMatch(/inferred/);
    expect(r.unknown_effective_dates).toBe(1);
  });
  it("retains the earlier posted version when a correction has not been posted", () => {
    const f = fixture();
    f.ap.records[0].versions.push({
      ...f.ap.records[0].versions[0],
      version: 2,
      reason: "Fix",
      amount_cents: "20000",
      allocations: [{ job_id: scope.job_id, cost_code: "FUEL", amount_cents: "20000" }],
    });
    const r = check(f);
    expect(r.findings.map((x) => x.code)).toEqual(
      expect.arrayContaining(["ap_pending_correction", "ap_unmatched"]),
    );
    expect(r.findings.find((f) => f.code === "ap_unmatched")?.amount_cents).toBe("6000");
  });
  it("flags repeat references without disclosing free-text values", () => {
    const f = fixture();
    const other = structuredClone(f.ap.records[0]);
    other.id = id(6);
    other.payments[0].id = id(7);
    f.ap.records.push(other);
    const r = check(f);
    expect(r.findings.map((x) => x.code)).toEqual(
      expect.arrayContaining(["duplicate_ap_reference", "duplicate_payment_reference"]),
    );
    expect(JSON.stringify(r)).not.toContain("Synthetic vendor");
    expect(JSON.stringify(r)).not.toContain("CHK-1");
  });
  it("fails closed for absent, denied, malformed, incomplete, wrong-scope and unsupported results", () => {
    const f = fixture();
    for (const x of [
      null,
      { snapshot_version: 1, complete: false, status: "unavailable" },
      { ...f, snapshot_version: 2 },
      { ...f, company_id: id(99) },
      { ...f, job_id: id(99) },
      { ...f, ap: { ...f.ap, currency_verified: true } },
      { ...f, ap: { ...f.ap, cents_encoding: "number" } },
      { ...f, ap: { ...f.ap, external_accounting_coverage: true } },
      { ...f, ap: { ...f.ap, records: undefined } },
    ]) {
      const r = check(x);
      expect(r.coverage.state).toBe("unavailable");
      expect(r.findings).toEqual([]);
    }
  });
  it("rejects noncanonical, unsupported and unsafe monetary representations", () => {
    for (const amount of ["0", "1.2", "9000000000001", "01", "-1", 9000]) {
      const f = fixture();
      f.ap.records[0].versions[0].amount_cents = amount as string;
      expect(check(f).coverage.state).toBe("unavailable");
    }
  });
  it("requires coherent posted version, approvals and correction lineage", () => {
    const f = fixture();
    f.ap.records[0].accounting_approvals = [];
    expect(check(f).coverage.state).toBe("unavailable");
    const g = fixture();
    g.ap.records[0].versions.push({ ...g.ap.records[0].versions[0], version: 3, reason: "Fix" });
    expect(check(g).coverage.state).toBe("unavailable");
  });
  it("uses the producer's exact pinned currency list", () => {
    const helper = readFileSync("tests/fixtures/pr351-ap-snapshot-helpers-1318.sql", "utf8");
    const codes = [...helper.matchAll(/'([A-Z]{3})'/g)].map((m) => m[1]);
    expect([...COST_CURRENCIES]).toEqual(codes);
  });
  it("groups posted job allocations by currency and kind without mixing whole-record values", () => {
    const f = fixture();
    const eur = structuredClone(f.ap.records[0]);
    eur.id = id(8);
    eur.kind = "company_paid_expense";
    eur.versions[0].currency_code = "EUR";
    eur.versions[0].document_reference = "EUR-1";
    eur.versions[0].allocations = [
      { job_id: scope.job_id, cost_code: "A", amount_cents: "3000" },
      { job_id: id(9), cost_code: "B", amount_cents: "7000" },
    ];
    eur.payments = [];
    f.ap.records.push(eur);
    expect(check(f).currency_totals).toEqual([
      {
        currency_code: "EUR",
        supplier_bill_cents: "0",
        reimbursable_expense_cents: "0",
        company_paid_expense_cents: "3000",
        posted_record_count: 1,
      },
      {
        currency_code: "USD",
        supplier_bill_cents: "10000",
        reimbursable_expense_cents: "0",
        company_paid_expense_cents: "0",
        posted_record_count: 1,
      },
    ]);
  });
  it("flags settlement recorded against a company-paid expense without treating it as a payable", () => {
    const f = fixture();
    f.ap.records[0].kind = "company_paid_expense";
    const r = check(f);
    expect(r.findings.map((x) => x.code)).toContain("ap_company_paid_settlement");
    expect(r.findings.map((x) => x.code)).not.toContain("ap_unmatched");
  });
  it("keeps legacy unknown currency and effective date unknown, without amounts or inferred zero", () => {
    const f = fixture();
    f.ap.records[0].versions[0].currency_code = null;
    f.ap.records[0].versions[0].currency_source = "unknown";
    f.ap.records[0].versions[0].incurred_on = null;
    const r = check(f);
    expect(r.coverage.state).toBe("checked");
    expect(r.currency_totals).toEqual([]);
    expect(r.unknown_currency_records).toBe(1);
    expect(r.unknown_effective_dates).toBe(1);
    expect(r.settlement_unchecked_records).toBe(1);
    expect(r.findings.some((x) => x.code === "ap_unmatched")).toBe(false);
  });
  it("withholds settlement comparison when a corrected posted version changes currency", () => {
    const f = fixture();
    const r = f.ap.records[0];
    r.versions.push({
      ...r.versions[0],
      version: 2,
      reason: "Currency correction",
      currency_code: "EUR",
    });
    r.accounting_approvals.push({ version: 2, approved_at: "2026-10-29T00:00:00Z" });
    r.posting_events.push({
      version: 2,
      posted_at: "2026-10-29T00:00:00Z",
      accounting_effective_on: null,
    });
    r.posted_version = 2;
    const result = check(f);
    expect(result.currency_totals[0].currency_code).toBe("EUR");
    expect(result.settlement_unchecked_records).toBe(1);
    expect(result.findings.some((x) => x.code === "ap_unmatched")).toBe(false);
  });
  it("does not assign legacy settlement to a correction when the earlier posted currency is unknown", () => {
    const f = fixture();
    const r = f.ap.records[0];
    r.versions[0].currency_code = null;
    r.versions[0].currency_source = "unknown";
    r.versions.push({
      ...r.versions[0],
      version: 2,
      reason: "Add currency",
      currency_code: "USD",
      currency_source: "reviewed_submission",
    });
    r.accounting_approvals.push({ version: 2, approved_at: "2026-10-29T00:00:00Z" });
    r.posting_events.push({
      version: 2,
      posted_at: "2026-10-29T00:00:00Z",
      accounting_effective_on: null,
    });
    r.posted_version = 2;
    const result = check(f);
    expect(result.currency_totals[0].currency_code).toBe("USD");
    expect(result.settlement_unchecked_records).toBe(1);
    expect(result.findings.some((x) => x.code === "ap_unmatched")).toBe(false);
  });
  it("does not carry mixed, unknown, shared or ambiguously timed settlement into a balance", () => {
    const f = fixture();
    f.ap.records[0].payments[0].recorded_at = f.ap.records[0].posting_events[0].posted_at;
    expect(check(f).settlement_unchecked_records).toBe(1);
    f.ap.records[0].payments[0].recorded_at = "2026-10-28T03:00:00";
    expect(check(f).settlement_unchecked_records).toBe(1);
    const g = fixture();
    g.ap.records[0].shared_allocations = [
      {
        payment_id: id(10),
        amount_cents: "1000",
        paid_on: "2026-10-28",
        reference: "S-1",
        recorded_at: "2026-10-28T02:00:00Z",
        correction: null,
      },
    ] as never;
    const r = check(g);
    expect(r.settlement_unchecked_records).toBe(1);
    expect(r.findings.some((x) => x.code === "ap_unmatched")).toBe(false);
  });
  it("preserves a known posted currency while a differently denominated correction is unposted", () => {
    const f = fixture();
    f.ap.records[0].versions.push({
      ...f.ap.records[0].versions[0],
      version: 2,
      reason: "Pending correction",
      currency_code: "EUR",
    });
    const r = check(f);
    expect(r.findings.find((x) => x.code === "ap_unmatched")).toMatchObject({
      currency_code: "USD",
      amount_cents: "6000",
    });
    expect(r.findings.map((x) => x.code)).toContain("ap_pending_correction");
  });
  it("keeps correction evidence separate from a bank refund and preserves exact amounts", () => {
    const f = fixture();
    const r = f.ap.records[0];
    r.versions[0].amount_cents = "9000000000000";
    r.versions[0].allocations[0].amount_cents = "9000000000000";
    r.payments[0].correction = {
      id: id(50),
      reason: "Erroneous entry",
      corrected_at: "2026-10-29T00:00:00Z",
    } as never;
    const result = check(f);
    expect(result.currency_totals[0].supplier_bill_cents).toBe("9000000000000");
    expect(result.findings.find((x) => x.code === "ap_unmatched")?.amount_cents).toBe(
      "9000000000000",
    );
    expect(JSON.stringify(result)).not.toMatch(/refund/i);
  });
  it("treats inconsistent posting, currency or reused payment identity as unavailable", () => {
    const a = fixture();
    a.ap.records[0].versions[0].currency_source = "unknown";
    expect(check(a).coverage.state).toBe("unavailable");
    const b = fixture();
    b.ap.records[0].posting_events.push({ ...b.ap.records[0].posting_events[0] });
    expect(check(b).coverage.state).toBe("unavailable");
    const c = fixture();
    const other = structuredClone(c.ap.records[0]);
    other.id = id(7);
    c.ap.records.push(other);
    expect(check(c).coverage.state).toBe("unavailable");
  });
  it("preserves explicit effective dates without inventing dates for legacy postings", () => {
    const f = fixture();
    f.ap.records[0].posting_events[0].accounting_effective_on = "2026-10-27";
    f.ap.accounting_effective_date_available = true;
    expect(check(f).unknown_effective_dates).toBe(0);
    f.ap.accounting_effective_date_available = false;
    expect(check(f).coverage.state).toBe("unavailable");
    f.ap.records[0].posting_events[0].accounting_effective_on = "2026-02-31";
    f.ap.accounting_effective_date_available = true;
    expect(check(f).coverage.state).toBe("unavailable");
  });
});
