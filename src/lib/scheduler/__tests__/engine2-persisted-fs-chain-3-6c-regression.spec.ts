/**
 * Phase 3.7 — regression sentinel for the persisted FS-chain schedule
 * surfaced by the Phase 3.6c live smoke (`scripts/phase-3-6c-smoke.ts`).
 *
 * This spec locks down the *current* known behavior of the engine2 vs
 * legacy comparison on the simplest real persisted shape that exhibits
 * divergence — a 5-task FS chain on a standard Mon–Fri calendar with no
 * holidays, no progress, no resources, no per-activity calendars.
 *
 * What we are asserting (and WHY):
 *
 *   - Early STARTS match exactly across all 5 activities.
 *     Both engines agree on when each task begins.
 *
 *   - Early FINISHES differ by a consistent calendar-day offset per task,
 *     because the two engines use different end-of-finish conventions:
 *       * legacy renders earlyFinish as the NEXT working-day boundary
 *         after the last worked day  ("exclusive end").
 *       * engine2 renders earlyFinish as the last worked instant itself
 *         ("inclusive end" — 08:00Z on the last worked day with the
 *          current 8h/day bridge).
 *     Effect: legacy EF = engine2 EF + ~1 working day, expressed in
 *     calendar days. Crossing a weekend (Friday→Monday) widens that
 *     +1 working-day gap to +3 calendar days. The 5-task chain's worst
 *     activity straddles a weekend so its delta is 3.
 *
 *   - Project finish: legacy 2026-06-30, engine2 2026-06-29
 *     (1 calendar-day delta; both correspond to "end of work" on the
 *      same business day).
 *
 *   - maxDateDelta = 3 calendar days (driven by activity C).
 *
 *   - maxFloatDelta = 0. Total float and free float MATCH, because the
 *     +1 working-day convention cancels in working-day math.
 *
 *   - Legacy remains authoritative; engine2 output is informational only.
 *
 *   - Dry-run does not mutate schedule state.
 *
 * If a future change either fixes the convention difference or introduces
 * a NEW divergence, this spec will fail loudly and force a re-diagnosis
 * — exactly what a regression sentinel is for. Do not loosen these
 * assertions; update them only with an explicit re-diagnosis logged in
 * ARCHITECTURE.md §38.
 *
 * See ARCHITECTURE.md §38.
 */

import { describe, expect, it } from "vitest";
import { PERSISTED_FS_CHAIN_3_6C_FIXTURE } from "./fixtures/dry-run-fixtures";
import { summarizePersistedDryRun } from "../engine2/persisted-dry-run";
import { runScheduleDryRunComparison } from "../engine2/dry-run";

const SCHEDULE_ID = "3.6c-persisted-fs-chain-regression";

describe("Phase 3.7 — persisted FS-chain 3.6c regression sentinel", () => {
  it("locks down ES match / EF +1-working-day offset / weekend widens to 3d / float matches / no mutation", () => {
    const schedule = PERSISTED_FS_CHAIN_3_6C_FIXTURE.make();
    const snapshot = JSON.stringify(schedule);

    const full = runScheduleDryRunComparison(schedule, { log: false });
    const report = summarizePersistedDryRun({
      scheduleId: SCHEDULE_ID,
      projectName: schedule.name ?? "persisted-fs-chain-3.6c",
      schedule,
    });

    // No mutation invariant.
    expect(JSON.stringify(schedule)).toBe(snapshot);

    // Engine2 ran (no eligibility blockers).
    expect(report.engine2Ran).toBe(true);
    expect(report.eligibilityBlockers).toEqual([]);

    // Legacy remains authoritative.
    expect(report.provenance.legacyAuthoritative).toBe(true);
    expect(report.provenance.engineUsed).toBe("legacy");

    // Project finish sentinel — legacy 2026-06-30, engine2 2026-06-29.
    expect(report.projectFinish.legacy).toBe("2026-06-30");
    expect(report.projectFinish.engine2).toBe("2026-06-29");
    expect(report.projectFinish.match).toBe(false);
    expect(report.projectFinish.deltaDays).toBe(1);

    // Max date delta = 3 (activity C straddles the 06-19 → 06-22 weekend).
    expect(report.maxDateDeltaDays).toBe(3);

    // Float matches under the working-day-cancelling convention.
    expect(report.maxFloatDeltaDays).toBe(0);

    // All 5 activities differ on dates (every EF is offset by +1 working-day).
    expect(report.differingCount).toBe(5);
    expect(report.matchingCount).toBe(0);
    expect(report.differingIds.sort()).toEqual(["A", "B", "C", "D", "E"]);

    // Legacy task table — early STARTS match across the chain exactly,
    // and early FINISHES follow the diagnosed +1 working-day offset
    // (3 calendar days on the weekend-spanning task).
    const legacyById = new Map(full.result.tasks.map((t) => [t.id, t]));
    expect(legacyById.get("A")?.earlyStartDate).toBe("2026-06-01");
    expect(legacyById.get("A")?.earlyFinishDate).toBe("2026-06-04");
    expect(legacyById.get("B")?.earlyStartDate).toBe("2026-06-04");
    expect(legacyById.get("B")?.earlyFinishDate).toBe("2026-06-11");
    expect(legacyById.get("C")?.earlyStartDate).toBe("2026-06-11");
    expect(legacyById.get("C")?.earlyFinishDate).toBe("2026-06-22");
    expect(legacyById.get("D")?.earlyStartDate).toBe("2026-06-22");
    expect(legacyById.get("D")?.earlyFinishDate).toBe("2026-06-26");
    expect(legacyById.get("E")?.earlyStartDate).toBe("2026-06-26");
    expect(legacyById.get("E")?.earlyFinishDate).toBe("2026-06-30");

    // Cross-check on the structured differences: every recorded
    // early-date divergence is an early_finish_date (NOT early_start_date),
    // confirming starts match and only finish-rendering diverges.
    const earlyDateDiffs = (full.comparison?.differences ?? []).filter(
      (d) =>
        d.category === "early_start_date" || d.category === "early_finish_date",
    );
    expect(earlyDateDiffs.length).toBeGreaterThan(0);
    for (const d of earlyDateDiffs) {
      expect(d.category).toBe("early_finish_date");
    }

    // Float / critical-flag IDs — none should appear in those buckets.
    expect(report.differingIds).toEqual(["A", "B", "C", "D", "E"]);
    expect(full.dryRun.mismatchIds.totalFloat).toEqual([]);
    expect(full.dryRun.mismatchIds.freeFloat).toEqual([]);
  });
});
