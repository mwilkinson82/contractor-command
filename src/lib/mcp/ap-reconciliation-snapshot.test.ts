import { describe, expect, it } from "vitest";
import { reconcileApSnapshot } from "./ap-reconciliation-snapshot";
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
      amount_cents: "10000",
      document_reference: "Bill-1",
      counterparty_name: "Synthetic vendor",
      allocations: [{ job_id: scope.job_id, cost_code: "FUEL", amount_cents: "10000" }],
    },
  ],
  accounting_approvals: [{ version: 1, approved_at: "2026-10-28T00:00:00Z" }],
  posting_events: [{ version: 1, posted_at: "2026-10-28T00:00:00Z" }],
  business_approvals: [],
  payments: [
    {
      id: id(4),
      amount_cents: "4000",
      paid_on: "2026-10-28",
      reference: "CHK-1",
      recorded_at: "2026-10-28T00:00:00Z",
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
    cents_encoding: "decimal_string",
    coverage: "athena_cost_records_only",
    external_accounting_coverage: false,
    shared_payment_conservation_available: false,
    settlement_allocation_by_job_available: false,
    accounting_effective_date_available: false,
    original_evidence_coverage: false,
    records: [row()],
  },
});
const check = (data: unknown) => reconcileApSnapshot(data, scope);
describe("PR351 v1 snapshot consumer", () => {
  it("accepts exact contract but does not infer payable balance, currency or original gaps", () => {
    const r = check(fixture());
    expect(r.coverage.state).toBe("checked");
    expect(r.coverage.reason).toMatch(/Currency/);
    expect(r.findings).toEqual([]);
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
    expect(r.findings.map((x) => x.code)).toEqual(["ap_pending_correction"]);
    expect(r.findings[0].amount_cents).toBeUndefined();
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
});
