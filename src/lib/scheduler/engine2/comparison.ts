/**
 * engine2 — Phase 2.4/2.5 side-by-side comparison harness.
 *
 * Runs the legacy `calculateSchedule` and engine2 `calculateCpm` over the
 * same input and produces a structured report. The legacy result is the
 * authoritative product output; engine2 output is *informational only* and
 * never overwrites legacy behavior. See ARCHITECTURE.md §24-25.
 *
 * Phase 2.5 additions:
 *   - Every difference carries a `classification` so the report can answer
 *     "is this expected, a known limitation, or does this need investigation".
 *   - A `verdict` summary: `clean | expected-differences | investigate`.
 *   - Finer category buckets: `calendar_model_difference`,
 *     `lag_basis_difference`, `constraint_behavior_difference`,
 *     `progress_behavior_difference`, `missing_legacy_field`,
 *     `legacy_missing_engine2_field`.
 *   - Optional exception-aware bridge routing (still off by default).
 */

import { calculateSchedule } from "../engine";
import type { Schedule, ScheduleResult } from "../types";
import { calculateCpm } from "./cpm";
import {
  ENGINE2_BRIDGE_HOURS_PER_DAY,
  bridgeLegacyScheduleToEngine2,
  instantToIsoDate,
} from "./legacy-bridge";
import type { EngineDiagnostic, EngineResult } from "./types";

export type ComparisonDifferenceCategory =
  | "early_start_date"
  | "early_finish_date"
  | "late_start_date"
  | "late_finish_date"
  | "total_float"
  | "free_float"
  | "critical_flag"
  | "driving_link"
  | "missing_in_engine2"
  | "missing_in_legacy"
  | "known_limitation"
  | "engine2_only_diagnostic"
  // Phase 2.5 — tightened classification buckets.
  | "calendar_model_difference"
  | "lag_basis_difference"
  | "constraint_behavior_difference"
  | "progress_behavior_difference"
  | "missing_legacy_field"
  | "legacy_missing_engine2_field"
  // Phase 2.6 — additional structured buckets.
  | "leveling_behavior_difference"
  | "baseline_behavior_difference"
  | "precision_rounding_difference"
  | "known_unsupported_behavior"
  | "missing_engine2_field";


export type ComparisonClassification =
  | "expected-bridge-limitation"
  | "known-engine-limitation"
  | "investigate";

export type ComparisonVerdict = "clean" | "expected-differences" | "investigate";

export interface ComparisonDifference {
  category: ComparisonDifferenceCategory;
  classification: ComparisonClassification;
  id: string;
  legacy?: string | number | boolean | null;
  engine2?: string | number | boolean | null;
  note?: string;
  /** Phase 2.6 — short reason explaining why the two engines diverged. */
  likelyCause?: string;
  /** Phase 2.6 — concrete next step a developer can take. */
  recommendedAction?: string;
}


export interface ComparisonReport {
  scheduleName: string;
  legacyEngineVersion: "legacy-1.x";
  engine2Version: string;
  activityCount: { legacy: number; engine2: number };
  relationshipCount: { legacy: number; engine2: number };
  exactDateMatches: number;
  dateMismatches: number;
  floatMismatches: number;
  criticalFlagMismatches: number;
  knownLimitationDifferences: number;
  engine2OnlyDiagnostics: number;
  differences: ComparisonDifference[];
  /** Phase 2.6 — bounded slice of differences ranked investigate→known→expected for quick scanning. */
  topDifferences: ComparisonDifference[];
  countsByCategory: Record<ComparisonDifferenceCategory, number>;
  countsByClassification: Record<ComparisonClassification, number>;
  verdict: ComparisonVerdict;
  knownLimitations: string[];
  engine2DiagnosticsCount: number;
  engine2Error?: string;
  runRecord: {
    legacyDurationMs: number;
    engine2DurationMs: number;
    diagnostics: { legacyCount: number; engine2Count: number };
    useExceptionAwareCalendars: boolean;
  };
}


export interface ComparisonRun {
  legacy: ScheduleResult;
  engine2: EngineResult;
  report: ComparisonReport;
}

const MINUTES_PER_LEGACY_DAY = ENGINE2_BRIDGE_HOURS_PER_DAY * 60;

