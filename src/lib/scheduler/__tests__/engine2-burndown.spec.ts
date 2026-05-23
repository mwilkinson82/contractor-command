/**
 * Phase 2.9 — Engine2 shadow evidence review & burn-down tests.
 *
 * Proves:
 *   - evidence summary is deterministic and zero-safe
 *   - recurring mismatch categories are grouped correctly
 *   - burn-down ranking is stable and deterministic
 *   - promotion-readiness criteria evaluate correctly
 *   - errors in the log never block legacy output
 *   - feature flags are NOT touched by this module
 */

import { describe, expect, it } from "vitest";
import { commercialFitOutSample } from "../sample";
import { calculateSchedule } from "../engine";
import type { Schedule } from "../types";
import { COMPARISON_FIXTURES } from "./fixtures/comparison-fixtures";
import {
  buildMismatchBurnDown,
  evaluatePromotionReadiness,
  formatEvidenceReview,
  isEngine2ShadowEnabled,
  rankBurnDown,
  runShadowComparisons,
  summarizeEvidenceLog,
  type EvidenceLog,
  type EvidenceLogEntry,
  type MismatchBurnDownRow,
  type ShadowScheduleInput,
} from "../engine2";

const fixedClock = { now: () => "2026-05-23T00:00:00.000Z" };

