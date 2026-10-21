// Accounting phase 1 + decision D1 (retainage per job from the contract). Job 2701 dry-run numbers from the build plan.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { applyBp, divHalfUp, fmt, toBp, toCents } from "./accounting/cents";
import { computeRetainage, ruleLine, ruleProblems, RETAINAGE_SETUP_RULE, type RetainageRule } from "./accounting/retainage";
import { payAppMath, type PayLine } from "./accounting/payapp-math";
import { accountingScope, requireApproved, requireBase, seqLabel, versionStamp } from "./accounting/foundations";
import { retainageRuleSave, retainageRuleLines } from "./tools/accounting-tools";
import { contractTerms } from "./tools/workflow-tools";

const $ = (v: number) => toCents(v);
const CLAUSE_41 = "Contractor shall retain ten percent (10%) of each progress payment until the Work is fifty percent (50%) complete, and five percent (5%) on subsequent payments.";
const RULE_2701: RetainageRule = {
  base_rate_bp: 1000, reduction: "prospective", threshold_bp: 5000, threshold_basis: "contract_sum_to_date", reduced_rate_bp: 500,
  release_terms: "30 days after the Owner's final acceptance and receipt of closeout documents (§4.2).",
  source: "contract", clause_section: "4.1", clause_text: CLAUSE_41, answered_by: null,
};

// App 2 (certified) G and I per line, then app 3 D/E/F. C · D · E · F from plan P3; prev G and prev I from plan P2.
const P3: [string, number, number, number, number, number, number, boolean?][] = [
  // id, C, D, E, F, prevG (app 2), prevI (app 2)
  ["26.01", 70000, 56000, 7000, 0, 56000, 5600],
  ["26.02", 20000, 18000, 2000, 0, 18000, 1800],
  ["26.03", 210000, 70000, 105000, 0, 140000, 14000],
  ["26.04", 180000, 0, 120000, 0, 60000, 6000],
  ["26.05", 185000, 37000, 74000, 0, 74000, 7400],
  ["26.06", 255000, 0, 191000, 0, 0, 0],
  ["26.07", 205000, 0, 102500, 0, 51250, 5125],
  ["26.08", 70000, 0, 0, 0, 0, 0],
  ["27.01", 90000, 45000, 22500, 0, 45000, 4500],
  ["28.01", 115000, 23000, 46000, 0, 46000, 4600],
  ["CO-001", 18500, 0, 9250, 0, 0, 0, true],
];
const app3Lines = (): PayLine[] => P3.map(([id, c, d, e, f, pg, pi, co]) => ({ id, co: !!co, c: $(c), d: $(d), e: $(e), f: $(f), prev_g: $(pg), prev_i: $(pi) }));
const app3 = (rule: RetainageRule, extra: Partial<Parameters<typeof payAppMath>[1]> = {}) =>
  payAppMath(rule, { original_contract: $(1400000), net_change_orders: $(18500), previous_certificates: $(441225), lines: app3Lines(), ...extra });

describe("cents: exact money, half-up rounding", () => {
  it("parses and formats to the cent", () => {
    expect(toCents("1,418,500.00")).toBe(141850000);
    expect(toCents(8968.75)).toBe(896875);
    expect(fmt(40515000)).toBe("$405,150.00");
    expect(fmt(-1000)).toBe("-$10.00");
    expect(() => toCents("1.005")).toThrow();
    expect(toBp(7.5)).toBe(750);
  });
  it("rounds half up, never banker's rounding", () => {
    expect(divHalfUp(5, 2)).toBe(3);
    expect(divHalfUp(-5, 2)).toBe(-3);
    expect(applyBp(1, 5000)).toBe(1); // half a cent rounds up
    expect(applyBp(141850000, 5000)).toBe(70925000); // 50% of $1,418,500.00 = $709,250.00
  });
});