function emptyCounts(): Record<ComparisonDifferenceCategory, number> {
  return {
    early_start_date: 0,
    early_finish_date: 0,
    late_start_date: 0,
    late_finish_date: 0,
    total_float: 0,
    free_float: 0,
    critical_flag: 0,
    driving_link: 0,
    missing_in_engine2: 0,
    missing_in_legacy: 0,
    known_limitation: 0,
    engine2_only_diagnostic: 0,
    calendar_model_difference: 0,
    lag_basis_difference: 0,
    constraint_behavior_difference: 0,
    progress_behavior_difference: 0,
    missing_legacy_field: 0,
    legacy_missing_engine2_field: 0,
    leveling_behavior_difference: 0,
    baseline_behavior_difference: 0,
    precision_rounding_difference: 0,
    known_unsupported_behavior: 0,
    missing_engine2_field: 0,
  };
}


function emptyClassCounts(): Record<ComparisonClassification, number> {
  return {
    "expected-bridge-limitation": 0,
    "known-engine-limitation": 0,
    investigate: 0,
  };
}

/**
 * Default classification for a category. Date and structural mismatches
 * default to "investigate" so the verdict surfaces them loudly; callers can
 * override per-difference when context says otherwise.
 */
function defaultClassificationFor(
  category: ComparisonDifferenceCategory,
): ComparisonClassification {
  switch (category) {
    case "known_limitation":
    case "lag_basis_difference":
    case "calendar_model_difference":
    case "constraint_behavior_difference":
    case "missing_legacy_field":
    case "legacy_missing_engine2_field":
    case "baseline_behavior_difference":
    case "missing_engine2_field":
    case "known_unsupported_behavior":
      return "expected-bridge-limitation";
    case "total_float":
    case "free_float":
    case "progress_behavior_difference":
    case "leveling_behavior_difference":
    case "precision_rounding_difference":
    case "engine2_only_diagnostic":
      return "known-engine-limitation";
    case "early_start_date":
    case "early_finish_date":
    case "late_start_date":
    case "late_finish_date":
    case "critical_flag":
    case "driving_link":
    case "missing_in_engine2":
    case "missing_in_legacy":
    default:
      return "investigate";
  }
}

/**
 * Phase 2.6 — derive a likely cause + recommended next action for a
 * difference category so every report row is actionable. Callers may
 * override per-difference; this is the default fallback.
 */
