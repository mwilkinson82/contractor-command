/**
 * Phase 3.5 — clean, engine2-eligible fixture schedules for dry-run
 * reconciliation.
 *
 * Every fixture in this file MUST pass `evaluateScheduleEligibility` with
 * zero blockers so engine2 actually runs in dry-run mode. That means:
 *   - no `percentComplete` (no in-progress, no completed)
 *   - no resource fields
 *   - no per-activity `calendarId`
 *   - at most one NamedCalendar (we just rely on `schedule.calendar`)
 *   - no constraints / actuals / leveling / baselines
 *   - no engine2Capabilities (defaults to all-PASS)
 *
 * Each fixture is deterministic and serializable. Tests deep-clone them
 * before running so the source-of-truth objects are never mutated.
 */

import type { Schedule } from "../../types";

export interface DryRunFixture {
  /** Stable name used in reconciliation reports / test titles. */
  name: string;
  /** Short description of what this fixture exercises. */
  description: string;
  /** Producer — clone-per-call so tests cannot leak mutations. */
  make: () => Schedule;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ---------------------------------------------------------------------------
// Individual fixtures
// ---------------------------------------------------------------------------

const SIMPLE_FS_CHAIN: Schedule = {
  name: "simple-fs-chain",
  projectStartDate: "2026-01-05", // Monday
  calendar: { workDays: 31, holidays: [] },
  tasks: [
    { id: "A", name: "A", duration: 3 },
    { id: "B", name: "B", duration: 4 },
    { id: "C", name: "C", duration: 2 },
  ],
  dependencies: [
    { from: "A", to: "B", type: "FS", lag: 0 },
    { from: "B", to: "C", type: "FS", lag: 0 },
  ],
};

const PARALLEL_PATHS_WITH_FLOAT: Schedule = {
  name: "parallel-paths-with-float",
  projectStartDate: "2026-01-05",
  calendar: { workDays: 31, holidays: [] },
  tasks: [
    { id: "START", name: "Start", duration: 1 },
    { id: "LONG", name: "Long path", duration: 10 },
    { id: "SHORT", name: "Short path", duration: 4 },
    { id: "END", name: "End", duration: 1 },
  ],
  dependencies: [
    { from: "START", to: "LONG", type: "FS", lag: 0 },
    { from: "START", to: "SHORT", type: "FS", lag: 0 },
    { from: "LONG", to: "END", type: "FS", lag: 0 },
    { from: "SHORT", to: "END", type: "FS", lag: 0 },
  ],
};

const MIXED_RELATIONSHIPS: Schedule = {
  name: "mixed-relationships",
  projectStartDate: "2026-01-05",
  calendar: { workDays: 31, holidays: [] },
  tasks: [
    { id: "A", name: "A (driver)", duration: 5 },
    { id: "B", name: "B (SS from A)", duration: 4 },
    { id: "C", name: "C (FF from A)", duration: 3 },
    { id: "D", name: "D (FS from B)", duration: 2 },
  ],
  dependencies: [
    { from: "A", to: "B", type: "SS", lag: 0 },
    { from: "A", to: "C", type: "FF", lag: 0 },
    { from: "B", to: "D", type: "FS", lag: 0 },
  ],
};

const WEEKEND_AND_HOLIDAY_CALENDAR: Schedule = {
  name: "weekend-and-holiday-calendar",
  projectStartDate: "2026-01-05", // Monday
  calendar: {
    workDays: 31, // Mon–Fri
    // Jan 19 2026 (Mon) is a holiday — forces the schedule to skip a working
    // day mid-stream so the calendar-aware engines have to align.
    holidays: ["2026-01-19"],
  },
  tasks: [
    { id: "P1", name: "Pre-holiday", duration: 5 },
    { id: "P2", name: "Spans holiday", duration: 10 },
    { id: "P3", name: "Tail", duration: 2 },
  ],
  dependencies: [
    { from: "P1", to: "P2", type: "FS", lag: 0 },
    { from: "P2", to: "P3", type: "FS", lag: 0 },
  ],
};

const MILESTONE_FIXTURE: Schedule = {
  name: "milestone-fixture",
  projectStartDate: "2026-01-05",
  calendar: { workDays: 31, holidays: [] },
  tasks: [
    { id: "M-START", name: "Project start (milestone)", duration: 0 },
    { id: "WORK1", name: "Work 1", duration: 3 },
    { id: "WORK2", name: "Work 2", duration: 5 },
    { id: "M-FINISH", name: "Project finish (milestone)", duration: 0 },
  ],
  dependencies: [
    { from: "M-START", to: "WORK1", type: "FS", lag: 0 },
    { from: "M-START", to: "WORK2", type: "FS", lag: 0 },
    { from: "WORK1", to: "M-FINISH", type: "FS", lag: 0 },
    { from: "WORK2", to: "M-FINISH", type: "FS", lag: 0 },
  ],
};

const FS_LAG_FIXTURE: Schedule = {
  name: "fs-lag-fixture",
  projectStartDate: "2026-01-05",
  calendar: { workDays: 31, holidays: [] },
  tasks: [
    { id: "POUR", name: "Pour slab", duration: 2 },
    { id: "CURE", name: "Cure (FS+3 lag)", duration: 1 },
    { id: "FRAME", name: "Frame walls", duration: 4 },
  ],
  dependencies: [
    { from: "POUR", to: "CURE", type: "FS", lag: 3 },
    { from: "CURE", to: "FRAME", type: "FS", lag: 0 },
  ],
};

/**
 * Phase 3.7 — exact recreation of the persisted "eligible FS chain" smoke
 * schedule from Phase 3.6c. This is the simplest real saved schedule that
 * exposed engine2 vs legacy date-rendering divergence in live dry-run.
 *
 * Captured behavior (regression sentinel):
 *   legacy projectFinishDate = 2026-06-30
 *   engine2 projectFinish    = 2026-06-29 (last work moment, inclusive)
 *   max date delta           = 3 calendar days (C: Fri 06-19 vs Mon 06-22)
 *   max float delta          = 0 (float matches; rendering only)
 *   early starts             = match exactly across all 5 activities
 *   early finishes           = legacy is 1 calendar day later per task
 *
 * Root cause: legacy renders earlyFinish as the NEXT working-day boundary
 * after the last worked day ("exclusive end" convention); engine2 renders
 * the last work moment itself ("inclusive end"). Both engines compute the
 * same underlying schedule. See ARCHITECTURE.md §38.
 */
const PERSISTED_FS_CHAIN_3_6C: Schedule = {
  name: "persisted-fs-chain-3.6c",
  projectStartDate: "2026-06-01", // Monday
  calendar: { workDays: 31, holidays: [] },
  tasks: [
    { id: "A", name: "Site prep", duration: 3 },
    { id: "B", name: "Foundations", duration: 5 },
    { id: "C", name: "Framing", duration: 7 },
    { id: "D", name: "Roofing", duration: 4 },
    { id: "E", name: "Closeout", duration: 2 },
  ],
  dependencies: [
    { from: "A", to: "B", type: "FS", lag: 0 },
    { from: "B", to: "C", type: "FS", lag: 0 },
    { from: "C", to: "D", type: "FS", lag: 0 },
    { from: "D", to: "E", type: "FS", lag: 0 },
  ],
};

export const PERSISTED_FS_CHAIN_3_6C_FIXTURE: DryRunFixture = {
  name: PERSISTED_FS_CHAIN_3_6C.name,
  description:
    "Phase 3.6c live persisted smoke schedule: 5-task FS chain, Mon–Fri, no holidays.",
  make: () => clone(PERSISTED_FS_CHAIN_3_6C),
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const DRY_RUN_FIXTURES: ReadonlyArray<DryRunFixture> = [
  {
    name: SIMPLE_FS_CHAIN.name,
    description: "Linear FS chain on standard Mon–Fri calendar.",
    make: () => clone(SIMPLE_FS_CHAIN),
  },
  {
    name: PARALLEL_PATHS_WITH_FLOAT.name,
    description:
      "Two parallel paths converging — short path has slack vs the long path.",
    make: () => clone(PARALLEL_PATHS_WITH_FLOAT),
  },
  {
    name: MIXED_RELATIONSHIPS.name,
    description: "FS + SS + FF mix to exercise non-FS bridging.",
    make: () => clone(MIXED_RELATIONSHIPS),
  },
  {
    name: WEEKEND_AND_HOLIDAY_CALENDAR.name,
    description: "Mon–Fri calendar with a mid-stream holiday.",
    make: () => clone(WEEKEND_AND_HOLIDAY_CALENDAR),
  },
  {
    name: MILESTONE_FIXTURE.name,
    description: "Start/finish milestones (zero-duration) around two paths.",
    make: () => clone(MILESTONE_FIXTURE),
  },
  {
    name: FS_LAG_FIXTURE.name,
    description: "FS relationship with a positive working-day lag.",
    make: () => clone(FS_LAG_FIXTURE),
  },
  PERSISTED_FS_CHAIN_3_6C_FIXTURE,
];

/**
 * An intentionally ineligible fixture used by reconciliation tests to
 * prove the skipped-summary path. In-progress activities are blockers
 * per `schedule-eligibility`.
 */
export function makeIneligibleFixture(): Schedule {
  return {
    name: "ineligible-in-progress",
    projectStartDate: "2026-01-05",
    calendar: { workDays: 31, holidays: [] },
    tasks: [
      { id: "X", name: "X", duration: 5, percentComplete: 40 },
      { id: "Y", name: "Y", duration: 3 },
    ],
    dependencies: [{ from: "X", to: "Y", type: "FS", lag: 0 }],
  };
}
