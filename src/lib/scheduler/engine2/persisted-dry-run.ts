/**
 * Phase 3.6 — internal-only dry-run comparison against persisted schedules.
 *
 * Builds on top of the Phase 3.4 `runScheduleDryRunComparison` entry point
 * and produces a `PersistedDryRunReport` that adds the metadata an internal
 * operator needs to make sense of a saved schedule run:
 *
 *   - schedule id / project name
 *   - whether engine2 ran or was skipped (with reason)
 *   - eligibility blockers + warnings
 *   - matching / differing counts, max date / float deltas
 *   - sorted differing-activity IDs
 *   - project finish match/mismatch (legacy + engine2)
 *   - engine selection provenance (mode, gates, legacy authoritative flag)
 *
 * GUARDRAILS — identical to §35/§36:
 *   - Production code paths NEVER call this module.
 *   - Engine2 output is never persisted and never returned as the
 *     authoritative `ScheduleResult` (the legacy result is always
 *     authoritative; we deliberately do not return it from this helper
 *     to keep the surface report-only).
 *   - Schedule state is never mutated.
 *   - UNKNOWN / BLOCK capability metadata still gates engine2 off via
 *     `runScheduleWithSelectedEngine` -> eligibility audit.
 *   - Engine2 errors fall back cleanly: legacy stays authoritative and
 *     the error is surfaced in `engine2Error`.
 *
 * See ARCHITECTURE.md §37.
 */

import type { Schedule } from "../types";
import { runScheduleDryRunComparison } from "./dry-run";

export interface PersistedDryRunReport {
  scheduleId: string;
  projectName: string;
  engine2Ran: boolean;
  skippedReason?: string;
  eligibilityBlockers: string[];
  eligibilityWarnings: string[];
  matchingCount: number;
  differingCount: number;
  maxDateDeltaDays: number;
  maxFloatDeltaDays: number;
  differingIds: string[];
  projectFinish: {
    legacy: string | null;
    engine2: string | null;
    deltaDays: number;
    match: boolean;
  };
  provenance: {
    effectiveMode: string;
    legacyAuthoritative: true;
    engineUsed: "legacy" | "engine2";
    gateDecision: string;
    scheduleEligible: boolean;
  };
  engine2DiagnosticsCount: number;
  engine2Error?: string;
}

export interface SummarizePersistedDryRunInput {
  scheduleId: string;
  projectName: string;
  schedule: Schedule;
}

/**
 * Pure helper: takes a loaded persisted schedule and produces the
 * internal-only Phase 3.6 dry-run report. Never mutates `schedule` and
 * never returns engine2 output as authoritative.
 */
export function summarizePersistedDryRun(
  input: SummarizePersistedDryRunInput,
): PersistedDryRunReport {
  const { scheduleId, projectName, schedule } = input;
  const out = runScheduleDryRunComparison(schedule, { log: false });
  const { dryRun, provenance } = out;

  const differing = new Set<string>([
    ...dryRun.mismatchIds.earlyDates,
    ...dryRun.mismatchIds.lateDates,
    ...dryRun.mismatchIds.totalFloat,
    ...dryRun.mismatchIds.freeFloat,
    ...dryRun.mismatchIds.criticalFlag,
    ...dryRun.mismatchIds.drivingLink,
    ...dryRun.mismatchIds.missingInEngine2,
    ...dryRun.mismatchIds.missingInLegacy,
  ]);

  return {
    scheduleId,
    projectName,
    engine2Ran: dryRun.engine2Ran,
    skippedReason: dryRun.skippedReason,
    eligibilityBlockers: dryRun.eligibilityBlockers,
    eligibilityWarnings: dryRun.eligibilityWarnings,
    matchingCount: dryRun.matchingCount,
    differingCount: dryRun.differingCount,
    maxDateDeltaDays: dryRun.maxDateDeltaDays,
    maxFloatDeltaDays: dryRun.maxFloatDeltaDays,
    differingIds: [...differing].sort(),
    projectFinish: {
      legacy: dryRun.projectFinish.legacy,
      engine2: dryRun.projectFinish.engine2,
      deltaDays: dryRun.projectFinish.deltaDays,
      match: dryRun.projectFinish.deltaDays === 0,
    },
    provenance: {
      effectiveMode: provenance.effectiveMode,
      legacyAuthoritative: true,
      engineUsed: provenance.engineUsed,
      gateDecision: provenance.gateDecision,
      scheduleEligible: provenance.scheduleEligible,
    },
    engine2DiagnosticsCount: dryRun.engine2DiagnosticsCount,
    engine2Error: dryRun.engine2Error,
  };
}
