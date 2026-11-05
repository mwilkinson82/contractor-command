import { describe, expect, it } from "vitest";
import type { Activity } from "./mcp/living";
import { prepareSchedule } from "./mcp/schedule-control";
import {
  alignMilestoneDates,
  projectMilestoneRequest,
  projectMilestonesPresent,
  withProjectMilestones,
} from "./schedule-milestones";

const act = (id: string, name: string, extra: Partial<Activity> = {}): Activity => ({
  id,
  name,
  duration: 5,
  start: null,
  finish: null,
  predecessors: [],
  total_float: null,
  critical: null,
  pct_complete: 0,
  value: null,
  sov_line: null,
  cost_code: null,
  ...extra,
});
const fs = (id: string) => ({ id, type: "FS" as const, lag: 0 });

describe("withProjectMilestones", () => {
  it("adds Project Start FS 0 to every open start and Substantial Completion FF 0 to every open end", () => {
    const input = [
      act("A", "Layout", { start: "2026-03-02", finish: "2026-03-06" }),
      act("B", "Order gear", { start: "2026-03-03", finish: "2026-03-09" }),
      act("C", "Rough-in", {
        predecessors: [fs("A")],
        start: "2026-03-09",
        finish: "2026-03-20",
      }),
      act("D", "Set gear", { predecessors: [fs("B")], start: "2026-03-10", finish: "2026-03-18" }),
    ];
    const r = withProjectMilestones(input);
    expect(r.ids).toEqual(["MS-000", "MS-999"]);
    expect(r.activities.map((a) => a.id)).toEqual(["MS-000", "A", "B", "C", "D", "MS-999"]);
    const by = new Map(r.activities.map((a) => [a.id, a]));
    expect(by.get("MS-000")).toMatchObject({
      name: "Project Start",
      activity_type: "milestone-start",
      duration: 0,
      start: "2026-03-02",
      finish: "2026-03-02",
      predecessors: [],
      pct_complete: 0,
    });
    expect(by.get("A")!.predecessors).toEqual([fs("MS-000")]);
    expect(by.get("B")!.predecessors).toEqual([fs("MS-000")]);
    expect(by.get("C")!.predecessors).toEqual([fs("A")]);
    expect(by.get("MS-999")).toMatchObject({
      name: "Substantial Completion",
      activity_type: "milestone-finish",
      duration: 0,
      start: "2026-03-20",
      finish: "2026-03-20",
      predecessors: [
        { id: "C", type: "FF", lag: 0 },
        { id: "D", type: "FF", lag: 0 },
      ],
    });
    expect(by.get("MS-999")!.actual_finish).toBeUndefined();
    expect(r.added).toEqual([
      "Added start milestone MS-000 Project Start, tied FS 0 to A Layout and B Order gear.",
      "Added finish milestone MS-999 Substantial Completion, tied FF 0 to C Rough-in and D Set gear.",
    ]);
    // The input is not changed.
    expect(input[0].predecessors).toEqual([]);
  });

  it("ties Mobilization SS 0 to the mobilization activity, takes its start logic, and carries actuals", () => {
    const r = withProjectMilestones([
      act("01-010", "Contract award", {
        actual_start: "2026-02-03",
        actual_finish: "2026-02-07",
        pct_complete: 100,
        remaining_duration: 0,
      }),
      act("01-020", "Site mobilization and layout", {
        predecessors: [fs("01-010")],
        actual_start: "2026-02-10",
        actual_finish: "2026-02-14",
        pct_complete: 100,
        remaining_duration: 0,
        wbs_id: "general",
      }),
      act("99-010", "Final punch and demobilization", {
        predecessors: [fs("01-020")],
        actual_start: "2026-03-02",
        actual_finish: "2026-03-07",
        pct_complete: 100,
        remaining_duration: 0,
      }),
    ]);
    const by = new Map(r.activities.map((a) => [a.id, a]));
    expect(by.get("MS-000")).toMatchObject({
      name: "Mobilization",
      predecessors: [fs("01-010")],
      actual_start: "2026-02-10",
      actual_finish: "2026-02-10",
      pct_complete: 100,
      remaining_duration: 0,
      wbs_id: "general",
    });
    expect(by.get("01-020")!.predecessors).toEqual([
      fs("01-010"),
      { id: "MS-000", type: "SS", lag: 0 },
    ]);
    expect(by.get("01-010")!.predecessors).toEqual([]);
    expect(by.get("MS-999")).toMatchObject({
      predecessors: [{ id: "99-010", type: "FF", lag: 0 }],
      actual_start: "2026-03-07",
      actual_finish: "2026-03-07",
      pct_complete: 100,
      remaining_duration: 0,
    });
    expect(r.added[0]).toBe(
      "Added start milestone MS-000 Mobilization, tied SS 0 to 01-020 Site mobilization and layout and driven by its predecessor 01-010; complete at its actual start, Feb 10, 2026.",
    );
  });

  it("adds none the schedule already has, and picks a free ID", () => {
    const has = [
      act("NTP", "Notice to Proceed", { duration: 0, activity_type: "milestone-finish" }),
      act("A", "Work", { predecessors: [fs("NTP")] }),
      act("SC", "Substantial Completion", {
        duration: 0,
        activity_type: "milestone-finish",
        predecessors: [fs("A")],
      }),
    ];
    expect(projectMilestonesPresent(has)).toEqual({ start: true, finish: true });
    expect(withProjectMilestones(has).ids).toEqual([]);
    expect(projectMilestoneRequest(has)).toBeNull();
    // A schedule that already ends on milestones has its finish.
    const endsOnMilestone = [
      act("MS-000", "Pour slab"),
      act("Z", "Owner move-in", { duration: 0, predecessors: [fs("MS-000")] }),
    ];
    const r = withProjectMilestones(endsOnMilestone);
    expect(r.ids).toEqual(["MS-0000"]);
    expect(projectMilestonesPresent(r.activities)).toEqual({ start: true, finish: true });
  });

  it("stays inside the 400-activity limit", () => {
    const full = Array.from({ length: 399 }, (_, i) => act(`A${i}`, `Work ${i}`));
    const r = withProjectMilestones(full);
    expect(r.activities).toHaveLength(400);
    expect(r.ids).toEqual(["MS-000"]);
    expect(r.added[1]).toMatch(/No Substantial Completion milestone was added: .*400-activity/);
  });

  it("dates milestones from the as-planned activities they tie to", () => {
    const r = withProjectMilestones([
      act("A", "Mobilize", { start: "2026-03-04", finish: "2026-03-05" }),
      act("B", "Work", { predecessors: [fs("A")], start: "2026-03-06", finish: "2026-03-20" }),
    ]);
    const baseline = r.activities.map((a) =>
      a.id === "A"
        ? { ...a, start: "2026-03-02", finish: "2026-03-03" }
        : a.id === "B"
          ? { ...a, start: "2026-03-04", finish: "2026-03-14" }
          : a,
    );
    const aligned = new Map(alignMilestoneDates(baseline, r.ids).map((a) => [a.id, a]));
    expect(aligned.get("MS-000")).toMatchObject({ start: "2026-03-02", finish: "2026-03-02" });
    expect(aligned.get("MS-999")).toMatchObject({ start: "2026-03-14", finish: "2026-03-14" });
  });
});

