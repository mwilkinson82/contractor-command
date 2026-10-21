import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ATHENA_VERSION } from "./server-info-branding";
import { CHART_PALETTE, splitGuidance, visibleProblems } from "./visible";
import {
  CPM_REQUIRED_TOP, LIVING_REQUIRED_TOP, activityLine, billableValue, calendarDays, checkSave, costLoadTotal, countCheck,
  earnedToDate, isOwnerFurnished, remainingForecast, stripMoney, tiaResult, tieCheck, type Activity,
} from "./living";
import { cpmActivities, livingReportGet, livingReportSave } from "./tools/living-tools";

const src = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
const ann = (t: unknown) => (t as { annotations?: Record<string, unknown> }).annotations ?? (t as { config?: { annotations?: Record<string, unknown> } }).config?.annotations;
const act = (id: string, value: number, extra: Partial<Activity> = {}): Activity => ({
  id, name: `Activity ${id}`, duration: 10, start: "2027-03-01", finish: "2027-03-12", predecessors: [], total_float: 0, critical: true,
  pct_complete: 0, value, sov_line: "26.01", cost_code: "26-010", ...extra,
});
// 39 activities that tie to $1,400,000.00: 38 × $35,000.00 + $70,000.00.
const job2701 = (): Activity[] => [...Array.from({ length: 38 }, (_, i) => act(`A${1000 + i * 10}`, 35_000)), act("A1390", 70_000)];

