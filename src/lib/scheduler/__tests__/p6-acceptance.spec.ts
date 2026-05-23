/**
 * P6-Class Scheduling Engine — Acceptance Test Harness
 *
 * These 20 tests are the executable form of the spec in
 * `.lovable/scheduler-p6-gap-analysis.md` (anchor: §"Acceptance tests" of the
 * Primavera P6-Class Scheduling Engine Specification).
 *
 * They are intentionally `.todo()` stubs. As the Phase 1–6 work lands, each
 * test gets fleshed out and flipped to `it(...)`. This file is the gate that
 * prevents the engine from drifting away from spec parity.
 *
 * Naming convention: `<SECTION>-<N>` matches the spec's numbering so it is
 * obvious which acceptance criterion a failure maps to.
 */

import { describe, expect, it } from "vitest";
import {
  calculateCpm,
  createWholeDayWorkClock,
  type EngineActivity,
  type EngineRelationship,
  type WorkClock,
} from "../engine2";

// ---------------------------------------------------------------------------
// Test fixture helpers (Phase 1.1 — narrow but correctly designed).
// ---------------------------------------------------------------------------

const DAY_MIN = 8 * 60; // 480 working minutes per workday

function monFri(id = "cal-mf"): WorkClock {
  return createWholeDayWorkClock({
    id,
    name: "Mon-Fri 8h",
    workDays: 0b0111110, // Mon..Fri
    holidays: [],
    hoursPerDay: 8,
  });
}

function activity(id: string, durDays: number, calendarId = "cal-mf"): EngineActivity {
  return {
    id,
    name: id,
    type: "task",
    durationType: "fixed-dur-units",
    percentCompleteType: "duration",
    calendarId,
    originalDuration: { minutes: durDays * DAY_MIN, authoringCalendarId: calendarId },
    remainingDuration: { minutes: durDays * DAY_MIN, authoringCalendarId: calendarId },
    constraints: [],
  };
}

function link(
  id: string,
  from: string,
  to: string,
  type: "FS" | "SS" | "FF" | "SF" = "FS",
  lagDays = 0,
): EngineRelationship {
  return {
    id,
    from,
    to,
    type,
    lag: { minutes: lagDays * DAY_MIN, authoringCalendarId: "cal-mf" },
    lagCalendarBasis: "project",
  };
}

// 2025-01-06 is a Monday (UTC). No holidays in this fixture week.
const MON_2025_01_06 = Date.UTC(2025, 0, 6);

describe("P6 acceptance — CPM (engine2)", () => {
  it("CPM-1: simple FS chain on one calendar computes expected ES/EF/LS/LF and controlling path", () => {
    const cal = monFri();
    const activities = [activity("A", 10), activity("B", 5), activity("C", 3)];
    const rels = [link("A-B", "A", "B"), link("B-C", "B", "C")];
    const result = calculateCpm({
      dataDate: MON_2025_01_06,
      projectStart: MON_2025_01_06,
      projectCalendarId: "cal-mf",
      calendars: new Map([["cal-mf", cal]]),
      activities,
      relationships: rels,
    });

    const byId = new Map(result.activities.map((a) => [a.id, a]));
    const A = byId.get("A")!;
    const B = byId.get("B")!;
    const C = byId.get("C")!;

    // Positions, measured in working minutes from project start under the
    // project calendar — robust against day-end-boundary representation
    // (e.g. Fri 08:00 ≡ following Mon 00:00 in position).
    expect(cal.diffWork(MON_2025_01_06, A.earlyStart)).toBe(0);
    expect(cal.diffWork(MON_2025_01_06, A.earlyFinish)).toBe(10 * DAY_MIN);
    expect(cal.diffWork(MON_2025_01_06, B.earlyStart)).toBe(10 * DAY_MIN);
    expect(cal.diffWork(MON_2025_01_06, B.earlyFinish)).toBe(15 * DAY_MIN);
    expect(cal.diffWork(MON_2025_01_06, C.earlyStart)).toBe(15 * DAY_MIN);
    expect(cal.diffWork(MON_2025_01_06, C.earlyFinish)).toBe(18 * DAY_MIN);

    for (const a of [A, B, C]) {
      expect(a.totalFloatMinutes).toBe(0);
      expect(a.isCritical).toBe(true);
    }

    // Late dates equal early dates in working-minute position.
    expect(cal.diffWork(A.earlyStart, A.lateStart)).toBe(0);
    expect(cal.diffWork(C.earlyFinish, C.lateFinish)).toBe(0);

    expect(result.criticalPath).toEqual(["A", "B", "C"]);
  });

  it("CPM-2: two parallel paths of unequal duration give the shorter path positive total float and the longer path critical marking", () => {
    const cal = monFri();
    const activities = [
      activity("A", 1),
      activity("B", 3),
      activity("C", 5),
      activity("D", 1),
    ];
    const rels = [
      link("A-B", "A", "B"),
      link("A-C", "A", "C"),
      link("B-D", "B", "D"),
      link("C-D", "C", "D"),
    ];
    const result = calculateCpm({
      dataDate: MON_2025_01_06,
      projectStart: MON_2025_01_06,
      projectCalendarId: "cal-mf",
      calendars: new Map([["cal-mf", cal]]),
      activities,
      relationships: rels,
    });

    const byId = new Map(result.activities.map((a) => [a.id, a]));
    expect(byId.get("A")!.isCritical).toBe(true);
    expect(byId.get("C")!.isCritical).toBe(true);
    expect(byId.get("D")!.isCritical).toBe(true);
    expect(byId.get("B")!.isCritical).toBe(false);
    expect(byId.get("B")!.totalFloatMinutes).toBe(2 * DAY_MIN);
    expect(byId.get("C")!.totalFloatMinutes).toBe(0);
  });

  it("CPM-3: free float equals the maximum delay that does not delay any immediate successor's early start (Oracle definition)", () => {
    const cal = monFri();
    // A(1d) ─┬─ B(2d) ─┐
    //        └─ C(5d) ─┴─ D(1d)
    // B finishes 3d in, D starts at 6d (driven by C). Delaying B up to 3d
    // does not delay D → B.freeFloat = 3 workdays.
    const activities = [
      activity("A", 1),
      activity("B", 2),
      activity("C", 5),
      activity("D", 1),
    ];
    const rels = [
      link("A-B", "A", "B"),
      link("A-C", "A", "C"),
      link("B-D", "B", "D"),
      link("C-D", "C", "D"),
    ];
    const result = calculateCpm({
      dataDate: MON_2025_01_06,
      projectStart: MON_2025_01_06,
      projectCalendarId: "cal-mf",
      calendars: new Map([["cal-mf", cal]]),
      activities,
      relationships: rels,
    });

    const byId = new Map(result.activities.map((a) => [a.id, a]));
    expect(byId.get("B")!.freeFloatMinutes).toBe(3 * DAY_MIN);
    expect(byId.get("C")!.freeFloatMinutes).toBe(0);
    expect(byId.get("A")!.freeFloatMinutes).toBe(0);
  });
});

