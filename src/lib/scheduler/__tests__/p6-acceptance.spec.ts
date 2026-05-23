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

  it("CAL-5: holiday and shift exceptions alter working-time addition without corrupting neighboring work shifts", async () => {
    const { createExceptionWorkClock } = await import("../engine2/work-clock-exceptions");
    // Base: Mon-Fri 8h. Exceptions:
    //   - Tue 2025-01-07 → holiday (non-working).
    //   - Sat 2025-01-11 → working exception with split shift 08:00-12:00 + 13:00-17:00.
    const cal = createExceptionWorkClock({
      id: "cal-ex",
      name: "Mon-Fri 8h + Tue holiday + Sat split shift",
      workDays: 0b0111110,
      hoursPerDay: 8,
      holidays: ["2025-01-07"],
      exceptions: [
        {
          date: "2025-01-11",
          kind: "working",
          windows: [
            { startMinuteOfDay: 8 * 60, endMinuteOfDay: 12 * 60 },
            { startMinuteOfDay: 13 * 60, endMinuteOfDay: 17 * 60 },
          ],
        },
      ],
    });
    const cleanCal = createExceptionWorkClock({
      id: "cal-clean",
      name: "Mon-Fri 8h clean",
      workDays: 0b0111110,
      hoursPerDay: 8,
    });

    // 5 workdays starting Mon-06 on the clean calendar lands Fri-10 16:00? No,
    // hoursPerDay window is [00:00, 08:00). 5*480 min from Mon 00:00 → Fri 08:00.
    expect(cleanCal.addWork(MON_2025_01_06, 5 * DAY_MIN)).toBe(
      Date.UTC(2025, 0, 10, 8, 0),
    );

    // Same 5 workdays on the exception calendar: Tue is skipped (holiday), so
    // the 5th workday is consumed on the Saturday split shift, ending at the
    // end of the second shift (17:00 Sat).
    // Days consumed: Mon-06, Wed-08, Thu-09, Fri-10, Sat-11.
    // On Sat the 480-min budget = 4h shift 1 + 4h shift 2 → end at 17:00.
    expect(cal.addWork(MON_2025_01_06, 5 * DAY_MIN)).toBe(
      Date.UTC(2025, 0, 11, 17, 0),
    );

    // Neighboring shift integrity: Sat shift 1 ending at 12:00, +1 min jumps
    // to 13:01 (does not bleed into lunch).
    expect(cal.addWork(Date.UTC(2025, 0, 11, 8, 0), 4 * 60 + 1)).toBe(
      Date.UTC(2025, 0, 11, 13, 1),
    );

    // Backward across the holiday is the inverse: Wed 00:30 - 60 min →
    // 30 min Wed (0 because non-Wed has no exception, Wed is workday on this
    // clean cal; ...). For exception cal Wed is workday (not in exceptions),
    // so Wed 00:30 - 60 min = 30 min Wed + 30 min Mon end (Tue holiday).
    const wed0030 = Date.UTC(2025, 0, 8, 0, 30);
    expect(cal.addWork(wed0030, -60)).toBe(Date.UTC(2025, 0, 6, 7, 30));

    // Sanity: diffWork on the Saturday accounts for 480 min total split across
    // two shifts; the lunch hour does not count.
    expect(cal.diffWork(Date.UTC(2025, 0, 11), Date.UTC(2025, 0, 12))).toBe(
      8 * 60,
    );
  });
});

describe("P6 acceptance — Constraints", () => {
  it("CON-6: FNLT finish constraint pulls late finish earlier and emits a diagnostic", () => {
    const cal = monFri();
    // A(5d) → B(5d). Without constraint, project finish = 10 workdays.
    // Add FNLT on B at end of workday 7 (Mon-13 EOD == Tue-14 00:00 wall).
    // Late finish for B should be the constraint, not project finish.
    const A = activity("A", 5);
    const B = activity("B", 5);
    const fnltInstant = Date.UTC(2025, 0, 14); // Tue 00:00 (== Mon EOD position)
    B.constraints = [
      { type: "fnlt", instant: fnltInstant, calendarId: "cal-mf" },
    ];
    const result = calculateCpm({
      dataDate: MON_2025_01_06,
      projectStart: MON_2025_01_06,
      projectCalendarId: "cal-mf",
      calendars: new Map([["cal-mf", cal]]),
      activities: [A, B],
      relationships: [link("A-B", "A", "B")],
    });
    const byId = new Map(result.activities.map((a) => [a.id, a]));
    const bRes = byId.get("B")!;
    // B's late finish should be at or earlier than the constraint snap.
    expect(bRes.lateFinish).toBeLessThanOrEqual(fnltInstant);
    // The constraint should have created negative total float on B (5 days
    // of work needs to fit in 2 days of slack window).
    expect(bRes.totalFloatMinutes).toBeLessThan(0);
    // A diagnostic should mention the FNLT constraint.
    expect(
      result.diagnostics.some(
        (d) => d.activityId === "B" && d.code === "constraint-fnlt",
      ),
    ).toBe(true);
  });

  it("CON-7: constraint-driven dates expose a non-logic governingCause", () => {
    const cal = monFri();
    const A = activity("A", 3);
    const snetInstant = Date.UTC(2025, 0, 13); // Mon week 2
    A.constraints = [
      { type: "snet", instant: snetInstant, calendarId: "cal-mf" },
    ];
    const result = calculateCpm({
      dataDate: MON_2025_01_06,
      projectStart: MON_2025_01_06,
      projectCalendarId: "cal-mf",
      calendars: new Map([["cal-mf", cal]]),
      activities: [A],
      relationships: [],
    });
    const aRes = result.activities[0];
    expect(aRes.governingCause).toBe("snet");
    expect(aRes.earlyStart).toBe(snetInstant);
    // Constraint diagnostic must be present and tagged with the activity id.
    const diag = result.diagnostics.find(
      (d) => d.activityId === "A" && d.code === "constraint-snet",
    );
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("info");
  });
});

