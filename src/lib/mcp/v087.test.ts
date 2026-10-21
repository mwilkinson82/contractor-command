import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHART_PALETTE, SOV_CHART_RULE, SOV_DELIVERY_BLOCK, SOV_DELIVERY_STRUCTURED_CLIENT, sovChart, visibleProblems } from "./visible";
import { sweepDupNote } from "./sweep";
import { dedupeNotices } from "./contacts";
import { ATHENA_VERSION } from "./server-info-branding";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("0.8.7 owner link hard no, SOV chart, date sweep", () => {
  it("0.8.8: no owner-link hard no; shared link allowed for every audience", () => {
    const sc = SOV_DELIVERY_STRUCTURED_CLIENT as Record<string, unknown>;
    expect(sc.link_hard_no).toBeUndefined();
    expect(sc.never_offer_override).toBeUndefined();
    expect(SOV_DELIVERY_BLOCK).not.toMatch(/HARD NO|no exceptions|team only/i);
    expect(src("./tools/workflow-tools.ts")).not.toContain("SOV_LINK_HARD_NO");
  });
  it("report sov carries a required bar chart in the fixed palette", () => {
    const c = sovChart([{ item_no: "26.01", cost_code: "26-010", description: "Gear", scheduled_value: 1000, scheduled_value_display: "$1,000.00" }]);
    expect(c).toMatchObject({ required: true, type: "bar", bar_color: "#2563EB" });
    expect(c.palette).toEqual([...CHART_PALETTE]);
    expect(c.bars[0]).toMatchObject({ label: "26.01 (26-010)", value: 1000, value_display: "$1,000.00" });
    expect(SOV_CHART_RULE).toContain("#2563EB");
    const w = src("./tools/workflow-tools.ts");
    expect(w).toContain("chart: sovChart(sovLineRows(sov)),");
    expect(w).toContain("SOV_CHART_RULE,");
  });
  it("date sweep uses the same dedupe and names duplicates by Ref", () => {
    const items = [
      { id: "263acb11-0000-0000-0000-000000000000", action: "Send written delay notice (§6.2) for: Weather delay occurred today", clause_source: "§6.2 (contract)", needed_by: "2026-10-25" },
      { id: "11111111-0000-0000-0000-000000000000", action: "Send written delay notice (§6.2) for: Weather delay", clause_source: "§6.2 (contract)", needed_by: "2026-10-25" },
    ];
    const d = dedupeNotices(items);
    expect(d.items).toHaveLength(1);
    const note = sweepDupNote(d.duplicates.get(d.items[0].id));
    expect(note).toBe(" | Same notice also logged as: Ref 263AC (shown once)");
    expect(note).not.toContain("#");
    expect(sweepDupNote(d.duplicates.get(d.items[0].id), true)).toBe("");
    expect(src("./sweep.ts")).toContain("dedupeNotices(");
  });
  it("sweep shows only at job open or when asked", () => {
    const g = src("./guard.ts");
    expect(g).not.toContain("ALWAYS_SWEEP");
    expect(g).toContain("(fresh.data === true || o.sweep === true)");
    const w = src("./tools/workflow-tools.ts");
    expect(w).toContain("sweep: args.date_sweep === true");
    expect(w).toContain("Same notice also logged as: ${d.map((x) => displayRef(x))");
  });
  it("version is 0.8.7", () => expect(ATHENA_VERSION).toBe("0.8.16"));
});

