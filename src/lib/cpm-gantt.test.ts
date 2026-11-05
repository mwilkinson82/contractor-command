import { describe, expect, it } from "vitest";
import { prepareSchedule, readScheduleControl } from "./mcp/schedule-control";
import type { Activity, LivingData } from "./mcp/living";
import {
  compareActivities,
  comparisonHtml,
  ganttHtml,
  ganttModel,
  ganttSummary,
  milestoneHtml,
  viewItems,
  workDaysBetween,
} from "./cpm-gantt";
import {
  renderReportBody,
  renderReportDocument,
  REPORT_PAGE_HEADERS,
  type JobPayload,
} from "./report-pages";

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
// Fictional network: A → B → C → End is the longest path; X hangs off A with 4 WD float; Y has 6.
function network() {
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
      act("A", 3, [], { wbs_id: "general-requirements", cost_code: "01-100" }),
      act("B", 5, ["A"], { wbs_id: "construction", cost_code: "03-300" }),
      act("C", 5, ["B"], { wbs_id: "construction", cost_code: "03-300" }),
      act("X", 6, ["A"], { wbs_id: "construction", cost_code: "05-100" }),
      act("Y", 4, ["A"], { wbs_id: "procurement" }),
      act("End", 0, ["C", "X", "Y"], { wbs_id: "closeout" }),
    ],
  }).data;
  data = prepareSchedule(data, 1, {
    operation: "baseline",
    data_date: "2026-03-02",
    baseline: { id: "BL1", name: "Fictional baseline", status: "accepted" },
  }).data;
  data = prepareSchedule(data, 2, {
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
const input = () => {
  const data = network();
  return {
    data,
    control: readScheduleControl(data)!,
    dataDate: "2026-03-09",
    contractCompletion: "2026-03-20",
  };
};
const view = (html: string, v: string) =>
  html.split(`<div class="cpmv" data-view="${v}"`)[1]?.split('<div class="cpmv"')[0] ?? "";

describe("calculated schedule page", () => {
  it("draws the longest path, float paths and driving logic from the saved calculation", () => {
    const i = input();
    const m = ganttModel(i);
    expect(m.floatPaths[0].activity_ids).toEqual(["B", "C", "End"]);
    expect(viewItems(m, "longest").map((it) => (it.kind === "act" ? it.r.a.id : "group"))).toEqual([
      "B",
      "C",
      "End",
    ]);
    const html = ganttHtml(i);
    // Four views, one per pill, all drawn server side.
    for (const v of ["all", "longest", "paths", "tf0"]) expect(html).toContain(`id="cpm-v-${v}"`);
    expect(view(html, "longest")).not.toContain('data-activity="X"');
    expect(view(html, "paths")).toContain("Float path 1 · longest path");
    expect(view(html, "paths")).toContain("Float path 2");
    // Driving ties on the longest path are red; a tie that does not drive is dashed gray.
    expect(view(html, "all")).toMatch(/class="cpm-k-c" data-logic-from="B" data-logic-to="C"/);
    expect(view(html, "all")).toMatch(/class="cpm-k-n" data-logic-from="Y" data-logic-to="End"/);
    // Remaining work on the longest path is red, positive float green with a float bar.
    expect(view(html, "all")).toMatch(
      /data-activity="C"[^]*?data-bar="remaining" style="[^"]*background:#C8322B/,
    );
    expect(view(html, "all")).toMatch(/data-activity="Y"[^]*?data-bar="float"/);
    // In-progress work shows the actual period up to the data date, then the remaining bar.
    expect(view(html, "all")).toMatch(
      /data-activity="B"[^]*?data-bar="actual"[^]*?data-bar="remaining"/,
    );
    expect(html).not.toContain("NaN");
  });

  it("filters by WBS and cost code and toggles layers with CSS only", () => {
    const html = ganttHtml(input());
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('<select id="cpm-wbs">');
    expect(html).toContain('<select id="cpm-cc">');
    expect(html).toContain('<option value="c1">03-300</option>');
    expect(html).toMatch(
      /#cpm-cc option\[value="c1"\]:checked\) \.cpm-body \.cpm-row:not\(\[data-cc~="c1"\]\)\{display:none\}/,
    );
    expect(html).toContain("#cpm-lg:not(:checked)) .cpm-logic{display:none}");
    // Logic hides under a filter so no line points at a hidden row.
    expect(html).toContain('#cpm-wbs option:not([value=""]):checked) .cpm-logic');
    // Every activity has an inspector the name opens without scripts.
    expect(html).toMatch(/href="#cpm-a-2"/);
    expect(html).toMatch(/<section class="cpm-insp" id="cpm-a-2"[^]*?Predecessors[^]*?Driving/);
  });

  it("states completion against the contract and baseline on the project calendar", () => {
    const s = ganttSummary(ganttModel(input()));
    expect(s.driverId).toBe("B");
    expect(s.pathCount).toBeGreaterThanOrEqual(2);
    expect(s.longestLine).toMatch(/^B Activity B → C → End, total float/);
    const cal = {
      name: "Mon to Fri",
      works: (t: number) => ![0, 6].includes(new Date(t).getUTCDay()),
    };
    expect(
      workDaysBetween(Date.parse("2026-03-06T00:00:00Z"), Date.parse("2026-03-09T00:00:00Z"), cal),
    ).toBe(1);
    expect(
      workDaysBetween(Date.parse("2026-03-09T00:00:00Z"), Date.parse("2026-03-06T00:00:00Z"), cal),
    ).toBe(-1);
  });

  it("puts the page on calculated schedules only, scrolls sideways and stays inside the share policy", () => {
    const i = input();
    const payload: JobPayload = {
      page: "schedule",
      job_number: "QA-1",
      job_name: "Fictional",
      report: {
        found: true,
        version: 3,
        data_date: i.dataDate,
        contract_completion_date: i.contractCompletion,
        data: i.data,
      },
    };
    const html = renderReportBody(payload);
    expect(html).toContain('class="cpmx" id="cpm-gantt"');
    expect(html).toContain("Longest path:");
    expect(html).toContain("overflow-x:auto");
    expect(html).toContain("position:sticky;left:0");
    expect(html).toMatch(/@media\(max-width:559px\)/);
    expect(html).toMatch(/@media print\{@page\{size:17in 11in/);
    expect(REPORT_PAGE_HEADERS["content-security-policy"]).not.toContain("script-src");
    expect(renderReportDocument(payload)).not.toMatch(/<script/i);
    // Reported-only schedules keep their table.
    const legacy = renderReportBody({
      ...payload,
      report: { ...payload.report, data: { activities: i.data.activities } },
    });
    expect(legacy).not.toContain("cpm-gantt");
    expect(legacy).toContain('class="ath-cpm"');
  });

  it("escapes activity names everywhere they appear", () => {
    const i = input();
    i.data.activities![0].name = '<img src=x onerror="alert(1)">';
    const html = ganttHtml(i);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("keeps the last update so the page compares update against update", () => {
    const first = network();
    const control = readScheduleControl(first)!;
    // The update at Mar 9 kept the Mar 2 calculation as its prior update.
    expect(control.prior_update?.data_date).toBe("2026-03-02");
    expect(
      control.prior_update?.activities.find((a) => a.id === "B")?.actual_start ?? null,
    ).toBeNull();
    // A later update slips C by two days of extra work.
    const next = prepareSchedule(first, 3, {
      operation: "recalculate",
      data_date: "2026-03-16",
      updates: [
        {
          id: "B",
          actual_start: "2026-03-05",
          actual_finish: "2026-03-13",
          remaining_duration: 0,
          pct_complete: 100,
        },
        { id: "C", duration: 7 },
      ],
    }).data as LivingData;
    const c2 = readScheduleControl(next)!;
    expect(c2.prior_update?.data_date).toBe("2026-03-09");
    const i = { data: next, control: c2, dataDate: "2026-03-16", contractCompletion: "2026-03-20" };
    const m = ganttModel(i);
    const changes = compareActivities(m, c2.prior_update!.activities);
    const c = changes.find((x) => x.id === "C")!;
    expect(c.notes).toContain("Duration 5 → 7 WD");
    expect(c.finish_variance).toBeGreaterThan(0);
    expect(changes.find((x) => x.id === "B")!.notes).toContain("Finished");
    // Biggest slip first.
    expect(changes[0].finish_variance).toBe(
      Math.max(...changes.map((x) => x.finish_variance ?? -99)),
    );
    const html = comparisonHtml(i);
    expect(html).toContain('id="cpmc-b"');
    expect(html).toContain('id="cpmc-p"');
    expect(html).toContain("Against the last update (data date 03/09/26)");
    expect(html).toMatch(/data-change="C"/);
    // The Gantt can draw the last update's bars instead of the baseline's.
    const g = ganttHtml(i);
    expect(g).toContain('<option value="p">Last update: 03/09/26</option>');
    expect(g).toContain('data-bar="prior-update"');
    // A same-date revision keeps the prior update it already had.
    const same = prepareSchedule(next, 4, {
      operation: "recalculate",
      data_date: "2026-03-16",
      updates: [{ id: "Y", duration: 5 }],
    }).data;
    expect(readScheduleControl(same)!.prior_update?.data_date).toBe("2026-03-09");
  });

  it("reports milestones against the baseline and the last update", () => {
    const html = milestoneHtml(input());
    expect(html).toContain('data-milestone-row="End"');
    expect(html).toContain('<th class="cpm-n">Last update</th>');
    expect(html).not.toContain("NaN");
    const page = renderReportBody({
      page: "schedule",
      job_number: "QA-1",
      report: { found: true, version: 3, data_date: "2026-03-09", data: input().data },
    });
    expect(page).toContain("MILESTONES");
    expect(page).toContain("UPDATE COMPARISON");
  });
});