describe("P6 acceptance — Progress", () => {
  it("PRG-8: Physical, Duration, and Units percent-complete types produce distinct reported percent-complete values given the same base activity and assignment data", () => {
    const cal = monFri();
    // All three start Mon-06, original 10d, remaining 4d, data date Mon-13.
    // Duration%   = actual / (actual + remaining) = 5 / (5+4) = 55.55…
    // Physical%   = author-supplied 25 (independent of duration).
    // Units%      = author-supplied 80 (Phase 1.3 stub, independent of duration).
    const dataDate = Date.UTC(2025, 0, 13);
    const mk = (id: string, pct: "duration" | "physical" | "units"): EngineActivity => {
      const a = activity(id, 10);
      a.percentCompleteType = pct;
      a.actualStart = MON_2025_01_06;
      a.remainingDuration = { minutes: 4 * DAY_MIN, authoringCalendarId: "cal-mf" };
      if (pct === "physical") a.physicalPercentComplete = 25;
      if (pct === "units") a.unitsPercentComplete = 80;
      return a;
    };
    const D = mk("D", "duration");
    const P = mk("P", "physical");
    const U = mk("U", "units");
    const result = calculateCpm({
      dataDate,
      projectStart: MON_2025_01_06,
      projectCalendarId: "cal-mf",
      calendars: new Map([["cal-mf", cal]]),
      activities: [D, P, U],
      relationships: [],
    });
    const byId = new Map(result.activities.map((a) => [a.id, a]));
    const d = byId.get("D")!;
    const p = byId.get("P")!;
    const u = byId.get("U")!;

    // Status is derived deterministically from actuals.
    expect(d.status).toBe("in-progress");
    expect(p.status).toBe("in-progress");
    expect(u.status).toBe("in-progress");

    // Duration% derives from actual/at-completion working minutes.
    expect(d.actualDurationMinutes).toBe(5 * DAY_MIN);
    expect(d.remainingDurationMinutes).toBe(4 * DAY_MIN);
    expect(d.atCompletionDurationMinutes).toBe(9 * DAY_MIN);
    expect(d.durationPercentComplete).toBeCloseTo((5 / 9) * 100, 6);
    expect(d.reportedPercentComplete).toBeCloseTo((5 / 9) * 100, 6);

    // Physical% reports the author-supplied value verbatim and is NOT the
    // duration-derived value.
    expect(p.reportedPercentComplete).toBe(25);
    expect(p.reportedPercentComplete).not.toBeCloseTo(d.durationPercentComplete, 3);

    // Units% reports the author-supplied stub value verbatim and is NOT the
    // duration-derived value.
    expect(u.reportedPercentComplete).toBe(80);
    expect(u.reportedPercentComplete).not.toBeCloseTo(d.durationPercentComplete, 3);

    // The three reported values are mutually distinct.
    expect(new Set([
      Math.round(d.reportedPercentComplete * 1000),
      Math.round(p.reportedPercentComplete * 1000),
      Math.round(u.reportedPercentComplete * 1000),
    ]).size).toBe(3);
  });

  it("PRG-9: in-progress activity projects remaining duration from the data date", () => {
    const cal = monFri();
    // A started Mon-06, originally 10d, has 4d remaining, data date Mon-13.
    // Projected finish = data date + 4 workdays under cal = Fri-17 EOD.
    const A = activity("A", 10);
    A.actualStart = MON_2025_01_06;
    A.remainingDuration = { minutes: 4 * DAY_MIN, authoringCalendarId: "cal-mf" };
    const dataDate = Date.UTC(2025, 0, 13);
    const result = calculateCpm({
      dataDate,
      projectStart: MON_2025_01_06,
      projectCalendarId: "cal-mf",
      calendars: new Map([["cal-mf", cal]]),
      activities: [A],
      relationships: [],
    });
    const aRes = result.activities[0];
    expect(aRes.earlyStart).toBe(MON_2025_01_06);
    // 4 workdays from Mon-13 00:00 lands at Fri-17 08:00 (position equiv to Sat).
    expect(cal.diffWork(dataDate, aRes.earlyFinish)).toBe(4 * DAY_MIN);
    expect(aRes.governingCause).toBe("data-date");
    expect(
      result.diagnostics.some(
        (d) => d.activityId === "A" && d.code === "in-progress",
      ),
    ).toBe(true);
  });

  it("PRG-10: out-of-sequence updates follow the selected progress rule (retained-logic vs progress-override) and produce repeatable outcomes", () => {
    const cal = monFri();
    // Setup: A (10d) FS→ B (5d). Data date = Mon-20.
    // A is in progress: actualStart Mon-06, remaining 6d → projected EF
    //   from data date Mon-20 + 6d = Mon-27 EOD (position).
    // B is OOS in progress: actualStart Mon-13 (before A finished),
    //   remaining 3d.
    const A = activity("A", 10);
    A.actualStart = MON_2025_01_06;
    A.remainingDuration = { minutes: 6 * DAY_MIN, authoringCalendarId: "cal-mf" };

    const B = activity("B", 5);
    B.actualStart = Date.UTC(2025, 0, 13);
    B.remainingDuration = { minutes: 3 * DAY_MIN, authoringCalendarId: "cal-mf" };

    const rels = [link("A-B", "A", "B")];
    const dataDate = Date.UTC(2025, 0, 20);

    const baseInput = {
      dataDate,
      projectStart: MON_2025_01_06,
      projectCalendarId: "cal-mf",
      calendars: new Map([["cal-mf", cal]]),
      activities: [A, B],
      relationships: rels,
    };

    // ---- Retained-logic rule (default) ----
    const retained = calculateCpm(baseInput);
    const Br = retained.activities.find((x) => x.id === "B")!;
    const Ar = retained.activities.find((x) => x.id === "A")!;
    // ES is preserved as the actual start regardless of rule.
    expect(Br.earlyStart).toBe(B.actualStart);
    // Under retained-logic, B's remaining 3d cannot begin before A's
    // projected EF. So B.EF = A.EF + 3 working days.
    expect(cal.diffWork(Ar.earlyFinish, Br.earlyFinish)).toBe(3 * DAY_MIN);

    // Diagnostics: violation surfaced and rule applied.
    const codes = new Set(retained.diagnostics.map((d) => d.code));
    expect(codes.has("out_of_sequence_progress_detected")).toBe(true);
    expect(codes.has("relationship_logic_violated_by_actuals")).toBe(true);
    expect(codes.has("predecessor_incomplete_successor_started")).toBe(true);
    expect(codes.has("retained_logic_applied")).toBe(true);
    expect(codes.has("progress_override_applied")).toBe(false);

    // Repeatable: a second identical run yields identical dates.
    const retained2 = calculateCpm(baseInput);
    const Br2 = retained2.activities.find((x) => x.id === "B")!;
    expect(Br2.earlyFinish).toBe(Br.earlyFinish);

    // ---- Progress-override rule ----
    const overridden = calculateCpm({
      ...baseInput,
      progress: { outOfSequenceRule: "progress-override" },
    });
    const Bo = overridden.activities.find((x) => x.id === "B")!;
    // Under progress-override, B's 3d remaining projects from data date,
    // ignoring the broken FS link.
    expect(Bo.earlyStart).toBe(B.actualStart);
    expect(cal.diffWork(dataDate, Bo.earlyFinish)).toBe(3 * DAY_MIN);

    const ocodes = new Set(overridden.diagnostics.map((d) => d.code));
    expect(ocodes.has("out_of_sequence_progress_detected")).toBe(true);
    expect(ocodes.has("progress_override_applied")).toBe(true);
    expect(ocodes.has("retained_logic_applied")).toBe(false);

    // The two rules produce different outcomes — proves the selector matters.
    expect(Bo.earlyFinish).not.toBe(Br.earlyFinish);

    // ---- Deferred "actual-dates" rule emits warning + falls back ----
    const deferred = calculateCpm({
      ...baseInput,
      progress: { outOfSequenceRule: "actual-dates" },
    });
    expect(
      deferred.diagnostics.some((d) => d.code === "out_of_sequence_rule_deferred"),
    ).toBe(true);
    const Bd = deferred.activities.find((x) => x.id === "B")!;
    expect(Bd.earlyFinish).toBe(Br.earlyFinish); // fell back to retained-logic
  });
});


