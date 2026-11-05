import { describe, expect, it } from "vitest";
import { iorFlags, iorRollup, readIorModel } from "./ior-model";
import { renderAthenaIor } from "./ior-athena-view";
import { renderIorLayout } from "./ior-layout";
import { checkSave } from "./mcp/living";

const harbor = {
  original_contract: 3200000,
  original_cost_budget: 2720000,
  cost_growth: 0,
  actual_cost_to_date: 0,
  phase: "Middle",
  percent_complete: 58,
  baseline_completion: "2027-01-19",
  forecast_completion: "2027-03-02",
  change_orders: [
    { number: "CO-001", description: "Wine room expansion", status: "Approved", contract_amount: 145000, cost_amount: 116000 },
    { number: "CO-002", description: "Primary bath stone", status: "Approved", contract_amount: 65000, cost_amount: 52000 },
    { number: "CO-003", description: "Pool equipment relocation", status: "Pending", contract_amount: 85000, cost_amount: 70000, probability: 70 },
    { number: "CO-004", description: "Outdoor kitchen", status: "Pending", contract_amount: 120000, cost_amount: 96000, probability: 50 },
    { number: "CO-005", description: "Denied add", status: "Denied", contract_amount: 999999, cost_amount: 1 },
  ],
  exposures: [
    { title: "Window and door delivery running late", short: "Window and door delivery", category: "procurement", response: "recover", dollar_risk: 52000, probability: 60, hold: "E", owner: "PM", opened: "2026-09-02", next_review: "2026-11-12", next_move: "Get a firm ship date and send the delay notice." },
    { title: "Stone slab breakage", category: "procurement", response: "recover", dollar_risk: 38000, probability: 50, hold: "E", opened: "2026-10-06", next_review: "2026-11-18" },
    { title: "Owner lighting selections are late", short: "Lighting selections", category: "owner_decision", response: "offset", dollar_risk: 24000, probability: 50, hold: "E", opened: "2026-09-20" },
    { title: "Millwork shop drawings behind", category: "trade_performance", response: "eliminate", dollar_risk: 30000, probability: 35, hold: "E", opened: "2026-10-14", next_review: "2026-11-09" },
    { title: "Pool CO not signed", category: "owner_decision", response: "recover", dollar_risk: 18000, probability: 40, hold: "E", opened: "2026-10-22", next_review: "2026-11-15" },
    { title: "Drywall rework <after> re-inspection", category: "field_change", response: "eliminate", dollar_risk: 9000, probability: 50, hold: "E", opened: "2026-10-28", next_review: "2026-11-10" },
    { title: "Winter weather on hardscape", category: "schedule_compression", response: "accept", dollar_risk: 15000, probability: 40, hold: "C", opened: "2026-10-01", next_review: "2026-12-01" },
    { title: "Finish-phase contingency", category: "other", response: "recover", dollar_risk: 40000, probability: 100, hold: "C", opened: "2026-08-15", next_review: "2026-12-15" },
    { title: "Closed risk", category: "other", response: "recover", dollar_risk: 1000000, probability: 100, hold: "E", status: "Recovered" },
  ],
};

const TODAY = "2026-11-04";

describe("IOR model", () => {
  it("rolls up the way Overwatch does, to the dollar", () => {
    const { model, problems } = readIorModel({ ior_model: harbor });
    expect(problems).toEqual([]);
    const r = iorRollup(model!);
    expect(r.originalGP).toBe(48_000_000);
    expect(r.signedContract).toBe(341_000_000);
    expect(r.signedGP).toBe(52_200_000);
    expect(r.forecastContract).toBe(352_950_000);
    expect(r.forecastCost).toBe(298_500_000);
    expect(r.beforeHolds).toBe(54_450_000);
    expect(r.eHold).toBe(8_440_000);
    expect(r.cHold).toBe(4_600_000);
    expect(r.indicatedGP).toBe(41_410_000);
    expect(r.gap).toBe(-10_790_000);
    expect(r.eTarget).toBe(8_955_000);
    expect(r.cTarget).toBe(7_462_500);
  });

  it("raises Overwatch's warnings", () => {
    const { model } = readIorModel({ ior_model: harbor });
    const flags = iorFlags(model!, iorRollup(model!), TODAY);
    expect(flags.map((f) => f.title)).toEqual([
      "Pending change orders aren't reserved.",
      "Lighting selections has gone 45 days without a review.",
    ]);
  });

  it("flags a slip with no schedule risk logged and a missing cost budget", () => {
    const { model } = readIorModel({ ior_model: { ...harbor, original_cost_budget: 0, exposures: [] } });
    const titles = iorFlags(model!, iorRollup(model!), TODAY).map((f) => f.title);
    expect(titles).toContain("No cost budget is saved.");
    expect(titles).toContain("The schedule slipped 42 days with no schedule exposure logged.");
  });

  it("doesn't nag about a risk holding nothing, and flags reviews that have passed", () => {
    const exposures = [
      { title: "Window delivery delay", category: "procurement", response: "recover", dollar_risk: 18000, probability: 80, hold: "E", opened: "2026-07-09", next_review: "2026-07-30" },
      { title: "Lighting allowance overrun", category: "allowance_overrun", response: "offset", dollar_risk: 22000, probability: 90, hold: "E", opened: "2026-07-02", next_review: "2026-07-28" },
      { title: "Electrician contingency overrun", category: "trade_performance", response: "eliminate", dollar_risk: 0, probability: 100, hold: "C", opened: "2026-07-23", status: "accepted" },
      { title: "Stone slab breakage", category: "procurement", response: "recover", dollar_risk: 38000, probability: 50, hold: "E", opened: "2026-10-06", next_review: "2026-11-18" },
    ];
    const { model } = readIorModel({ ior_model: { ...harbor, exposures } });
    const flags = iorFlags(model!, iorRollup(model!), "2026-11-05");
    const titles = flags.map((f) => f.title);
    expect(titles.join(" ")).not.toContain("Electrician contingency overrun");
    expect(titles).toContain("2 risks are past their review date.");
    expect(flags.find((f) => f.title.startsWith("2 risks"))!.detail).toBe(
      "They hold $34,200. Furthest behind is Lighting allowance overrun, 100 days late. Review them and set new dates.",
    );
    const one = readIorModel({ ior_model: { ...harbor, exposures: [exposures[0]] } }).model!;
    expect(iorFlags(one, iorRollup(one), "2026-11-05").map((f) => f.title)).toContain("Window delivery delay is 98 days past its review.");

    const html = renderAthenaIor(model!, { today: "2026-11-05" });
    expect(html).toContain("<div class=\"rev stale\">Review overdue since Jul 30, 2026");
    expect(html).toContain("<div class=\"rev\">Next review Nov 18, 2026");
    expect(html).toContain("<div class=\"rev\">No review date set");
  });

  it("rejects a model it can't read, and the IOR save says why", () => {
    const bad = { ior_model: { ...harbor, phase: "Closeout", change_orders: [{ status: "Pending", contract_amount: 5000 }] } };
    const { model, problems } = readIorModel(bad);
    expect(model).toBeNull();
    expect(problems.join(" ")).toContain("phase must be Early, Middle or Late");
    expect(problems.join(" ")).toContain("cost_amount must be an amount");
    expect(checkSave("ior", bad as never, null, null).problems).toEqual(expect.arrayContaining(problems));
    expect(checkSave("ior", { ior_model: harbor } as never, null, null).ok).toBe(true);
  });
});

