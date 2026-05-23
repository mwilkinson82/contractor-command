/**
 * engine2 Reconciliation harness (Phase 1.8)
 *
 * Classifies the gap between an imported XER schedule, engine2's
 * calculated result, and (optionally) externally-supplied expected
 * values. The classification is deliberately coarse so future passes
 * can promote items between buckets without changing the harness API.
 *
 * Buckets:
 *  - "match"                            — engine2 produced what was expected
 *  - "acceptable-known-limitation"      — divergence is documented and expected
 *                                         given current engine2 scope
 *  - "mismatch"                         — engine2 produced something wrong vs. expectations
 *  - "unsupported-preserved-only"       — XER carried data engine2 does not execute,
 *                                         but the importer preserved it raw + diagnosed
 */

import type {
  EngineActivityResult,
  EngineDiagnostic,
  EngineResult,
  Instant,
} from "./types";
import type { XerEngine2ImportResult } from "./xer-import";

export type ReconciliationKind =
  | "match"
  | "acceptable-known-limitation"
  | "mismatch"
  | "unsupported-preserved-only";

export interface ReconciliationEntry {
  kind: ReconciliationKind;
  /** "activity:A1000.earlyFinish", "diagnostic:baseline_not_in_xer", "calendar:CAL2.shifts", ... */
  subject: string;
  message: string;
  /** Whichever side of the comparison is meaningful. */
  expected?: unknown;
  actual?: unknown;
  /** Diagnostic codes that justify an "acceptable-known-limitation" or
   *  "unsupported-preserved-only" classification. */
  justifyingCodes?: string[];
}

/** Per-activity expected values supplied by the harness caller. */
export interface ExpectedActivity {
  activityId: string;
  earlyStart?: Instant;
  earlyFinish?: Instant;
  isCritical?: boolean;
  /** Total float in working minutes. */
  totalFloatMinutes?: number;
}

export interface ReconciliationInput {
  importResult: XerEngine2ImportResult;
  engineResult: EngineResult;
  expectedActivities?: ExpectedActivity[];
  /** Tolerance for date comparisons (working minutes). Default 0. */
  toleranceMinutes?: number;
  /**
   * Diagnostic codes whose presence should be classified as
   * "acceptable-known-limitation" rather than "unsupported-preserved-only".
   * Default: a curated list of Phase 1.7–1.9 deferral codes.
   */
  acceptableLimitationCodes?: string[];
  /**
   * Phase 1.9 — signal from the pipeline that external/interproject
   * relationships were ignored by option. When true, preserved external
   * relationships classify as "acceptable-known-limitation". When false
   * (default), they classify as "mismatch" since the engine has not
   * honored documented logic.
   */
  externalRelationshipsIgnored?: boolean;
}

export interface ReconciliationReport {
  entries: ReconciliationEntry[];
  summary: {
    match: number;
    acceptable: number;
    mismatch: number;
    unsupportedPreservedOnly: number;
  };
  /** True only when no entry has kind "mismatch". */
  ok: boolean;
}

const DEFAULT_ACCEPTABLE_CODES = new Set<string>([
  "baseline_not_in_xer",
  "resource_calendar_deferred",
  "unsupported_calendar_shift",
  "unsupported_calendar_hours_per_day",
  "unsupported_activity_type_behavior",
  "unsupported_duration_type_behavior",
  "unsupported_percent_complete_type_behavior",
  "external_relationship_preserved_raw",
  "external_relationship_preserved",
  "external_relationship_ignored_by_option",
  "interproject_relationship_mapped",
  "calendar_synthesized",
]);

const UNSUPPORTED_PRESERVED_CODES = new Set<string>([
  "unsupported_constraint_type",
  "missing_calendar_reference",
  "missing_resource_reference",
  "external_project_missing",
  "interproject_relationship_unresolved",
]);

/**
 * Phase 1.9 — codes that signal real divergence the engine cannot honor
 * without additional input. Classified as "mismatch" regardless of
 * severity, so reconciliation surfaces them prominently.
 */
const MISMATCH_CODES = new Set<string>([
  "external_relationship_requires_imported_project",
]);

function findActivity(r: EngineResult, id: string): EngineActivityResult | undefined {
  return r.activities.find((a) => a.id === id);
}