function scheduleFromSample(): Schedule {
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

function fullShadowBatch(): ShadowScheduleInput[] {
  const inputs: ShadowScheduleInput[] = [
    {
      id: "commercial-fit-out",
      label: "Commercial Fit-Out",
      schedule: scheduleFromSample(),
      intent: "demo",
    },
  ];
  for (const f of COMPARISON_FIXTURES) {
    inputs.push({
      id: `fixture:${f.name}`,
      label: f.name,
      schedule: f.schedule,
      intent: f.intent,
    });
  }
  return inputs;
}

function runLog(): EvidenceLog {
  return runShadowComparisons(fullShadowBatch(), { force: true, clock: fixedClock }).log;
}

function makeEntry(p: Partial<EvidenceLogEntry>): EvidenceLogEntry {
  return {
    scheduleId: "x",
    scheduleName: "X",
    timestamp: fixedClock.now(),
    legacyEngineVersion: "legacy-1.x",
    engine2Version: "engine2-test",
    calendarMode: "whole-day",
    verdict: "clean",
    mismatchCount: 0,
    exactDateMatches: 0,
    classificationCounts: {},
    topDifferenceCategories: [],
    useExceptionAwareCalendars: false,
    boring: true,
    ...p,
  };
}

describe("engine2 burn-down — evidence summary (Phase 2.9)", () => {
  it("returns a zeroed summary for an empty/missing log", () => {
    const s = summarizeEvidenceLog(undefined);
    expect(s.totalRuns).toBe(0);
    expect(s.totalSchedules).toBe(0);
    expect(s.recurringCategories).toEqual([]);
    expect(s.exceptionClockDeltas).toEqual([]);
  });

  it("is deterministic — same log → same summary", () => {
    const log = runLog();
    expect(JSON.stringify(summarizeEvidenceLog(log))).toBe(
      JSON.stringify(summarizeEvidenceLog(log)),
    );
  });

  it("aggregates verdicts, errors, and clock modes correctly", () => {
    const log: EvidenceLog = {
      createdAt: fixedClock.now(),
      entries: [
        makeEntry({ scheduleId: "a", verdict: "clean", boring: true }),
        makeEntry({
          scheduleId: "b",
          verdict: "expected-differences",
          boring: true,
          mismatchCount: 3,
          topDifferenceCategories: [{ category: "total_float", count: 3 }],
        }),
        makeEntry({
          scheduleId: "c",
          verdict: "investigate",
          boring: false,
          mismatchCount: 1,
          topDifferenceCategories: [{ category: "early_finish_date", count: 1 }],
        }),
        makeEntry({
          scheduleId: "d",
          engine2Error: "bridge failed to convert",
          boring: false,
        }),
        makeEntry({
          scheduleId: "e",
          engine2Error: "engine2 internal crash",
          boring: false,
        }),
        makeEntry({
          scheduleId: "a",
          calendarMode: "exception-aware",
          useExceptionAwareCalendars: true,
          mismatchCount: 2,
        }),
      ],
    };
    const s = summarizeEvidenceLog(log);
    expect(s.totalRuns).toBe(6);
    expect(s.totalSchedules).toBe(5);
    expect(s.cleanReports).toBe(2);
    expect(s.expectedDifferenceReports).toBe(1);
    expect(s.investigateReports).toBe(1);
    expect(s.bridgeErrorCount).toBe(1);
    expect(s.engine2ErrorCount).toBe(1);
    expect(s.exceptionAwareRuns).toBe(1);
    expect(s.wholeDayRuns).toBe(5);
    // Schedule "a" has both whole-day (0 mismatches) and EA (2 mismatches).
    expect(s.exceptionClockDeltas).toEqual([
      { scheduleId: "a", wholeDayMismatches: 0, exceptionAwareMismatches: 2, delta: 2 },
    ]);
    // Recurring categories sorted by occurrences desc.
    expect(s.recurringCategories[0].category).toBe("total_float");
    expect(s.recurringCategories[0].occurrences).toBe(3);
  });
});

describe("engine2 burn-down — grouping & ranking (Phase 2.9)", () => {
  it("groups by category across entries", () => {
    const log: EvidenceLog = {
      createdAt: fixedClock.now(),
      entries: [
        makeEntry({
          scheduleId: "a",
          topDifferenceCategories: [
            { category: "total_float", count: 2 },
            { category: "early_finish_date", count: 1 },
          ],
        }),
        makeEntry({
          scheduleId: "b",
          topDifferenceCategories: [{ category: "total_float", count: 5 }],
        }),
      ],
    };
    const bd = buildMismatchBurnDown(log);
    const tf = bd.rows.find((r) => r.category === "total_float")!;
    expect(tf.count).toBe(7);
    expect(tf.affectedRuns).toBe(2);
    expect(bd.totalCategories).toBe(2);
    expect(bd.totalMismatches).toBe(8);
  });

  it("ranks investigate > known > expected and is stable", () => {
    const rows: MismatchBurnDownRow[] = [
      {
        category: "total_float",
        count: 99,
        affectedRuns: 1,
        classification: "known-engine-limitation",
        severity: "medium",
        origin: "engine2",
        likelyCause: "",
        recommendedAction: "",
        impactsDates: true,
        affectsRealSchedules: false,
        blocksPromotion: false,
      },
      {
        category: "early_finish_date",
        count: 1,
        affectedRuns: 1,
        classification: "investigate",
        severity: "high",
        origin: "engine2",
        likelyCause: "",
        recommendedAction: "",
        impactsDates: true,
        affectsRealSchedules: true,
        blocksPromotion: true,
      },
      {
        category: "calendar_model_difference",
        count: 4,
        affectedRuns: 1,
        classification: "expected-bridge-limitation",
        severity: "low",
        origin: "bridge",
        likelyCause: "",
        recommendedAction: "",
        impactsDates: false,
        affectsRealSchedules: false,
        blocksPromotion: false,
      },
    ];
    const ranked = rankBurnDown(rows);
    expect(ranked.map((r) => r.category)).toEqual([
      "early_finish_date",
      "total_float",
      "calendar_model_difference",
    ]);
    // Idempotent.
    expect(rankBurnDown(ranked).map((r) => r.category)).toEqual(
      ranked.map((r) => r.category),
    );
  });

  it("tags date-impacting categories and marks investigate as blocking", () => {
    const log: EvidenceLog = {
      createdAt: fixedClock.now(),
      entries: [
        makeEntry({
          topDifferenceCategories: [
            { category: "early_finish_date", count: 1 },
            { category: "baseline_behavior_difference", count: 1 },
          ],
        }),
      ],
    };
    const bd = buildMismatchBurnDown(log);
    const ef = bd.rows.find((r) => r.category === "early_finish_date")!;
    const bl = bd.rows.find((r) => r.category === "baseline_behavior_difference")!;
    expect(ef.impactsDates).toBe(true);
    expect(ef.blocksPromotion).toBe(true);
    expect(bl.impactsDates).toBe(false);
    expect(bl.blocksPromotion).toBe(false);
  });

  it("treats demo/imported intents as real schedules", () => {
    const log: EvidenceLog = {
      createdAt: fixedClock.now(),
      entries: [
        makeEntry({
          intent: "demo",
          topDifferenceCategories: [{ category: "total_float", count: 1 }],
        }),
      ],
    };
    const bd = buildMismatchBurnDown(log);
    expect(bd.rows[0].affectsRealSchedules).toBe(true);
  });
});

describe("engine2 burn-down — promotion readiness (Phase 2.9)", () => {
  it("is not ready on an empty log (no CFO evidence)", () => {
    const r = evaluatePromotionReadiness({ createdAt: "", entries: [] });
    expect(r.ready).toBe(false);
    expect(r.blockers.length).toBeGreaterThan(0);
  });

  it("flags engine2 + bridge errors as blockers", () => {
    const log: EvidenceLog = {
      createdAt: fixedClock.now(),
      entries: [
        makeEntry({
          scheduleId: "commercial-fit-out",
          intent: "demo",
          verdict: "clean",
          engine2Error: "engine2 internal crash",
          boring: false,
        }),
        makeEntry({
          scheduleId: "x",
          engine2Error: "bridge failure xyz",
          boring: false,
        }),
      ],
    };
    const r = evaluatePromotionReadiness(log);
    expect(r.ready).toBe(false);
    expect(r.criteria.find((c) => c.id === "no-engine2-errors")!.pass).toBe(false);
    expect(r.criteria.find((c) => c.id === "no-bridge-errors")!.pass).toBe(false);
  });

  it("reports READY when log is clean for CFO and no investigate categories", () => {
    const log: EvidenceLog = {
      createdAt: fixedClock.now(),
      entries: [
        makeEntry({
          scheduleId: "commercial-fit-out",
          intent: "demo",
          verdict: "expected-differences",
          mismatchCount: 2,
          topDifferenceCategories: [
            { category: "total_float", count: 2 },
            { category: "calendar_model_difference", count: 1 },
          ],
          boring: true,
        }),
      ],
    };
    const r = evaluatePromotionReadiness(log);
    expect(r.blockers).toEqual([]);
    expect(r.ready).toBe(true);
  });

  it("fails when CFO has an investigate verdict", () => {
    const log: EvidenceLog = {
      createdAt: fixedClock.now(),
      entries: [
        makeEntry({
          scheduleId: "commercial-fit-out",
          intent: "demo",
          verdict: "investigate",
          boring: false,
          topDifferenceCategories: [{ category: "early_finish_date", count: 1 }],
        }),
      ],
    };
    const r = evaluatePromotionReadiness(log);
    expect(r.ready).toBe(false);
    expect(
      r.criteria.find((c) => c.id === "cfo-clean")!.pass,
    ).toBe(false);
    expect(
      r.criteria.find((c) => c.id === "no-investigate-rows")!.pass,
    ).toBe(false);
  });

  it("fails when exception-aware run produces investigate verdict", () => {
    const log: EvidenceLog = {
      createdAt: fixedClock.now(),
      entries: [
        makeEntry({
          scheduleId: "commercial-fit-out",
          intent: "demo",
          verdict: "expected-differences",
          boring: true,
        }),
        makeEntry({
          scheduleId: "commercial-fit-out",
          intent: "demo",
          calendarMode: "exception-aware",
          useExceptionAwareCalendars: true,
          verdict: "investigate",
          boring: false,
          topDifferenceCategories: [{ category: "early_start_date", count: 1 }],
        }),
      ],
    };
    const r = evaluatePromotionReadiness(log);
    expect(r.ready).toBe(false);
    expect(
      r.criteria.find((c) => c.id === "exception-clock-documented")!.pass,
    ).toBe(false);
  });
});

describe("engine2 burn-down — real shadow run integration (Phase 2.9)", () => {
  it("does not change legacy output", () => {
    const schedule = scheduleFromSample();
    const before = calculateSchedule(schedule);
    const log = runShadowComparisons(
      [{ id: "commercial-fit-out", label: schedule.name, schedule, intent: "demo" }],
      { force: true, clock: fixedClock },
    ).log;
    summarizeEvidenceLog(log);
    buildMismatchBurnDown(log);
    evaluatePromotionReadiness(log);
    const after = calculateSchedule(schedule);
    expect(after.projectFinishDate).toBe(before.projectFinishDate);
    expect(after.criticalPath).toEqual(before.criticalPath);
  });

  it("does not flip shadow-mode flag", () => {
    const log = runLog();
    summarizeEvidenceLog(log);
    buildMismatchBurnDown(log);
    evaluatePromotionReadiness(log);
    expect(isEngine2ShadowEnabled()).toBe(false);
  });

  it("formatEvidenceReview is deterministic", () => {
    const log = runLog();
    const a = formatEvidenceReview(log);
    const b = formatEvidenceReview(log);
    expect(a).toBe(b);
    expect(a).toContain("engine2 shadow evidence review");
    expect(a).toContain("promotion-ready:");
  });

  it("does not throw when log entries carry engine2Error", () => {
    const log: EvidenceLog = {
      createdAt: fixedClock.now(),
      entries: [
        makeEntry({ engine2Error: "boom" }),
        makeEntry({ engine2Error: "bridge crashed" }),
      ],
    };
    expect(() => summarizeEvidenceLog(log)).not.toThrow();
    expect(() => buildMismatchBurnDown(log)).not.toThrow();
    expect(() => evaluatePromotionReadiness(log)).not.toThrow();
  });
});
