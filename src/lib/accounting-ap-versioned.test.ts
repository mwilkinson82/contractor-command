import { describe, expect, it } from "vitest";
import { sources, job, company } from "../../tests/fixtures/accounting-evidence";
import { versionedSnapshot } from "../../tests/fixtures/ap-versioned-snapshot";
import { buildVersionedApReport, attachVersionedAp, apMoney } from "./accounting-ap-versioned";
import { accountingCsv, buildAccountingReport, accountingMoney } from "./accounting-report";
function report(raw = versionedSnapshot(), asOf = "2026-10-28", from: string | null = null) {
  return buildVersionedApReport(raw, job, asOf, from, company)!;
}
function joined(raw = versionedSnapshot()) {
  const s = sources();
  s.costs = { available: false, reason: "AP separate" };
  return attachVersionedAp(buildAccountingReport(s, { asOf: "2026-10-28" }), report(raw));
}
describe("reviewed version-level AP report", () => {
  it("uses explicit accounting effective date rather than later recorded timestamp", () => {
    expect(report(undefined, "2026-10-03").groups[0].postedCents).toBe("3000");
    expect(report(undefined, "2026-10-01").rows).toHaveLength(0);
    expect(report(undefined, "2026-10-28", "2026-10-03").groups[0].selectedPeriodCents).toBeNull();
  });
  it("reports supported USD costs, cost-code variance and bounded provisional result", () => {
    const r = joined();
    expect(r.metrics.find((m) => m.key === "actual_costs")?.cents).toBe(3000);
    expect(r.metrics.find((m) => m.key === "provisional_result")?.cents).toBe(7000);
    expect(r.costCodes[0].remainingCents).toBe(7000);
    expect(r.metrics.find((m) => m.key === "unpaid_costs")?.cents).toBeNull();
  });
  it("keeps unknown currency and effective dates unknown while preserving known subset", () => {
    const s = versionedSnapshot();
    const unknown = structuredClone(s.ap.records[0]);
    unknown.id = "legacy";
    unknown.posting_events[0].accounting_effective_on = null;
    s.ap.records.push(unknown);
    const ap = report(s);
    expect(ap.groups[0]).toMatchObject({
      postedCents: null,
      knownSubtotalCents: "3000",
      unknownRows: 1,
    });
    expect(joined(s).metrics.find((m) => m.key === "actual_costs")?.cents).toBeNull();
    unknown.versions[0].currency_code = null;
    unknown.versions[0].currency_source = "unknown";
    expect(report(s).groups.some((g) => g.currency === null && g.postedCents === null)).toBe(true);
  });
  it("groups EUR separately and withholds a USD total/provisional result for mixed currency", () => {
    const s = versionedSnapshot();
    const eur = structuredClone(s.ap.records[0]);
    eur.id = "eur";
    eur.versions[0].currency_code = "EUR";
    s.ap.records.push(eur);
    expect(report(s).groups.map((g) => g.currency)).toEqual(["EUR", "USD"]);
    const r = joined(s);
    expect(r.metrics.find((m) => m.key === "actual_costs")?.cents).toBeNull();
    expect(r.metrics.find((m) => m.key === "provisional_result")?.cents).toBeNull();
    expect(r.costCodes[0].recordedCostCents).toBeNull();
  });
  it("excludes later unposted corrections and preserves posted provenance", () => {
    const s = versionedSnapshot();
    s.ap.records[0].versions.push({
      ...structuredClone(s.ap.records[0].versions[0]),
      version: 2,
      currency_code: "EUR",
    });
    const ap = report(s);
    expect(ap.rows[0]).toMatchObject({ version: 1, currency: "USD", amountCents: "3000" });
    expect(ap.rows[0].source).toContain("later unposted revision excluded");
    expect(ap.rows[0].source).toContain("prior settlement is not carried");
    expect(ap.groups[0].unpaidCents).toBeNull();
  });
  it("uses only the requested job cost allocation and never prorates payments", () => {
    const s = versionedSnapshot();
    s.ap.records[0].versions[0].allocations = [
      { job_id: job, cost_code: "03-100", amount_cents: "2000" },
      { job_id: company, cost_code: "other-job", amount_cents: "1000" },
    ];
    s.ap.records[0].shared_allocations = [{ amount_cents: "1000", payment_id: "shared" }];
    expect(report(s).groups[0]).toMatchObject({ postedCents: "2000", unpaidCents: null });
    expect(report(s).rows).toHaveLength(1);
  });
  it("fails closed on malformed decimal strings, allocation mismatch, scope and duplicate versions", () => {
    const s = versionedSnapshot();
    s.ap.records[0].versions[0].amount_cents = "3e3";
    expect(report(s)).toBeNull();
    s.ap.records[0].versions[0].amount_cents = "4000";
    expect(report(s)).toBeNull();
    s.ap.records[0].versions[0].amount_cents = "3000";
    s.ap.records[0].versions.push(s.ap.records[0].versions[0]);
    expect(report(s)).toBeNull();
    expect(
      buildVersionedApReport(versionedSnapshot(), company, "2026-10-28", null, company),
    ).toBeNull();
  });
  it("does not treat unsupported zero-/three-decimal units as two-decimal money", () => {
    const s = versionedSnapshot();
    s.ap.records[0].versions[0].currency_code = "JPY";
    expect(report(s).rows[0].amountCents).toBeNull();
    s.ap.records[0].versions[0].currency_code = "KWD";
    expect(report(s).rows[0].currency).toBeNull();
  });
  it("exports exact string cents as spreadsheet text and every AP source page", () => {
    const s = versionedSnapshot();
    for (let i = 0; i < 110; i++) {
      const r = structuredClone(s.ap.records[0]);
      r.id = `record-${i}`;
      s.ap.records.push(r);
    }
    const r = joined(s),
      csv = accountingCsv(r);
    expect(csv).toContain("ap_currency_summary");
    expect(csv).toContain('"\'333000"');
    expect(csv).toContain('"\'3000"');
    expect(csv).toContain("ledger_page=3");
    expect(apMoney("9007199254740991", "USD")).toBe("USD 90,071,992,547,409.91");
    expect(accountingMoney(9007199254740991)).toBe("$90,071,992,547,409.91");
  });
});
