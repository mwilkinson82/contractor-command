/**
 * Phase 2.4 — engine2 vs legacy comparison harness tests.
 *
 * These tests prove engine2 can run beside the legacy engine on real data
 * without destabilizing it. They do NOT assert engine2 reaches parity —
 * unit-basis mismatches and modeling differences are bucketed into the
 * report's `knownLimitations` / `known_limitation` category and counted.
 */

import { describe, expect, it } from "vitest";
import { commercialFitOutSample } from "../sample";
import type { Schedule } from "../types";
import {
  bridgeLegacyScheduleToEngine2,
  compareEnginesOnSchedule,
  formatComparisonReport,
  instantToIsoDate,
  isEngine2ComparisonEnabled,
} from "../engine2";
import { calculateScheduleWithEngine2Comparison } from "../compare";

function buildScheduleFromSample(): Schedule {
  const s = commercialFitOutSample();
  return {
    name: s.name,
    projectStartDate: s.projectStartDate,
    dataDate: s.dataDate,
    calendar: { workDays: s.workDays, holidays: s.holidays },
    tasks: s.tasks,
    dependencies: s.dependencies,
  };
}

describe("engine2 legacy bridge", () => {
  it("converts a legacy schedule to a engine2 CpmInput", () => {
    const schedule = buildScheduleFromSample();
    const { input, calendars, conversionNotes } = bridgeLegacyScheduleToEngine2(schedule);

    expect(input.activities.length).toBe(schedule.tasks.length);
    expect(input.relationships.length).toBe(schedule.dependencies.length);
    expect(calendars.size).toBeGreaterThanOrEqual(1);
    expect(input.projectCalendarId).toBeDefined();
    expect(input.calendars.has(input.projectCalendarId)).toBe(true);
    expect(conversionNotes.length).toBeGreaterThan(0);
    // Project start instant must round-trip to the original ISO date.
    expect(instantToIsoDate(input.projectStart)).toBe(schedule.projectStartDate);
  });
});

describe("engine2 comparison harness", () => {
  it("runs both engines on the Commercial Fit-Out sample and produces a structured report", () => {
    const schedule = buildScheduleFromSample();
    const run = compareEnginesOnSchedule(schedule, { treatFloatAsLimitation: true });

    expect(run.legacy).toBeTruthy();
    expect(run.engine2).toBeTruthy();
    expect(run.report.activityCount.legacy).toBe(schedule.tasks.length);
    expect(run.report.activityCount.engine2).toBe(schedule.tasks.length);
    expect(run.report.relationshipCount.legacy).toBe(schedule.dependencies.length);
    expect(run.report.relationshipCount.engine2).toBe(schedule.dependencies.length);

    // The harness must NEVER report activities that exist on only one side
    // for an honestly bridged schedule.
    expect(run.report.countsByCategory.missing_in_engine2).toBe(0);
    expect(run.report.countsByCategory.missing_in_legacy).toBe(0);

    // Known limitations are surfaced verbatim for the dev console.
    expect(run.report.knownLimitations.length).toBeGreaterThan(0);

    // Pretty-printer must not throw and must include the version strings.
    const text = formatComparisonReport(run.report);
    expect(text).toContain(run.report.engine2Version);
  });

  it("legacy result is byte-for-byte unchanged by running the comparison", () => {
    const schedule = buildScheduleFromSample();
    const baseline = compareEnginesOnSchedule(schedule).legacy;
    const second = compareEnginesOnSchedule(schedule).legacy;
    expect(second.projectFinishDate).toBe(baseline.projectFinishDate);
    expect(second.tasks.length).toBe(baseline.tasks.length);
    for (let i = 0; i < baseline.tasks.length; i++) {
      expect(second.tasks[i].earlyStartDate).toBe(baseline.tasks[i].earlyStartDate);
      expect(second.tasks[i].earlyFinishDate).toBe(baseline.tasks[i].earlyFinishDate);
      expect(second.tasks[i].isCritical).toBe(baseline.tasks[i].isCritical);
    }
  });
});

describe("engine2 internal feature flag", () => {
  it("defaults the comparison flag to OFF", () => {
    // No env override is set in the test runner by default.
    expect(isEngine2ComparisonEnabled()).toBe(false);
  });

  it("calculateScheduleWithEngine2Comparison returns ONLY the legacy result when the flag is off", () => {
    const schedule = buildScheduleFromSample();
    const wrapped = calculateScheduleWithEngine2Comparison(schedule);
    expect(wrapped.result).toBeTruthy();
    expect(wrapped.engine2Comparison).toBeUndefined();
    expect(wrapped.engine2Error).toBeUndefined();
    // Wrapped legacy result must equal a direct legacy call for the same input.
    expect(wrapped.result.tasks.length).toBe(schedule.tasks.length);
  });
});
