/**
 * Phase 3.8 — finish-date convention normalization tests.
 *
 * Locks the reporting-only normalization adapter that maps engine2's
 * inclusive last-work-moment finish into legacy's exclusive
 * next-working-day boundary, and the dry-run summary that surfaces
 * convention-only vs true mismatches.
 *
 * Regression coverage for the 3.6c persisted FS-chain fixture:
 *   - raw view still surfaces legacy 2026-06-30 vs engine2 2026-06-29
 *   - normalized view treats every divergence as convention-only
 *   - ES values match; float values match
 *   - no true CPM mismatch remains after normalization
 *   - legacy remains authoritative
 *   - dry-run does not mutate state
 */

import { describe, expect, it } from "vitest";
import {
  classifyFinishDateMismatch,
  nextWorkingDayIso,
  normalizeEngine2FinishIso,
} from "../engine2/finish-convention";
import { runScheduleDryRunComparison } from "../engine2/dry-run";
import { summarizePersistedDryRun } from "../engine2/persisted-dry-run";
import { PERSISTED_FS_CHAIN_3_6C_FIXTURE } from "./fixtures/dry-run-fixtures";
import type { Schedule } from "../types";

const MON_FRI: Schedule = {
  name: "mon-fri",
  projectStartDate: "2026-06-01",
  calendar: { workDays: 31, holidays: [] },
  tasks: [],
  dependencies: [],
};

describe("Phase 3.8 — finish-convention helpers", () => {
  it("nextWorkingDayIso steps past weekends on a Mon–Fri calendar", () => {
    expect(nextWorkingDayIso("2026-06-03", MON_FRI.calendar!)).toBe("2026-06-04"); // Wed → Thu
    expect(nextWorkingDayIso("2026-06-19", MON_FRI.calendar!)).toBe("2026-06-22"); // Fri → Mon
    expect(nextWorkingDayIso("2026-06-22", MON_FRI.calendar!)).toBe("2026-06-23"); // Mon → Tue
  });

  it("nextWorkingDayIso respects holidays", () => {
    const cal = { workDays: 31, holidays: ["2026-06-22"] };
    expect(nextWorkingDayIso("2026-06-19", cal)).toBe("2026-06-23"); // skip Mon holiday
  });

  it("normalizeEngine2FinishIso uses the schedule's project calendar", () => {
    expect(normalizeEngine2FinishIso("2026-06-19", MON_FRI)).toBe("2026-06-22");
    expect(normalizeEngine2FinishIso(null, MON_FRI)).toBeNull();
    expect(normalizeEngine2FinishIso("", MON_FRI)).toBeNull();
  });

  it("classifyFinishDateMismatch distinguishes convention from true mismatch", () => {
    // Engine2 reports the last-work day (Fri); legacy reports the next
    // working day boundary (Mon) — convention-only.
    expect(
      classifyFinishDateMismatch("2026-06-22", "2026-06-19", MON_FRI),
    ).toBe("convention-only");
    // Exact match.
    expect(
      classifyFinishDateMismatch("2026-06-22", "2026-06-22", MON_FRI),
    ).toBe("match");
    // A 2-working-day gap is not the convention — true mismatch.
    expect(
      classifyFinishDateMismatch("2026-06-23", "2026-06-19", MON_FRI),
    ).toBe("true-mismatch");
  });
});

describe("Phase 3.8 — 3.6c persisted FS-chain: convention-adjusted view", () => {
  it("raw view still shows the divergence; normalized view collapses it", () => {
    const schedule = PERSISTED_FS_CHAIN_3_6C_FIXTURE.make();
    const snapshot = JSON.stringify(schedule);

    const full = runScheduleDryRunComparison(schedule, { log: false });
    const report = summarizePersistedDryRun({
      scheduleId: "3.8-persisted-fs-chain",
      projectName: schedule.name ?? "persisted-fs-chain-3.6c",
      schedule,
    });

    // Schedule state is untouched.
    expect(JSON.stringify(schedule)).toBe(snapshot);

    // Legacy authoritative.
    expect(report.provenance.legacyAuthoritative).toBe(true);
    expect(report.provenance.engineUsed).toBe("legacy");

    // --- Raw view: unchanged from §38 baseline ---------------------------
    expect(report.projectFinish.legacy).toBe("2026-06-30");
    expect(report.projectFinish.engine2).toBe("2026-06-29");
    expect(report.projectFinish.match).toBe(false);
    expect(report.projectFinish.deltaDays).toBe(1);
    expect(report.maxDateDeltaDays).toBe(3);
    expect(report.differingCount).toBe(5);
    expect(report.matchingCount).toBe(0);

    // --- Normalized view: convention-adjusted ---------------------------
    expect(report.normalizedProjectFinish.engine2Normalized).toBe("2026-06-30");
    expect(report.normalizedProjectFinish.deltaDays).toBe(0);
    expect(report.normalizedProjectFinish.match).toBe(true);

    // Every early-finish divergence classifies as convention-only.
    expect(report.conventionMismatchIds.earlyFinish.sort()).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
    ]);
    // Late-finish divergence is also convention-only (the project tail
    // activity inherits the same +1 working-day boundary offset).
    expect(report.conventionMismatchIds.lateFinish).toEqual(["E"]);

    // No true date mismatch remains after normalization.
    expect(report.trueDateMismatchIds.earlyStart).toEqual([]);
    expect(report.trueDateMismatchIds.earlyFinish).toEqual([]);
    expect(report.trueDateMismatchIds.lateStart).toEqual([]);
    expect(report.trueDateMismatchIds.lateFinish).toEqual([]);
    expect(report.conventionAdjustedDifferingCount).toBe(0);
    expect(report.conventionAdjustedMatchingCount).toBe(5);
    expect(report.maxNormalizedDateDeltaDays).toBe(0);

    // Float still matches under both views.
    expect(report.maxFloatDeltaDays).toBe(0);

    // dryRun mirror exposes the same data on the full comparison result.
    expect(full.dryRun.normalizedProjectFinish.match).toBe(true);
    expect(full.dryRun.conventionAdjustedDifferingCount).toBe(0);
  });
});