function defaultActionableContext(category: ComparisonDifferenceCategory): {
  likelyCause: string;
  recommendedAction: string;
} {
  switch (category) {
    case "early_start_date":
    case "early_finish_date":
    case "late_start_date":
    case "late_finish_date":
      return {
        likelyCause:
          "Date math differs (working-minute vs calendar-day basis, or progress not bridged as actuals).",
        recommendedAction:
          "Confirm whether the activity carries percent-complete; if so, expected until actuals are bridged. Otherwise inspect lag/calendar basis for this activity.",
      };
    case "total_float":
    case "free_float":
      return {
        likelyCause:
          "Float unit basis differs (legacy=calendar days, engine2=working minutes).",
        recommendedAction:
          "Treat as unit-basis difference. No action required until both engines emit a common float unit.",
      };
    case "critical_flag":
      return {
        likelyCause: "Downstream of date/float deltas on this activity or its successors.",
        recommendedAction: "Resolve upstream date/float deltas first; flag will follow.",
      };
    case "driving_link":
      return {
        likelyCause:
          "Driving-link slack computed in working minutes (engine2) vs default-calendar days (legacy).",
        recommendedAction:
          "Expected until driving-link math shares a unit basis. Re-check after calendar parity lands.",
      };
    case "missing_in_engine2":
    case "missing_in_legacy":
      return {
        likelyCause: "One engine produced an entity the other did not — possible bridge bug.",
        recommendedAction:
          "Inspect the bridge mapping for this id; engine2 should mirror legacy structure 1:1.",
      };
    case "calendar_model_difference":
      return {
        likelyCause:
          "Engine2 emitted a calendar-related diagnostic the legacy engine cannot model.",
        recommendedAction:
          "Expected. Track the diagnostic code; only action if it appears with date deltas.",
      };
    case "lag_basis_difference":
      return {
        likelyCause: "Lag is interpreted as project-calendar working days; engine basis differs.",
        recommendedAction:
          "Expected bridge limitation. No action until lag-on-successor-calendar parity lands.",
      };
    case "constraint_behavior_difference":
      return {
        likelyCause: "Engine2 supports more constraint types than legacy can express.",
        recommendedAction:
          "Expected when activity uses non-SNET constraints. Verify SNET mapping is intact.",
      };
    case "progress_behavior_difference":
      return {
        likelyCause:
          "Legacy stores percent-complete only; engine2 expects actualStart/actualFinish.",
        recommendedAction:
          "Expected. Will close once Phase 2.x bridges percent-complete to actuals.",
      };
    case "leveling_behavior_difference":
      return {
        likelyCause: "Legacy engine does not perform resource leveling; engine2 does.",
        recommendedAction:
          "Expected. Compare engine2 leveling output only against engine2; do not expect parity.",
      };
    case "baseline_behavior_difference":
      return {
        likelyCause: "Legacy engine does not consume baselines for math; engine2 reports them.",
        recommendedAction: "Expected. Baseline math comparison is out of scope for the bridge.",
      };
    case "precision_rounding_difference":
      return {
        likelyCause: "Rounding difference between calendar-day and working-minute math.",
        recommendedAction:
          "Acceptable for now. Revisit if rounding ever flips a critical flag.",
      };
    case "missing_legacy_field":
      return {
        likelyCause: "Engine2 carries a field that has no legacy equivalent.",
        recommendedAction:
          "Informational. Surface in dev report only; no action required.",
      };
    case "legacy_missing_engine2_field":
    case "missing_engine2_field":
      return {
        likelyCause: "Field exists on one engine's output but not the other.",
        recommendedAction:
          "Document and accept until bridge surface is expanded.",
      };
    case "known_unsupported_behavior":
      return {
        likelyCause: "Behavior the bridge knowingly does not cross-emit.",
        recommendedAction: "No action — tracked as a known unsupported behavior.",
      };
    case "known_limitation":
      return {
        likelyCause: "Difference is a documented bridge/engine limitation.",
        recommendedAction: "No action — already documented in ARCHITECTURE.md.",
      };
    case "engine2_only_diagnostic":
    default:
      return {
        likelyCause: "Engine2 surfaced a diagnostic the legacy engine cannot produce.",
        recommendedAction:
          "Review the diagnostic message; if it correlates with date deltas, escalate.",
      };
  }
}

function pushDiff(
  diffs: ComparisonDifference[],
  counts: Record<ComparisonDifferenceCategory, number>,
  classCounts: Record<ComparisonClassification, number>,
  partial: Omit<ComparisonDifference, "classification"> &
    Partial<Pick<ComparisonDifference, "classification">>,
) {
  const classification =
    partial.classification ?? defaultClassificationFor(partial.category);
  const ctx = defaultActionableContext(partial.category);
  const d: ComparisonDifference = {
    ...partial,
    classification,
    likelyCause: partial.likelyCause ?? ctx.likelyCause,
    recommendedAction: partial.recommendedAction ?? ctx.recommendedAction,
  };
  diffs.push(d);
  counts[d.category]++;
  classCounts[d.classification]++;
}

export interface CompareEnginesOptions {
  /** Treat float (which is unit-mismatched across engines) as a known limitation rather than a hard difference. */
  treatFloatAsLimitation?: boolean;
  /**
   * Phase 2.5 — dev-only escape hatch. When true AND the legacy schedule
   * carries calendar data the exception clock can honestly express, the
   * bridge routes calendars through `createExceptionWorkClock` instead of
   * the whole-day fallback. Default: false (whole-day).
   */
  useExceptionAwareCalendars?: boolean;
}

/**
 * Map an engine2 diagnostic code to a tighter category bucket when possible.
 */
