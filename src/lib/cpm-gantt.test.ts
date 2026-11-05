import { describe, expect, it } from "vitest";
import { prepareSchedule, readScheduleControl } from "./mcp/schedule-control";
import type { Activity, LivingData } from "./mcp/living";
import { ganttHtml, ganttModel, ganttSummary, viewItems, workDaysBetween } from "./cpm-gantt";
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
});
