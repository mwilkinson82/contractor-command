import { describe, expect, it } from "vitest";
import { isNoneAnswer, mergeScopeFacts, visibleLookaheads } from "./lookahead-items";
import { clauseFlag } from "./clauses";
import { withoutContactPii } from "./client-safe";
import { clientCopy } from "./jobs";
import { buildSov } from "./sov";

describe("2701 unit fixes", () => {
  it("bug 3: 'none'/'no' list answers with an explanation open nothing; real lists still do", () => {
    for (const t of ["none", "None.", "No", "N/A", "None. Underground conduit starts 2026-11-12 after GC pad compaction.", "None block work in this window. S-001 due 2026-11-19.", "No — all released"]) expect(isNoneAnswer(t), t).toBe(true);
    for (const t of ["RFI-001 open", "No permits pulled yet for the slab", "None of the switchgear submittals are approved", "Nobody assigned"]) expect(isNoneAnswer(t), t).toBe(false);
  });
  it("bug 9: the setup container is not a listed lookahead", () => {
    expect(visibleLookaheads([{ id: "a", inputs: { kind: "setup" } }, { id: "b", inputs: { crews: "x" } }, { id: "c", inputs: null }]).map((r) => r.id)).toEqual(["b", "c"]);
  });
  it("bug 8: a partial scope update merges", () => {
    const prior = [{ key: "job_type", value: "Electrical", status: "known" }, { key: "key_clauses", value: { retainage: "yes", beneficial_use: "no" }, status: "known" }];
    const out = mergeScopeFacts({ job_type: undefined, sector: undefined, scope_summary: "x", key_clauses: { notice: "yes" } }, prior);
    expect(out).toEqual({ sector: null, scope_summary: "x", key_clauses: { retainage: "yes", beneficial_use: "no", notice: "yes" } });
  });
  it("bug 8: 'None in the subcontract.' beneficial use reads no", () => {
    expect(clauseFlag("None in the subcontract.")).toBe("no");
    expect(clauseFlag("None in the contract (lump sum).")).toBe("no");
    expect(clauseFlag("§9.3 Owner may occupy portions before Substantial Completion")).toBe("yes");
  });
  it("bug 6: client copy drops contact details (the summary tag is kept pending Marshall's call)", () => {
    const t = clientCopy("   - retainage: §4.1 10% (summary, not verified against the contract text)\n   - Deliveries: Gulf Coast, contact Dana Whitfield (dana.whitfield@example.com)");
    expect(t).toContain("(summary, not verified against the contract text)");
    expect(t).not.toMatch(/@/);
    expect(t).toContain("contact Dana Whitfield");
    expect(withoutContactPii("Call (361) 555-0142 or +1 361 555 0142")).toBe("Call [contact withheld] or [contact withheld]");
    expect(withoutContactPii("Marcus Hale (Superintendent, marcus.hale@example.com).")).toBe("Marcus Hale (Superintendent).");
  });
  it("bug 7: the fee is added on top of the lines (reference method); fee 0 keeps the contract sum equal to the lines", () => {
    const lines = [{ item_no: "26.01", description: "x", scheduled_value: 700000 }, { item_no: "26.02", description: "y", scheduled_value: 700000 }];
    expect(buildSov(lines, 0, 10).summary.contract_total).toBe(1400000);
    expect(buildSov(lines, 15, 10).summary.contract_total).toBeGreaterThan(1400000);
  });
});
