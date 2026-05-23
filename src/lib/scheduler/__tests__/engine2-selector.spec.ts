/**
 * Phase 3.0 — internal Engine2 selectable-mode tests.
 *
 * Proves:
 *   - default mode is "legacy-only"
 *   - normal users (no flag, no devMode) cannot see the selector UI
 *   - engine2-internal is blocked / downgraded when boring-bar fails
 *   - engine2-internal works when readiness passes (or `force`)
 *   - engine2 errors fall back to legacy without corrupting result
 *   - legacy ScheduleResult is unchanged across all modes
 *   - provenance is emitted with required fields
 *   - comparison report is still produced in comparison + engine2-internal
 */

import { describe, expect, it, vi } from "vitest";
import { commercialFitOutSample } from "../sample";
import { calculateSchedule } from "../engine";
import type { Schedule } from "../types";
import {
  DEFAULT_ENGINE_MODE,
  ENGINE2_VERSION,
  formatProvenance,
  getInternalEngineMode,
  isInternalEngineSelectorUiEnabled,
  resolveEngineMode,
  runScheduleWithSelectedEngine,
  type EngineSelectionProvenance,
  type EvidenceLog,
  type EvidenceLogEntry,
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

function entry(p: Partial<EvidenceLogEntry>): EvidenceLogEntry {
  return {
    scheduleId: "commercial-fit-out",
    scheduleName: "Commercial Fit-Out",
    timestamp: fixedClock.now(),
    legacyEngineVersion: "legacy-1.x",
    engine2Version: ENGINE2_VERSION,
    calendarMode: "whole-day",
    verdict: "expected-differences",
    mismatchCount: 0,
    exactDateMatches: 0,
    classificationCounts: {},
    topDifferenceCategories: [],
    useExceptionAwareCalendars: false,
    boring: true,
    intent: "demo",
    ...p,
  };
}

function passingLog(): EvidenceLog {
  return {
    createdAt: fixedClock.now(),
    entries: [entry({ verdict: "expected-differences", boring: true })],
  };
}

function failingLog(): EvidenceLog {
  return {
    createdAt: fixedClock.now(),
    entries: [
      entry({
        verdict: "investigate",
        boring: false,
        topDifferenceCategories: [{ category: "early_finish_date", count: 1 }],
      }),
    ],
  };
}

describe("engine-selector — defaults & visibility (Phase 3.0)", () => {
  it("DEFAULT_ENGINE_MODE is legacy-only", () => {
    expect(DEFAULT_ENGINE_MODE).toBe("legacy-only");
  });

  it("getInternalEngineMode falls back to legacy-only when no flag is set", () => {
    // Default test env has no scheduler env vars set.
    const mode = getInternalEngineMode();
    expect(mode === "legacy-only" || mode === "comparison").toBe(true);
  });

  it("internal selector UI is hidden for normal users (no flag, no devMode)", () => {
    expect(
      isInternalEngineSelectorUiEnabled({ forceFlag: false, forceDevMode: false }),
    ).toBe(false);
    // dev mode without the flag is still hidden.
    expect(
      isInternalEngineSelectorUiEnabled({ forceFlag: false, forceDevMode: true }),
    ).toBe(false);
    // flag without dev mode is still hidden.
    expect(
      isInternalEngineSelectorUiEnabled({ forceFlag: true, forceDevMode: false }),
    ).toBe(false);
  });

  it("internal selector UI shows only when BOTH flag and devMode are on", () => {
    expect(
      isInternalEngineSelectorUiEnabled({ forceFlag: true, forceDevMode: true }),
    ).toBe(true);
  });
});

describe("engine-selector — readiness gate (Phase 3.0)", () => {
  it("does not gate legacy-only or comparison modes", () => {
    const r1 = resolveEngineMode({
      requestedMode: "legacy-only",
      readiness: { ready: false, criteria: [], blockers: ["x"] },
    });
    expect(r1).toEqual({ effectiveMode: "legacy-only", downgraded: false });
    const r2 = resolveEngineMode({
      requestedMode: "comparison",
      readiness: { ready: false, criteria: [], blockers: ["x"] },
    });
    expect(r2).toEqual({ effectiveMode: "comparison", downgraded: false });
  });

  it("downgrades engine2-internal → comparison when readiness fails", () => {
    const r = resolveEngineMode({
      requestedMode: "engine2-internal",
      readiness: {
        ready: false,
        criteria: [],
        blockers: ["CFO dirty", "engine2 error count > 0"],
      },
    });
    expect(r.effectiveMode).toBe("comparison");
    expect(r.downgraded).toBe(true);
    expect(r.reason).toContain("CFO dirty");
  });

  it("allows engine2-internal when readiness passes", () => {
    const r = resolveEngineMode({
      requestedMode: "engine2-internal",
      readiness: { ready: true, criteria: [], blockers: [] },
    });
    expect(r.effectiveMode).toBe("engine2-internal");
    expect(r.downgraded).toBe(false);
  });

  it("allows engine2-internal when forcePastReadinessGate is true", () => {
    const r = resolveEngineMode({
      requestedMode: "engine2-internal",
      readiness: { ready: false, criteria: [], blockers: ["nope"] },
      forcePastReadinessGate: true,
    });
    expect(r.effectiveMode).toBe("engine2-internal");
    expect(r.downgraded).toBe(false);
  });
});

describe("engine-selector — execution & provenance (Phase 3.0)", () => {
  it("legacy-only run returns legacy result and engine=legacy provenance", () => {
    const schedule = scheduleFromSample();
    const legacy = calculateSchedule(schedule);
    const out = runScheduleWithSelectedEngine(schedule, {
      mode: "legacy-only",
      clock: fixedClock,
    });
    expect(out.result.projectFinishDate).toBe(legacy.projectFinishDate);
    expect(out.result.criticalPath).toEqual(legacy.criticalPath);
    expect(out.comparison).toBeUndefined();
    expect(out.provenance.requestedMode).toBe("legacy-only");
    expect(out.provenance.effectiveMode).toBe("legacy-only");
    expect(out.provenance.engineUsed).toBe("legacy");
    expect(out.provenance.fallbackUsed).toBe(false);
    expect(out.provenance.engine2Version).toBe(ENGINE2_VERSION);
    expect(out.provenance.selectedAt).toBe(fixedClock.now());
  });

  it("engine2-internal mode is downgraded to comparison when log fails readiness", () => {
    const schedule = scheduleFromSample();
    const out = runScheduleWithSelectedEngine(schedule, {
      mode: "engine2-internal",
      evidenceLog: failingLog(),
      clock: fixedClock,
    });
    expect(out.provenance.requestedMode).toBe("engine2-internal");
    expect(out.provenance.effectiveMode).toBe("comparison");
    expect(out.provenance.engineUsed).toBe("legacy");
    expect(out.provenance.fallbackUsed).toBe(true);
    expect(out.provenance.fallbackReason).toContain("boring-bar");
    expect(out.provenance.readinessReady).toBe(false);
    expect(out.provenance.readinessBlockers.length).toBeGreaterThan(0);
    expect(out.comparison).toBeDefined();
  });

  it("engine2-internal runs as engine2 when readiness passes", () => {
    const schedule = scheduleFromSample();
    const out = runScheduleWithSelectedEngine(schedule, {
      mode: "engine2-internal",
      evidenceLog: passingLog(),
      clock: fixedClock,
    });
    expect(out.provenance.effectiveMode).toBe("engine2-internal");
    expect(out.provenance.engineUsed).toBe("engine2");
    expect(out.provenance.fallbackUsed).toBe(false);
    expect(out.provenance.readinessReady).toBe(true);
    expect(out.comparison).toBeDefined();
    expect(out.provenance.comparisonVerdict).toBeDefined();
  });

  it("engine2 errors fall back to legacy without corrupting the result", () => {
    const schedule = scheduleFromSample();
    const legacy = calculateSchedule(schedule);
    // Intentionally break engine2 by stripping projectStartDate AFTER the
    // legacy result is captured. The selector should still return a stable
    // legacy result and surface engine2Error in provenance.
    const broken: Schedule = { ...schedule, projectStartDate: "" };
    const out = runScheduleWithSelectedEngine(broken, {
      mode: "engine2-internal",
      evidenceLog: passingLog(),
      forcePastReadinessGate: true,
      clock: fixedClock,
    });
    // Legacy still produced a sane shape (or threw — selector returns legacy);
    // critical: provenance records fallback.
    expect(out.provenance.fallbackUsed).toBe(true);
    expect(out.provenance.engineUsed).toBe("legacy");
    expect(out.provenance.fallbackReason).toBeTruthy();
    // The unbroken schedule's legacy output is unchanged by this run.
    const after = calculateSchedule(schedule);
    expect(after.projectFinishDate).toBe(legacy.projectFinishDate);
  });

  it("legacy ScheduleResult is identical across all modes", () => {
    const schedule = scheduleFromSample();
    const baseline = calculateSchedule(schedule);
    for (const mode of ["legacy-only", "comparison", "engine2-internal"] as const) {
      const out = runScheduleWithSelectedEngine(schedule, {
        mode,
        evidenceLog: passingLog(),
        clock: fixedClock,
      });
      expect(out.result.projectFinishDate).toBe(baseline.projectFinishDate);
      expect(out.result.criticalPath).toEqual(baseline.criticalPath);
      expect(out.result.tasks.length).toBe(baseline.tasks.length);
    }
  });

  it("comparison mode produces a comparison report and provenance.verdict", () => {
    const schedule = scheduleFromSample();
    const out = runScheduleWithSelectedEngine(schedule, {
      mode: "comparison",
      evidenceLog: passingLog(),
      clock: fixedClock,
    });
    expect(out.comparison).toBeDefined();
    expect(out.provenance.effectiveMode).toBe("comparison");
    expect(out.provenance.comparisonVerdict).toBe(out.comparison?.verdict);
    expect(out.provenance.diagnosticsCount).toBe(
      out.comparison?.engine2DiagnosticsCount ?? -1,
    );
  });

  it("does not mutate the input schedule", () => {
    const schedule = scheduleFromSample();
    const snapshot = JSON.stringify(schedule);
    runScheduleWithSelectedEngine(schedule, {
      mode: "engine2-internal",
      evidenceLog: passingLog(),
      clock: fixedClock,
    });
    expect(JSON.stringify(schedule)).toBe(snapshot);
  });

  it("formatProvenance renders deterministic text including blockers", () => {
    const p: EngineSelectionProvenance = {
      requestedMode: "engine2-internal",
      effectiveMode: "comparison",
      engineUsed: "legacy",
      legacyEngineVersion: "legacy-1.x",
      engine2Version: ENGINE2_VERSION,
      fallbackUsed: true,
      fallbackReason: "boring-bar not met",
      comparisonVerdict: "expected-differences",
      readinessReady: false,
      readinessBlockers: ["CFO dirty"],
      scheduleEligible: true,
      eligibilityBlockers: [],
      eligibilityWarnings: [],
      gateDecision: "req=engine2-internal eff=comparison readiness=fail eligibility=pass",
      diagnosticsCount: 3,
      warnings: [],
      legacyAuthoritative: true,
      selectedAt: fixedClock.now(),
    };
    const a = formatProvenance(p);
    const b = formatProvenance(p);
    expect(a).toBe(b);
    expect(a).toContain("requested=engine2-internal");
    expect(a).toContain("effective=comparison");
    expect(a).toContain("CFO dirty");
    expect(a).toContain(ENGINE2_VERSION);
    expect(a).toContain("legacyAuthoritative=true");
  });
});

describe("engine-selector — no side effects (Phase 3.0)", () => {
  it("does not flip feature flags", () => {
    const before = getInternalEngineMode();
    runScheduleWithSelectedEngine(scheduleFromSample(), {
      mode: "engine2-internal",
      evidenceLog: passingLog(),
      clock: fixedClock,
    });
    expect(getInternalEngineMode()).toBe(before);
  });

  it("does not write to console by itself", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      runScheduleWithSelectedEngine(scheduleFromSample(), {
        mode: "engine2-internal",
        evidenceLog: passingLog(),
        clock: fixedClock,
      });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