describe("0.8.9 CPM activity handoff, tie guard, owner-furnished, living reports", () => {
  it("version is 0.8.9", () => expect(ATHENA_VERSION).toBe("0.8.12"));

  it("count check reads 39 of 39 with the allocated total, and names undated activities", () => {
    const acts = job2701();
    expect(countCheck(acts).line).toBe("39 of 39 activities dated, $1,400,000.00 allocated.");
    acts[3] = { ...acts[3], start: null };
    const c = countCheck(acts);
    expect(c.complete).toBe(false);
    expect(c.missing).toEqual(["A1030"]);
    expect(c.line).toMatch(/^38 of 39/);
  });

  it("tie line: equal to the cent, or 'Doesn't tie: off by $X'", () => {
    expect(tieCheck(1_400_000, 1_400_000).line).toBe("Forecast total $1,400,000.00 = contract $1,400,000.00");
    const over = tieCheck(1_409_384.62, 1_400_000);
    expect(over.ties).toBe(false);
    expect(over.off_by).toBe(9384.62);
    expect(over.line).toMatch(/^Doesn't tie: off by \$9,384\.62 \(over the contract/);
    expect(tieCheck(1, null).line).toMatch(/contract value Needed/);
  });

  it("remaining forecast = contract − the higher of billed and earned (the $9,384.62 case)", () => {
    expect(remainingForecast(1_400_000, 532_000, 541_384.62)).toBe(858_615.38);
    expect(remainingForecast(1_400_000, 560_000, 541_384.62)).toBe(840_000);
  });

  it("owner-furnished work is $0.00 in ALP billing, by flag or by name", () => {
    const gear = act("A1060", 15_750, { name: "Owner-furnished main switchgear delivery" });
    expect(isOwnerFurnished(gear)).toBe(true);
    expect(billableValue(gear)).toBe(0);
    expect(isOwnerFurnished(act("A1061", 1, { owner_furnished: true }))).toBe(true);
    expect(isOwnerFurnished(act("A1062", 1, { name: "Owner-furnished gear", owner_furnished: false }))).toBe(false);
    expect(isOwnerFurnished(act("A1210", 1, { name: "Switchgear set and terminate" }))).toBe(false);
    expect(activityLine(gear, true)).toContain("owner-furnished, $0.00 in ALP billing");
    expect(earnedToDate([{ ...gear, pct_complete: 60 }])).toBe(0);
  });

  it("a baseline that bills the owner's switchgear as ALP work is refused, naming it", () => {
    const acts = job2701();
    acts[6] = act("A1060", 35_000 - 19_250, { name: "Owner-furnished switchgear delivery" }); // $15,750.00
    acts[7] = act("A1070", 35_000 + 19_250 - 15_750 + 15_750); // keeps the raw sum at $1,400,000.00
    expect(acts.reduce((s, a) => s + (a.value ?? 0), 0)).toBe(1_400_000);
    expect(costLoadTotal(acts)).toBe(1_384_250);
    const r = checkSave("cpm", { activities: acts }, null, 1_400_000);
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toContain("off by $15,750.00");
    expect(r.problems.join("\n")).toContain("A1060 Owner-furnished switchgear delivery ($15,750.00)");
  });

  it("save checks: refuses dropped activities and an over-contract forecast; accepts a tied update", () => {
    const prev = { activities: job2701() };
    expect(checkSave("cpm", { activities: job2701() }, prev, 1_400_000).ok).toBe(true);
    const dropped = checkSave("cpm", { activities: job2701().slice(0, 38) }, prev, 1_400_000);
    expect(dropped.ok).toBe(false);
    expect(dropped.problems[0]).toContain("drops 1 activity (A1390)");
    const months = [{ month: "2027-02", amount: 541_384.62, kind: "actual" as const }, { month: "2027-03", amount: 868_000, kind: "forecast" as const }];
    const bad = checkSave("billing_forecast", { activities: job2701(), billing: { months } }, prev, 1_400_000);
    expect(bad.ok).toBe(false);
    expect(bad.problems.join(" ")).toContain("off by $9,384.62");
    const good = checkSave("billing_forecast", { activities: job2701(), billing: { months: [months[0], { ...months[1], amount: 858_615.38 }] } }, prev, 1_400_000);
    expect(good.ok).toBe(true);
    expect(good.tie!.line).toBe("Forecast total $1,400,000.00 = contract $1,400,000.00");
    expect(checkSave("cpm", { activities: job2701() }, null, null).ok).toBe(false);
    expect(checkSave("ior", { items: [] }, null, null).ok).toBe(true);
  });

  it("TIA result is computed from the saved dates, never typed in", () => {
    expect(calendarDays("2027-06-04", "2027-06-19")).toBe(15);
    const t = tiaResult({ fragnet: "FRAG-01", prior_completion: "2027-06-04", updated_completion: "2027-06-19", fragnet_only_completion: "2027-06-11" })!;
    expect(t.impact_cd).toBe(15);
    expect(t.fragnet_only_cd).toBe(8);
    expect(t.math).toBe("Updated completion Jun 19, 2027 − prior completion Jun 4, 2027. Fragnet-only impact: Jun 19, 2027 − Jun 11, 2027 = 8 CD.");
    expect(tiaResult({ fragnet: "FRAG-02", prior_completion: "2027-06-04", updated_completion: "2027-06-04" })!.statement).toBe("Completion delay: +0 WD (0 CD): float absorbed it.");
    expect(tiaResult(null)).toBeNull();
  });

  it("supers get the schedule with no dollars", () => {
    const s = stripMoney({ activities: job2701(), billing: { months: [] }, kpis: { x: 1 } } as never);
    expect(s.activities!.every((a) => a.value === null)).toBe(true);
    expect(s).not.toHaveProperty("billing");
    expect(s).not.toHaveProperty("kpis");
    expect(activityLine(job2701()[0], false)).not.toContain("$");
  });

  it("REQUIRED lines lead the visible text and stay visible", () => {
    for (const top of [CPM_REQUIRED_TOP, LIVING_REQUIRED_TOP]) {
      for (const l of top.split("\n")) expect(l).toMatch(/^REQUIRED: /);
      expect(splitGuidance(`${top}\nbody`).visible.startsWith(top)).toBe(true);
      expect(visibleProblems(top)).toEqual([]);
    }
    expect(CPM_REQUIRED_TOP).toMatch(/never type in your own/);
    expect(src("./tools/living-tools.ts")).toContain("CPM_REQUIRED_TOP,\n        `${prefix(job)}");
  });

  it("activity lines carry every field the host needs", () => {
    const l = activityLine(act("A1210", 103_054.71, { name: "Switchgear set and terminate", predecessors: [{ id: "A1060" }, { id: "FRAG-01", type: "SS", lag: 2 }], total_float: 3, critical: false, pct_complete: 0 }), true);
    expect(l).toBe("- A1210 Switchgear set and terminate · 10 WD · 2027-03-01 → 2027-03-12 · after A1060, FRAG-01 SS +2 · float 3 · 0% complete · $103,054.71 · SOV 26.01 · cost code 26-010");
    expect(visibleProblems(l)).toEqual([]);
  });

  it("tool annotations: two reads, one ask-first destructive save that needs approved: true", () => {
    expect(ann(cpmActivities)).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(ann(livingReportGet)).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(ann(livingReportSave)).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
    const m = JSON.parse(readFileSync(".lovable/mcp/manifest.json", "utf8")) as { mcp: { tools: { name: string; description: string; inputSchema: { required?: string[] } }[] } };
    const save = m.mcp.tools.find((t) => t.name === "living_report_save")!;
    expect(save.inputSchema.required).toEqual(expect.arrayContaining(["approved", "base_version", "what_changed", "report_type", "job_number"]));
    for (const n of ["cpm_activities", "living_report_get", "living_report_save"]) expect(m.mcp.tools.find((t) => t.name === n)!.description).toMatch(/^REQUIRED: /);
  });

  it("server wires the three tools and the instructions lead with the CPM rule; palette unchanged (no red)", () => {
    const idx = src("./index.ts");
    expect(idx).toContain("cpmActivities, livingReportGet, livingReportSave, fileShare, fileShareRevoke]");
    expect(idx).toContain('construction agents. " + GREETING_RULE + " REQUIRED: before drawing or updating a cost-loaded CPM');
    expect(idx).toContain("never rose, pink or orange");
    expect(idx).toContain("ALERT_PALETTE_RULE");
    expect(idx).not.toMatch(/never red/i);
    expect([...CHART_PALETTE]).toEqual(["#2563EB", "#6B7280", "#9CA3AF", "#D1D5DB", "#F3F4F6"]);
  });

  it("migration is additive: one column, one append-only table, full-scope reads, Super strip, save re-checks", () => {
    const sql = readFileSync("supabase/migrations/20261020213000_athena_living_reports.sql", "utf8");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS contract_completion_date date");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.mcp_living_reports");
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)|\bDELETE\s+FROM|\bTRUNCATE/i);
    expect(sql).not.toMatch(/FOR (INSERT|UPDATE|DELETE)/);
    expect(sql).toContain("mcp_living_strip_money");
    expect(sql).toContain("drops activities");
    expect(sql).toContain("doesn''t tie to the contract");
  });
});

import { REPORT_SHARE_STRUCTURED, SHARE_OPTIONS_REQUIRED, EMAIL_TO_LABEL_REQUIRED, sovChart, SOV_DELIVERY_STRUCTURED } from "./visible";
describe("0.8.9 retest fixes", () => {
  it("SOV bars alternate blue and gray", () => {
    const c = sovChart([1, 2, 3].map((n) => ({ item_no: `${n}`, cost_code: null, description: null, scheduled_value: n, scheduled_value_display: `$${n}.00` })));
    expect(c.bars.map((b) => b.color)).toEqual(["#2563EB", "#9CA3AF", "#2563EB"]);
  });
  it("share, sweep and To: REQUIRED lines", () => {
    expect(SHARE_OPTIONS_REQUIRED).toMatch(/^REQUIRED: .*all 3 sharing options.*Never recommend/);
    expect(EMAIL_TO_LABEL_REQUIRED).toContain('"To:"');
    expect(REPORT_SHARE_STRUCTURED.options).toHaveLength(3);
    expect(SOV_DELIVERY_STRUCTURED.never_recommend_one).toBe(true);
  });
});