describe("D1: job 2701 app 3 under the saved rule (10% to 50% complete, then 5% prospective)", () => {
  const r = app3(RULE_2701);
  it("current payment due is $405,150.00", () => {
    expect(fmt(r.g702.l8)).toBe("$405,150.00");
  });
  it("G702 summary matches the plan to the cent", () => {
    const g = r.g702;
    expect([g.l1, g.l2, g.l3, g.l4, g.l5a, g.l5b, g.l5, g.l6, g.l7, g.l8, g.l9].map(fmt)).toEqual([
      "$1,400,000.00", "$18,500.00", "$1,418,500.00", "$928,250.00", "$81,875.00", "$0.00", "$81,875.00", "$846,375.00", "$441,225.00", "$405,150.00", "$572,125.00",
    ]);
  });
  it("splits the period at the $709,250.00 threshold: $219,000.00 at 10% + $219,000.00 at 5% = $32,850.00", () => {
    expect(fmt(r.retainage.threshold_amount!)).toBe("$709,250.00");
    expect(fmt(r.retainage.below)).toBe("$219,000.00");
    expect(fmt(r.retainage.above)).toBe("$219,000.00");
    expect(fmt(r.retainage.period_retainage)).toBe("$32,850.00");
  });
  it("per-line period retainage and I match the plan, and lines sum to the totals", () => {
    expect(r.g703.map((l) => fmt(l.period_retainage))).toEqual(["$525.00", "$150.00", "$2,625.00", "$4,500.00", "$2,775.00", "$14,325.00", "$3,843.75", "$0.00", "$1,687.50", "$1,725.00", "$693.75"]);
    expect(r.g703.map((l) => fmt(l.i))).toEqual(["$6,125.00", "$1,950.00", "$16,625.00", "$10,500.00", "$10,175.00", "$14,325.00", "$8,968.75", "$0.00", "$6,187.50", "$6,325.00", "$693.75"]);
    expect(r.g703.map((l) => l.pct)).toEqual(["90.00%", "100.00%", "83.33%", "66.67%", "60.00%", "74.90%", "50.00%", "0.00%", "75.00%", "60.00%", "50.00%"]);
  });
  it("all five checks pass and the note reads in one line", () => {
    expect(r.checks.map((c) => [c.key, c.ok])).toEqual([["B1", true], ["B2", true], ["B3", true], ["B4", true], ["B5", true]]);
    expect(r.retainage.note).toBe("Held at 10% up to $709,250.00 (50% of contract sum to date), 5% above. This period: $32,850.00.");
  });
  it("cross-check: $438,000.00 − $32,850.00 = $405,150.00", () => {
    expect(fmt(r.retainage.period_amount - r.retainage.period_retainage)).toBe("$405,150.00");
  });
});

describe("P3-ALT: each other contract reading computes correctly when it is the saved rule", () => {
  it("whole balance drops to 5% at 50%: retainage $46,412.50, line 6 $881,837.50, due $440,612.50", () => {
    const r = app3({ ...RULE_2701, reduction: "whole_balance" });
    expect([r.g702.l5, r.g702.l6, r.g702.l8].map(fmt)).toEqual(["$46,412.50", "$881,837.50", "$440,612.50"]);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });
  it("rate set by status at the start of the period: $43,800.00 this period, $92,825.00 total, due $394,200.00", () => {
    const r = app3({ ...RULE_2701, reduction: "period_start_status" });
    expect([r.retainage.period_retainage, r.g702.l5, r.g702.l8].map(fmt)).toEqual(["$43,800.00", "$92,825.00", "$394,200.00"]);
  });
  it("threshold on the original contract ($700,000.00): $20,975.00 + $11,412.50 = $32,387.50, due $405,612.50, lines tie", () => {
    const r = app3({ ...RULE_2701, threshold_basis: "original_contract" });
    expect(fmt(r.retainage.threshold_amount!)).toBe("$700,000.00");
    expect([r.retainage.period_retainage, r.g702.l8].map(fmt)).toEqual(["$32,387.50", "$405,612.50"]);
    expect(r.g703.reduce((s, l) => s + l.period_retainage, 0)).toBe(r.retainage.period_retainage);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });
  it("flat 10% with no reduction: $43,800.00 this period", () => {
    const r = app3({ ...RULE_2701, reduction: "none", threshold_bp: null, threshold_basis: null, reduced_rate_bp: null });
    expect(fmt(r.retainage.period_retainage)).toBe("$43,800.00");
  });
  it("a contract that holds no retainage: $0.00 held, due equals the period amount", () => {
    const r = app3({ ...RULE_2701, base_rate_bp: 0, reduction: "none", threshold_bp: null, threshold_basis: null, reduced_rate_bp: null }, { lines: app3Lines().map((l) => ({ ...l, prev_i: 0 })), previous_certificates: $(490250) });
    expect([r.g702.l5, r.g702.l8].map(fmt)).toEqual(["$0.00", "$438,000.00"]);
  });
});

