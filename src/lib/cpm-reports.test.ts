import { describe, expect, it } from "vitest";
import { prepareSchedule, readScheduleControl } from "./mcp/schedule-control";
import type { Activity, LivingData } from "./mcp/living";
import {
  healthHtml,
  lookaheadByPath,
  lookaheadHtml,
  narrativeHtml,
  scheduleHealth,
  scheduleNarrative,
} from "./cpm-reports";
import { renderReportBody } from "./report-pages";
import { ganttModel, ganttSummary } from "./cpm-gantt";

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

describe("schedule reports", () => {
  it("runs the DCMA 14-point checks on remaining work", () => {
    const checks = scheduleHealth(input());
    expect(checks.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    const by = (id: number) => checks.find((c) => c.id === id)!;
    expect(by(1).status).toBe("pass");
    expect(by(2).status).toBe("pass");
    expect(by(4).value).toBe(100);
    expect(by(7).status).toBe("pass");
    expect(by(9).status).toBe("pass");
    expect(by(10).status).toBe("not-run");
    // A was due by the Mar 9 data date on the baseline and finished on time.
    expect(by(11)).toMatchObject({ status: "pass", count: 0 });
    expect(by(14).value).toBe(1);
    expect(by(12).status).toBe("pass");
    expect(by(13).value).not.toBeNull();
    const html = healthHtml(input());
    expect(html).toContain("SCHEDULE HEALTH (DCMA 14-POINT)");
    expect(html).not.toContain("NaN");
  });

  it("flags leads, open ends and missing baselines", () => {
    const i = input();
    const y = i.data.activities!.find((a) => a.id === "Y")!;
    y.predecessors = [{ id: "A", type: "FS", lag: -2 }];
    const x = i.data.activities!.find((a) => a.id === "X")!;
    // X loses its successor: an open end.
    i.data.activities!.find((a) => a.id === "End")!.predecessors = [
      { id: "C", type: "FS" },
      { id: "Y", type: "FS" },
    ];
    expect(x.id).toBe("X");
    const c = scheduleHealth(i);
    expect(c.find((h) => h.id === 2)).toMatchObject({ status: "fail", activity_ids: ["Y"] });
    expect(c.find((h) => h.id === 1)!.activity_ids).toContain("X");
    const noBase = {
      ...i,
      control: { ...i.control, baselines: [], active_baseline_id: undefined },
    };
    expect(scheduleHealth(noBase).find((h) => h.id === 14)!.status).toBe("not-run");
  });

  it("groups the lookahead by float path, longest path first", () => {
    const groups = lookaheadByPath(input());
    expect(groups[0].label).toBe("Longest path");
    expect(groups[0].rows.map((r) => r.a.id)).toContain("B");
    expect(lookaheadHtml(input())).toContain("3-WEEK LOOKAHEAD BY PATH");
  });

  it("writes the narrative from saved results only", () => {
    const paras = scheduleNarrative(input());
    expect(paras[0]).toMatch(
      /^As of the 03\/09\/26 data date, the schedule forecasts completion on /,
    );
    expect(paras[0]).toContain("contract completion of 03/20/26");
    expect(
      paras.some((p) =>
        p.startsWith(
          "Since the last update (data date 03/02/26), 2 activities started and 1 finished.",
        ),
      ),
    ).toBe(true);
    expect(
      paras.some((p) => p.startsWith("The longest path runs through B Activity B, then C")),
    ).toBe(true);
    expect(paras[paras.length - 1]).toMatch(/schedule health checks/);
    const html = narrativeHtml(input());
    expect(html).not.toMatch(/NaN|undefined/);
    const page = renderReportBody({
      page: "schedule",
      job_number: "QA-1",
      report: {
        found: true,
        version: 3,
        data_date: "2026-03-09",
        contract_completion_date: "2026-03-20",
        data: input().data,
      },
    });
    for (const id of ["cpm-narrative", "cpm-lookahead", "cpm-health"])
      expect(page).toContain(`id="${id}"`);
    expect(page.indexOf('id="cpm-gantt"')).toBeLessThan(page.indexOf('id="cpm-narrative"'));
  });

  it("leads with the forecast against the baseline and flags a contract date far from it", () => {
    const ok = scheduleNarrative(input())[0];
    expect(ok).toContain("driven by its logic and recorded progress");
    expect(ok.indexOf("baseline finish")).toBeLessThan(ok.indexOf("contract completion"));
    expect(ok).not.toContain("isn't used to measure delay");
    // A contract date months after the plan would make a job behind its baseline read as early.
    const far = { ...input(), contractCompletion: "2026-06-30" };
    const s = ganttSummary(ganttModel(far));
    expect(s.completionMismatch).toBeGreaterThan(5);
    const first = scheduleNarrative(far)[0];
    expect(first).toContain("the baseline finish of");
    expect(first).toContain("The contract completion on file, 06/30/26,");
    expect(first).toContain("isn't used to measure delay until the contract date is confirmed");
    expect(first).not.toMatch(/early|before the contract/);
    const cpli = scheduleHealth(far).find((h) => h.id === 13)!;
    expect(cpli.note).toContain("Measured to the baseline finish");
    expect(cpli.value).toBe(
      scheduleHealth({ ...far, contractCompletion: null }).find((h) => h.id === 13)!.value,
    );
    const page = renderReportBody({
      page: "schedule",
      job_number: "QA-1",
      report: {
        found: true,
        version: 3,
        data_date: "2026-03-09",
        contract_completion_date: "2026-06-30",
        data: far.data,
      },
    });
    expect(page).toContain('data-completion-mismatch="true"');
    expect(page).toContain("Variance to baseline");
    expect(page).not.toContain("WD early");
  });
});
