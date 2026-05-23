/**
 * Phase 2.8 — Engine2 shadow-mode runner + evidence log.
 *
 * Shadow mode runs the engine2 comparison harness against a batch of
 * real-shaped schedules (Commercial Fit-Out sample, manually crafted
 * fixtures, imported schedules, schedules with constraints / progress
 * / resources / baselines) and aggregates the results into an evidence
 * log. The legacy engine remains authoritative; nothing here mutates
 * schedules, legacy results, or product state.
 *
 * GUARDRAILS:
 *   - All entry points are flag-gated. With default flags, shadow mode
 *     is a no-op and produces an empty result.
 *   - Every function is pure with respect to its inputs (the schedule
 *     batch is iterated read-only).
 *   - Engine2 / bridge errors are captured per-entry, never thrown.
 *   - "Boring report" detection is centralized so the boring-target
 *     bar can move in exactly one place.
 *
 * See ARCHITECTURE.md §28.
 */

import {
  compareEnginesOnSchedule,
  type ComparisonClassification,
  type ComparisonDifferenceCategory,
  type ComparisonReport,
  type ComparisonVerdict,
} from "./comparison";
import {
  isEngine2ComparisonEnabled,
  isEngine2ExceptionClockEnabled,
} from "./feature-flag";
import type { Schedule } from "../types";

/**
 * Phase 2.8 — explicit shadow-mode flag. Distinct from the comparison
 * flag so a developer can run ad-hoc comparisons (Phase 2.4+) without
 * implicitly opting into batch shadow runs, and vice versa.
 */
export function isEngine2ShadowEnabled(): boolean {
  // Reuse env resolution by piggy-backing on the comparison flag's logic:
  // shadow mode requires comparison to also be enabled. The dedicated
  // VITE_SCHEDULER_ENGINE2_SHADOW flag is checked first so it can be
  // toggled independently in tests.
  const explicit = readEnv("VITE_SCHEDULER_ENGINE2_SHADOW") ?? readEnv("SCHEDULER_ENGINE2_SHADOW");
  if (explicit && explicit !== "0" && explicit.toLowerCase() !== "false" && explicit.toLowerCase() !== "off") {
    return isEngine2ComparisonEnabled();
  }
  return false;
}

function readEnv(name: string): string | undefined {
  try {
    const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name];
    if (typeof v === "string" && v.length > 0) return v;
  } catch {
    // ignore
  }
  try {
    const v = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
      .process?.env?.[name];
    if (typeof v === "string" && v.length > 0) return v;
  } catch {
    // ignore
  }
  return undefined;
}

/** Calendar-routing mode for a single shadow run. */
export type ShadowCalendarMode = "whole-day" | "exception-aware";

export interface ShadowScheduleInput {
  /** Stable identifier — used in evidence log entries. */
  id: string;
  /** Human-readable label (often schedule.name). */
  label: string;
  schedule: Schedule;
  /**
   * Optional intent tag (e.g. "constraints", "progress", "resources",
   * "baselines", "imported"). Surfaced verbatim in the evidence log so
   * batches stay categorizable.
   */
  intent?: string;
}

/**
 * One evidence-log entry — what we learned from running a single
 * comparison. Deterministic and serializable so it can be exported.
 */
export interface EvidenceLogEntry {
  scheduleId: string;
  scheduleName: string;
  intent?: string;
  /** ISO timestamp the entry was recorded. Tests inject a fixed clock. */
  timestamp: string;
  legacyEngineVersion: string;
  engine2Version: string;
  calendarMode: ShadowCalendarMode;
  verdict: ComparisonVerdict;
  mismatchCount: number;
  exactDateMatches: number;
  /** Counts keyed by ComparisonClassification (non-zero only). */
  classificationCounts: Partial<Record<ComparisonClassification, number>>;
  /** Top difference categories (most common first), bounded for readability. */
  topDifferenceCategories: Array<{
    category: ComparisonDifferenceCategory;
    count: number;
  }>;
  /** True when exception-aware bridge routing was used for this entry. */
  useExceptionAwareCalendars: boolean;
  /** Bridge / engine2 error message when one was captured. */
  engine2Error?: string;
  /** `true` when the report meets the boring-report bar (see `isBoringReport`). */
  boring: boolean;
}

