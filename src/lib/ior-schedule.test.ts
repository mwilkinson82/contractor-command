import { describe, expect, it } from "vitest";
import { prepareSchedule } from "./mcp/schedule-control";
import type { Activity, LivingData } from "./mcp/living";
import { cpmFinish } from "./ior-schedule";
import { iorFlags, iorModelText, iorRollup, readIorModel, withCpmFinish } from "./ior-model";
import { renderIorLayout } from "./ior-layout";

const act = (
  id: string,
  duration: number,
  preds: string[],
  extra: Partial<Activity> = {},
): Activity => ({
  id,
  name: `Activity ${id}`,
  duration,
  start: null,
  finish: null,
  predecessors: preds.map((p) => ({ id: p, type: "FS" })),
  total_float: null,
  critical: null,
  pct_complete: 0,
  value: null,
  sov_line: null,
  cost_code: null,
  ...extra,
});

// Fictional network: A → B → C → End. Baseline finishes Mar 19; B started late, so the
// recalculated forecast finishes Mar 20, one working day behind.
function cpm(opts: { baseline?: boolean } = {}): LivingData {
  let data = prepareSchedule(null, 0, {
    operation: "recalculate",
    data_date: "2026-03-02",
    starter_wbs: true,
    settings: {
      project_start: "2026-03-02",
      default_calendar_id: "work",
      calendars: [
        { id: "work", name: "Mon to Fri", work_days: 62, holidays: [], hours_per_day: 8 },
      ],
      finish_convention: "inclusive-last-work-day",
      out_of_sequence: "retained-logic",
    },
    initial_activities: [
      act("A", 3, [], { wbs_id: "general-requirements" }),
      act("B", 5, ["A"], { wbs_id: "construction" }),
      act("C", 5, ["B"], { wbs_id: "construction" }),
      act("End", 0, ["C"], { wbs_id: "closeout" }),
    ],
  }).data;
  let v = 1;
  if (opts.baseline !== false) {
    data = prepareSchedule(data, v++, {
      operation: "baseline",
      data_date: "2026-03-02",
      baseline: { id: "BL1", name: "Fictional baseline", status: "accepted" },
    }).data;
  }
  data = prepareSchedule(data, v, {
    operation: "recalculate",
    data_date: "2026-03-09",
    updates: [
      {
        id: "A",
        actual_start: "2026-03-02",
        actual_finish: "2026-03-04",
        remaining_duration: 0,
        pct_complete: 100,
      },
      { id: "B", actual_start: "2026-03-05", remaining_duration: 4, pct_complete: 20 },
    ],
  }).data;
  return data as LivingData;
}

const report = (data: LivingData, contract: string | null = null) => ({
  found: true,
  version: 4,
  data_date: "2026-03-09",
  contract_completion_date: contract,
  data,
});

// An IOR whose imported dates say the job finishes in 2027, 42 days late.
const ior = {
  original_contract: 3200000,
  original_cost_budget: 2720000,
  cost_growth: 0,
  actual_cost_to_date: 0,
  phase: "Middle",
  percent_complete: 60,
  baseline_completion: "2027-01-19",
  forecast_completion: "2027-03-02",
  last_forecast_completion: "2027-02-20",
  change_orders: [],
  exposures: [
    {
      title: "Lighting allowance overrun",
      category: "allowance_overrun",
      response: "offset",
      dollar_risk: 22000,
      probability: 90,
      hold: "E",
      opened: "2026-02-20",
      next_review: "2026-03-20",
    },
  ],
};
const TODAY = "2026-03-10";

describe("IOR finish from the CPM", () => {
  it("reads the CPM's logic-driven forecast against its baseline finish", () => {
    const f = cpmFinish(report(cpm(), "2026-03-20"))!;
    expect(f).toMatchObject({
      forecast: "2026-03-20",
      against: "2026-03-19",
      againstKind: "baseline",
      workDays: 1,
      version: 4,
      dataDate: "2026-03-09",
    });
  });

  it("measures against the contract completion when the CPM has no baseline", () => {
    const f = cpmFinish(report(cpm({ baseline: false }), "2026-03-23"))!;
    expect(f.forecast).toBe("2026-03-20");
    expect(f).toMatchObject({ against: "2026-03-23", againstKind: "contract", workDays: -1 });
  });

  it("uses a reported schedule's last finish when it isn't calculated", () => {
    const data = {
      activities: [
        act("A", 3, [], { start: "2026-03-02", finish: "2026-03-04" }),
        act("B", 5, ["A"], { start: "2026-03-05", finish: "2026-03-25" }),
      ],
    } as LivingData;
    expect(cpmFinish(report(data, "2026-03-20"))).toMatchObject({
      forecast: "2026-03-25",
      against: "2026-03-20",
      againstKind: "contract",
      workDays: null,
    });
  });

  it("returns nothing for a job with no schedule, so the IOR keeps its own dates", () => {
    expect(cpmFinish(null)).toBeNull();
    expect(cpmFinish({ found: false })).toBeNull();
    expect(cpmFinish(report({ activities: [] } as unknown as LivingData))).toBeNull();
    const { model } = readIorModel({ ior_model: ior });
    expect(withCpmFinish(model!, null)).toBe(model);
  });

  it("puts the CPM finish on the IOR page in place of the imported dates", () => {
    const html = renderIorLayout({
      report: { scope: "full", version: 2, data: { ior_model: ior } },
      today: TODAY,
      schedule: report(cpm(), "2026-03-20"),
    });
    expect(html).toContain("1 working day late</span> against the baseline finish.");
    expect(html).toContain("From the CPM v4");
    expect(html).toContain("Baseline finish <b>");
    expect(html).not.toContain("42 days");
    expect(html).not.toContain("since the last IOR");
  });

  it("keeps the imported dates on the page when the job has no CPM", () => {
    const html = renderIorLayout({
      report: { scope: "full", version: 2, data: { ior_model: ior } },
      today: TODAY,
    });
    expect(html).toContain("42 days late</span> against the baseline.");
  });

  it("gives chat the same finish, and flags the slip in working days", () => {
    const { model } = readIorModel({ ior_model: ior });
    const m = withCpmFinish(model!, cpmFinish(report(cpm(), "2026-03-20")));
    const text = iorModelText(m, TODAY).join("\n");
    expect(text).toContain(
      "Finish (from the CPM v4, data date 2026-03-09; it outranks the imported dates): forecast 2026-03-20, baseline finish 2026-03-19 (1 working day late)",
    );
    expect(text).not.toContain("2027-03-02");
    const titles = iorFlags(m, iorRollup(m), TODAY).map((f) => f.title);
    expect(titles).toContain(
      "The schedule slipped 1 working day with no schedule exposure logged.",
    );
  });

  it("reaches chat through the IOR tool text", async () => {
    const { iorSectionsText } = await import("./mcp/living");
    const text = iorSectionsText({ ior_model: ior }, { cpm: cpmFinish(report(cpm())) }).join("\n");
    expect(text).toContain("forecast 2026-03-20, baseline finish 2026-03-19 (1 working day late)");
  });
});
