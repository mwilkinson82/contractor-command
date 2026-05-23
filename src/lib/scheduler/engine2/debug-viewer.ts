/**
 * Phase 2.7 — internal-only Engine2 comparison debug viewer.
 *
 * This module is the pure-logic backbone of the debug drawer:
 *   - `shouldShowEngine2DebugViewer` decides whether the viewer mounts.
 *     The React drawer calls this and renders nothing when it returns
 *     false. Default-off in production.
 *   - `buildComparisonViewModel` projects a `ComparisonReport` into a
 *     deterministic, render-ready shape. The drawer never reads the raw
 *     report — it consumes this view-model, which means all formatting
 *     decisions live here and are unit-testable without a DOM.
 *
 * Guardrails:
 *   - Never mutates the schedule or the report.
 *   - Never alters legacy results (it only reads).
 *   - Never throws; engine2 errors are surfaced as a viewer field.
 *   - Never authoritative: this is observability, not behavior.
 *
 * See ARCHITECTURE.md §27.
 */

import type {
  ComparisonClassification,
  ComparisonDifference,
  ComparisonDifferenceCategory,
  ComparisonReport,
  ComparisonVerdict,
} from "./comparison";
import { formatComparisonReport } from "./comparison";
import {
  isEngine2ComparisonEnabled,
  isEngine2ExceptionClockEnabled,
} from "./feature-flag";

/** Inputs to the viewer visibility check. */
export interface DebugViewerVisibilityInput {
  /** True when the engine2 comparison flag (env or forced) is on. */
  comparisonEnabled: boolean;
  /** True when running in a dev/internal build. Falsy in production. */
  devMode: boolean;
  /** Optional override (e.g. URL param) — when explicitly false, hides. */
  explicitlyDisabled?: boolean;
}

/**
 * The viewer mounts only when BOTH the comparison flag AND dev mode are
 * on, and no explicit disable override is present. This is the single
 * source of truth for "is the drawer allowed to render?".
 */
export function shouldShowEngine2DebugViewer(
  input: DebugViewerVisibilityInput,
): boolean {
  if (input.explicitlyDisabled === true) return false;
  return Boolean(input.comparisonEnabled && input.devMode);
}

/**
 * Resolve visibility from the live environment. Used by the React
 * drawer at mount time so callers do not have to wire flags manually.
 * In a production build with all flags off, this returns false and the
 * drawer renders nothing.
 */
export function resolveDebugViewerVisibility(opts?: {
  forceComparison?: boolean;
  forceDevMode?: boolean;
}): boolean {
  const comparisonEnabled =
    opts?.forceComparison ?? isEngine2ComparisonEnabled();
  let devMode = opts?.forceDevMode;
  if (devMode === undefined) {
    try {
      devMode = Boolean(
        (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV,
      );
    } catch {
      devMode = false;
    }
  }
  return shouldShowEngine2DebugViewer({
    comparisonEnabled,
    devMode,
  });
}

export interface DebugDifferenceRow {
  id: string;
  category: ComparisonDifferenceCategory;
  classification: ComparisonClassification;
  legacyValue: string;
  engine2Value: string;
  likelyCause: string;
  recommendedAction: string;
  /** Severity is derived from classification: investigate > known > expected. */
  severity: "high" | "medium" | "low";
}

export interface DebugViewerViewModel {
  scheduleName: string;
  legacyEngineVersion: string;
  engine2Version: string;
  verdict: ComparisonVerdict;
  activityCount: { legacy: number; engine2: number };
  relationshipCount: { legacy: number; engine2: number };
  exactDateMatches: number;
  mismatchCount: number;
  classificationSummary: Array<{
    classification: ComparisonClassification;
    count: number;
  }>;
  categorySummary: Array<{
    category: ComparisonDifferenceCategory;
    count: number;
  }>;
  topDifferences: DebugDifferenceRow[];
  allDifferences: DebugDifferenceRow[];
  diagnostics: {
    engine2Count: number;
    knownLimitations: string[];
  };
  /** Set when engine2 (or the bridge) threw. The drawer should show this prominently. */
  engine2Error?: string;
  runRecord: {
    legacyDurationMs: number;
    engine2DurationMs: number;
    useExceptionAwareCalendars: boolean;
  };
  /** Pre-formatted plain-text report for copy/export. */
  formattedReport: string;
}

function severityFor(c: ComparisonClassification): "high" | "medium" | "low" {
  switch (c) {
    case "investigate":
      return "high";
    case "known-engine-limitation":
      return "medium";
    case "expected-bridge-limitation":
      return "low";
  }
}

function valueToString(v: ComparisonDifference["legacy"]): string {
  if (v === undefined) return "—";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function toRow(d: ComparisonDifference): DebugDifferenceRow {
  return {
    id: d.id,
    category: d.category,
    classification: d.classification,
    legacyValue: valueToString(d.legacy),
    engine2Value: valueToString(d.engine2),
    likelyCause: d.likelyCause ?? "",
    recommendedAction: d.recommendedAction ?? "",
    severity: severityFor(d.classification),
  };
}

/**
 * Deterministic projection of a `ComparisonReport` into a render-ready
 * view-model. Pure: same report → same output, always.
 */
export function buildComparisonViewModel(
  report: ComparisonReport,
): DebugViewerViewModel {
  const mismatchCount = report.differences.length;

  const classificationSummary = (
    Object.entries(report.countsByClassification) as Array<
      [ComparisonClassification, number]
    >
  )
    .filter(([, n]) => n > 0)
    .sort((a, b) => severityOrder(a[0]) - severityOrder(b[0]));

  const categorySummary = (
    Object.entries(report.countsByCategory) as Array<
      [ComparisonDifferenceCategory, number]
    >
  )
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return {
    scheduleName: report.scheduleName,
    legacyEngineVersion: report.legacyEngineVersion,
    engine2Version: report.engine2Version,
    verdict: report.verdict,
    activityCount: { ...report.activityCount },
    relationshipCount: { ...report.relationshipCount },
    exactDateMatches: report.exactDateMatches,
    mismatchCount,
    classificationSummary: classificationSummary.map(([classification, count]) => ({
      classification,
      count,
    })),
    categorySummary: categorySummary.map(([category, count]) => ({
      category,
      count,
    })),
    topDifferences: report.topDifferences.map(toRow),
    allDifferences: report.differences.map(toRow),
    diagnostics: {
      engine2Count: report.engine2DiagnosticsCount,
      knownLimitations: [...report.knownLimitations],
    },
    engine2Error: report.engine2Error,
    runRecord: {
      legacyDurationMs: report.runRecord.legacyDurationMs,
      engine2DurationMs: report.runRecord.engine2DurationMs,
      useExceptionAwareCalendars: report.runRecord.useExceptionAwareCalendars,
    },
    formattedReport: formatComparisonReport(report),
  };
}

function severityOrder(c: ComparisonClassification): number {
  switch (c) {
    case "investigate":
      return 0;
    case "known-engine-limitation":
      return 1;
    case "expected-bridge-limitation":
      return 2;
  }
}

/** Convenience: a JSON blob suitable for download/export. */
export function viewModelToJsonBlob(vm: DebugViewerViewModel): string {
  return JSON.stringify(vm, null, 2);
}