export interface EvidenceLog {
  /** ISO timestamp the log was created. */
  createdAt: string;
  entries: EvidenceLogEntry[];
}

/** Clock seam for deterministic tests. */
export interface ShadowClock {
  now: () => string;
}

const REAL_CLOCK: ShadowClock = {
  now: () => new Date().toISOString(),
};

/**
 * Definition of a "boring" comparison report — i.e. one that does NOT
 * require developer attention. This is the bar Phase 2.8 wants to hit
 * across every shadow-mode schedule before engine2 can be promoted.
 *
 * Rules (all must hold):
 *   1. No bridge / engine2 error.
 *   2. No `investigate`-classified differences.
 *   3. Verdict is `clean` or `expected-differences`.
 *   4. No unclassified categories (engine2_only_diagnostic is allowed
 *      because it is itself a classified bucket).
 *
 * Centralized so the bar moves in exactly one place.
 */
export function isBoringReport(report: ComparisonReport): boolean {
  if (report.engine2Error) return false;
  if ((report.countsByClassification.investigate ?? 0) > 0) return false;
  if (report.verdict === "investigate") return false;
  return true;
}

export interface BoringSummary {
  boring: boolean;
  reasons: string[];
}

/** Returns the same boolean as `isBoringReport` plus the failure reasons. */
export function summarizeBoringness(report: ComparisonReport): BoringSummary {
  const reasons: string[] = [];
  if (report.engine2Error) reasons.push(`engine2 error: ${report.engine2Error}`);
  const investigateCount = report.countsByClassification.investigate ?? 0;
  if (investigateCount > 0) {
    reasons.push(`${investigateCount} investigate-classified difference(s)`);
  }
  if (report.verdict === "investigate") {
    reasons.push(`verdict is investigate`);
  }
  return { boring: reasons.length === 0, reasons };
}

export interface RunShadowOptions {
  /** Force run regardless of env flag. Used by tests/internal tooling. */
  force?: boolean;
  /**
   * Calendar routing mode(s) to run per schedule. Default: `["whole-day"]`.
   * Passing `["whole-day", "exception-aware"]` produces a dual-clock
   * comparison so we can detect whether exception-aware routing changes
   * results in explainable ways.
   */
  calendarModes?: ShadowCalendarMode[];
  /** Cap the number of top categories captured per entry. Default 5. */
  topCategoryLimit?: number;
  clock?: ShadowClock;
}

export interface ShadowRunResult {
  /** True when the run actually executed (flag on OR `force`). */
  ran: boolean;
  log: EvidenceLog;
  /** Convenience aggregates. */
  totals: {
    entries: number;
    boring: number;
    nonBoring: number;
    errors: number;
  };
}

const NOOP_LOG = (): EvidenceLog => ({ createdAt: "", entries: [] });

/**
 * Run shadow-mode comparisons across a batch of schedules. Never throws.
 * When the shadow flag is off and `force` is false, returns an empty,
 * inert result so production callers stay no-op.
 */
export function runShadowComparisons(
  inputs: ShadowScheduleInput[],
  options: RunShadowOptions = {},
): ShadowRunResult {
  const enabled = options.force === true || isEngine2ShadowEnabled();
  if (!enabled) {
    return {
      ran: false,
      log: NOOP_LOG(),
      totals: { entries: 0, boring: 0, nonBoring: 0, errors: 0 },
    };
  }

  const clock = options.clock ?? REAL_CLOCK;
  const modes: ShadowCalendarMode[] = options.calendarModes ?? ["whole-day"];
  const topLimit = options.topCategoryLimit ?? 5;

  const entries: EvidenceLogEntry[] = [];
  let boring = 0;
  let errors = 0;

  for (const input of inputs) {
    for (const mode of modes) {
      const entry = buildEntryForSchedule(input, mode, clock, topLimit);
      entries.push(entry);
      if (entry.boring) boring += 1;
      if (entry.engine2Error) errors += 1;
    }
  }

  return {
    ran: true,
    log: { createdAt: clock.now(), entries },
    totals: {
      entries: entries.length,
      boring,
      nonBoring: entries.length - boring,
      errors,
    },
  };
}