describe("P6 acceptance — Float paths", () => {
  it("PTH-11: multiple float-path analysis ranks paths by total float, path 1 = critical chain", () => {
    const cal = monFri();
    // Diamond: A→B(3d)→D and A→C(5d)→D. C-path is critical (path 1),
    // B-path has 2d of total float (path 2).
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
      floatPathCount: 2,
    });

    expect(result.floatPaths).toBeDefined();
    const fp = result.floatPaths!;
    expect(fp.basis).toBe("total-float");
    expect(fp.endpointActivityId).toBe("D");
    expect(fp.paths).toHaveLength(2);

    const p1 = fp.paths[0];
    expect(p1.rank).toBe(1);
    expect(p1.pathFloatMinutes).toBe(0);
    expect(p1.steps.map((s) => s.activityId)).toEqual(["A", "C", "D"]);

    const p2 = fp.paths[1];
    expect(p2.rank).toBe(2);
    expect(p2.pathFloatMinutes).toBe(2 * DAY_MIN);
    expect(p2.steps.map((s) => s.activityId)).toContain("B");
    expect(p1.pathFloatMinutes).toBeLessThanOrEqual(p2.pathFloatMinutes);
  });

  it("PTH-12: float-path analysis targeted to a selected milestone endpoint differs from whole-project analysis", () => {
    const cal = monFri();
    // A(1d) → B(3d) → M1, A(1d) → C(5d) → M2. M2 is project finish (default).
    // Selecting M1 must route the path through B, not C.
    const activities: EngineActivity[] = [
      activity("A", 1),
      activity("B", 3),
      activity("C", 5),
      { ...activity("M1", 0), type: "milestone-finish" },
      { ...activity("M2", 0), type: "milestone-finish" },
    ];
    const rels = [
      link("A-B", "A", "B"),
      link("A-C", "A", "C"),
      link("B-M1", "B", "M1"),
      link("C-M2", "C", "M2"),
    ];

    const defaultRun = calculateCpm({
      dataDate: MON_2025_01_06,
      projectStart: MON_2025_01_06,
      projectCalendarId: "cal-mf",
      calendars: new Map([["cal-mf", cal]]),
      activities,
      relationships: rels,
      floatPathCount: 1,
    });
    expect(defaultRun.floatPaths!.endpointActivityId).toBe("M2");
    expect(
      defaultRun.floatPaths!.paths[0].steps.map((s) => s.activityId),
    ).toEqual(["A", "C", "M2"]);

    const selectedRun = calculateCpm({
      dataDate: MON_2025_01_06,
      projectStart: MON_2025_01_06,
      projectCalendarId: "cal-mf",
      calendars: new Map([["cal-mf", cal]]),
      activities,
      relationships: rels,
      floatPathCount: 1,
      floatPathEndpointActivityId: "M1",
    });
    expect(selectedRun.floatPaths!.endpointActivityId).toBe("M1");
    const ids = selectedRun.floatPaths!.paths[0].steps.map((s) => s.activityId);
    expect(ids).toEqual(["A", "B", "M1"]);
    expect(ids).not.toContain("C");
  });
});

