/**
 * Phase 3.4 — internal-only dry-run comparison entrypoint.
 *
 * Wires `runScheduleWithSelectedEngine` into a thin wrapper that callers
 * (tests, future dev drawers, engineering diagnosis) can use to obtain:
 *
 *   - the authoritative legacy `ScheduleResult` (never engine2 output)
 *   - a side-by-side comparison summary (matching/differing counts, max
 *     date delta, max float delta, project-finish delta, mismatch IDs)
 *   - engine2 provenance + eligibility blockers/warnings
 *
 * GUARDRAILS:
 *   - Production callers (legacy code paths in the UI) DO NOT go through
 *     this module. Production reads `calculateSchedule` directly.
 *   - This wrapper NEVER mutates schedule state and NEVER returns engine2
 *     output as the authoritative `result`.
 *   - When engine2 is ineligible (eligibility blockers) the dry-run still
 *     runs legacy and returns a "skipped" summary — engine2 is NOT invoked.
 *   - When engine2 throws, legacy is still returned and the error is
 *     captured in provenance.fallbackReason + dryRun.engine2Error.
 *   - Logging only fires in dev / when an explicit `log` option is set.
 *
 * See ARCHITECTURE.md §35.
 */

import type { Schedule, ScheduleResult, SchedulerOptions } from "../types";
import { instantToIsoDate } from "./legacy-bridge";
import type { ComparisonDifference, ComparisonReport, ComparisonVerdict } from "./comparison";
import {
  runScheduleWithSelectedEngine,
  type EngineSelectionProvenance,
  type SelectedScheduleResult,
} from "./engine-selector";
import {
  classifyFinishDateMismatch,
  normalizeEngine2FinishIso,
} from "./finish-convention";

const MS_PER_DAY = 86_400_000;

export interface DryRunMismatchIds {
  earlyDates: string[];
  lateDates: string[];
  totalFloat: string[];
  freeFloat: string[];
  criticalFlag: string[];
  drivingLink: string[];
  missingInEngine2: string[];
  missingInLegacy: string[];
}

export interface DryRunSummary {
  /** Whether engine2 was actually executed in this dry-run. */
  engine2Ran: boolean;
  /** Why engine2 was skipped (if it was). */
  skippedReason?: string;
  /** Side-by-side verdict. Absent when engine2 was skipped. */
  verdict?: ComparisonVerdict;
  /** Activities present in both engines that matched on all four dates. */
  matchingCount: number;
  /** Activities present in both engines with at least one date difference. */
  differingCount: number;
  /** Max |legacy - engine2| date delta across ES/EF/LS/LF, in whole days. */
  maxDateDeltaDays: number;
  /** Max |legacy - engine2| float delta (legacy days vs engine2 working days). */
  maxFloatDeltaDays: number;
  /** Project finish comparison. Engine2 finish is derived from max(earlyFinish). */
  projectFinish: {
    legacy: string | null;
    engine2: string | null;
    deltaDays: number;
  };
  /**
   * Phase 3.8 — finish-date convention normalization (reporting only).
   *
   * Raw engine2 / legacy values above are NEVER overwritten. These fields
   * surface a convention-adjusted view so engineering can tell a true CPM
   * divergence apart from the known finish-rendering convention difference
   * (see ARCHITECTURE.md §38/§39). Engine2 internal date math is unchanged.
   */
  normalizedProjectFinish: {
    /** Engine2 finish ISO normalized to the legacy exclusive-boundary convention. */
    engine2Normalized: string | null;
    /** |legacy - engine2Normalized| in whole calendar days. */
    deltaDays: number;
    /** True when normalized engine2 finish equals legacy finish. */
    match: boolean;
  };
  /** Max |legacy - engine2Normalized| date delta across ES/EF/LS/LF, post-normalization. */
  maxNormalizedDateDeltaDays: number;
  /** Counts of activities matching after convention normalization. */
  conventionAdjustedMatchingCount: number;
  /** Counts of activities still differing after convention normalization. */
  conventionAdjustedDifferingCount: number;
  /** Activity / relationship IDs grouped by which dimension diverged. */
  mismatchIds: DryRunMismatchIds;
  /**
   * Phase 3.8 — activity IDs whose ONLY divergence is the finish-date
   * rendering convention (legacy exclusive-boundary vs engine2 inclusive
   * last-work-moment). These IDs are also present in `mismatchIds` —
   * they are NOT subtracted from the raw view.
   */
  conventionMismatchIds: {
    earlyFinish: string[];
    lateFinish: string[];
  };
  /**
   * Phase 3.8 — activity IDs whose divergence survives normalization.
   * A true date mismatch indicates the two engines disagree on the
   * underlying schedule, not just how a finish moment is rendered.
   */
  trueDateMismatchIds: {
    earlyStart: string[];
    earlyFinish: string[];
    lateStart: string[];
    lateFinish: string[];
  };
  /** Engine2 diagnostics surfaced during the run. */
  engine2DiagnosticsCount: number;
  /** Non-fatal engine2 error (engine2 threw — legacy still returned). */
  engine2Error?: string;
  /** Eligibility blockers (engine2 not run when non-empty). */
  eligibilityBlockers: string[];
  /** Eligibility warnings (engine2 still ran). */
  eligibilityWarnings: string[];
}