describe("Athena's IOR view", () => {
  const { model } = readIorModel({ ior_model: harbor });
  const html = renderAthenaIor(model!, { today: TODAY, version: 4, dataDate: "2026-11-02" });

  it("leads with Athena's read in dollars", () => {
    expect(html).toContain("Profit is tracking <span class=\"neg\">$107,900 under</span> the deal you signed.");
    expect(html).toContain("Indicated margin is <b>11.7%</b> against <b>15.3%</b> signed.");
    expect(html).toContain("IOR v4 · data date Nov 2, 2026 · Middle phase, 58% complete");
  });

  it("shows each risk's held amount and Athena's next move, escaped", () => {
    expect(html).toContain("$52,000 × 60% = <b>$31,200</b> held");
    expect(html).toContain("Athena's next move");
    expect(html).toContain("Drywall rework &lt;after&gt; re-inspection");
    expect(html).not.toContain("<after>");
    expect(html).not.toContain("Closed risk");
    expect(html).toContain("8 open");
  });

  it("shows the finish date, the hold guide and the math", () => {
    expect(html).toContain("42 days late</span> against baseline.");
    expect(html).toContain("$5,150 short of the 3% I'd hold this phase.");
    expect(html).toContain("Risk-adjusted contract</span><span>$3,529,500");
    expect(html).toContain("@container ior (max-width:620px)");
    expect(html).not.toContain("<script");
  });

  it("says plainly when there is no cost budget", () => {
    const { model: noCost } = readIorModel({ ior_model: { ...harbor, original_cost_budget: null } });
    const page = renderAthenaIor(noCost!, { today: TODAY });
    expect(page).toContain("I can't read profit on this job yet.");
    expect(page).not.toContain("100.0%");
  });

  it("never puts today before the IOR's data date", () => {
    const page = renderIorLayout({ report: { scope: "full", version: 1, data_date: "2026-11-05", data: { ior_model: harbor } }, today: "2026-11-04" });
    expect(page).toContain("aria-label=\"Today Nov 5, 2026");
    const later = renderIorLayout({ report: { scope: "full", version: 1, data_date: "2026-11-05", data: { ior_model: harbor } }, today: "2026-11-09" });
    expect(later).toContain("aria-label=\"Today Nov 9, 2026");
  });

  it("replaces the saved-field layout only when the report carries a model and money is allowed", () => {
    const full = renderIorLayout({ report: { scope: "full", version: 4, data: { ior_model: harbor } }, today: TODAY });
    expect(full).toContain("class=\"ath-ior\"");
    const limited = renderIorLayout({ report: { scope: "limited", version: 4, data: { ior_model: harbor } }, today: TODAY });
    expect(limited).not.toContain("ath-ior");
    expect(limited).not.toContain("$107,900");
    expect(limited).not.toContain("Window and door delivery");
    const old = renderIorLayout({ report: { scope: "full", version: 2, data: { kpis: { contract: 1000 } } } });
    expect(old).not.toContain("class=\"ath-ior\"");
  });
});

describe("IOR in chat", () => {
  it("gives the same numbers as the page", async () => {
    const { iorSectionsText } = await import("./mcp/living");
    const text = iorSectionsText({ ior_model: harbor }).join("\n");
    expect(text).toContain("Indicated gross profit: $414,100 · 11.7%");
    expect(text).toContain("Gap to signed: −$107,900");
    expect(text).toContain("Window and door delivery running late · E-hold · $52,000 × 60% = $31,200 held");
    expect(text).not.toContain("Ior Model");
  });
});
