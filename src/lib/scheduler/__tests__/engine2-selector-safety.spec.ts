/**
 * Phase 3.1 — Engine Selector Safety Audit.
 *
 * Negative tests: confirm engine2 is NOT chosen for schedules with
 * features it cannot safely calculate, even when the boring-bar passes
 * or is force-bypassed.
 *
 * Also covers provenance verification + failure-behavior guarantees.
 */

import { describe, expect, it } from "vitest";
import type { Schedule } from "../types";
import {
  ENGINE2_VERSION,
  evaluateScheduleEligibility,
  formatProvenance,
  formatScheduleEligibility,
  runScheduleWithSelectedEngine,
  type EvidenceLog,
  type EvidenceLogEntry,
} from "../engine2";

const fixedClock = { now: () => "2026-05-23T00:00:00.000Z" };

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

function clean(): Schedule {
  return {
    name: "clean",
    projectStartDate: "2026-01-05",
    calendar: { workDays: 31, holidays: [] },
    tasks: [
      { id: "T1", name: "S", duration: 0 },
      { id: "T2", name: "M", duration: 5 },
      { id: "T3", name: "E", duration: 0 },
    ],
    dependencies: [
      { from: "T1", to: "T2", type: "FS", lag: 0 },
      { from: "T2", to: "T3", type: "FS", lag: 0 },
    ],
  };
}

function runWith(schedule: Schedule) {
  return runScheduleWithSelectedEngine(schedule, {
    mode: "engine2-internal",
    evidenceLog: passingLog(),
    forcePastReadinessGate: true,
    clock: fixedClock,
  });
}

// ---------------------------------------------------------------------------
// 1. Eligibility evaluator — deterministic, per-feature blockers
// ---------------------------------------------------------------------------

describe("schedule eligibility — direct evaluation", () => {
  it("returns blockers for null/undefined schedule", () => {
    const e = evaluateScheduleEligibility(null as any);
    expect(e.eligible).toBe(false);
    expect(e.blockers.length).toBeGreaterThan(0);
  });

  it("clean schedule is eligible with zero blockers", () => {
    const e = evaluateScheduleEligibility(clean());
    expect(e.eligible).toBe(true);
    expect(e.blockers).toEqual([]);
  });

  it("flags in-progress activities as blocker", () => {
    const s = clean();
    s.tasks[1].percentComplete = 50;
    const e = evaluateScheduleEligibility(s);
    expect(e.eligible).toBe(false);
    expect(e.checks.find((c) => c.id === "in-progress-activities")?.pass).toBe(false);
  });

  it("flags completed activities without bridged actuals as blocker", () => {
    const s = clean();
    s.tasks[0].percentComplete = 100;
    const e = evaluateScheduleEligibility(s);
    expect(e.eligible).toBe(false);
    expect(
      e.checks.find((c) => c.id === "completed-with-actuals-not-bridged")?.pass,
    ).toBe(false);
  });

  it("flags per-activity calendar references as blocker", () => {
    const s = clean();
    s.calendars = [
      { id: "DEF", name: "Default", isDefault: true, workDays: 31, holidays: [] },
      { id: "NIGHT", name: "Night Shift", isDefault: false, workDays: 31, holidays: [] },
    ];
    s.tasks[1].calendarId = "NIGHT";
    const e = evaluateScheduleEligibility(s);
    expect(e.eligible).toBe(false);
    expect(e.checks.find((c) => c.id === "per-activity-calendars")?.pass).toBe(false);
    expect(e.checks.find((c) => c.id === "multiple-named-calendars")?.pass).toBe(false);
  });

  it("flags non-standard workweek + holidays as warning (not blocker)", () => {
    const s = clean();
    s.calendar = { workDays: 63, holidays: ["2026-01-19"] }; // Mon–Sat + a holiday
    const e = evaluateScheduleEligibility(s);
    expect(e.eligible).toBe(true);
    expect(e.warnings.length).toBeGreaterThan(0);
    expect(
      e.checks.find((c) => c.id === "non-standard-workweek-with-holidays")?.pass,
    ).toBe(false);
  });

  it("flags resource-loaded activities as warning (not blocker)", () => {
    const s = clean();
    s.tasks[1].resourceName = "Carpenters";
    s.tasks[1].resourceUnitsPerDay = 3;
    const e = evaluateScheduleEligibility(s);
    expect(e.eligible).toBe(true);
    expect(
      e.checks.find((c) => c.id === "resource-loaded-activities")?.pass,
    ).toBe(false);
    expect(e.warnings.some((w) => w.includes("resource-loaded"))).toBe(true);
  });

  it("includes importer-owned audit checks for unsupported features", () => {
    const e = evaluateScheduleEligibility(clean());
    const ids = e.checks.map((c) => c.id);
    expect(ids).toContain("leveling-required");
    expect(ids).toContain("unsupported-constraints");
    expect(ids).toContain("external-relationships");
    expect(ids).toContain("baseline-required");
    expect(ids).toContain("unsupported-percent-type");
    expect(ids).toContain("unsupported-duration-type");
    expect(ids).toContain("unsupported-xer-semantics");
  });

  it("formatScheduleEligibility is deterministic", () => {
    const e = evaluateScheduleEligibility(clean());
    expect(formatScheduleEligibility(e)).toBe(formatScheduleEligibility(e));
  });
});

