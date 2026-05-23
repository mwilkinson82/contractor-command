/**
 * Phase 2.6 — small realistic schedule fixtures for the engine2 vs legacy
 * comparison harness. Each fixture is intentionally minimal so the
 * comparison report stays readable and the verdict has a single,
 * defensible cause.
 *
 * Internal-only. These fixtures never reach the UI.
 */

import type { Schedule } from "../../types";

export interface ComparisonFixture {
  name: string;
  schedule: Schedule;
  /** What this fixture exists to prove. */
  intent: string;
}

const MONDAY_TO_FRIDAY = 31;
const ALL_DAYS = 127;

function fsChain(): Schedule {
  return {
    name: "fixture: simple FS chain",
    projectStartDate: "2026-01-05",
    calendar: { workDays: MONDAY_TO_FRIDAY, holidays: [] },
    tasks: [
      { id: "A", name: "A", duration: 3 },
      { id: "B", name: "B", duration: 2 },
      { id: "C", name: "C", duration: 4 },
    ],
    dependencies: [
      { from: "A", to: "B", type: "FS" },
      { from: "B", to: "C", type: "FS" },
    ],
  };
}

function parallelPaths(): Schedule {
  return {
    name: "fixture: parallel paths",
    projectStartDate: "2026-01-05",
    calendar: { workDays: MONDAY_TO_FRIDAY, holidays: [] },
    tasks: [
      { id: "A", name: "A", duration: 2 },
      { id: "B", name: "B (short)", duration: 3 },
      { id: "C", name: "C (long)", duration: 6 },
      { id: "D", name: "D", duration: 2 },
    ],
    dependencies: [
      { from: "A", to: "B", type: "FS" },
      { from: "A", to: "C", type: "FS" },
      { from: "B", to: "D", type: "FS" },
      { from: "C", to: "D", type: "FS" },
    ],
  };
}

function mixedRelationships(): Schedule {
  return {
    name: "fixture: mixed relationship types",
    projectStartDate: "2026-01-05",
    calendar: { workDays: MONDAY_TO_FRIDAY, holidays: [] },
    tasks: [
      { id: "A", name: "A", duration: 5 },
      { id: "B", name: "B", duration: 4 },
      { id: "C", name: "C", duration: 3 },
      { id: "D", name: "D", duration: 2 },
    ],
    dependencies: [
      { from: "A", to: "B", type: "SS", lag: 1 },
      { from: "A", to: "C", type: "FS", lag: 2 },
      { from: "B", to: "D", type: "FF", lag: 0 },
      { from: "C", to: "D", type: "FS" },
    ],
  };
}

function constraints(): Schedule {
  return {
    name: "fixture: SNET constraint",
    projectStartDate: "2026-01-05",
    calendar: { workDays: MONDAY_TO_FRIDAY, holidays: [] },
    tasks: [
      { id: "A", name: "A", duration: 2 },
      { id: "B", name: "B (SNET)", duration: 3, startNoEarlierThan: "2026-01-19" },
      { id: "C", name: "C", duration: 2 },
    ],
    dependencies: [
      { from: "A", to: "B", type: "FS" },
      { from: "B", to: "C", type: "FS" },
    ],
  };
}

function inProgress(): Schedule {
  return {
    name: "fixture: in-progress activities",
    projectStartDate: "2026-01-05",
    dataDate: "2026-01-12",
    calendar: { workDays: MONDAY_TO_FRIDAY, holidays: [] },
    tasks: [
      { id: "A", name: "A done", duration: 5, percentComplete: 100 },
      { id: "B", name: "B in-progress", duration: 6, percentComplete: 50 },
      { id: "C", name: "C", duration: 3 },
    ],
    dependencies: [
      { from: "A", to: "B", type: "FS" },
      { from: "B", to: "C", type: "FS" },
    ],
  };
}

function completed(): Schedule {
  return {
    name: "fixture: completed only",
    projectStartDate: "2026-01-05",
    dataDate: "2026-01-30",
    calendar: { workDays: MONDAY_TO_FRIDAY, holidays: [] },
    tasks: [
      { id: "A", name: "A", duration: 4, percentComplete: 100 },
      { id: "B", name: "B", duration: 3, percentComplete: 100 },
    ],
    dependencies: [{ from: "A", to: "B", type: "FS" }],
  };
}