export function reconcileSchedule(input: ReconciliationInput): ReconciliationReport {
  const entries: ReconciliationEntry[] = [];
  const tol = input.toleranceMinutes ?? 0;
  const tolMs = tol * 60_000;
  const acceptable = new Set<string>([
    ...DEFAULT_ACCEPTABLE_CODES,
    ...(input.acceptableLimitationCodes ?? []),
  ]);

  // 1. Diagnostics classification
  const allDiagnostics: EngineDiagnostic[] = [
    ...input.importResult.diagnostics,
    ...input.engineResult.diagnostics,
  ];
  for (const d of allDiagnostics) {
    if (acceptable.has(d.code)) {
      entries.push({
        kind: "acceptable-known-limitation",
        subject: `diagnostic:${d.code}${d.activityId ? `:${d.activityId}` : ""}`,
        message: d.message,
        justifyingCodes: [d.code],
      });
    } else if (UNSUPPORTED_PRESERVED_CODES.has(d.code)) {
      entries.push({
        kind: "unsupported-preserved-only",
        subject: `diagnostic:${d.code}${d.activityId ? `:${d.activityId}` : ""}`,
        message: d.message,
        justifyingCodes: [d.code],
      });
    } else if (d.severity === "error") {
      entries.push({
        kind: "mismatch",
        subject: `diagnostic:${d.code}${d.activityId ? `:${d.activityId}` : ""}`,
        message: d.message,
      });
    }
    // info/warn diagnostics with unknown codes are silently ignored — not
    // every informational note is a reconciliation finding.
  }

  // 2. Per-activity expected-vs-actual
  for (const exp of input.expectedActivities ?? []) {
    const got = findActivity(input.engineResult, exp.activityId);
    if (!got) {
      entries.push({
        kind: "mismatch",
        subject: `activity:${exp.activityId}`,
        message: `Activity ${exp.activityId} not present in engine2 result.`,
        expected: exp,
      });
      continue;
    }
    const cmp = (
      field: "earlyStart" | "earlyFinish",
      e: Instant | undefined,
      g: Instant,
    ) => {
      if (e === undefined) return;
      const diff = Math.abs(g - e);
      if (diff > tolMs) {
        entries.push({
          kind: "mismatch",
          subject: `activity:${exp.activityId}.${field}`,
          message: `${field} differs by ${Math.round(diff / 60_000)} min`,
          expected: e,
          actual: g,
        });
      } else {
        entries.push({
          kind: "match",
          subject: `activity:${exp.activityId}.${field}`,
          message: "within tolerance",
          expected: e,
          actual: g,
        });
      }
    };
    cmp("earlyStart", exp.earlyStart, got.earlyStart);
    cmp("earlyFinish", exp.earlyFinish, got.earlyFinish);
    if (exp.isCritical !== undefined) {
      entries.push({
        kind: exp.isCritical === got.isCritical ? "match" : "mismatch",
        subject: `activity:${exp.activityId}.isCritical`,
        message: exp.isCritical === got.isCritical ? "critical flag match" : "critical flag differs",
        expected: exp.isCritical,
        actual: got.isCritical,
      });
    }
    if (exp.totalFloatMinutes !== undefined) {
      const diff = Math.abs(exp.totalFloatMinutes - got.totalFloatMinutes);
      entries.push({
        kind: diff <= tol ? "match" : "mismatch",
        subject: `activity:${exp.activityId}.totalFloatMinutes`,
        message:
          diff <= tol
            ? "total float within tolerance"
            : `total float differs by ${diff} min`,
        expected: exp.totalFloatMinutes,
        actual: got.totalFloatMinutes,
      });
    }
  }

  // 3. Baseline-absence classification (XER never carries baselines).
  const anyBaselineProvided = !!input.engineResult.runRecord.optionsSnapshot.baselinesProvided;
  if (!anyBaselineProvided) {
    entries.push({
      kind: "acceptable-known-limitation",
      subject: "baseline:not-provided",
      message:
        "No baseline supplied; engine2 correctly did not fabricate one from XER content.",
      justifyingCodes: ["baseline_not_in_xer"],
    });
  }

  // 4. External-relationship preservation count
  if (input.importResult.stats.externalRelationshipsPreservedRaw > 0) {
    entries.push({
      kind: "unsupported-preserved-only",
      subject: "relationships:external",
      message: `${input.importResult.stats.externalRelationshipsPreservedRaw} external relationship(s) preserved as raw XER rows; engine2 does not execute them in this pass.`,
      justifyingCodes: ["external_relationship_preserved_raw"],
    });
  }

  const summary = {
    match: 0,
    acceptable: 0,
    mismatch: 0,
    unsupportedPreservedOnly: 0,
  };
  for (const e of entries) {
    if (e.kind === "match") summary.match++;
    else if (e.kind === "acceptable-known-limitation") summary.acceptable++;
    else if (e.kind === "mismatch") summary.mismatch++;
    else summary.unsupportedPreservedOnly++;
  }

  return { entries, summary, ok: summary.mismatch === 0 };
}
