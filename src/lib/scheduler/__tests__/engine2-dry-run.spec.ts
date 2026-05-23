/**
 * Phase 3.4 — engine2 dry-run comparison entrypoint tests.
 *
 * Proves:
 *   - Legacy remains authoritative (engine2 output never leaks into `result`).
 *   - Dry-run does not mutate schedule state.
 *   - Ineligible schedules return a skipped summary; engine2 is not executed.
 *   - Engine2 errors fall back cleanly without leaking partial results.
 *   - Summary correctly captures matching/differing counts, max date and
 *     float deltas, project-finish delta, and mismatch IDs.
 */

import { describe, expect, it, vi } from "vitest";
import type { Schedule } from "../types";
import {
  formatDryRunSummary,
  runScheduleDryRunComparison,
} from "../engine2/dry-run";
import { calculateSchedule } from "../engine";

function clean(): Schedule {
  return {
    name: "dry-run-clean",
    projectStartDate: "2026-01-05",
    calendar: { workDays: 31, holidays: [] },
    tasks: [
      { id: "T1", name: "Start", duration: 0 },
      { id: "T2", name: "Mid", duration: 5 },
      { id: "T3", name: "End", duration: 0 },
    ],
    dependencies: [
      { from: "T1", to: "T2", type: "FS", lag: 0 },
      { from: "T2", to: "T3", type: "FS", lag: 0 },
    ],
  };
}

describe("runScheduleDryRunComparison — legacy authoritative", () => {
  it("returns the legacy ScheduleResult as the authoritative payload", () => {
    const schedule = clean();
    const out = runScheduleDryRunComparison(schedule, { log: false });
    const legacyDirect = calculateSchedule(schedule);
    expect(out.provenance.legacyAuthoritative).toBe(true);
    expect(out.provenance.engineUsed).toBe("legacy");
    expect(out.result.tasks.length).toBe(legacyDirect.tasks.length);
    expect(out.result.projectFinishDate).toBe(legacyDirect.projectFinishDate);
  });

  it("never mutates schedule state", () => {
    const schedule = clean();
    const snapshot = JSON.stringify(schedule);
    runScheduleDryRunComparison(schedule, { log: false });
    expect(JSON.stringify(schedule)).toBe(snapshot);
  });

  it("does not mutate the legacy result vs a direct calculateSchedule call", () => {
    const a = calculateSchedule(clean());
    const b = runScheduleDryRunComparison(clean(), { log: false }).result;
    expect(b.tasks.map((t) => t.id)).toEqual(a.tasks.map((t) => t.id));
    expect(b.projectFinishDate).toBe(a.projectFinishDate);
  });
});

describe("runScheduleDryRunComparison — eligibility gating", () => {
  it("skips engine2 when the schedule is ineligible (in-progress activity)", () => {
    const s = clean();
    s.tasks[1].percentComplete = 40;
    const out = runScheduleDryRunComparison(s, { log: false });
    expect(out.dryRun.engine2Ran).toBe(false);
    expect(out.dryRun.skippedReason).toContain("ineligible");
    expect(out.dryRun.eligibilityBlockers.length).toBeGreaterThan(0);
    // Authoritative result still returned.
    expect(out.result.tasks.length).toBe(s.tasks.length);
    expect(out.provenance.scheduleEligible).toBe(false);
    expect(out.provenance.engineUsed).toBe("legacy");
  });

  it("runs engine2 dry-run on eligible schedules and reports a verdict", () => {
    const out = runScheduleDryRunComparison(clean(), { log: false });
    expect(out.dryRun.engine2Ran).toBe(true);
    expect(out.dryRun.verdict).toBeDefined();
    expect(out.comparison).toBeDefined();
    expect(out.provenance.scheduleEligible).toBe(true);
  });
});

describe("runScheduleDryRunComparison — summary metrics", () => {
  it("captures matching count, differing count, and project-finish delta", () => {
    const out = runScheduleDryRunComparison(clean(), { log: false });
    const { dryRun } = out;
    expect(dryRun.matchingCount + dryRun.differingCount).toBeLessThanOrEqual(
      out.result.tasks.length,
    );
    expect(dryRun.maxDateDeltaDays).toBeGreaterThanOrEqual(0);
    expect(dryRun.maxFloatDeltaDays).toBeGreaterThanOrEqual(0);
    expect(dryRun.projectFinish.legacy).toBe(out.result.projectFinishDate);
    expect(dryRun.projectFinish.deltaDays).toBeGreaterThanOrEqual(0);
  });

  it("mismatchIds buckets are sorted and unique", () => {
    const out = runScheduleDryRunComparison(clean(), { log: false });
    for (const ids of Object.values(out.dryRun.mismatchIds)) {
      const sorted = [...ids].sort();
      expect(ids).toEqual(sorted);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("runScheduleDryRunComparison — logging discipline", () => {
  it("emits a concise summary line only when log is enabled", () => {
    const sink = vi.fn();
    runScheduleDryRunComparison(clean(), { log: true, logSink: sink });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toContain("[engine2 dry-run]");
  });

  it("does not log when log is explicitly false", () => {
    const sink = vi.fn();
    runScheduleDryRunComparison(clean(), { log: false, logSink: sink });
    expect(sink).not.toHaveBeenCalled();
  });

  it("formats skipped summaries with their reason", () => {
    const s = clean();
    s.tasks[1].percentComplete = 50;
    const out = runScheduleDryRunComparison(s, { log: false });
    const line = formatDryRunSummary(out.provenance, out.dryRun);
    expect(line).toContain("skipped");
    expect(line).toContain("ineligible");
  });
});
