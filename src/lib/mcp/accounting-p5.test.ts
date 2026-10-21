import { describe, expect, it } from "vitest";
import { fade, fileFormat, ledgerMath, overUnderLabel, type LedgerInput } from "./accounting/ledger";
import { fmt, toCents } from "./accounting/cents";

const $ = toCents;
const base = (): LedgerInput => ({
  contract_sum: $("1,800,000.00"), estimate_total: $("1,500,000.00"),
  lines: [
    { code: "01", description: "General conditions", contract: $("300,000.00"), estimate: $("250,000.00"), cost_to_date: $("125,000.00"), billed_to_date: $("150,000.00") },
    { code: "26", description: "Electrical", contract: $("900,000.00"), estimate: $("750,000.00"), cost_to_date: $("384,250.00"), billed_to_date: $("528,250.00") },
    { code: "09", description: "Finishes", contract: $("600,000.00"), estimate: $("500,000.00"), cost_to_date: $("200,000.00"), billed_to_date: $("250,000.00") },
  ],
  costs: [{ code: "01", amount: $("125,000.00"), date: "2027-03-01" }, { code: "26", amount: $("384,250.00"), date: "2027-03-01" }, { code: "09", amount: $("200,000.00"), date: "2027-03-01" }],
  import_control_total: $("709,250.00"), certified_billed_to_date: $("928,250.00"), certified_retainage: $("92,825.00"), retainage_held: $("92,825.00"),
});

describe("Phase 5 ledger (D5, D7, D8)", () => {
  it("cost-to-cost: earned $851,100.00, overbilled $77,150.00, all ties pass", () => {
    const r = ledgerMath(base());
    expect(fmt(r.job.earned)).toBe("$851,100.00");
    expect(overUnderLabel(r.job.over_under)).toBe("Overbilled $77,150.00");
    expect(r.ties.slice(0, 7).map((t) => t.id)).toEqual(["T1", "T2", "T3", "T4", "T5", "T6", "T7"]);
    expect(r.blocks).toEqual([]);
  });
  it("L8: import short by $27.00 blocks with zero tolerance", () => {
    const x = base(); x.import_control_total += 2700;
    const r = ledgerMath(x);
    expect(r.blocks).toEqual(["T1 Import rows = accounting control total misses by $27.00. Zero tolerance; nothing can be saved until it ties."]);
  });
  it("one cent off blocks too", () => { const x = base(); x.retainage_held += 1; expect(ledgerMath(x).blocks[0]).toMatch(/^T5 .* \$0\.01/); });
  it("L9: fade alert when cost% is more than 5 points ahead of billed%, not at exactly 5", () => {
    expect(fade({ estimate: 10000, cost_to_date: 6001, contract: 10000, billed_to_date: 5000 }).alert).toBe(true);
    expect(fade({ estimate: 10000, cost_to_date: 5500, contract: 10000, billed_to_date: 5000 }).alert).toBe(false);
    const x = base(); x.lines[2].billed_to_date = $("100,000.00"); // cost 40.00% vs billed 16.67%
    expect(ledgerMath(x).lines[2].alert).toBe(true);
  });
  it("unknown cost code blocks (T6)", () => { const x = base(); x.costs.push({ code: "99", amount: 0, date: "2027-03-01" }); expect(ledgerMath(x).blocks.join()).toContain("99"); });
  it("D7: Excel by default; Google Sheet only with Drive and an ask", () => {
    expect(fileFormat(true, false).format).toBe("xlsx");
    expect(fileFormat(false, true).format).toBe("xlsx");
    expect(fileFormat(true, true).format).toBe("google_sheet");
  });
});
