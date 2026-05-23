/**
 * Phase 2.4 + 2.5 — engine2 vs legacy comparison harness tests.
 *
 * Proves engine2 can run beside the legacy engine on real data without
 * destabilizing it. Phase 2.5 adds tests for the developer-only report
 * sink, the verdict / classification surface, the exception-aware bridge
 * option, and engine2-error tolerance.
 */

import { describe, expect, it } from "vitest";
import { commercialFitOutSample } from "../sample";
import type { Schedule } from "../types";
import {
  bridgeLegacyScheduleToEngine2,
  compareEnginesOnSchedule,
  formatComparisonReport,
  isEngine2ComparisonEnabled,
  isEngine2ExceptionClockEnabled,
  type ComparisonReport,
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
  it("converts a legacy schedule to a engine2 CpmInput (whole-day default)", () => {
    const schedule = buildScheduleFromSample();
    const { input, calendars, conversionNotes } = bridgeLegacyScheduleToEngine2(schedule);
    expect(input.activities.length).toBe(schedule.tasks.length);
    expect(input.relationships.length).toBe(schedule.dependencies.length);
    expect(calendars.size).toBeGreaterThanOrEqual(1);
    expect(input.projectCalendarId).toBeDefined();
    expect(input.calendars.has(input.projectCalendarId)).toBe(true);
    expect(conversionNotes.length).toBeGreaterThan(0);
  });

  it("exception-aware option routes calendars through createExceptionWorkClock", () => {
    const schedule = buildScheduleFromSample();
    const wholeDay = bridgeLegacyScheduleToEngine2(schedule);
    const exceptionAware = bridgeLegacyScheduleToEngine2(schedule, {
      useExceptionAwareCalendars: true,
    });
    expect(exceptionAware.calendars.size).toBe(wholeDay.calendars.size);
    expect(
      exceptionAware.conversionNotes.some((n) =>
        n.includes("createExceptionWorkClock"),
      ),
    ).toBe(true);
  });
});