describe("P6 acceptance — Leveling", () => {
  // Phase 1.6 leveling fixture helpers (whole-day, units-based, narrow).
  const lvlCal = monFri("cal-mf");

  function lvlActivity(
    id: string,
    durDays: number,
    levelingPriority?: number,
  ): EngineActivity {
    const a = activity(id, durDays);
    if (levelingPriority !== undefined) a.levelingPriority = levelingPriority;
    return a;
  }

  function lvlAsn(
    id: string,
    activityId: string,
    resourceId: string,
    units: number,
  ) {
    return {
      id,
      activityId,
      resourceId,
      budgetedUnits: units,
      actualUnits: 0,
      remainingUnits: units,
    };
  }

  it("LVL-13: resource overallocations are detectable before leveling and resolved after leveling per priority", () => {
    // Two 5-day activities both fully load resource R (cap=8 units/day, demand=8 each).
    // A has higher priority (1), B has lower (2). After leveling, B is delayed to start
    // when A finishes; no remaining overallocation on R.
    const A = lvlActivity("A", 5, 1);
    const B = lvlActivity("B", 5, 2);
    const result = calculateCpm({
      dataDate: MON_2025_01_06,
      projectStart: MON_2025_01_06,
      projectCalendarId: "cal-mf",
      calendars: new Map([["cal-mf", lvlCal]]),
      activities: [A, B],
      relationships: [],
      resources: [{ id: "R", name: "Crew", type: "labor", maxUnitsPerDay: 8 }],
      assignments: [lvlAsn("a1", "A", "R", 40), lvlAsn("a2", "B", "R", 40)],
      leveling: { enabled: true },
    });

    expect(result.leveling).toBeDefined();
    const lv = result.leveling!;
    // BEFORE: both activities run on the same workdays at 8 units/day each → 16 > 8.
    expect(lv.overallocationsBefore.length).toBe(1);
    expect(lv.overallocationsBefore[0].resourceId).toBe("R");
    expect(lv.overallocationsBefore[0].days.length).toBeGreaterThan(0);
    // AFTER: no overallocation remains on R.
    expect(lv.overallocationsAfter).toEqual([]);
    // B was moved, A was not.
    const moved = lv.entries.filter((e) => e.delayMinutes > 0);
    expect(moved.length).toBe(1);
    expect(moved[0].activityId).toBe("B");
    expect(moved[0].resourcesCausingConflict).toEqual(["R"]);
    // Delay = 5 workdays (A's duration).
    expect(moved[0].delayMinutes).toBe(5 * DAY_MIN);
    // CPM dates on result.activities are NOT mutated.
    const bCpm = result.activities.find((a) => a.id === "B")!;
    expect(bCpm.earlyStart).toBe(MON_2025_01_06);
  });

  it("LVL-14: preserve-scheduled-early-and-late-dates mode materially constrains how far leveling may move activities", () => {
    // Setup chosen so B has *some* float but not enough to absorb the conflict:
    //   A (5d, prio 1) → C (3d) gives the project an 8-day critical chain.
    //     A.LF = day 5, A.LS = 0  → A has zero float.
    //   B (5d, prio 2) has no successors → LF = projectFinish = day 8, LS = day 3.
    //     B has 3 workdays of float.
    //   Both A and B fully load resource R (cap 8, demand 8 each).
    //
    // Without preserve: B can be delayed 5 workdays → fully resolved.
    // With preserve   : B may only be delayed 3 workdays (its float); the
    //                   conflict on the remaining overlap days is unresolved.
    const A = lvlActivity("A", 5, 1);
    const B = lvlActivity("B", 5, 2);
    const C = lvlActivity("C", 3);
    const rels = [link("A-C", "A", "C")];
    const resources = [{ id: "R", name: "Crew", type: "labor" as const, maxUnitsPerDay: 8 }];
    const assignments = [lvlAsn("a1", "A", "R", 40), lvlAsn("a2", "B", "R", 40)];

    const baseInput = {
      dataDate: MON_2025_01_06,
      projectStart: MON_2025_01_06,
      projectCalendarId: "cal-mf",
      calendars: new Map([["cal-mf", lvlCal]]),
      activities: [A, B, C],
      relationships: rels,
      resources,
      assignments,
    };

    // ---- Without preserve-dates: B delayed the full 5 days. ----
    const unrestricted = calculateCpm({
      ...baseInput,
      leveling: { enabled: true },
    });
    const uLv = unrestricted.leveling!;
    const uB = uLv.entries.find((e) => e.activityId === "B")!;
    expect(uB.delayMinutes).toBe(5 * DAY_MIN);
    expect(uLv.overallocationsAfter).toEqual([]);
    expect(uB.preserveDatesOutcome).toBe("n/a");

    // ---- With preserve-dates: leveler must respect B's late-start window. ----
    const preserved = calculateCpm({
      ...baseInput,
      leveling: {
        enabled: true,
        preserveScheduledEarlyAndLateDates: true,
      },
    });
    const pLv = preserved.leveling!;
    const pB = pLv.entries.find((e) => e.activityId === "B")!;

    // B's CPM late-start gives it 3 workdays of float; preserve caps the
    // delay at exactly that. Strictly less than the unrestricted 5 days.
    expect(pB.delayMinutes).toBeLessThan(uB.delayMinutes);
    expect(pB.delayMinutes).toBeLessThanOrEqual(3 * DAY_MIN);
    expect(pB.leveledStart).toBeLessThanOrEqual(pB.cpmLateStart);
    expect(pB.preserveDatesOutcome).toBe("limited");
    expect(pB.resourcesCausingConflict).toContain("R");

    // CPM dates on the result are NOT mutated by leveling.
    const bCpm = preserved.activities.find((a) => a.id === "B")!;
    expect(bCpm.earlyStart).toBe(MON_2025_01_06);

    // Residual overallocation surfaced after preserve-dates leveling.
    expect(pLv.overallocationsAfter.length).toBeGreaterThan(0);
    expect(pLv.overallocationsAfter[0].resourceId).toBe("R");

    // Options echo reflects the enabled rule.
    expect(pLv.options.preserveScheduledEarlyAndLateDates).toBe(true);

    // Required Phase 2.3 diagnostics surface on the leveling warnings.
    const codes = pLv.warnings.map((w) => w.code);
    expect(codes).toContain("leveling_preserve_dates_applied");
    expect(codes).toContain("leveling_move_limited_by_late_date");
    expect(codes).toContain("leveling_overallocation_unresolved");
    // The deferred warning from Phase 1.6 is gone.
    expect(codes).not.toContain("leveling_preserve_dates_deferred");

    // Repeatable: identical inputs yield identical leveled dates.
    const preserved2 = calculateCpm({
      ...baseInput,
      leveling: {
        enabled: true,
        preserveScheduledEarlyAndLateDates: true,
      },
    });
    const pB2 = preserved2.leveling!.entries.find((e) => e.activityId === "B")!;
    expect(pB2.leveledStart).toBe(pB.leveledStart);
    expect(pB2.leveledFinish).toBe(pB.leveledFinish);
  });


  it("LVL-15: selected-resource leveling does not move activities solely because of non-selected resources", () => {
    // A and B both overload R2 (cap=1, demand=1 each, same window). R1 is fine.
    // Leveling selects ONLY R1 → no moves should occur.
    const A = lvlActivity("A", 5, 1);
    const B = lvlActivity("B", 5, 2);
    const result = calculateCpm({
      dataDate: MON_2025_01_06,
      projectStart: MON_2025_01_06,
      projectCalendarId: "cal-mf",
      calendars: new Map([["cal-mf", lvlCal]]),
      activities: [A, B],
      relationships: [],
      resources: [
        { id: "R1", name: "OK", type: "labor", maxUnitsPerDay: 100 },
        { id: "R2", name: "Tight", type: "labor", maxUnitsPerDay: 1 },
      ],
      assignments: [
        // Both A and B touch R1 lightly (no conflict) and R2 heavily (conflict).
        lvlAsn("a1", "A", "R1", 10),
        lvlAsn("a2", "B", "R1", 10),
        lvlAsn("a3", "A", "R2", 5),
        lvlAsn("a4", "B", "R2", 5),
      ],
      leveling: { enabled: true, selectedResourceIds: ["R1"] },
    });

    const lv = result.leveling!;
    expect(lv.consideredResourceIds).toEqual(["R1"]);
    // No considered-resource overallocation → no moves.
    const moved = lv.entries.filter((e) => e.delayMinutes > 0);
    expect(moved.length).toBe(0);
    // R2 overallocations are NOT reported here because R2 isn't considered.
    expect(lv.overallocationsBefore.find((o) => o.resourceId === "R2")).toBeUndefined();
  });

  it("LVL-16: leveling emits an entry-level log with original CPM dates, leveled dates, delay, causing resource, and priority reason", () => {
    const A = lvlActivity("A", 3, 1);
    const B = lvlActivity("B", 3, 5);
    const result = calculateCpm({
      dataDate: MON_2025_01_06,
      projectStart: MON_2025_01_06,
      projectCalendarId: "cal-mf",
      calendars: new Map([["cal-mf", lvlCal]]),
      activities: [A, B],
      relationships: [],
      resources: [{ id: "R", name: "Crew", type: "labor", maxUnitsPerDay: 8 }],
      assignments: [lvlAsn("a1", "A", "R", 24), lvlAsn("a2", "B", "R", 24)],
      leveling: { enabled: true },
    });

    const lv = result.leveling!;
    const bEntry = lv.entries.find((e) => e.activityId === "B");
    expect(bEntry).toBeDefined();
    expect(bEntry!.cpmEarlyStart).toBe(MON_2025_01_06);
    expect(bEntry!.cpmEarlyFinish).toBeGreaterThan(MON_2025_01_06);
    expect(bEntry!.leveledStart).toBeGreaterThan(bEntry!.cpmEarlyStart);
    expect(bEntry!.delayMinutes).toBeGreaterThan(0);
    expect(bEntry!.resourcesCausingConflict).toContain("R");
    expect(bEntry!.priorityReason).toMatch(/priority=5/);
    // Options echoed.
    expect(lv.options.enabled).toBe(true);
    expect(lv.options.maxDelayWorkdays).toBe(365);
    // Phase 1.6 honest-limitations warnings are present.
    const codes = lv.warnings.map((w) => w.code);
    expect(codes).toContain("leveling_whole_day_only");
    expect(codes).toContain("leveling_successors_not_reflowed");
  });
});