describe("pay app checks block on a mismatch with the saved rule", () => {
  it("B4 (P6): app 3 typed at flat 10% is $10,950.00 too high on the 5% part", () => {
    const r = app3(RULE_2701, { typed: { line5: $(92825) } });
    const b4 = r.checks.find((c) => c.key === "B4")!;
    expect(r.ok).toBe(false);
    expect(b4.message).toBe("Retainage is $10,950.00 too high on the 5% part above $709,250.00.");
  });
  it("B4 line by line: a single line off by a cent blocks", () => {
    const lines = app3Lines().map((l) => ({ ...l }));
    const r0 = app3(RULE_2701);
    lines.forEach((l, k) => (l.typed_i = r0.g703[k].i));
    lines[6].typed_i! += 1;
    lines[0].typed_i! -= 1; // total still ties, the lines don't
    const r = app3(RULE_2701, { lines });
    expect(r.checks.find((c) => c.key === "B4")!.message).toBe("Line 26.01 retainage is $0.01 too low against the saved rule.");
  });
  it("B1 (P4): CO-001 approved but not on the SOV", () => {
    const r = app3(RULE_2701, { lines: app3Lines().filter((l) => l.id !== "CO-001") });
    expect(r.checks.find((c) => c.key === "B1")!.message).toBe("SOV is $18,500.00 short of the contract sum to date. Add the approved change order as a line.");
  });
  it("B3 (P5): 26.02 over its scheduled value blocks; no approval path until D3 is decided", () => {
    const lines = app3Lines().map((l) => (l.id === "26.02" ? { ...l, e: $(3500) } : l));
    const r = app3(RULE_2701, { lines });
    expect(r.checks.find((c) => c.key === "B3")!.message).toBe("Line 26.02 is $1,500.00 over its scheduled value.");
  });
  it("B2 (P7): G702 line 5 keyed $500.00 high", () => {
    const r = app3(RULE_2701, { typed: { line5a: $(81875), line5b: $(500) } });
    expect(r.checks.find((c) => c.key === "B2")!.message).toBe("G702 line 5 is $500.00 more than the G703 column I total.");
  });
  it("B5 (P8): line 7 higher than the certified record", () => {
    const r = app3(RULE_2701, { previous_certificates: $(432000), typed: { line7: $(441225) } });
    expect(r.checks.find((c) => c.key === "B5")!.message).toBe("Previous certificates are $9,225.00 higher than the certified record.");
  });
});

describe("P1 and P2 under the same saved rule", () => {
  it("app 1: due $215,100.00", () => {
    const L: [string, number, number][] = [["26.01", 70000, 49000], ["26.02", 20000, 15000], ["26.03", 210000, 70000], ["26.04", 180000, 0], ["26.05", 185000, 37000], ["26.06", 255000, 0], ["26.07", 205000, 0], ["26.08", 70000, 0], ["27.01", 90000, 45000], ["28.01", 115000, 23000]];
    const r = payAppMath(RULE_2701, { original_contract: $(1400000), net_change_orders: 0, previous_certificates: 0, lines: L.map(([id, c, e]) => ({ id, c: $(c), d: 0, e: $(e), f: 0, prev_g: 0, prev_i: 0 })) });
    expect([r.g702.l4, r.g702.l5, r.g702.l8, r.g702.l9].map(fmt)).toEqual(["$239,000.00", "$23,900.00", "$215,100.00", "$1,184,900.00"]);
  });
  it("app 2: due $226,125.00, 5b $24,125.00 on stored materials", () => {
    const L: [string, number, number, number, number, number, number][] = [
      ["26.01", 70000, 49000, 7000, 0, 49000, 4900], ["26.02", 20000, 15000, 3000, 0, 15000, 1500], ["26.03", 210000, 70000, 0, 70000, 70000, 7000],
      ["26.04", 180000, 0, 0, 60000, 0, 0], ["26.05", 185000, 37000, 0, 37000, 37000, 3700], ["26.06", 255000, 0, 0, 0, 0, 0],
      ["26.07", 205000, 0, 0, 51250, 0, 0], ["26.08", 70000, 0, 0, 0, 0, 0], ["27.01", 90000, 45000, 0, 0, 45000, 4500], ["28.01", 115000, 23000, 0, 23000, 23000, 2300],
    ];
    const r = payAppMath(RULE_2701, { original_contract: $(1400000), net_change_orders: 0, previous_certificates: $(215100), lines: L.map(([id, c, d, e, f, pg, pi]) => ({ id, c: $(c), d: $(d), e: $(e), f: $(f), prev_g: $(pg), prev_i: $(pi) })) });
    expect([r.g702.l4, r.g702.l5a, r.g702.l5b, r.g702.l5, r.g702.l6, r.g702.l8, r.g702.l9].map(fmt)).toEqual(["$490,250.00", "$24,900.00", "$24,125.00", "$49,025.00", "$441,225.00", "$226,125.00", "$958,775.00"]);
    expect(r.ok).toBe(true);
  });
});

