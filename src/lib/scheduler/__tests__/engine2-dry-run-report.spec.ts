/**
 * Phase 3.9 — dry-run report formatter tests.
 *
 * Asserts:
 *   - 3.6c persisted FS-chain report shows raw mismatch but normalized match
 *   - trueDateMismatchIds is empty for 3.6c
 *   - conventionMismatchIds includes the expected activities
 *   - ineligible/skipped report includes skipped reason + blockers
 *   - every report keeps legacy as authoritative
 */

import { describe, expect, it } from "vitest";
import {
  PERSISTED_FS_CHAIN_3_6C_FIXTURE,
  makeIneligibleFixture,
} from "./fixtures/dry-run-fixtures";
import { summarizePersistedDryRun } from "../engine2/persisted-dry-run";
import {
  buildDryRunReportJson,
  formatDryRunReportMarkdown,
} from "../engine2/dry-run-report";

const STABLE_TS = "2026-05-24T00:00:00.000Z";

describe("Phase 3.9 dry-run report formatter — 3.6c persisted FS-chain fixture", () => {
  const schedule = PERSISTED_FS_CHAIN_3_6C_FIXTURE.make();
  const report = summarizePersistedDryRun({
    scheduleId: "fixture-3-6c",
    projectName: PERSISTED_FS_CHAIN_3_6C_FIXTURE.name,
    schedule,
  });
  const json = buildDryRunReportJson(report, { runTimestamp: STABLE_TS });
  const md = formatDryRunReportMarkdown(report, { runTimestamp: STABLE_TS });

  it("engine2 actually ran and remained non-authoritative", () => {
    expect(report.engine2Ran).toBe(true);
    expect(json.legacyAuthoritative).toBe(true);
    expect(json.provenance.legacyAuthoritative).toBe(true);
  });

  it("raw view shows real differences (rendering convention)", () => {
    expect(json.activities.raw.differingCount).toBeGreaterThan(0);
    expect(json.activities.raw.maxDateDeltaDays).toBeGreaterThan(0);
    expect(json.projectFinish.raw.match).toBe(false);
    expect(json.projectFinish.raw.deltaDays).toBeGreaterThan(0);
  });

  it("normalized view collapses convention-only mismatches to match", () => {
    expect(json.projectFinish.normalized.match).toBe(true);
    expect(json.projectFinish.normalized.deltaDays).toBe(0);
    expect(json.activities.normalized.differingCount).toBe(0);
    expect(json.activities.normalized.maxDateDeltaDays).toBe(0);
  });

  it("trueDateMismatchIds is empty across all dimensions for 3.6c", () => {
    expect(json.trueDateMismatchIds.earlyStart).toEqual([]);
    expect(json.trueDateMismatchIds.earlyFinish).toEqual([]);
    expect(json.trueDateMismatchIds.lateStart).toEqual([]);
    expect(json.trueDateMismatchIds.lateFinish).toEqual([]);
  });

  it("conventionMismatchIds.earlyFinish includes the chain activities", () => {
    // 3.6c is a 5-task FS chain A→B→C→D→E. Every task's early-finish
    // differs only by the rendering convention.
    expect(json.conventionMismatchIds.earlyFinish.length).toBeGreaterThan(0);
    for (const id of json.conventionMismatchIds.earlyFinish) {
      expect(["A", "B", "C", "D", "E"]).toContain(id);
    }
  });

  it("markdown report preserves raw vs normalized distinction", () => {
    expect(md).toContain("# Engine2 Dry-Run Report");
    expect(md).toContain("Legacy authoritative");
    expect(md).toContain("Raw (no normalization)");
    expect(md).toContain("Normalized (finish-convention adjusted");
    expect(md).toContain("Convention-only Mismatches");
    expect(md).toContain("True Date Mismatches");
    expect(md).toContain(STABLE_TS);
    // The closing disclaimer must explicitly say legacy stays authoritative.
    expect(md).toContain(
      "Legacy `calculateSchedule` remains the sole authoritative engine in production",
    );
  });
});

describe("Phase 3.9 dry-run report formatter — ineligible/skipped schedule", () => {
  const schedule = makeIneligibleFixture();
  const report = summarizePersistedDryRun({
    scheduleId: "fixture-ineligible",
    projectName: "ineligible-in-progress",
    schedule,
  });
  const json = buildDryRunReportJson(report, { runTimestamp: STABLE_TS });
  const md = formatDryRunReportMarkdown(report, { runTimestamp: STABLE_TS });

  it("engine2 was skipped with a reason", () => {
    expect(report.engine2Ran).toBe(false);
    expect(json.engine2.skippedReason).toBeTruthy();
    expect(json.eligibility.blockers.length).toBeGreaterThan(0);
  });

  it("legacy remains authoritative even on skipped runs", () => {
    expect(json.legacyAuthoritative).toBe(true);
    expect(json.provenance.legacyAuthoritative).toBe(true);
    expect(json.provenance.engineUsed).toBe("legacy");
  });

  it("markdown surfaces the skipped reason and blockers", () => {
    expect(md).toContain("Engine2 ran**: false");
    expect(md).toContain("Skipped reason");
    expect(md).toContain("Blockers");
  });
});