describe("P6 acceptance — Interoperability / XER", () => {
  it("XER-17: importing a multi-project XER preserves interproject relationships when both projects are included", async () => {
    const { importXerForEngine2, xerToCpmInput } = await import("../engine2");
    const { FIXTURE_MULTI_PROJECT_INTERPROJECT } = await import(
      "./fixtures/xer-fixtures"
    );
    const importResult = importXerForEngine2(FIXTURE_MULTI_PROJECT_INTERPROJECT);

    // Both projects parsed; both tasks present in the engine graph.
    expect(importResult.projects.map((p) => p.id).sort()).toEqual(["P1", "P2"]);
    expect(importResult.stats.projectsParsed).toBe(2);
    expect(importResult.activities.map((a) => a.id).sort()).toEqual([
      "P1A",
      "P2B",
    ]);
    // Cross-project task → project map preserved.
    expect(importResult.activityProjectIds["P1A"]).toBe("P1");
    expect(importResult.activityProjectIds["P2B"]).toBe("P2");

    // Interproject relationship is in the engine graph (NOT in externals).
    expect(importResult.relationships).toHaveLength(1);
    expect(importResult.externalRelationships).toHaveLength(0);
    expect(importResult.interprojectRelationships).toHaveLength(1);
    const ip = importResult.interprojectRelationships[0];
    expect(ip.predProjectId).toBe("P1");
    expect(ip.succProjectId).toBe("P2");
    expect(ip.predActivityId).toBe("P1A");
    expect(ip.succActivityId).toBe("P2B");
    expect(ip.type).toBe("FS");

    // Diagnostic emitted.
    expect(
      importResult.diagnostics.some(
        (d) => d.code === "interproject_relationship_mapped",
      ),
    ).toBe(true);

    // Schedule actually calculates: P2B starts after P1A finishes.
    const { cpmInput } = xerToCpmInput(importResult);
    const result = calculateCpm(cpmInput);
    const byId = new Map(result.activities.map((a) => [a.id, a]));
    const a = byId.get("P1A")!;
    const b = byId.get("P2B")!;
    expect(b.earlyStart).toBeGreaterThanOrEqual(a.earlyFinish);
  });

  it("XER-18: missing-external-project behavior with ignore-external-relationships option", async () => {
    const { importXerForEngine2, xerToCpmInput, reconcileSchedule } =
      await import("../engine2");
    const { FIXTURE_MISSING_EXTERNAL_PROJECT } = await import(
      "./fixtures/xer-fixtures"
    );
    const importResult = importXerForEngine2(FIXTURE_MISSING_EXTERNAL_PROJECT);

    // External relationship preserved with full identity (incl. predProjectId).
    expect(importResult.externalRelationships).toHaveLength(1);
    const ext = importResult.externalRelationships[0];
    expect(ext.predProjectId).toBe("P_EXT");
    expect(ext.predTaskXerId).toBe("9999");
    expect(ext.succProjectId).toBe("P1");
    expect(ext.predProjectMissing).toBe(true);

    // external_project_missing diagnostic raised (not silently dropped).
    expect(
      importResult.diagnostics.some((d) => d.code === "external_project_missing"),
    ).toBe(true);
    // engine2 graph does NOT contain the external link.
    expect(importResult.relationships).toHaveLength(0);

    // -- ignoreExternalRelationships=true → calculation succeeds, classified acceptable.
    const ignored = xerToCpmInput(importResult, {
      ignoreExternalRelationships: true,
    });
    expect(ignored.externalRelationshipsIgnored).toBe(true);
    expect(
      ignored.diagnostics.some(
        (d) => d.code === "external_relationship_ignored_by_option",
      ),
    ).toBe(true);
    const okResult = calculateCpm(ignored.cpmInput);
    const okReport = reconcileSchedule({
      importResult,
      engineResult: okResult,
      externalRelationshipsIgnored: true,
    });
    const okEntry = okReport.entries.find(
      (e) => e.subject === "relationships:external",
    );
    expect(okEntry?.kind).toBe("acceptable-known-limitation");
    expect(okReport.summary.mismatch).toBe(0);

    // -- ignoreExternalRelationships=false → reconciliation flags mismatch.
    const honored = xerToCpmInput(importResult, {
      ignoreExternalRelationships: false,
    });
    expect(honored.externalRelationshipsIgnored).toBe(false);
    expect(
      honored.diagnostics.some(
        (d) => d.code === "external_relationship_requires_imported_project",
      ),
    ).toBe(true);
    const honoredResult = calculateCpm(honored.cpmInput);
    const honoredReport = reconcileSchedule({
      importResult,
      engineResult: honoredResult,
      externalRelationshipsIgnored: false,
    });
    const mismatchEntry = honoredReport.entries.find(
      (e) => e.subject === "relationships:external",
    );
    expect(mismatchEntry?.kind).toBe("mismatch");
    expect(honoredReport.summary.mismatch).toBeGreaterThan(0);
  });

  it("XER-19: XER import does not fabricate baselines from absent baseline data", async () => {
    const { importXerForEngine2, xerToCpmInput } = await import("../engine2");
    const xer = [
      "ERMHDR\t6.2",
      "%T\tPROJECT",
      "%F\tproj_short_name\tplan_start_date",
      "%R\tX\t2025-01-06 08:00",
      "%T\tTASK",
      "%F\ttask_id\ttask_code\ttask_name\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt",
      "%R\t1\tA\tOnly\t8\t8",
      "%E",
    ].join("\n");
    const importResult = importXerForEngine2(xer);
    // Importer always emits baseline_not_in_xer; never fabricates baseline data.
    expect(importResult.diagnostics.some((d) => d.code === "baseline_not_in_xer")).toBe(true);
    const { cpmInput } = xerToCpmInput(importResult);
    expect(cpmInput.baselines).toBeUndefined();
    const result = calculateCpm(cpmInput);
    expect(result.runRecord.optionsSnapshot.baselinesProvided).toBe(false);
    expect(result.activities.every((a) => a.baselineVariance === undefined)).toBe(true);
  });

  it("XER-20: update-existing import actions respect delete-unreferenced settings for activities, activity relationships, and activity resource assignments", async () => {
    const { applyImportAction, importXerForEngine2 } = await import("../engine2");

    function xer(opts: {
      tasks: Array<{ id: string; code: string; durHr?: number }>;
      preds?: Array<{ from: string; to: string }>;
      assignments?: Array<{ id: string; taskId: string }>;
    }): string {
      const L: string[] = ["ERMHDR\t6.2"];
      L.push("%T\tPROJECT");
      L.push("%F\tproj_id\tproj_short_name\tplan_start_date\tlast_recalc_date");
      L.push("%R\tP1\tP1\t2025-01-06 08:00\t2025-01-06 08:00");
      L.push("%T\tCALENDAR");
      L.push("%F\tclndr_id\tclndr_name\tday_hr_cnt\tclndr_data");
      L.push("%R\tCAL1\t5d\t8\t");
      L.push("%T\tRSRC");
      L.push("%F\trsrc_id\trsrc_name\trsrc_type\tclndr_id");
      L.push("%R\tR1\tCrew\tRT_Labor\tCAL1");
      L.push("%T\tTASK");
      L.push(
        "%F\ttask_id\tproj_id\ttask_code\ttask_name\tclndr_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt",
      );
      for (const t of opts.tasks) {
        L.push(
          `%R\t${t.id}\tP1\t${t.code}\t${t.code}\tCAL1\t${t.durHr ?? 8}\t${t.durHr ?? 8}`,
        );
      }
      if (opts.preds && opts.preds.length) {
        L.push("%T\tTASKPRED");
        L.push("%F\ttask_id\tproj_id\tpred_task_id\tpred_proj_id\tpred_type\tlag_hr_cnt");
        for (const p of opts.preds)
          L.push(`%R\t${p.to}\tP1\t${p.from}\tP1\tPR_FS\t0`);
      }
      if (opts.assignments && opts.assignments.length) {
        L.push("%T\tTASKRSRC");
        L.push(
          "%F\ttaskrsrc_id\ttask_id\trsrc_id\ttarget_qty\tact_reg_qty\tremain_qty\ttarget_cost\tact_reg_cost\tremain_cost",
        );
        for (const a of opts.assignments)
          L.push(`%R\t${a.id}\t${a.taskId}\tR1\t8\t0\t8\t0\t0\t0`);
      }
      L.push("%E");
      return L.join("\n");
    }

    // Seed: A→B→C with two assignments.
    const seed = applyImportAction({
      incoming: importXerForEngine2(
        xer({
          tasks: [
            { id: "1", code: "A" },
            { id: "2", code: "B" },
            { id: "3", code: "C" },
          ],
          preds: [
            { from: "1", to: "2" },
            { from: "2", to: "3" },
          ],
          assignments: [
            { id: "TA1", taskId: "1" },
            { id: "TA2", taskId: "2" },
          ],
        }),
      ),
      options: { action: "create-new-project", targetProjectId: "P1" },
    }).state;
    expect(seed.activities.map((a) => a.id).sort()).toEqual(["A", "B", "C"]);
    expect(seed.relationships).toHaveLength(2);
    expect(seed.assignments).toHaveLength(2);

    // Update with delete-unreferenced OFF: B/C and their links preserved.
    const incoming = importXerForEngine2(
      xer({ tasks: [{ id: "1", code: "A", durHr: 24 }] }),
    );
    const preserved = applyImportAction({
      existing: seed,
      incoming,
      options: { action: "update-existing-project", targetProjectId: "P1" },
    });
    expect(preserved.ok).toBe(true);
    expect(preserved.state.activities.map((a) => a.id).sort()).toEqual(["A", "B", "C"]);
    expect(preserved.state.relationships).toHaveLength(2);
    expect(preserved.state.assignments).toHaveLength(2);

    // Update with delete-unreferenced ON for all three supported categories.
    const cleaned = applyImportAction({
      existing: seed,
      incoming,
      options: {
        action: "update-existing-project",
        targetProjectId: "P1",
        deleteUnreferenced: {
          activities: true,
          relationships: true,
          assignments: true,
        },
      },
    });
    expect(cleaned.ok).toBe(true);
    expect(cleaned.state.activities.map((a) => a.id)).toEqual(["A"]);
    expect(cleaned.state.relationships).toHaveLength(0);
    expect(cleaned.state.assignments).toHaveLength(0);
    // A's duration was updated, not just preserved.
    expect(cleaned.state.activities[0].originalDuration.minutes).toBe(24 * 60);
    // Plan reports the deletions.
    expect(cleaned.plan.summary.delete).toBeGreaterThanOrEqual(4);
  });
});