export interface DryRunComparisonResult {
  /** ALWAYS the legacy `ScheduleResult`. Engine2 never leaks here. */
  result: ScheduleResult;
  /** Engine selection provenance (mode, gates, versions). */
  provenance: EngineSelectionProvenance;
  /** Full structured comparison report (when engine2 ran). */
  comparison?: ComparisonReport;
  /** Compact summary suitable for logging / diagnostics. */
  dryRun: DryRunSummary;
}

export interface DryRunOptions extends SchedulerOptions {
  /**
   * Force-log the summary even outside dev. Defaults to `import.meta.env.DEV`.
   * Production callers pass `log: false` (or simply do not enable this path).
   */
  log?: boolean;
  /** Sink for the dev log line. Defaults to `console.info`. */
  logSink?: (line: string) => void;
  /** Bypass the boring-bar readiness gate (tests only). */
  forcePastReadinessGate?: boolean;
  /** Force exception-aware bridge routing on/off. */
  forceExceptionAwareCalendars?: boolean;
}

/**
 * Run legacy authoritatively, and — if eligibility allows — engine2 as a
 * non-authoritative dry-run. Returns a summary of how the two engines
 * compared without ever returning engine2 output as the schedule result.
 */
export function runScheduleDryRunComparison(
  schedule: Schedule,
  options: DryRunOptions = {},
): DryRunComparisonResult {
  const selected: SelectedScheduleResult = runScheduleWithSelectedEngine(
    schedule,
    {
      criticalFloatTolerance: options.criticalFloatTolerance,
      mode: "comparison",
      forcePastReadinessGate: options.forcePastReadinessGate,
      forceExceptionAwareCalendars: options.forceExceptionAwareCalendars,
    },
  );

  const eligibilityBlockers = selected.provenance.eligibilityBlockers;
  const eligibilityWarnings = selected.provenance.eligibilityWarnings;

  // If the schedule is ineligible OR engine2 errored before producing a
  // report, return a skipped summary. Legacy is still authoritative.
  if (!selected.provenance.scheduleEligible || !selected.comparison) {
    const skippedReason =
      !selected.provenance.scheduleEligible
        ? `schedule ineligible: ${eligibilityBlockers.join("; ") || "unknown"}`
        : selected.engine2Error
          ? `engine2 error: ${selected.engine2Error}`
          : "engine2 did not produce a comparison report";

    const summary: DryRunSummary = {
      engine2Ran: false,
      skippedReason,
      matchingCount: 0,
      differingCount: 0,
      maxDateDeltaDays: 0,
      maxFloatDeltaDays: 0,
      projectFinish: {
        legacy: selected.result.projectFinishDate ?? null,
        engine2: null,
        deltaDays: 0,
      },
      normalizedProjectFinish: {
        engine2Normalized: null,
        deltaDays: 0,
        match: true,
      },
      maxNormalizedDateDeltaDays: 0,
      conventionAdjustedMatchingCount: 0,
      conventionAdjustedDifferingCount: 0,
      mismatchIds: emptyMismatchIds(),
      conventionMismatchIds: { earlyFinish: [], lateFinish: [] },
      trueDateMismatchIds: {
        earlyStart: [],
        earlyFinish: [],
        lateStart: [],
        lateFinish: [],
      },
      engine2DiagnosticsCount: selected.provenance.diagnosticsCount,
      engine2Error: selected.engine2Error,
      eligibilityBlockers,
      eligibilityWarnings,
    };
    maybeLog(options, selected.provenance, summary);
    return {
      result: selected.result,
      provenance: selected.provenance,
      comparison: selected.comparison,
      dryRun: summary,
    };
  }

  const report = selected.comparison;
  const summary = buildSummary(selected.result, report, {
    schedule,
    eligibilityBlockers,
    eligibilityWarnings,
    engine2Error: selected.engine2Error,
  });
  maybeLog(options, selected.provenance, summary);
  return {
    result: selected.result,
    provenance: selected.provenance,
    comparison: report,
    dryRun: summary,
  };
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function emptyMismatchIds(): DryRunMismatchIds {
  return {
    earlyDates: [],
    lateDates: [],
    totalFloat: [],
    freeFloat: [],
    criticalFlag: [],
    drivingLink: [],
    missingInEngine2: [],
    missingInLegacy: [],
  };
}

function dateDeltaDays(a?: string | number | boolean | null, b?: string | number | boolean | null): number {
  if (typeof a !== "string" || typeof b !== "string") return 0;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.abs(Math.round((ta - tb) / MS_PER_DAY));
}

function numDeltaDays(a?: string | number | boolean | null, b?: string | number | boolean | null): number {
  if (typeof a !== "number" || typeof b !== "number") return 0;
  return Math.abs(a - b);
}

function deriveEngine2ProjectFinishIso(report: ComparisonReport): string | null {
  // Engine2 project finish is the max ISO-date across early-finish entries
  // recorded in the differences (legacy + engine2 both present). When no
  // engine2 dates appear in differences (perfectly matched), fall back to
  // the legacy date — it's the same value by definition.
  let max: string | null = null;
  for (const d of report.differences) {
    if (d.category !== "early_finish_date") continue;
    if (typeof d.engine2 !== "string") continue;
    if (max === null || d.engine2 > max) max = d.engine2;
  }
  return max;
}

function buildSummary(
  legacy: ScheduleResult,
  report: ComparisonReport,
  ctx: {
    eligibilityBlockers: string[];
    eligibilityWarnings: string[];
    engine2Error?: string;
  },
): DryRunSummary {
  const mismatchIds = emptyMismatchIds();
  const earlyDateIds = new Set<string>();
  const lateDateIds = new Set<string>();
  const tfIds = new Set<string>();
  const ffIds = new Set<string>();
  const critIds = new Set<string>();
  const drivIds = new Set<string>();
  const missingE2 = new Set<string>();
  const missingLg = new Set<string>();

  let maxDateDelta = 0;
  let maxFloatDelta = 0;

  for (const d of report.differences as ComparisonDifference[]) {
    switch (d.category) {
      case "early_start_date":
      case "early_finish_date": {
        earlyDateIds.add(d.id);
        maxDateDelta = Math.max(maxDateDelta, dateDeltaDays(d.legacy, d.engine2));
        break;
      }
      case "late_start_date":
      case "late_finish_date": {
        lateDateIds.add(d.id);
        maxDateDelta = Math.max(maxDateDelta, dateDeltaDays(d.legacy, d.engine2));
        break;
      }
      case "total_float":
      case "known_limitation": {
        // total/free float gets bucketed under known_limitation when
        // `treatFloatAsLimitation` is set — check both legacy/engine2 numbers.
        if (typeof d.legacy === "number" && typeof d.engine2 === "number") {
          tfIds.add(d.id);
          maxFloatDelta = Math.max(maxFloatDelta, numDeltaDays(d.legacy, d.engine2));
        }
        break;
      }
      case "free_float": {
        ffIds.add(d.id);
        maxFloatDelta = Math.max(maxFloatDelta, numDeltaDays(d.legacy, d.engine2));
        break;
      }
      case "critical_flag":
        critIds.add(d.id);
        break;
      case "driving_link":
        drivIds.add(d.id);
        break;
      case "missing_in_engine2":
        missingE2.add(d.id);
        break;
      case "missing_in_legacy":
        missingLg.add(d.id);
        break;
      default:
        break;
    }
  }

  mismatchIds.earlyDates = [...earlyDateIds].sort();
  mismatchIds.lateDates = [...lateDateIds].sort();
  mismatchIds.totalFloat = [...tfIds].sort();
  mismatchIds.freeFloat = [...ffIds].sort();
  mismatchIds.criticalFlag = [...critIds].sort();
  mismatchIds.drivingLink = [...drivIds].sort();
  mismatchIds.missingInEngine2 = [...missingE2].sort();
  mismatchIds.missingInLegacy = [...missingLg].sort();

  const activitiesWithAnyDateDiff = new Set<string>([
    ...earlyDateIds,
    ...lateDateIds,
  ]);
  const matchingCount = Math.max(
    0,
    report.activityCount.legacy - activitiesWithAnyDateDiff.size,
  );

  const legacyFinish = legacy.projectFinishDate ?? null;
  let engine2Finish = deriveEngine2ProjectFinishIso(report);
  if (engine2Finish === null) engine2Finish = legacyFinish;
  const finishDelta = dateDeltaDays(legacyFinish, engine2Finish);

  return {
    engine2Ran: true,
    verdict: report.verdict,
    matchingCount,
    differingCount: activitiesWithAnyDateDiff.size,
    maxDateDeltaDays: maxDateDelta,
    maxFloatDeltaDays: maxFloatDelta,
    projectFinish: {
      legacy: legacyFinish,
      engine2: engine2Finish,
      deltaDays: finishDelta,
    },
    mismatchIds,
    engine2DiagnosticsCount: report.engine2DiagnosticsCount,
    engine2Error: ctx.engine2Error,
    eligibilityBlockers: ctx.eligibilityBlockers,
    eligibilityWarnings: ctx.eligibilityWarnings,
  };
}

// re-exported so legacy-bridge isn't required at call sites that already
// touch this module.
export { instantToIsoDate };

function maybeLog(
  options: DryRunOptions,
  provenance: EngineSelectionProvenance,
  summary: DryRunSummary,
): void {
  let enabled = options.log;
  if (enabled === undefined) {
    try {
      enabled = Boolean(
        (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV,
      );
    } catch {
      enabled = false;
    }
  }
  if (!enabled) return;
  const sink =
    options.logSink ??
    ((line: string) => {
      // eslint-disable-next-line no-console
      console.info(line);
    });
  sink(formatDryRunSummary(provenance, summary));
}

/** Concise one-block summary for dev console / engineering diagnosis. */
export function formatDryRunSummary(
  provenance: EngineSelectionProvenance,
  summary: DryRunSummary,
): string {
  if (!summary.engine2Ran) {
    return [
      `[engine2 dry-run] skipped — ${summary.skippedReason ?? "unknown"}`,
      `  legacyAuthoritative=${provenance.legacyAuthoritative} gate=${provenance.gateDecision}`,
    ].join("\n");
  }
  return [
    `[engine2 dry-run] verdict=${summary.verdict} matching=${summary.matchingCount} differing=${summary.differingCount}`,
    `  maxDateΔ=${summary.maxDateDeltaDays}d maxFloatΔ=${summary.maxFloatDeltaDays}d projectFinishΔ=${summary.projectFinish.deltaDays}d`,
    `  legacyFinish=${summary.projectFinish.legacy ?? "—"} engine2Finish=${summary.projectFinish.engine2 ?? "—"}`,
    `  engine2Diagnostics=${summary.engine2DiagnosticsCount}${summary.engine2Error ? ` engine2Error="${summary.engine2Error}"` : ""}`,
    `  eligibilityBlockers=[${summary.eligibilityBlockers.join(", ")}] warnings=[${summary.eligibilityWarnings.join(", ")}]`,
    `  legacyAuthoritative=${provenance.legacyAuthoritative} gate=${provenance.gateDecision}`,
  ].join("\n");
}