describe("P6 acceptance — Calendars (engine2)", () => {
  it("CAL-4: two otherwise identical activities on different calendars yield different dates when non-work periods differ", () => {
    const calNoHoliday = createWholeDayWorkClock({
      id: "cal-clean",
      name: "Mon-Fri 8h clean",
      workDays: 0b0111110,
      holidays: [],
      hoursPerDay: 8,
    });
    const calWithHoliday = createWholeDayWorkClock({
      id: "cal-holiday",
      name: "Mon-Fri 8h + Tue holiday",
      workDays: 0b0111110,
      holidays: ["2025-01-07"], // Tue of the project's first week
      hoursPerDay: 8,
    });

    const X = activity("X", 5, "cal-clean");
    const Y = activity("Y", 5, "cal-holiday");

    const result = calculateCpm({
      dataDate: MON_2025_01_06,
      projectStart: MON_2025_01_06,
      projectCalendarId: "cal-clean",
      calendars: new Map<string, WorkClock>([
        ["cal-clean", calNoHoliday],
        ["cal-holiday", calWithHoliday],
      ]),
      activities: [X, Y],
      relationships: [],
    });

    const byId = new Map(result.activities.map((a) => [a.id, a]));
    const xEF = byId.get("X")!.earlyFinish;
    const yEF = byId.get("Y")!.earlyFinish;

    // Same project start, same nominal duration (5 workdays). X finishes
    // Fri-10; Y skips the Tue holiday and finishes Mon-13 — a one-workday
    // slip that spans 3 calendar days because it crosses a weekend.
    expect(yEF - xEF).toBe(3 * 86_400_000);

    expect(calNoHoliday.diffWork(MON_2025_01_06, xEF)).toBe(5 * DAY_MIN);
    expect(calWithHoliday.diffWork(MON_2025_01_06, yEF)).toBe(5 * DAY_MIN);
  });

  it.todo(
    "CAL-5: holiday and shift exceptions alter working-time addition without corrupting neighboring work shifts",
  );
});

describe("P6 acceptance — Constraints", () => {
  it.todo(
    "CON-6: applying a finish constraint alters late or early dates per the selected constraint semantics and emits a visible diagnostic",
  );

  it.todo(
    "CON-7: constraint-driven dates remain distinguishable from pure logic-driven dates in trace output",
  );
});

describe("P6 acceptance — Progress", () => {
  it.todo(
    "PRG-8: Physical, Duration, and Units percent-complete types produce distinct progress results under identical base activity and assignment data",
  );

  it.todo(
    "PRG-9: updating actual start and remaining duration on an in-progress activity correctly recalculates projected finish",
  );

  it.todo(
    "PRG-10: out-of-sequence updates follow the selected progress rule (retained logic / progress override / actual dates) and produce repeatable outcomes",
  );
});

describe("P6 acceptance — Float paths", () => {
  it.todo(
    "PTH-11: multiple float-path analysis produces ranked paths using total float and, separately, free float as the basis",
  );

  it.todo(
    "PTH-12: path analysis targeted to a selected milestone differs from whole-project-finish analysis when the selected endpoint lies on a different controlling chain",
  );
});

describe("P6 acceptance — Leveling", () => {
  it.todo(
    "LVL-13: resource overallocations are detectable before leveling and resolved according to selected leveling priorities after leveling",
  );

  it.todo(
    "LVL-14: preserve-scheduled-early-and-late-dates mode materially constrains how far leveling may move activities",
  );

  it.todo(
    "LVL-15: selected-resource leveling does not move activities solely because of non-selected resources",
  );

  it.todo(
    "LVL-16: leveling emits a log explaining moved activities, governing priorities, and post-level cost recalculation when enabled",
  );
});

describe("P6 acceptance — Interoperability / XER", () => {
  it.todo(
    "XER-17: importing a multi-project XER file preserves interproject relationships where both projects are included",
  );

  it.todo(
    "XER-18: scheduling a project with missing external projects and the ignore-external-relationships option enabled preserves external activity dates",
  );

  it.todo("XER-19: XER import does not fabricate baselines from absent baseline data");

  it.todo(
    "XER-20: update-existing import actions respect delete-unreferenced settings for activities, activity relationships, and activity resource assignments",
  );
});
