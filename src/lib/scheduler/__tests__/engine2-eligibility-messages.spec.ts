/**
 * Phase 3.7 — eligibility blocker / warning message cleanup tests.
 *
 * Validates that `evaluateScheduleEligibility` reports the actual
 * FAILURE reason via `failureMessage`, not the inverted "requirement"
 * sentence. Locks in the Phase 3.6c finding that "Schedule has at least
 * one task" was a confusing blocker for an empty schedule.
 *
 * Also pins:
 *   - empty-schedule blocker text
 *   - in-progress-activities blocker text
 *   - warnings stay warnings (resource-loaded fixture)
 *   - blockers stay blockers
 */

import { describe, expect, it } from "vitest";
import { evaluateScheduleEligibility } from "../engine2/schedule-eligibility";
import type { Schedule } from "../types";

function baseSchedule(): Schedule {
  return {
    name: "elig-msg-base",
    projectStartDate: "2026-01-05",
    calendar: { workDays: 31, holidays: [] },
    tasks: [
      { id: "A", name: "A", duration: 2 },
      { id: "B", name: "B", duration: 3 },
    ],
    dependencies: [{ from: "A", to: "B", type: "FS", lag: 0 }],
  };
}

describe("Phase 3.7 — eligibility failure messages are not inverted", () => {
  it("empty schedule reports 'no tasks' (not 'has at least one task')", () => {
    const schedule: Schedule = {
      ...baseSchedule(),
      tasks: [],
      dependencies: [],
    };
    const elig = evaluateScheduleEligibility(schedule);
    expect(elig.eligible).toBe(false);
    expect(elig.blockers).toContain("Schedule has no tasks.");
    // The inverted requirement text must NOT leak into blockers.
    expect(elig.blockers.some((b) => /at least one task/i.test(b))).toBe(false);
  });

  it("in-progress activity reports actuals/percent-bridge blocker", () => {
    const schedule = baseSchedule();
    schedule.tasks[0].percentComplete = 40;
    const elig = evaluateScheduleEligibility(schedule);
    expect(elig.eligible).toBe(false);
    const msg = elig.blockers.find((b) => /in-progress/i.test(b));
    expect(msg).toBeDefined();
    expect(msg!).toMatch(/percent-complete/i);
    // Not the inverted requirement.
    expect(elig.blockers.some((b) => /No in-progress activities/i.test(b))).toBe(false);
  });

  it("completed-without-bridged-actuals reports the failure, not the requirement", () => {
    const schedule = baseSchedule();
    schedule.tasks[0].percentComplete = 100;
    const elig = evaluateScheduleEligibility(schedule);
    expect(elig.eligible).toBe(false);
    const msg = elig.blockers.find((b) => /completed activities/i.test(b));
    expect(msg).toBeDefined();
    expect(msg!).toMatch(/actualStart|actualFinish|bridged/i);
  });

  it("resource-loaded activities surface as WARNING, not blocker", () => {
    const schedule = baseSchedule();
    schedule.tasks[0].resourceName = "Crew 1";
    schedule.tasks[0].resourceUnitsPerDay = 2;
    const elig = evaluateScheduleEligibility(schedule);
    // Still eligible — resource-loaded is a warning, not a blocker.
    expect(elig.eligible).toBe(true);
    expect(elig.warnings.some((w) => /resource-loaded/i.test(w))).toBe(true);
    expect(elig.blockers).toEqual([]);
  });

  it("clean schedule has zero blockers and zero warnings", () => {
    const elig = evaluateScheduleEligibility(baseSchedule());
    expect(elig.eligible).toBe(true);
    expect(elig.blockers).toEqual([]);
    expect(elig.warnings).toEqual([]);
  });
});