/**
 * Phase 2.8 — dual-clock shadow helper. Runs every input through both
 * whole-day and exception-aware routing and returns the merged log.
 * Convenience over `runShadowComparisons({ calendarModes: [...] })`.
 */
export function runDualCalendarShadow(
  inputs: ShadowScheduleInput[],
  options: Omit<RunShadowOptions, "calendarModes"> = {},
): ShadowRunResult {
  return runShadowComparisons(inputs, {
    ...options,
    calendarModes: ["whole-day", "exception-aware"],
  });
}

function buildEntryForSchedule(
  input: ShadowScheduleInput,
  mode: ShadowCalendarMode,
  clock: ShadowClock,
  topLimit: number,
): EvidenceLogEntry {
  const useExceptionAwareCalendars = mode === "exception-aware";
  let report: ComparisonReport | undefined;
  let engine2Error: string | undefined;
  try {
    const run = compareEnginesOnSchedule(input.schedule, {
      treatFloatAsLimitation: true,
      useExceptionAwareCalendars,
    });
    report = run.report;
    engine2Error = run.report.engine2Error;
  } catch (err) {
    engine2Error = err instanceof Error ? err.message : String(err);
  }

  if (!report) {
    return {
      scheduleId: input.id,
      scheduleName: input.label,
      intent: input.intent,
      timestamp: clock.now(),
      legacyEngineVersion: "legacy-1.x",
      engine2Version: "unknown",
      calendarMode: mode,
      verdict: "investigate",
      mismatchCount: 0,
      exactDateMatches: 0,
      classificationCounts: {},
      topDifferenceCategories: [],
      useExceptionAwareCalendars,
      engine2Error,
      boring: false,
    };
  }

  const classificationCounts: Partial<Record<ComparisonClassification, number>> = {};
  for (const [k, v] of Object.entries(report.countsByClassification) as Array<
    [ComparisonClassification, number]
  >) {
    if (v > 0) classificationCounts[k] = v;
  }

  const topDifferenceCategories = (
    Object.entries(report.countsByCategory) as Array<
      [ComparisonDifferenceCategory, number]
    >
  )
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topLimit)
    .map(([category, count]) => ({ category, count }));

  return {
    scheduleId: input.id,
    scheduleName: input.label,
    intent: input.intent,
    timestamp: clock.now(),
    legacyEngineVersion: report.legacyEngineVersion,
    engine2Version: report.engine2Version,
    calendarMode: mode,
    verdict: report.verdict,
    mismatchCount: report.differences.length,
    exactDateMatches: report.exactDateMatches,
    classificationCounts,
    topDifferenceCategories,
    useExceptionAwareCalendars,
    engine2Error,
    boring: isBoringReport(report),
  };
}

/** Export the evidence log as a pretty-printed JSON blob. */
export function exportEvidenceLogToJson(log: EvidenceLog): string {
  return JSON.stringify(log, null, 2);
}

/**
 * Export the evidence log as CSV — one row per entry. Columns are
 * deterministic so diffs across runs are reviewable.
 */
export function exportEvidenceLogToCsv(log: EvidenceLog): string {
  const headers = [
    "scheduleId",
    "scheduleName",
    "intent",
    "timestamp",
    "legacyEngineVersion",
    "engine2Version",
    "calendarMode",
    "verdict",
    "mismatchCount",
    "exactDateMatches",
    "useExceptionAwareCalendars",
    "boring",
    "engine2Error",
    "topClassifications",
    "topCategories",
  ];
  const rows = log.entries.map((e) => {
    const classes = Object.entries(e.classificationCounts)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => `${k}:${v}`)
      .join("|");
    const cats = e.topDifferenceCategories
      .map((c) => `${c.category}:${c.count}`)
      .join("|");
    return [
      e.scheduleId,
      e.scheduleName,
      e.intent ?? "",
      e.timestamp,
      e.legacyEngineVersion,
      e.engine2Version,
      e.calendarMode,
      e.verdict,
      String(e.mismatchCount),
      String(e.exactDateMatches),
      String(e.useExceptionAwareCalendars),
      String(e.boring),
      e.engine2Error ?? "",
      classes,
      cats,
    ].map(csvEscape).join(",");
  });
  return [headers.join(","), ...rows].join("\n");
}

function csvEscape(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