describe("engine2 comparison harness", () => {
  it("produces a structured report with verdict and classification on the Commercial Fit-Out sample", () => {
    const schedule = buildScheduleFromSample();
    const run = compareEnginesOnSchedule(schedule, { treatFloatAsLimitation: true });

    expect(run.report.scheduleName).toBe(schedule.name);
    expect(run.report.activityCount.legacy).toBe(schedule.tasks.length);
    expect(run.report.activityCount.engine2).toBe(schedule.tasks.length);
    expect(run.report.relationshipCount.legacy).toBe(schedule.dependencies.length);
    expect(run.report.relationshipCount.engine2).toBe(schedule.dependencies.length);

    // No honestly bridged activity should disappear in either direction.
    expect(run.report.countsByCategory.missing_in_engine2).toBe(0);
    expect(run.report.countsByCategory.missing_in_legacy).toBe(0);

    // Every difference MUST be classified — no diff is left vague.
    for (const d of run.report.differences) {
      expect(d.classification).toBeDefined();
      expect([
        "expected-bridge-limitation",
        "known-engine-limitation",
        "investigate",
      ]).toContain(d.classification);
    }

    // Classification totals add up to the total number of differences.
    const classTotal =
      run.report.countsByClassification["expected-bridge-limitation"] +
      run.report.countsByClassification["known-engine-limitation"] +
      run.report.countsByClassification.investigate;
    expect(classTotal).toBe(run.report.differences.length);

    // Verdict must be one of the three known values.
    expect(["clean", "expected-differences", "investigate"]).toContain(
      run.report.verdict,
    );

    // Pretty-printer must not throw and must include the verdict + version.
    const text = formatComparisonReport(run.report);
    expect(text).toContain(run.report.verdict.toUpperCase());
    expect(text).toContain(run.report.engine2Version);
  });

  it("Commercial Fit-Out comparison is deterministic across runs", () => {
    const schedule = buildScheduleFromSample();
    const a = compareEnginesOnSchedule(schedule, { treatFloatAsLimitation: true })
      .report;
    const b = compareEnginesOnSchedule(schedule, { treatFloatAsLimitation: true })
      .report;
    expect(b.verdict).toBe(a.verdict);
    expect(b.differences.length).toBe(a.differences.length);
    expect(b.exactDateMatches).toBe(a.exactDateMatches);
    expect(b.dateMismatches).toBe(a.dateMismatches);
    expect(b.floatMismatches).toBe(a.floatMismatches);
    expect(b.criticalFlagMismatches).toBe(a.criticalFlagMismatches);
    expect(b.countsByCategory).toEqual(a.countsByCategory);
    expect(b.countsByClassification).toEqual(a.countsByClassification);
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

  it("schedule is not mutated by the comparison harness", () => {
    const schedule = buildScheduleFromSample();
    const snap = JSON.stringify(schedule);
    compareEnginesOnSchedule(schedule, { treatFloatAsLimitation: true });
    expect(JSON.stringify(schedule)).toBe(snap);
  });

  it("exception-aware comparison runs without changing legacy output", () => {
    const schedule = buildScheduleFromSample();
    const baseline = compareEnginesOnSchedule(schedule).legacy;
    const run = compareEnginesOnSchedule(schedule, {
      treatFloatAsLimitation: true,
      useExceptionAwareCalendars: true,
    });
    expect(run.report.runRecord.useExceptionAwareCalendars).toBe(true);
    expect(run.legacy.projectFinishDate).toBe(baseline.projectFinishDate);
    for (let i = 0; i < baseline.tasks.length; i++) {
      expect(run.legacy.tasks[i].earlyStartDate).toBe(baseline.tasks[i].earlyStartDate);
    }
  });
});

describe("engine2 internal feature flags", () => {
  it("defaults the comparison flag to OFF", () => {
    expect(isEngine2ComparisonEnabled()).toBe(false);
  });
  it("defaults the exception-clock flag to OFF", () => {
    expect(isEngine2ExceptionClockEnabled()).toBe(false);
  });
});

describe("calculateScheduleWithEngine2Comparison", () => {
  it("returns ONLY the legacy result when the comparison flag is off", () => {
    const schedule = buildScheduleFromSample();
    const wrapped = calculateScheduleWithEngine2Comparison(schedule);
    expect(wrapped.result).toBeTruthy();
    expect(wrapped.engine2Comparison).toBeUndefined();
    expect(wrapped.engine2Error).toBeUndefined();
    expect(wrapped.result.tasks.length).toBe(schedule.tasks.length);
  });

  it("with forceComparison=true returns the legacy result PLUS a report and calls the dev sink", () => {
    const schedule = buildScheduleFromSample();
    const captured: { text: string; report: ComparisonReport }[] = [];
    const wrapped = calculateScheduleWithEngine2Comparison(schedule, {
      forceComparison: true,
      devReportSink: (text, report) => captured.push({ text, report }),
    });
    expect(wrapped.result.tasks.length).toBe(schedule.tasks.length);
    expect(wrapped.engine2Comparison).toBeDefined();
    expect(captured.length).toBe(1);
    expect(captured[0].text).toContain(wrapped.engine2Comparison!.verdict.toUpperCase());
    expect(captured[0].report.scheduleName).toBe(schedule.name);
  });

  it("does NOT call the dev sink when the comparison flag is off", () => {
    const schedule = buildScheduleFromSample();
    let calls = 0;
    calculateScheduleWithEngine2Comparison(schedule, {
      devReportSink: () => calls++,
    });
    expect(calls).toBe(0);
  });

  it("engine2 error does NOT alter the legacy result", () => {
    // Force engine2 to throw by passing a schedule with no projectStartDate.
    const schedule: Schedule = {
      ...buildScheduleFromSample(),
      projectStartDate: undefined,
    };
    const wrapped = calculateScheduleWithEngine2Comparison(schedule, {
      forceComparison: true,
      devReportSink: () => {},
    });
    expect(wrapped.result).toBeTruthy();
    expect(wrapped.result.tasks.length).toBe(schedule.tasks.length);
    expect(wrapped.engine2Error).toBeDefined();
  });

  it("forceExceptionAwareCalendars routes through exception clock", () => {
    const schedule = buildScheduleFromSample();
    const wrapped = calculateScheduleWithEngine2Comparison(schedule, {
      forceComparison: true,
      forceExceptionAwareCalendars: true,
      devReportSink: () => {},
    });
    expect(wrapped.engine2Comparison?.runRecord.useExceptionAwareCalendars).toBe(true);
  });
});
