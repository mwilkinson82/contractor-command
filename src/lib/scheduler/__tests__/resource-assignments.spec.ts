/**
 * engine2 — Phase 1.5 resource/assignment math tests.
 *
 * Pure assignment-math + diagnostics. CPM dates are NOT under test here —
 * Phase 1.5 deliberately keeps activity calendar in charge of CPM dates and
 * does not let resource calendars drive scheduling yet (see ARCHITECTURE.md
 * §15).
 */

import { describe, expect, it } from "vitest";
import {
  assignmentAtCompletionCost,
  assignmentAtCompletionUnits,
  assignmentRemainingUnits,
  assignmentUnitsPercentComplete,
  calculateCpm,
  createWholeDayWorkClock,
  rollupActivityAssignments,
  type EngineActivity,
  type Resource,
  type ResourceAssignment,
} from "../engine2";

const DAY_MIN = 8 * 60;
const MON_2025_01_06 = Date.UTC(2025, 0, 6);

function monFri(id = "cal-mf") {
  return createWholeDayWorkClock({
    id,
    name: "Mon-Fri 8h",
    workDays: 0b0111110,
    holidays: [],
    hoursPerDay: 8,
  });
}

function unitsActivity(id: string): EngineActivity {
  return {
    id,
    name: id,
    type: "task",
    durationType: "fixed-dur-units",
    percentCompleteType: "units",
    calendarId: "cal-mf",
    originalDuration: { minutes: 10 * DAY_MIN, authoringCalendarId: "cal-mf" },
    remainingDuration: { minutes: 4 * DAY_MIN, authoringCalendarId: "cal-mf" },
    constraints: [],
    actualStart: MON_2025_01_06,
    unitsPercentComplete: 80, // authored fallback
  };
}

function asn(
  id: string,
  activityId: string,
  resourceId: string,
  budgeted: number,
  actual: number,
  remaining: number,
  cost?: { budgeted?: number; actual?: number; remaining?: number },
): ResourceAssignment {
  return {
    id,
    activityId,
    resourceId,
    budgetedUnits: budgeted,
    actualUnits: actual,
    remainingUnits: remaining,
    budgetedCost: cost?.budgeted,
    actualCost: cost?.actual,
    remainingCost: cost?.remaining,
  };
}

describe("engine2 assignment math helpers (Phase 1.5)", () => {
  it("derives at-completion + remaining + units% on a single assignment", () => {
    const a = asn("a1", "A", "r1", 100, 30, 70);
    expect(assignmentAtCompletionUnits(a)).toBe(100);
    expect(assignmentRemainingUnits(a)).toBe(70);
    expect(assignmentUnitsPercentComplete(a)).toBe(30);
  });

  it("falls back to budgeted-actual when remainingUnits is invalid", () => {
    const a = asn("a1", "A", "r1", 100, 30, Number.NaN);
    expect(assignmentRemainingUnits(a)).toBe(70);
  });

  it("clamps units% to 0 when at-completion is 0", () => {
    const a = asn("a1", "A", "r1", 0, 0, 0);
    expect(assignmentUnitsPercentComplete(a)).toBe(0);
  });

  it("rolls up units and cost across multiple assignments on one activity", () => {
    const a1 = asn("a1", "A", "r1", 80, 40, 40, {
      budgeted: 800,
      actual: 400,
      remaining: 400,
    });
    const a2 = asn("a2", "A", "r2", 40, 10, 30, {
      budgeted: 200,
      actual: 50,
      remaining: 150,
    });
    const sum = rollupActivityAssignments("A", [a1, a2])!;
    expect(sum.assignmentCount).toBe(2);
    expect(sum.budgetedUnits).toBe(120);
    expect(sum.actualUnits).toBe(50);
    expect(sum.remainingUnits).toBe(70);
    expect(sum.atCompletionUnits).toBe(120);
    // (40 + 10) / (40+40 + 10+30) = 50/120
    expect(sum.unitsPercentComplete).toBeCloseTo((50 / 120) * 100, 6);
    expect(sum.budgetedCost).toBe(1000);
    expect(sum.atCompletionCost).toBe(1000);
  });

  it("rollup returns undefined when activity has no assignments", () => {
    expect(rollupActivityAssignments("A", [])).toBeUndefined();
  });

  it("at-completion cost = actual + remaining", () => {
    const a = asn("a1", "A", "r1", 100, 30, 70, {
      budgeted: 1000,
      actual: 300,
      remaining: 700,
    });
    expect(assignmentAtCompletionCost(a)).toBe(1000);
  });
});

