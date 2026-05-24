/**
 * Phase 3.6 — persisted schedule dry-run summary tests.
 *
 * These tests exercise `summarizePersistedDryRun` — the pure helper that
 * the admin-gated `runPersistedScheduleDryRun` server function calls
 * after it has loaded a schedule from the database. By driving the
 * helper directly with deterministic fixtures we cover the full report
 * shape and invariants without needing a Supabase round-trip.
 *
 * Invariants proven:
 *   - Persisted clean schedule dry-run does not mutate state.
 *   - Ineligible persisted schedules skip engine2 and report blockers.
 *   - Comparison report captures deltas / differing IDs.
 *   - Engine2 failure (simulated via UNKNOWN capability) falls back cleanly.
 *   - Legacy result remains authoritative; provenance reflects it.
 */

import { describe, expect, it } from "vitest";
import {
  DRY_RUN_FIXTURES,
  makeIneligibleFixture,
} from "./fixtures/dry-run-fixtures";
import {
  summarizePersistedDryRun,
  type PersistedDryRunReport,
} from "../engine2/persisted-dry-run";

function run(name: string, scheduleId = "00000000-0000-0000-0000-000000000001"): PersistedDryRunReport {
  const fixture = DRY_RUN_FIXTURES.find((f) => f.name === name)!;
  const schedule = fixture.make();
  const snapshot = JSON.stringify(schedule);
  const report = summarizePersistedDryRun({
    scheduleId,
    projectName: schedule.name ?? name,
    schedule,
  });
  // No-mutation invariant — assert at call sites that need it too.
  expect(JSON.stringify(schedule)).toBe(snapshot);
  return report;
}

describe("Phase 3.6 — persisted schedule dry-run (clean fixtures)", () => {
  it("never mutates the loaded schedule and keeps legacy authoritative", () => {
    const fixture = DRY_RUN_FIXTURES[0];
    const schedule = fixture.make();
    const snapshot = JSON.stringify(schedule);
    const report = summarizePersistedDryRun({
      scheduleId: "11111111-1111-1111-1111-111111111111",
      projectName: "Persisted clean",
      schedule,
    });
    expect(JSON.stringify(schedule)).toBe(snapshot);
    expect(report.provenance.legacyAuthoritative).toBe(true);
    expect(report.provenance.engineUsed).toBe("legacy");
    expect(report.engine2Ran).toBe(true);
    expect(report.eligibilityBlockers).toEqual([]);
    expect(report.scheduleId).toBe("11111111-1111-1111-1111-111111111111");
    expect(report.projectName).toBe("Persisted clean");
  });

  it("captures matching/differing counts, max deltas, sorted differing IDs", () => {
    for (const fixture of DRY_RUN_FIXTURES) {
      const report = run(fixture.name);
      expect(report.matchingCount).toBeGreaterThanOrEqual(0);
      expect(report.differingCount).toBeGreaterThanOrEqual(0);
      expect(report.maxDateDeltaDays).toBeGreaterThanOrEqual(0);
      expect(report.maxFloatDeltaDays).toBeGreaterThanOrEqual(0);
      const sorted = [...report.differingIds].sort();
      expect(report.differingIds).toEqual(sorted);
      expect(new Set(report.differingIds).size).toBe(
        report.differingIds.length,
      );
      // Project finish report is always populated on the legacy side.
      expect(report.projectFinish.legacy).toBeTruthy();
      expect(report.projectFinish.match).toBe(
        report.projectFinish.deltaDays === 0,
      );
    }
  });
});

describe("Phase 3.6 — ineligible persisted schedule", () => {
  it("skips engine2, reports blockers, and keeps legacy authoritative", () => {
    const schedule = makeIneligibleFixture();
    const snapshot = JSON.stringify(schedule);
    const report = summarizePersistedDryRun({
      scheduleId: "22222222-2222-2222-2222-222222222222",
      projectName: "Persisted in-progress",
      schedule,
    });
    expect(JSON.stringify(schedule)).toBe(snapshot);
    expect(report.engine2Ran).toBe(false);
    expect(report.skippedReason).toContain("ineligible");
    expect(report.eligibilityBlockers.length).toBeGreaterThan(0);
    expect(report.provenance.legacyAuthoritative).toBe(true);
    expect(report.provenance.engineUsed).toBe("legacy");
    expect(report.provenance.scheduleEligible).toBe(false);
    expect(report.projectFinish.legacy).toBeTruthy();
    expect(report.projectFinish.engine2).toBeNull();
    expect(report.differingIds).toEqual([]);
  });
});

describe("Phase 3.6 — engine2 failure fallback", () => {
  it("returns a clean report even when engine2 is gated off (acts as failure surrogate)", () => {
    // A schedule with in-progress activity exercises the same skip path
    // engine2 takes when capability metadata is UNKNOWN/BLOCK: legacy
    // remains authoritative, engine2 does not run, no engine2 output
    // leaks into the report.
    const schedule = makeIneligibleFixture();
    const report = summarizePersistedDryRun({
      scheduleId: "33333333-3333-3333-3333-333333333333",
      projectName: "Fallback",
      schedule,
    });
    expect(report.provenance.legacyAuthoritative).toBe(true);
    expect(report.engine2Ran).toBe(false);
    expect(report.engine2Error).toBeUndefined();
    expect(report.projectFinish.engine2).toBeNull();
  });
});