describe("milestones on a calculated schedule", () => {
  // Job 2717's shape: Mon–Sat, contract award then mobilization done, last activity open.
  const settings = {
    project_start: "2026-02-03",
    default_calendar_id: "job",
    calendars: [
      { id: "job", name: "Mon–Sat", work_days: 0b1111110, holidays: [], hours_per_day: 8 },
    ],
    finish_convention: "inclusive-last-work-day" as const,
    out_of_sequence: "retained-logic" as const,
  };
  const v1 = () =>
    prepareSchedule(null, 0, {
      operation: "recalculate",
      data_date: "2026-03-02",
      settings,
      initial_activities: [
        act("01-010", "Contract award and preconstruction complete", {
          actual_start: "2026-02-03",
          actual_finish: "2026-02-07",
          pct_complete: 100,
          remaining_duration: 0,
        }),
        act("01-020", "Site mobilization and layout", {
          predecessors: [fs("01-010")],
          actual_start: "2026-02-10",
          actual_finish: "2026-02-14",
          pct_complete: 100,
          remaining_duration: 0,
        }),
        act("50-010", "Electrical rough-in", { duration: 100, predecessors: [fs("01-020")] }),
        act("99-010", "Final punch, owner walk, and substantial completion", {
          duration: 12,
          predecessors: [fs("50-010")],
        }),
      ] as never,
    });

  it("finishes Substantial Completion FF 0 on its predecessor's last work day; completion unchanged", () => {
    const before = v1();
    const last = before.data.activities!.find((a) => a.id === "99-010")!;
    const request = projectMilestoneRequest(before.data.activities!)!;
    expect(request.updates).toEqual([
      {
        id: "01-020",
        predecessors: [fs("01-010"), { id: "MS-000", type: "SS", lag: 0 }],
      },
    ]);
    const after = prepareSchedule(before.data, 1, {
      operation: "recalculate",
      data_date: "2026-03-02",
      add_activities: request.add_activities as never,
      updates: request.updates as never,
    });
    const by = new Map(after.data.activities!.map((a) => [a.id, a]));
    expect(by.get("MS-999")!.finish).toBe(last.finish);
    expect(by.get("MS-999")!.start).toBe(last.finish);
    expect(by.get("99-010")!.finish).toBe(last.finish);
    const completion = (acts: Activity[]) =>
      acts.reduce((m, a) => (a.finish! > m ? a.finish! : m), "");
    expect(completion(after.data.activities!)).toBe(completion(before.data.activities!));
    expect(by.get("MS-999")).toMatchObject({ critical: true, total_float: 0 });
    expect(after.control.calculation.longest_path?.at(-1)).toBe("MS-999");
    expect(by.get("MS-000")).toMatchObject({
      start: "2026-02-10",
      finish: "2026-02-10",
      actual_start: "2026-02-10",
      actual_finish: "2026-02-10",
      pct_complete: 100,
    });
  });

  it("ties a zero-duration FF 0 successor to a Saturday finish, not the next work day", () => {
    const r = prepareSchedule(null, 0, {
      operation: "recalculate",
      data_date: "2026-03-02",
      settings: { ...settings, project_start: "2026-03-02" },
      initial_activities: [
        act("A", "Six days of work", { duration: 6 }),
        act("SC", "Substantial Completion", {
          duration: 0,
          activity_type: "milestone-finish",
          predecessors: [{ id: "A", type: "FF", lag: 0 }],
        }),
      ] as never,
    });
    const by = new Map(r.data.activities!.map((a) => [a.id, a]));
    // Mon Mar 2 through Sat Mar 7 on the Mon–Sat calendar.
    expect(by.get("A")).toMatchObject({ start: "2026-03-02", finish: "2026-03-07" });
    expect(by.get("SC")).toMatchObject({ start: "2026-03-07", finish: "2026-03-07" });
    expect(by.get("SC")!.total_float).toBe(0);
    expect(r.control.calculation.activity_results!.SC.driving_predecessors).toEqual(["A"]);
  });
});