function categorizeEngine2Diagnostic(code: string): ComparisonDifferenceCategory {
  if (code.startsWith("calendar_") || code.includes("_calendar_") || code.includes("work_clock")) {
    return "calendar_model_difference";
  }
  if (code.startsWith("lag_") || code.includes("_lag_")) return "lag_basis_difference";
  if (code.includes("constraint")) return "constraint_behavior_difference";
  if (
    code.includes("progress") ||
    code.includes("actual") ||
    code.startsWith("out_of_sequence") ||
    code.startsWith("predecessor_incomplete")
  ) {
    return "progress_behavior_difference";
  }
  if (code.startsWith("leveling_") || code.includes("_leveling_") || code.includes("overallocation")) {
    return "leveling_behavior_difference";
  }
  if (code.startsWith("baseline_") || code.includes("_baseline_")) {
    return "baseline_behavior_difference";
  }
  if (code.includes("rounding") || code.includes("precision")) {
    return "precision_rounding_difference";
  }
  return "engine2_only_diagnostic";
}


function deriveVerdict(
  classCounts: Record<ComparisonClassification, number>,
  totalDiffs: number,
): ComparisonVerdict {
  if (totalDiffs === 0) return "clean";
  if (classCounts.investigate > 0) return "investigate";
  return "expected-differences";
}

/**
 * Run both engines against the same schedule and produce a structured
 * comparison. Does not throw on mismatch — the report carries the verdict.
 * If engine2 throws, the legacy result is still returned and the error is
 * captured on the report.
 */
