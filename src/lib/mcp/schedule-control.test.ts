import { describe, expect, it } from "vitest";
import {
  prepareSchedule,
  readScheduleControl,
  schedulePortfolio,
  starterWbs,
  wbsPaths,
} from "./schedule-control";
import { scheduleRequest, type ScheduleRequest, type ScheduleSettings } from "./schedule-schema";
import { draftScheduleNotice } from "./schedule-notice";
import { stripMoney, type Activity, type LivingData } from "./living";

export const settings: ScheduleSettings = {
  project_start: "2026-10-05",
  default_calendar_id: "work",
  calendars: [{ id: "work", name: "Mon–Fri", work_days: 62, holidays: [], hours_per_day: 8 }],
  finish_convention: "inclusive-last-work-day",
  out_of_sequence: "retained-logic",
};
export const act = (id: string, duration = 5, extra: Partial<Activity> = {}): Activity => ({
  id,
  name: id,
  duration,
  start: null,
  finish: null,
  predecessors: [],
  total_float: null,
  critical: null,
  pct_complete: 0,
  value: 0,
  sov_line: null,
  cost_code: null,
  ...extra,
});
export const plan = () =>
  prepareSchedule(null, 0, {
    operation: "recalculate",
    data_date: "2026-10-05",
    settings,
    starter_wbs: true,
    initial_activities: [
      act("A"),
      act("B", 3, { predecessors: [{ id: "A", type: "FS" }] }),
      act("M", 0, { predecessors: [{ id: "B", type: "FS" }] }),
    ],
  }).data;
const revise = (data: LivingData, request: Partial<ScheduleRequest>) =>
  prepareSchedule(data, 1, { operation: "recalculate", data_date: "2026-10-05", ...request });