describe("engine2 units% derivation via assignments (Phase 1.5)", () => {
  it("derives reportedPercentComplete from assignment units when assignments exist", () => {
    const cal = monFri();
    const A = unitsActivity("A");
    const r1: Resource = { id: "r1", name: "Carp", type: "labor" };
    const a1 = asn("asn1", "A", "r1", 100, 60, 40); // 60% units

    const result = calculateCpm({
      dataDate: Date.UTC(2025, 0, 13),
      projectStart: MON_2025_01_06,
      projectCalendarId: "cal-mf",
      calendars: new Map([["cal-mf", cal]]),
      activities: [A],
      relationships: [],
      resources: [r1],
      assignments: [a1],
    });
    const aRes = result.activities[0];
    expect(aRes.assignmentSummary).toBeDefined();
    expect(aRes.assignmentSummary!.unitsPercentComplete).toBe(60);
    // Must NOT use the authored 80 fallback once assignments are present.
    expect(aRes.reportedPercentComplete).toBe(60);
    // No "missing assignments" diagnostic.
    expect(
      result.diagnostics.some((d) => d.code === "units_percent_without_assignments"),
    ).toBe(false);
  });

  it("emits units_percent_without_assignments diagnostic when none exist", () => {
    const cal = monFri();
    const A = unitsActivity("A");
    const result = calculateCpm({
      dataDate: Date.UTC(2025, 0, 13),
      projectStart: MON_2025_01_06,
      projectCalendarId: "cal-mf",
      calendars: new Map([["cal-mf", cal]]),
      activities: [A],
      relationships: [],
    });
    const aRes = result.activities[0];
    expect(aRes.assignmentSummary).toBeUndefined();
    // Falls back to the authored stub value (preserves PRG-8 behavior).
    expect(aRes.reportedPercentComplete).toBe(80);
    expect(
      result.diagnostics.some(
        (d) =>
          d.activityId === "A" && d.code === "units_percent_without_assignments",
      ),
    ).toBe(true);
  });
});

describe("engine2 assignment validation diagnostics (Phase 1.5)", () => {
  const cal = monFri();
  const baseInput = {
    dataDate: MON_2025_01_06,
    projectStart: MON_2025_01_06,
    projectCalendarId: "cal-mf",
    calendars: new Map([["cal-mf", cal]]),
  };

  function task(): EngineActivity {
    return {
      id: "A",
      name: "A",
      type: "task",
      durationType: "fixed-dur-units",
      percentCompleteType: "duration",
      calendarId: "cal-mf",
      originalDuration: { minutes: DAY_MIN, authoringCalendarId: "cal-mf" },
      remainingDuration: { minutes: DAY_MIN, authoringCalendarId: "cal-mf" },
      constraints: [],
    };
  }

  it("emits missing_resource when assignment references unknown resource", () => {
    const result = calculateCpm({
      ...baseInput,
      activities: [task()],
      relationships: [],
      resources: [],
      assignments: [asn("a1", "A", "ghost", 10, 0, 10)],
    });
    expect(
      result.diagnostics.some(
        (d) => d.code === "missing_resource" && d.activityId === "A",
      ),
    ).toBe(true);
  });

  it("emits missing_resource_calendar when resource points at unknown calendar", () => {
    const r1: Resource = { id: "r1", name: "Carp", type: "labor", calendarId: "ghost-cal" };
    const result = calculateCpm({
      ...baseInput,
      activities: [task()],
      relationships: [],
      resources: [r1],
      assignments: [asn("a1", "A", "r1", 10, 0, 10)],
    });
    expect(
      result.diagnostics.some((d) => d.code === "missing_resource_calendar"),
    ).toBe(true);
  });

  it("emits resource_calendar_deferred reminder (once) when a resource calendar IS wired", () => {
    const r1: Resource = { id: "r1", name: "Carp", type: "labor", calendarId: "cal-mf" };
    const r2: Resource = { id: "r2", name: "Iron", type: "labor", calendarId: "cal-mf" };
    const result = calculateCpm({
      ...baseInput,
      activities: [task()],
      relationships: [],
      resources: [r1, r2],
      assignments: [
        asn("a1", "A", "r1", 10, 0, 10),
        asn("a2", "A", "r2", 10, 0, 10),
      ],
    });
    const deferred = result.diagnostics.filter(
      (d) => d.code === "resource_calendar_deferred",
    );
    expect(deferred.length).toBe(1);
    expect(deferred[0].severity).toBe("info");
  });

  it("emits assignment_units_inconsistent for negative or over-actual units", () => {
    const r1: Resource = { id: "r1", name: "Carp", type: "labor" };
    const result = calculateCpm({
      ...baseInput,
      activities: [task()],
      relationships: [],
      resources: [r1],
      assignments: [
        asn("a1", "A", "r1", 10, -5, 10), // negative actual
        asn("a2", "A", "r1", 10, 50, 5), // actual > at-completion (55 > 55? actually 50 > 15)
      ],
    });
    const incs = result.diagnostics.filter(
      (d) => d.code === "assignment_units_inconsistent",
    );
    expect(incs.length).toBeGreaterThanOrEqual(2);
  });

  it("does NOT let resource calendars drive CPM dates (Phase 1.5 guardrail)", () => {
    // Resource calendar = 24/7, activity calendar = Mon-Fri. CPM finish must
    // still snap to the activity calendar.
    const wide = createWholeDayWorkClock({
      id: "cal-247",
      name: "24/7",
      workDays: 0b1111111,
      holidays: [],
      hoursPerDay: 24,
    });
    const r1: Resource = { id: "r1", name: "Bot", type: "nonlabor", calendarId: "cal-247" };
    const t = task();
    t.originalDuration = { minutes: 5 * DAY_MIN, authoringCalendarId: "cal-mf" };
    t.remainingDuration = { minutes: 5 * DAY_MIN, authoringCalendarId: "cal-mf" };

    const result = calculateCpm({
      ...baseInput,
      calendars: new Map([
        ["cal-mf", cal],
        ["cal-247", wide],
      ]),
      activities: [t],
      relationships: [],
      resources: [r1],
      assignments: [asn("a1", "A", "r1", 40, 0, 40)],
    });
    const aRes = result.activities[0];
    // 5 workdays on Mon-Fri starting Mon-06 → end of Fri-10. NOT compressed
    // by the 24/7 resource calendar.
    expect(cal.diffWork(aRes.earlyStart, aRes.earlyFinish)).toBe(5 * DAY_MIN);
  });
});