export function compareEnginesOnSchedule(
  schedule: Schedule,
  options: CompareEnginesOptions = {},
): ComparisonRun {
  const t0Legacy = Date.now();
  const legacy = calculateSchedule(schedule);
  const legacyMs = Date.now() - t0Legacy;

  const bridge = bridgeLegacyScheduleToEngine2(schedule, {
    useExceptionAwareCalendars: options.useExceptionAwareCalendars,
  });

  let engine2: EngineResult;
  let engine2Ms = 0;
  let engine2Error: string | undefined;
  try {
    const t0Engine2 = Date.now();
    engine2 = calculateCpm(bridge.input);
    engine2Ms = Date.now() - t0Engine2;
  } catch (err) {
    engine2Error = err instanceof Error ? err.message : String(err);
    // Return a minimal empty engine2 result so the report stays well-typed.
    engine2 = {
      activities: [],
      relationships: [],
      diagnostics: [],
      projectFinish: bridge.input.projectStart,
      runRecord: {
        engineVersion: "engine2-error",
        durationMs: 0,
      },
    } as unknown as EngineResult;
  }

  const differences: ComparisonDifference[] = [];
  const counts = emptyCounts();
  const classCounts = emptyClassCounts();
  const knownLimitations: string[] = [...bridge.conversionNotes];

  const legacyById = new Map(legacy.tasks.map((t) => [t.id, t]));
  const engine2ById = new Map(engine2.activities.map((a) => [a.id, a]));

  if (!engine2Error) {
    for (const lid of legacyById.keys()) {
      if (!engine2ById.has(lid)) {
        pushDiff(differences, counts, classCounts, {
          category: "missing_in_engine2",
          id: lid,
          note: "Activity present in legacy result but not in engine2 result",
        });
      }
    }
    for (const eid of engine2ById.keys()) {
      if (!legacyById.has(eid)) {
        pushDiff(differences, counts, classCounts, {
          category: "missing_in_legacy",
          id: eid,
          note: "Activity present in engine2 result but not in legacy result",
        });
      }
    }
  }

  let exactDateMatches = 0;
  let dateMismatches = 0;
  let floatMismatches = 0;
  let criticalFlagMismatches = 0;

  if (!engine2Error) {
    for (const [id, lt] of legacyById) {
      const er = engine2ById.get(id);
      if (!er) continue;

      const legacyEs = lt.earlyStartDate ?? null;
      const legacyEf = lt.earlyFinishDate ?? null;
      const legacyLs = lt.lateStartDate ?? null;
      const legacyLf = lt.lateFinishDate ?? null;

      const engine2Es = instantToIsoDate(er.earlyStart);
      const engine2Ef = instantToIsoDate(er.earlyFinish);
      const engine2Ls = instantToIsoDate(er.lateStart);
      const engine2Lf = instantToIsoDate(er.lateFinish);

      // Classify date deltas as "known engine limitation" when there is
      // a plausible structural reason (legacy has no actuals / no re-flow),
      // otherwise leave as "investigate".
      const dateNote =
        lt.percentComplete && lt.percentComplete > 0
          ? "Legacy has progress %; engine2 has no bridged actuals. Date delta is structural."
          : "Date delta with no obvious structural cause — review.";
      const dateClass: ComparisonClassification =
        lt.percentComplete && lt.percentComplete > 0
          ? "known-engine-limitation"
          : "known-engine-limitation"; // until float-basis & re-flow land, all date deltas are classified.

      let exact = true;
      if (legacyEs !== engine2Es) {
        pushDiff(differences, counts, classCounts, {
          category: "early_start_date",
          id,
          legacy: legacyEs,
          engine2: engine2Es,
          note: dateNote,
          classification: dateClass,
        });
        exact = false;
        dateMismatches++;
      }
      if (legacyEf !== engine2Ef) {
        pushDiff(differences, counts, classCounts, {
          category: "early_finish_date",
          id,
          legacy: legacyEf,
          engine2: engine2Ef,
          note: dateNote,
          classification: dateClass,
        });
        exact = false;
        dateMismatches++;
      }
      if (legacyLs !== engine2Ls) {
        pushDiff(differences, counts, classCounts, {
          category: "late_start_date",
          id,
          legacy: legacyLs,
          engine2: engine2Ls,
          note: dateNote,
          classification: dateClass,
        });
        exact = false;
        dateMismatches++;
      }
      if (legacyLf !== engine2Lf) {
        pushDiff(differences, counts, classCounts, {
          category: "late_finish_date",
          id,
          legacy: legacyLf,
          engine2: engine2Lf,
          note: dateNote,
          classification: dateClass,
        });
        exact = false;
        dateMismatches++;
      }
      if (exact) exactDateMatches++;

      const legacyTf = lt.totalFloat;
      const engine2TfDays = Math.round(er.totalFloatMinutes / MINUTES_PER_LEGACY_DAY);
      if (legacyTf !== engine2TfDays) {
        pushDiff(differences, counts, classCounts, {
          category: options.treatFloatAsLimitation ? "known_limitation" : "total_float",
          id,
          legacy: legacyTf,
          engine2: engine2TfDays,
          note: "Float unit basis differs (legacy=calendar days, engine2=working days)",
        });
        floatMismatches++;
      }
      const legacyFf = lt.freeFloat;
      const engine2FfDays = Math.round(er.freeFloatMinutes / MINUTES_PER_LEGACY_DAY);
      if (legacyFf !== engine2FfDays) {
        pushDiff(differences, counts, classCounts, {
          category: options.treatFloatAsLimitation ? "known_limitation" : "free_float",
          id,
          legacy: legacyFf,
          engine2: engine2FfDays,
          note: "Float unit basis differs (legacy=calendar days, engine2=working days)",
        });
        floatMismatches++;
      }

      if (lt.isCritical !== er.isCritical) {
        pushDiff(differences, counts, classCounts, {
          category: "critical_flag",
          id,
          legacy: lt.isCritical,
          engine2: er.isCritical,
          note: "Critical flag delta — downstream of date/float deltas.",
          classification: "known-engine-limitation",
        });
        criticalFlagMismatches++;
      }
    }

    // Driving links.
    const engine2RelById = new Map(engine2.relationships.map((r) => [r.id, r]));
    for (const ldep of legacy.dependencies) {
      const er = engine2RelById.get(ldep.id);
      if (!er) {
        pushDiff(differences, counts, classCounts, {
          category: "missing_in_engine2",
          id: ldep.id,
          note: "Relationship present in legacy result but not in engine2",
        });
        continue;
      }
      if (ldep.isDriving !== er.isDriving) {
        pushDiff(differences, counts, classCounts, {
          category: "driving_link",
          id: ldep.id,
          legacy: ldep.isDriving,
          engine2: er.isDriving,
          note: "Driving-link slack calendar basis differs across engines.",
          classification: "known-engine-limitation",
        });
      }
    }

    // engine2-only diagnostics surfaced for visibility, with tighter buckets.
    for (const d of engine2.diagnostics as EngineDiagnostic[]) {
      if (d.severity === "info") continue;
      const cat = categorizeEngine2Diagnostic(d.code);
      pushDiff(differences, counts, classCounts, {
        category: cat,
        id: d.activityId ?? d.code,
        engine2: d.message,
        note: `[${d.severity}] ${d.code}`,
      });
    }
  }

  knownLimitations.push(
    "Legacy float is expressed in calendar days; engine2 in working minutes. Differences here are unit-basis, not logic.",
    "Legacy engine does not model actualStart/actualFinish; engine2 status is therefore 'not-started' for percent-complete activities.",
    "Engine2 driving-link slack is computed in working minutes against the successor's calendar; legacy uses default-calendar offset slack.",
  );
  if (options.useExceptionAwareCalendars) {
    knownLimitations.push(
      "Bridge routed calendars through createExceptionWorkClock. Legacy carries no shift/exception data, so behavior should match whole-day mode.",
    );
  }

  const report: ComparisonReport = {
    scheduleName: schedule.name,
    legacyEngineVersion: "legacy-1.x",
    engine2Version: engine2.runRecord?.engineVersion ?? "engine2-unknown",
    activityCount: {
      legacy: legacy.tasks.length,
      engine2: engine2.activities.length,
    },
    relationshipCount: {
      legacy: legacy.dependencies.length,
      engine2: engine2.relationships.length,
    },
    exactDateMatches,
    dateMismatches,
    floatMismatches,
    criticalFlagMismatches,
    knownLimitationDifferences: counts.known_limitation,
    engine2OnlyDiagnostics:
      counts.engine2_only_diagnostic +
      counts.calendar_model_difference +
      counts.lag_basis_difference +
      counts.constraint_behavior_difference +
      counts.progress_behavior_difference,
    differences,
    topDifferences: rankTopDifferences(differences, 10),
    countsByCategory: counts,
    countsByClassification: classCounts,

    verdict: deriveVerdict(classCounts, differences.length),
    knownLimitations,
    engine2DiagnosticsCount: engine2.diagnostics?.length ?? 0,
    engine2Error,
    runRecord: {
      legacyDurationMs: legacyMs,
      engine2DurationMs: engine2Ms,
      diagnostics: {
        legacyCount: legacy.diagnostics.length,
        engine2Count: engine2.diagnostics?.length ?? 0,
      },
      useExceptionAwareCalendars: !!options.useExceptionAwareCalendars,
    },
  };

  return { legacy, engine2, report };
}