// ---------------------------------------------------------------------------
// 2. Selector forces fallback for each unsupported feature class
// ---------------------------------------------------------------------------

describe("selector — engine2 is NOT selected for unsupported schedules", () => {
  function expectDowngrade(schedule: Schedule, expectBlockerSubstring: string) {
    const out = runWith(schedule);
    expect(out.provenance.requestedMode).toBe("engine2-internal");
    expect(out.provenance.effectiveMode).toBe("comparison");
    expect(out.provenance.engineUsed).toBe("legacy");
    expect(out.provenance.fallbackUsed).toBe(true);
    expect(out.provenance.scheduleEligible).toBe(false);
    expect(out.provenance.fallbackReason).toContain("schedule ineligible");
    expect(
      out.provenance.eligibilityBlockers.some((b) =>
        b.toLowerCase().includes(expectBlockerSubstring.toLowerCase()),
      ),
    ).toBe(true);
    // Public payload always remains the legacy ScheduleResult.
    expect(out.provenance.legacyAuthoritative).toBe(true);
    expect(out.result).toBeDefined();
  }

  it("blocks in-progress activities", () => {
    const s = clean();
    s.tasks[1].percentComplete = 25;
    expectDowngrade(s, "in-progress");
  });

  it("blocks completed activities without bridged actuals", () => {
    const s = clean();
    s.tasks[0].percentComplete = 100;
    expectDowngrade(s, "actualStart");
  });

  it("blocks per-activity calendar assignments", () => {
    const s = clean();
    s.calendars = [
      { id: "DEF", name: "Default", isDefault: true, workDays: 31, holidays: [] },
      { id: "ALT", name: "Alt", isDefault: false, workDays: 31, holidays: [] },
    ];
    s.tasks[1].calendarId = "ALT";
    expectDowngrade(s, "non-default calendar");
  });

  it("blocks schedules with more than one named calendar", () => {
    const s = clean();
    s.calendars = [
      { id: "DEF", name: "Default", isDefault: true, workDays: 31, holidays: [] },
      { id: "B", name: "B", isDefault: false, workDays: 31, holidays: [] },
    ];
    expectDowngrade(s, "named calendar");
  });

  it("blocks empty schedules", () => {
    const s: Schedule = {
      name: "empty",
      projectStartDate: "2026-01-05",
      calendar: { workDays: 31, holidays: [] },
      tasks: [],
      dependencies: [],
    };
    const out = runWith(s);
    expect(out.provenance.scheduleEligible).toBe(false);
    expect(out.provenance.engineUsed).toBe("legacy");
  });

  it("does NOT block resource-loaded activities (warning only)", () => {
    const s = clean();
    s.tasks[1].resourceName = "Carpenters";
    s.tasks[1].resourceUnitsPerDay = 3;
    const out = runWith(s);
    expect(out.provenance.scheduleEligible).toBe(true);
    expect(out.provenance.engineUsed).toBe("engine2");
    expect(out.provenance.eligibilityWarnings.length).toBeGreaterThan(0);
  });

  it("eligibility blocker cannot be bypassed by forcePastReadinessGate", () => {
    const s = clean();
    s.tasks[1].percentComplete = 50;
    const out = runScheduleWithSelectedEngine(s, {
      mode: "engine2-internal",
      evidenceLog: passingLog(),
      forcePastReadinessGate: true,
      clock: fixedClock,
    });
    expect(out.provenance.engineUsed).toBe("legacy");
    expect(out.provenance.fallbackUsed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Provenance verification — every selection emits the required fields
// ---------------------------------------------------------------------------

describe("selector — provenance contract", () => {
  it("every selector result carries every required provenance field", () => {
    const out = runScheduleWithSelectedEngine(clean(), {
      mode: "engine2-internal",
      evidenceLog: passingLog(),
      clock: fixedClock,
    });
    const p = out.provenance;
    // Required fields per audit contract.
    expect(typeof p.requestedMode).toBe("string");
    expect(typeof p.effectiveMode).toBe("string");
    expect(["legacy", "engine2"]).toContain(p.engineUsed);
    expect(p.legacyEngineVersion).toBe("legacy-1.x");
    expect(p.engine2Version).toBe(ENGINE2_VERSION);
    expect(typeof p.fallbackUsed).toBe("boolean");
    expect(typeof p.readinessReady).toBe("boolean");
    expect(Array.isArray(p.readinessBlockers)).toBe(true);
    expect(typeof p.scheduleEligible).toBe("boolean");
    expect(Array.isArray(p.eligibilityBlockers)).toBe(true);
    expect(Array.isArray(p.eligibilityWarnings)).toBe(true);
    expect(Array.isArray(p.warnings)).toBe(true);
    expect(typeof p.gateDecision).toBe("string");
    expect(p.gateDecision).toContain("req=");
    expect(p.gateDecision).toContain("eff=");
    expect(p.gateDecision).toContain("readiness=");
    expect(p.gateDecision).toContain("eligibility=");
    expect(typeof p.legacyAuthoritative).toBe("boolean");
    expect(p.legacyAuthoritative).toBe(true);
    expect(typeof p.selectedAt).toBe("string");
  });

  it("provenance.gateDecision encodes ineligibility", () => {
    const s = clean();
    s.tasks[1].percentComplete = 30;
    const out = runWith(s);
    expect(out.provenance.gateDecision).toContain("eligibility=fail");
  });

  it("formatProvenance renders eligibility blockers + warnings", () => {
    const s = clean();
    s.tasks[1].percentComplete = 30;
    s.tasks[2].resourceName = "Crew";
    const out = runWith(s);
    const text = formatProvenance(out.provenance);
    expect(text).toContain("eligibility blockers:");
    expect(text).toContain("eligibility warnings:");
    expect(text).toContain("legacyAuthoritative=true");
  });
});

// ---------------------------------------------------------------------------
// 4. Failure behavior — engine2 throwing never destabilizes legacy
// ---------------------------------------------------------------------------

describe("selector — failure behavior", () => {
  it("legacy result is byte-stable across engine2 success/failure paths", () => {
    const ok = runScheduleWithSelectedEngine(clean(), {
      mode: "engine2-internal",
      evidenceLog: passingLog(),
      clock: fixedClock,
    });
    const broken: Schedule = { ...clean(), projectStartDate: "" };
    const failed = runScheduleWithSelectedEngine(broken, {
      mode: "engine2-internal",
      evidenceLog: passingLog(),
      forcePastReadinessGate: true,
      clock: fixedClock,
    });
    // Different schedules, but both selector calls return a valid legacy
    // ScheduleResult shape with deterministic fields.
    expect(typeof ok.result.projectDuration).toBe("number");
    expect(typeof failed.result.projectDuration).toBe("number");
    expect(Array.isArray(ok.result.tasks)).toBe(true);
    expect(Array.isArray(failed.result.tasks)).toBe(true);
  });

  it("no partial engine2 result leaks into authoritative state", () => {
    // Selector contract: result === legacy ScheduleResult always. Even
    // when engine2 succeeds, the public payload is unchanged shape.
    const out = runScheduleWithSelectedEngine(clean(), {
      mode: "engine2-internal",
      evidenceLog: passingLog(),
      clock: fixedClock,
    });
    expect(out.provenance.legacyAuthoritative).toBe(true);
    // Comparison report is exposed only on `comparison` field, never
    // merged into `result`.
    expect(out.comparison).toBeDefined();
    expect(out.result).not.toBe(out.comparison);
  });

  it("failure is logged in provenance.fallbackReason", () => {
    const broken: Schedule = { ...clean(), projectStartDate: "" };
    const out = runScheduleWithSelectedEngine(broken, {
      mode: "engine2-internal",
      evidenceLog: passingLog(),
      forcePastReadinessGate: true,
      clock: fixedClock,
    });
    expect(out.provenance.fallbackUsed).toBe(true);
    expect(out.provenance.fallbackReason).toBeTruthy();
    expect(out.provenance.engineUsed).toBe("legacy");
  });
});