describe("controlled Athena schedule", () => {
  it("calculates FS dates and float without changing IDs, values or original duration", () => {
    const d = plan();
    expect(d.activities?.map((a) => a.id)).toEqual(["A", "B", "M"]);
    expect(d.activities?.map((a) => [a.start, a.finish])).toEqual([
      ["2026-10-05", "2026-10-09"],
      ["2026-10-12", "2026-10-14"],
      ["2026-10-15", "2026-10-15"],
    ]);
    expect(d.activities?.every((a) => a.critical && a.total_float === 0)).toBe(true);
    expect(d.activities?.[0].duration).toBe(5);
  });
  it("organizes existing activities with a complete hierarchy and preserves dates/logic/metadata", () => {
    const d = plan(),
      before = structuredClone(d);
    const result = revise(d, {
      operation: "organize",
      assignments: [{ activity_id: "B", wbs_id: "construction" }],
    });
    expect(result.data.activities?.[1]).toEqual({ ...d.activities![1], wbs_id: "construction" });
    expect(d).toEqual(before);
    expect(
      starterWbs()
        .filter((n) => n.parent_id === "submittals")
        .map((n) => n.name),
    ).toEqual(["Prepare and Submit", "Review and Approve"]);
    expect(
      wbsPaths([
        ...starterWbs(),
        { id: "26", name: "Electrical / Level 1", parent_id: "construction", order: 0 },
      ]).get("26"),
    ).toBe("Construction / Electrical / Level 1");
  });
  it("rejects hierarchy cycles, unknown assignments and accidental replacement", () => {
    expect(() =>
      revise(plan(), {
        operation: "organize",
        wbs: [{ id: "x", name: "x", parent_id: "x", order: 0 }],
      }),
    ).toThrow(/WBS cycle/);
    expect(() =>
      revise(plan(), {
        operation: "organize",
        assignments: [{ activity_id: "B", wbs_id: "missing" }],
      }),
    ).toThrow(/WBS.*not defined/);
    expect(() => revise(plan(), { initial_activities: [act("X")] })).toThrow(/stable activity IDs/);
    expect(() =>
      revise(plan(), { operation: "organize", updates: [{ id: "A", duration: 1 }] }),
    ).toThrow(/WBS only/);
  });
  it.each(["FS", "SS", "FF", "SF"] as const)(
    "retains and propagates %s dependencies with lag",
    (type) => {
      const d = revise(plan(), {
        updates: [
          { id: "B", predecessors: [{ id: "A", type, lag: 2, lag_calendar_basis: "project" }] },
        ],
      }).data;
      expect(d.activities![1].predecessors).toEqual([
        { id: "A", type, lag: 2, lag_calendar_basis: "project" },
      ]);
      expect(d.activities![1].start).toBe(
        type === "FS"
          ? "2026-10-14"
          : type === "SS"
            ? "2026-10-07"
            : type === "FF"
              ? "2026-10-09"
              : "2026-10-05",
      );
    },
  );
  it("honors holidays and per-activity calendars", () => {
    const config = structuredClone(settings);
    config.calendars[0].holidays = ["2026-10-12"];
    config.calendars.push({
      id: "all",
      name: "Every day",
      work_days: 127,
      holidays: [],
      hours_per_day: 8,
    });
    const d = revise(plan(), { settings: config, updates: [{ id: "B", calendar_id: "all" }] }).data;
    expect(d.activities![1].start).toBe("2026-10-10");
    const standard = revise(plan(), { settings: config }).data;
    expect(standard.activities![1].start).toBe("2026-10-13");
    expect(() => revise(plan(), { updates: [{ id: "A", calendar_id: "missing" }] })).toThrow(
      /no fallback/,
    );
  });
  it("uses explicit actuals and remaining duration, preserves original duration and rejects changed history", () => {
    const d = revise(plan(), {
      data_date: "2026-10-08",
      updates: [{ id: "A", actual_start: "2026-10-05", remaining_duration: 4, pct_complete: 20 }],
    }).data;
    expect(d.activities![0]).toMatchObject({
      actual_start: "2026-10-05",
      start: "2026-10-05",
      duration: 5,
      remaining_duration: 4,
      finish: "2026-10-13",
      total_float: 0,
      critical: true,
    });
    expect(() =>
      revise(d, { data_date: "2026-10-09", updates: [{ id: "A", actual_start: "2026-10-06" }] }),
    ).toThrow(/actual history/);
    expect(() => revise(d, { data_date: "2026-10-07" })).toThrow(/backward/);
    expect(() => revise(plan(), { updates: [{ id: "A", pct_complete: 40 }] })).toThrow(
      /actual-date evidence/,
    );
    expect(() =>
      revise(plan(), { updates: [{ id: "A", actual_start: "2026-10-06", remaining_duration: 2 }] }),
    ).toThrow(/follow the data date/);
    expect(() =>
      revise(plan(), { updates: [{ id: "A", actual_finish: "2026-10-05", pct_complete: 100 }] }),
    ).toThrow(/actual start/);
  });
  it("preserves completed dates even when the current data date moves", () => {
    const d = revise(plan(), {
      data_date: "2026-10-12",
      updates: [
        {
          id: "A",
          actual_start: "2026-10-05",
          actual_finish: "2026-10-09",
          remaining_duration: 0,
          pct_complete: 100,
        },
      ],
    }).data;
    const next = revise(d, { data_date: "2026-10-15" }).data;
    expect(next.activities![0]).toMatchObject({ start: "2026-10-05", finish: "2026-10-09" });
  });
  it("reports zero/negative float and critical/noncritical milestone semantics", () => {
    const data = prepareSchedule(null, 0, {
      operation: "recalculate",
      settings,
      data_date: "2026-10-05",
      initial_activities: [
        act("A", 5),
        act("M", 0, { predecessors: [{ id: "A" }], finish_no_later_than: "2026-10-07" }),
        act("N", 0),
      ],
    }).data;
    expect(data.activities!.find((a) => a.id === "M")).toMatchObject({ critical: true });
    expect(data.activities!.find((a) => a.id === "M")!.total_float).toBeLessThan(0);
    expect(data.activities!.find((a) => a.id === "N")!.total_float).toBeGreaterThan(0);
    expect(data.activities!.find((a) => a.id === "N")!.critical).toBe(false);
  });
  it("rejects cycles, invalid/duplicate dependencies and unknown patches", () => {
    expect(() => revise(plan(), { updates: [{ id: "A", predecessors: [{ id: "B" }] }] })).toThrow(
      /cycle/,
    );
    expect(() =>
      revise(plan(), { updates: [{ id: "A", predecessors: [{ id: "missing" }] }] }),
    ).toThrow(/not in this job/);
    expect(() => revise(plan(), { updates: [{ id: "A", predecessors: [{ id: "A" }] }] })).toThrow(
      /self dependency/,
    );
    expect(() =>
      revise(plan(), { updates: [{ id: "B", predecessors: [{ id: "A" }, { id: "A" }] }] }),
    ).toThrow(/repeat/);
    expect(() => revise(plan(), { updates: [{ id: "not-this-job", duration: 3 }] })).toThrow(
      /Unknown activity/,
    );
  });
  it("captures immutable accepted baseline without financial duplication", () => {
    const before = plan();
    before.activities![0].value = 12345;
    const baseline = revise(before, {
      operation: "baseline",
      baseline: { id: "BL1", name: "Accepted baseline", status: "accepted" },
    }).data;
    const after = revise(baseline, { updates: [{ id: "A", duration: 8 }] }).data;
    expect(readScheduleControl(after)!.baselines[0].activities[0]).toMatchObject({
      duration: 5,
      value: null,
      finish: "2026-10-09",
    });
    expect(after.activities![0].value).toBe(12345);
    expect(() =>
      revise(after, {
        operation: "baseline",
        baseline: { id: "BL1", name: "Overwrite", status: "accepted" },
      }),
    ).toThrow(/immutable/);
  });
  it("isolates connected fragnet impact instead of using delay duration as completion impact", () => {
    const d = plan(),
      frozen = structuredClone(d);
    const after = revise(d, {
      operation: "tia",
      delay: {
        event_id: "E1",
        description: "Redesign and review",
        event_date: "2026-10-05",
        source_refs: ["synthetic-event-E1"],
        assumptions: ["One review round; fictional durations"],
        add_activities: [act("D", 2, { name: "Redesign", predecessors: [{ id: "A" }] })],
        replace_predecessors: [{ activity_id: "B", predecessors: [{ id: "D" }] }],
      },
    });
    expect(after.control.analysis).toMatchObject({
      prior_completion: "2026-10-15",
      updated_completion: "2026-10-19",
      impact_calendar_days: 4,
      base_version: 1,
    });
    expect(after.control.analysis!.milestones).toEqual([
      {
        activity_id: "M",
        prior_finish: "2026-10-15",
        updated_finish: "2026-10-19",
        variance_calendar_days: 4,
      },
    ]);
    expect(d).toEqual(frozen);
    expect(() =>
      revise(d, {
        operation: "tia",
        delay: {
          event_id: "E",
          description: "unconnected",
          event_date: null,
          source_refs: [],
          assumptions: [],
          add_activities: [act("D")],
          replace_predecessors: [{ activity_id: "B", predecessors: [{ id: "A" }] }],
        },
      }),
    ).toThrow(/not connected/);
  });
  it("reports no completion impact when a connected delay consumes only available float", () => {
    const d = prepareSchedule(null, 0, {
      operation: "recalculate",
      data_date: "2026-10-05",
      settings,
      initial_activities: [
        act("long", 10),
        act("short", 2),
        act("end", 0, { predecessors: [{ id: "long" }, { id: "short" }] }),
      ],
    }).data;
    const result = revise(d, {
      operation: "tia",
      delay: {
        event_id: "E2",
        description: "short-path delay",
        event_date: null,
        source_refs: [],
        assumptions: [],
        add_activities: [act("D", 3, { predecessors: [{ id: "short" }] })],
        replace_predecessors: [{ activity_id: "end", predecessors: [{ id: "long" }, { id: "D" }] }],
      },
    });
    expect(result.control.analysis!.impact_calendar_days).toBe(0);
    expect(result.data.activities!.find((a) => a.id === "D")!.critical).toBe(false);
  });
  it("models the redesign, resubmittal, one review round and sourced fabrication chain", () => {
    const data = prepareSchedule(null, 0, {
      operation: "recalculate",
      settings,
      data_date: "2026-10-05",
      initial_activities: [
        act("release", 0),
        act("fabricate", 30, { predecessors: [{ id: "release" }] }),
        act("install", 5, { predecessors: [{ id: "fabricate" }] }),
        act("handover", 0, { predecessors: [{ id: "install" }] }),
      ],
    }).data;
    const result = revise(data, {
      operation: "tia",
      delay: {
        event_id: "E20",
        description: "Fictional 20-day redesign and resubmittal",
        event_date: "2026-10-05",
        source_refs: ["Synthetic event E20", "Fictional supplier lead time: 30 WD"],
        assumptions: [
          "One 10-WD review round, explicitly assumed",
          "Mon–Fri; no holidays in this fixture",
        ],
        add_activities: [
          act("redesign", 20, { predecessors: [{ id: "release" }] }),
          act("resubmit", 3, { predecessors: [{ id: "redesign" }] }),
          act("review", 10, { predecessors: [{ id: "resubmit" }] }),
        ],
        replace_predecessors: [{ activity_id: "fabricate", predecessors: [{ id: "review" }] }],
      },
    });
    expect(result.control.analysis).toMatchObject({
      prior_completion: "2026-11-23",
      updated_completion: "2027-01-07",
      impact_calendar_days: 45,
    });
    expect(result.data.activities!.find((a) => a.id === "fabricate")!.duration).toBe(30);
    expect(result.control.analysis!.assumptions).toContain(
      "One 10-WD review round, explicitly assumed",
    );
  });
  it("refuses unrelated logic deletion disguised as isolated delay impact", () => {
    expect(() =>
      revise(plan(), {
        operation: "tia",
        delay: {
          event_id: "E",
          description: "Unrouted original constraint",
          event_date: null,
          source_refs: [],
          assumptions: [],
          add_activities: [act("D", 1)],
          replace_predecessors: [{ activity_id: "B", predecessors: [{ id: "D" }] }],
        },
      }),
    ).toThrow(/must preserve existing constraints/);
  });
  it("adds new revision activities explicitly without changing existing identities", () => {
    const next = revise(plan(), {
      add_activities: [act("extra", 2, { predecessors: [{ id: "B" }] })],
    }).data;
    expect(next.activities!.map((a) => a.id)).toEqual(["A", "B", "M", "extra"]);
    expect(() => revise(plan(), { add_activities: [act("A")] })).toThrow(/IDs repeat/);
  });
  it("counts modeled impact on the explicit seven-day project calendar", () => {
    const seven = structuredClone(settings);
    seven.calendars[0].work_days = 127;
    const data = prepareSchedule(null, 0, {
      operation: "recalculate",
      settings: seven,
      data_date: "2026-10-05",
      initial_activities: [act("A", 1), act("B", 1, { predecessors: [{ id: "A" }] })],
    }).data;
    const result = revise(data, {
      operation: "tia",
      delay: {
        event_id: "E",
        description: "Seven-day review",
        event_date: "2026-10-05",
        source_refs: ["Fixture"],
        assumptions: [],
        add_activities: [act("D", 7, { predecessors: [{ id: "A" }] })],
        replace_predecessors: [{ activity_id: "B", predecessors: [{ id: "D" }] }],
      },
    });
    expect(result.control.analysis!.impact_project_work_days).toBe(7);
    expect(result.control.analysis!.impact_calendar_days).toBe(7);
    const publicData = stripMoney(result.data);
    const publicControl = readScheduleControl(publicData)!;
    expect(publicControl.analysis).not.toHaveProperty("source_refs");
    expect(publicControl.analysis).not.toHaveProperty("description");
    expect(publicControl.analysis!.impact_project_work_days).toBe(7);
  });
  it("saves a dated source import before recalculating so original dates are never lost", () => {
    const source = [act("A", 5, { start: "2026-10-05", finish: "2026-10-09" })];
    expect(() =>
      prepareSchedule(null, 0, {
        operation: "recalculate",
        data_date: "2026-10-12",
        settings,
        initial_activities: source,
      }),
    ).toThrow(/original imported dates and logic/);
    const imported = prepareSchedule(null, 0, {
      operation: "organize",
      data_date: "2026-10-05",
      settings,
      initial_activities: source,
    }).data;
    const frozen = structuredClone(imported);
    const next = prepareSchedule(imported, 1, {
      operation: "recalculate",
      data_date: "2026-10-12",
    }).data;
    expect(imported).toEqual(frozen);
    expect(imported.activities![0]).toMatchObject({ start: "2026-10-05", finish: "2026-10-09" });
    expect(next.activities![0]).toMatchObject({ start: "2026-10-12", finish: "2026-10-16" });
    expect(readScheduleControl(imported)!.calculation.status).toBe("reported");
  });
  it("does not invent calendars, dates or impact from legacy schedule metadata", () => {
    const legacy: LivingData = { activities: [act("A")], custom: { source: "original import" } };
    expect(revise(legacy, { operation: "organize", starter_wbs: true }).data.custom).toEqual(
      legacy.custom,
    );
    expect(() => revise(legacy, {})).toThrow(/No calendar or start was guessed/);
    expect(
      schedulePortfolio(legacy, { company_id: "C", job_id: "J", version: 1, data_date: null })
        .status,
    ).toBe("reported");
  });
  it("validates real dates and refuses unsupported calculation switches", () => {
    expect(
      scheduleRequest.safeParse({ operation: "organize", data_date: "2026-02-30" }).success,
    ).toBe(false);
    expect(
      scheduleRequest.safeParse({
        operation: "recalculate",
        data_date: "2026-10-05",
        settings: { ...settings, out_of_sequence: "progress-override" },
      }).success,
    ).toBe(false);
  });
  it("provides read-only portfolio provenance and missing states without finance inference", () => {
    const summary = schedulePortfolio(plan(), {
      company_id: "C",
      job_id: "J",
      version: 3,
      data_date: "2026-10-05",
    });
    expect(summary).toMatchObject({
      status: "calculated",
      source: { tool: "cpm_activities", version: 3 },
      current_url: "/r/job/J/schedule",
      baseline: null,
    });
    expect(summary.missing).toContain("Baseline not captured");
    expect(JSON.stringify(summary)).not.toMatch(/billed|paid|earned/);
  });
});