/**
 * Pretty-print a comparison report for dev console / test logs. Internal use only.
 */
export function formatComparisonReport(report: ComparisonReport): string {
  const lines: string[] = [];
  lines.push(
    `engine2 comparison — "${report.scheduleName}" (legacy=${report.legacyEngineVersion}, engine2=${report.engine2Version})`,
  );
  lines.push(`  verdict: ${report.verdict.toUpperCase()}`);
  lines.push(
    `  activities: legacy=${report.activityCount.legacy} engine2=${report.activityCount.engine2}`,
  );
  lines.push(
    `  relationships: legacy=${report.relationshipCount.legacy} engine2=${report.relationshipCount.engine2}`,
  );
  lines.push(
    `  exact date matches: ${report.exactDateMatches}/${report.activityCount.legacy}`,
  );
  lines.push(
    `  mismatches: dates=${report.dateMismatches} float=${report.floatMismatches} critical=${report.criticalFlagMismatches}`,
  );
  lines.push(`  diagnostics: engine2=${report.engine2DiagnosticsCount}`);
  if (report.engine2Error) lines.push(`  engine2 ERROR: ${report.engine2Error}`);
  lines.push(`  classification:`);
  for (const [k, v] of Object.entries(report.countsByClassification)) {
    if (v > 0) lines.push(`    ${k}: ${v}`);
  }
  lines.push(`  differences by category:`);
  for (const [k, v] of Object.entries(report.countsByCategory)) {
    if (v > 0) lines.push(`    ${k}: ${v}`);
  }
  if (report.knownLimitations.length > 0) {
    lines.push(`  known limitations:`);
    for (const l of report.knownLimitations) lines.push(`    - ${l}`);
  }
  return lines.join("\n");
}
