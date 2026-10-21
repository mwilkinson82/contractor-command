import { describe, expect, it } from "vitest";
import { R3_REFUSAL, SECTIONS, asksForDollars, buildRecord, countCheck, sectionsFor } from "./accounting/project-record";

describe("Phase 6 Project Record (D9)", () => {
  it("fixed section order", () => expect(SECTIONS.map((s) => s.key)).toEqual(["summary", "contract", "schedule", "logs", "notices", "pay_apps", "ar", "ledger", "change_log"]));
  it("full scope (owner, accounting, PM on own job) sees every section with dollars", () => {
    const r = buildRecord("full", { pay_apps: { lines: ["App 03 net $118,350.00"], alerts: 1 } });
    expect(r.sections).toHaveLength(9);
    expect(r.count).toEqual({ expected: 9, got: 9, ok: true });
    expect(r.sections[5].lines[0]).toContain("$118,350.00");
  });
  it("super sees no dollar sections", () => {
    const r = buildRecord("super", { pay_apps: { lines: ["App 03 net $118,350.00"], alerts: 1 } });
    expect(r.sections.map((s) => s.key)).toEqual(["summary", "schedule", "logs", "notices", "change_log"]);
    expect(JSON.stringify(r)).not.toContain("$");
  });
  it("a dollar figure leaking into a super section is refused", () => expect(() => buildRecord("super", { logs: { lines: ["CO-002 $4,000.00"], alerts: 0 } })).toThrow(/super view/));
  it("count check catches a missing or out-of-order section", () => {
    expect(countCheck("full", sectionsFor("full").map((s) => s.key).slice(1)).ok).toBe(false);
    expect(countCheck("super", ["schedule", "summary", "logs", "notices", "change_log"]).ok).toBe(false);
  });
  it("R3: a super asking for the money gets the refusal", () => {
    expect(asksForDollars("what's the over billing on 2701?")).toBe(true);
    expect(asksForDollars("show the RFI log")).toBe(false);
    expect(R3_REFUSAL).toContain("job's PM");
  });
});