describe("D1: the rule is saved per job from the contract, or from the PM; never assumed", () => {
  it("the 2701 rule reads back with the clause quoted exactly", () => {
    expect(ruleProblems(RULE_2701, `4.1 Retainage. ${CLAUSE_41} 4.2 Release.`)).toEqual([]);
    expect(ruleLine(RULE_2701)).toContain("10% until 50% complete (measured on the contract sum to date), then 5% on later payments");
    expect(ruleLine(RULE_2701)).toContain(`§4.1 ‹${CLAUSE_41}› (document)`);
  });
  it("refuses a clause that isn't word for word in the contract", () => {
    expect(ruleProblems({ ...RULE_2701, clause_text: "Retain 10% until half done." }, `4.1 ${CLAUSE_41}`)[0]).toMatch(/isn't found word for word/);
  });
  it("refuses a reduction with a missing part, and a contract rule with no clause", () => {
    expect(ruleProblems({ ...RULE_2701, reduced_rate_bp: null })).toContain("A reduction needs the reduced rate, no higher than the starting rate.");
    expect(ruleProblems({ ...RULE_2701, threshold_basis: null })[0]).toMatch(/measured against/);
    expect(ruleProblems({ ...RULE_2701, clause_text: null })).toContain("Quote the retainage clause exactly, with its section number.");
  });
  it("a silent contract takes the PM's answer, and says who answered", () => {
    const pm: RetainageRule = { ...RULE_2701, source: "pm_answer", clause_section: null, clause_text: null, answered_by: null };
    expect(ruleProblems(pm)[0]).toMatch(/the rule comes from the PM/);
    expect(ruleProblems({ ...pm, answered_by: "Priya Nand" })).toEqual([]);
    expect(ruleLine({ ...pm, answered_by: "Priya Nand" })).toContain("the contract is silent; per Priya Nand (PM answer)");
  });
  it("no saved rule shows Needed, never a default rate", () => {
    expect(retainageRuleLines(null)[0]).toMatch(/^Retainage rule: Needed\./);
    expect(retainageRuleLines(null)[0]).toMatch(/no default rate/);
  });
  it("the setup direction: Athena directs, the host reads the contract or asks the PM", () => {
    expect(RETAINAGE_SETUP_RULE).toMatch(/no default rate/);
    expect(RETAINAGE_SETUP_RULE).toMatch(/copied exactly and its section number/);
    expect(RETAINAGE_SETUP_RULE).toMatch(/ask the PM/);
    const idx = readFileSync("src/lib/mcp/index.ts", "utf8");
    expect(idx).toContain("RETAINAGE_SETUP_RULE");
    expect(idx).toContain("retainageRuleSave");
  });
});

describe("phase 1 foundations", () => {
  it("approved and base_version on every new write", () => {
    expect(() => requireApproved({})).toThrow(/Nothing was saved/);
    expect(() => requireApproved({ approved: true })).not.toThrow();
    expect(() => requireBase("Ledger", 4, 3)).toThrow("Ledger moved to v4. Reload first. Nothing was saved.");
  });
  it("one role scope check: dollars and writes need full job access", () => {
    const j = (scope: "full" | "contract" | "super") => ({ job_id: "x", job_number: "2701", name: "Harbor Point", company_id: "c", scope });
    expect(() => accountingScope(j("full"), "dollars")).not.toThrow();
    expect(() => accountingScope(j("super"), "dollars")).toThrow(/read-only/);
    expect(() => accountingScope(j("contract"), "write")).toThrow(/full access/);
    expect(() => accountingScope(j("super"), "schedule_logs")).not.toThrow();
    expect(() => accountingScope(j("contract"), "schedule_logs")).toThrow();
  });
  it("stamps print in the job time zone with its label; numbers zero pad", () => {
    expect(versionStamp("2027-03-10T14:05:00Z", "America/Chicago", "Luis Ortega")).toBe("2027-03-10 08:05 CST, Luis Ortega");
    expect(seqLabel("T-", 7)).toBe("T-007");
  });
  it("retainage_rule_save is an ask-first write; contract_terms stays read-only", () => {
    const ann = (t: unknown) => (t as { annotations?: Record<string, unknown> }).annotations ?? (t as { config?: { annotations?: Record<string, unknown> } }).config?.annotations;
    expect(ann(retainageRuleSave)).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    expect(ann(contractTerms)).toMatchObject({ readOnlyHint: true });
  });
  it("the migration is additive and marked not applied", () => {
    const sql = readFileSync("supabase/migrations/20261022000000_athena_accounting_p1.sql", "utf8");
    expect(sql).toMatch(/NOT APPLIED/);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|FUNCTION)\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bALTER\s+TABLE\s+public\.mcp_(?!retainage_rules|number_sequences|record_versions)/i);
    for (const t of ["mcp_retainage_rules", "mcp_number_sequences", "mcp_record_versions"]) expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
  });
  it("house words: fragnet, never fragment; never 'prompts'; red only by the alert rule", () => {
    const src = ["accounting/retainage.ts", "accounting/payapp-math.ts", "accounting/foundations.ts", "accounting/cents.ts", "tools/accounting-tools.ts"].map((f) => readFileSync(`src/lib/mcp/${f}`, "utf8")).join("\n");
    expect(src).not.toMatch(/fragment|prompts|#DC2626|\bred\b/i);
  });
});