describe("source-grounded draft notice", () => {
  const event = {
    id: "E",
    description: "Reported late design",
    delay_start: "2026-10-05",
    affected_activity_ids: ["A"],
    source_refs: ["fixture"],
  };
  it("keeps missing recipient/method/clock explicit and never asserts an uncalculated impact", () => {
    const draft = draftScheduleNotice({
      job_label: "Synthetic",
      event,
      clauses: [],
      source_issues: [],
      data: plan(),
    });
    expect(draft.body).toContain("DRAFT — NOT SENT");
    expect(draft.notice.due).toBeNull();
    expect(draft.ready_for_delivery).toBe(false);
    expect(draft.body).toContain("No quantified event impact is asserted");
  });
  it("uses physical-page sources and preserves compound clocks instead of inventing dates", () => {
    const clause = {
      source_id: "S",
      filename: "Fictional contract.pdf",
      file_sha256: "a".repeat(64),
      section: "8.4",
      heading: "8.4 Delay Notice",
      parts: [{ page: 7, text: "Notice" }],
      text: "Give notice to Owner within 5 calendar days from beginning of delay and supplemental notice within 10 calendar days.",
    };
    const draft = draftScheduleNotice({
      job_label: "Synthetic",
      event,
      clauses: [clause],
      source_issues: [],
      data: plan(),
    });
    expect(draft.notice.due).toBeNull();
    expect(draft.body).toContain(clause.text);
    expect(draft.citations[0].physical_pages).toEqual([7]);
  });
  it("does not borrow project holidays for a business-day notice clock", () => {
    const clause = {
      source_id: "S",
      filename: "Fictional contract.pdf",
      file_sha256: "b".repeat(64),
      section: "8.4",
      heading: "8.4 Delay Notice",
      parts: [{ page: 4, text: "Notice" }],
      text: "Give notice to Owner within 5 business days from the beginning of delay.",
    };
    const draft = draftScheduleNotice({
      job_label: "Synthetic",
      event,
      clauses: [clause],
      source_issues: [],
      data: plan(),
    });
    expect(draft.notice.due).toBeNull();
    expect(draft.notice.math).toContain("governing calendar");
    const calendar = draftScheduleNotice({
      job_label: "Synthetic",
      event,
      clauses: [{ ...clause, text: clause.text.replace("business", "calendar") }],
      source_issues: [],
      data: plan(),
    });
    expect(calendar.notice.due).toBe("2026-10-10");
  });
});