function outOfSequence(): Schedule {
  // Successor reports progress while predecessor is incomplete. Engine2
  // may flag this; legacy only stores percent-complete.
  return {
    name: "fixture: out-of-sequence progress",
    projectStartDate: "2026-01-05",
    dataDate: "2026-01-12",
    calendar: { workDays: MONDAY_TO_FRIDAY, holidays: [] },
    tasks: [
      { id: "A", name: "A pred (40%)", duration: 5, percentComplete: 40 },
      { id: "B", name: "B succ (50%)", duration: 4, percentComplete: 50 },
    ],
    dependencies: [{ from: "A", to: "B", type: "FS" }],
  };
}

function resourceLoaded(): Schedule {
  return {
    name: "fixture: resource-loaded",
    projectStartDate: "2026-01-05",
    calendar: { workDays: MONDAY_TO_FRIDAY, holidays: [] },
    tasks: [
      {
        id: "A",
        name: "A",
        duration: 4,
        resourceName: "Crew",
        resourceUnitsPerDay: 2,
        budgetCost: 8000,
      },
      {
        id: "B",
        name: "B",
        duration: 3,
        resourceName: "Crew",
        resourceUnitsPerDay: 2,
        budgetCost: 6000,
      },
    ],
    dependencies: [{ from: "A", to: "B", type: "FS" }],
  };
}

function levelingCandidate(): Schedule {
  // Two activities competing for the same crew on overlapping windows.
  // Legacy does no leveling; engine2 may flag the overallocation. We
  // expect leveling_behavior_difference diagnostics, not date deltas.
  return {
    name: "fixture: leveling candidate",
    projectStartDate: "2026-01-05",
    calendar: { workDays: MONDAY_TO_FRIDAY, holidays: [] },
    tasks: [
      { id: "A", name: "A", duration: 5, resourceName: "Crew", resourceUnitsPerDay: 3 },
      { id: "B", name: "B", duration: 5, resourceName: "Crew", resourceUnitsPerDay: 3 },
      { id: "C", name: "C", duration: 2 },
    ],
    dependencies: [
      { from: "A", to: "C", type: "FS" },
      { from: "B", to: "C", type: "FS" },
    ],
  };
}

function calendarException(): Schedule {
  // Holiday inside the work window. Both engines should respect it.
  return {
    name: "fixture: calendar exception (holiday)",
    projectStartDate: "2026-01-05",
    calendar: { workDays: MONDAY_TO_FRIDAY, holidays: ["2026-01-08"] },
    tasks: [
      { id: "A", name: "A", duration: 5 },
      { id: "B", name: "B", duration: 2 },
    ],
    dependencies: [{ from: "A", to: "B", type: "FS" }],
  };
}

function sevenDayCalendar(): Schedule {
  return {
    name: "fixture: 7-day calendar",
    projectStartDate: "2026-01-05",
    calendar: { workDays: ALL_DAYS, holidays: [] },
    tasks: [
      { id: "A", name: "A", duration: 3 },
      { id: "B", name: "B", duration: 4 },
    ],
    dependencies: [{ from: "A", to: "B", type: "FS" }],
  };
}

export const COMPARISON_FIXTURES: ComparisonFixture[] = [
  { name: "fs-chain", schedule: fsChain(), intent: "Baseline: FS chain — engines should agree on critical path structure." },
  { name: "parallel-paths", schedule: parallelPaths(), intent: "Two parallel paths into a join — driving-link math probed." },
  { name: "mixed-relationships", schedule: mixedRelationships(), intent: "Mixed FS/SS/FF with lag — exposes lag basis differences." },
  { name: "constraints", schedule: constraints(), intent: "SNET constraint mapped through the bridge." },
  { name: "in-progress", schedule: inProgress(), intent: "Percent-complete present — exposes progress behavior delta." },
  { name: "completed", schedule: completed(), intent: "All activities done — engines should not diverge on critical flag." },
  { name: "out-of-sequence", schedule: outOfSequence(), intent: "Successor progresses before predecessor completes." },
  { name: "resource-loaded", schedule: resourceLoaded(), intent: "Resource units present but no leveling." },
  { name: "leveling-candidate", schedule: levelingCandidate(), intent: "Overlapping resource demand — leveling-only signal expected from engine2." },
  { name: "calendar-exception", schedule: calendarException(), intent: "Holiday inside the work window — both engines should agree on dates." },
  { name: "seven-day-calendar", schedule: sevenDayCalendar(), intent: "7-day workweek — calendar mask conversion exercised." },
];
