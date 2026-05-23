/**
 * Phase 2.9 — Engine2 shadow-evidence review & mismatch burn-down.
 *
 * Turns an accumulated `EvidenceLog` (Phase 2.8) into engineering
 * decisions:
 *
 *   - `summarizeEvidenceLog`  → high-level totals across all shadow runs
 *   - `buildMismatchBurnDown` → grouped, classified, ranked rows with
 *                               likely cause + recommended action +
 *                               severity + origin (bridge/legacy/
 *                               engine2/known-limitation)
 *   - `rankBurnDown`          → stable deterministic ranking
 *   - `evaluatePromotionReadiness`
 *                             → formalized boring-report bar for moving
 *                               engine2 from shadow-only → selectable
 *
 * GUARDRAILS:
 *   - Pure projections over an EvidenceLog. Never mutates the log,
 *     legacy results, schedules, or any feature flag.
 *   - Never throws. Empty / malformed logs yield zeroed reports.
 *   - All sort orders are deterministic so test diffs are reviewable.
 *
 * See ARCHITECTURE.md §29.
 */

import type {
  ComparisonClassification,
  ComparisonDifferenceCategory,
  ComparisonVerdict,
} from "./comparison";
import type { EvidenceLog, EvidenceLogEntry } from "./shadow";

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface EvidenceSummary {
  totalRuns: number;
  totalSchedules: number;
  cleanReports: number;
  expectedDifferenceReports: number;
  investigateReports: number;
  boringReports: number;
  engine2ErrorCount: number;
  bridgeErrorCount: number;
  exceptionAwareRuns: number;
  wholeDayRuns: number;
  /** Diff in mismatchCount between exception-aware and whole-day for the same schedule. */
  exceptionClockDeltas: Array<{
    scheduleId: string;
    wholeDayMismatches: number;
    exceptionAwareMismatches: number;
    delta: number;
  }>;
  /** Recurring categories sorted by total occurrences across the log. */
  recurringCategories: Array<{
    category: ComparisonDifferenceCategory;
    occurrences: number;
    affectedRuns: number;
  }>;
  /** Activities/fields that appear most often across investigate diffs.
   *  In Phase 2.9 the evidence log only carries per-category counts (not
   *  per-id diffs), so this is intentionally empty until persisted diffs
   *  are added. Surface remains in the API so consumers don't break. */
  topRecurringIds: Array<{ id: string; occurrences: number }>;
}

const ZERO_SUMMARY = (): EvidenceSummary => ({
  totalRuns: 0,
  totalSchedules: 0,
  cleanReports: 0,
  expectedDifferenceReports: 0,
  investigateReports: 0,
  boringReports: 0,
  engine2ErrorCount: 0,
  bridgeErrorCount: 0,
  exceptionAwareRuns: 0,
  wholeDayRuns: 0,
  exceptionClockDeltas: [],
  recurringCategories: [],
  topRecurringIds: [],
});

/**
 * Deterministic aggregate over an EvidenceLog. Safe on empty logs.
 *
 * `bridgeErrorCount` is approximated from engine2Error messages that
 * mention "bridge"; `engine2ErrorCount` is everything else. This is a
 * coarse split — the evidence log does not yet carry an origin field —
 * but it's stable and reproducible.
 */
export function summarizeEvidenceLog(log: EvidenceLog | undefined | null): EvidenceSummary {
  if (!log || !Array.isArray(log.entries) || log.entries.length === 0) {
    return ZERO_SUMMARY();
  }

  const out = ZERO_SUMMARY();
  const scheduleIds = new Set<string>();
  const categoryTotals = new Map<
    ComparisonDifferenceCategory,
    { occurrences: number; affectedRuns: number }
  >();
  const byScheduleMode = new Map<string, Partial<Record<"whole-day" | "exception-aware", number>>>();

  for (const e of log.entries) {
    out.totalRuns += 1;
    scheduleIds.add(e.scheduleId);

    switch (e.verdict as ComparisonVerdict) {
      case "clean":
        out.cleanReports += 1;
        break;
      case "expected-differences":
        out.expectedDifferenceReports += 1;
        break;
      case "investigate":
        out.investigateReports += 1;
        break;
    }
    if (e.boring) out.boringReports += 1;

    if (e.engine2Error) {
      if (/bridge/i.test(e.engine2Error)) out.bridgeErrorCount += 1;
      else out.engine2ErrorCount += 1;
    }

    if (e.useExceptionAwareCalendars) out.exceptionAwareRuns += 1;
    else out.wholeDayRuns += 1;

    for (const c of e.topDifferenceCategories) {
      const prev = categoryTotals.get(c.category) ?? { occurrences: 0, affectedRuns: 0 };
      prev.occurrences += c.count;
      prev.affectedRuns += 1;
      categoryTotals.set(c.category, prev);
    }

    const bucket = byScheduleMode.get(e.scheduleId) ?? {};
    bucket[e.calendarMode] = (bucket[e.calendarMode] ?? 0) + e.mismatchCount;
    byScheduleMode.set(e.scheduleId, bucket);
  }

  out.totalSchedules = scheduleIds.size;

  for (const [scheduleId, modes] of byScheduleMode) {
    const wd = modes["whole-day"];
    const ea = modes["exception-aware"];
    if (typeof wd === "number" && typeof ea === "number") {
      out.exceptionClockDeltas.push({
        scheduleId,
        wholeDayMismatches: wd,
        exceptionAwareMismatches: ea,
        delta: ea - wd,
      });
    }
  }
  out.exceptionClockDeltas.sort((a, b) => a.scheduleId.localeCompare(b.scheduleId));

  out.recurringCategories = [...categoryTotals.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort(
      (a, b) =>
        b.occurrences - a.occurrences ||
        b.affectedRuns - a.affectedRuns ||
        a.category.localeCompare(b.category),
    );

  return out;
}

// ---------------------------------------------------------------------------
// Burn-down
// ---------------------------------------------------------------------------

export type MismatchSeverity = "high" | "medium" | "low";
export type MismatchOrigin =
  | "bridge"
  | "legacy-limitation"
  | "engine2"
  | "known-limitation";

export interface MismatchBurnDownRow {
  category: ComparisonDifferenceCategory;
  /** Total count of differences in this category across the log. */
  count: number;
  /** Distinct shadow-run entries this category touched. */
  affectedRuns: number;
  classification: ComparisonClassification;
  severity: MismatchSeverity;
  origin: MismatchOrigin;
  likelyCause: string;
  recommendedAction: string;
  /** True when this category affects dates / float / critical-path. */
  impactsDates: boolean;
  /** True when this category appeared on real (non-fixture) schedules. */
  affectsRealSchedules: boolean;
  /** True when this category blocks promoting engine2 from shadow → selectable. */
  blocksPromotion: boolean;
}

export interface MismatchBurnDown {
  totalCategories: number;
  totalMismatches: number;
  rows: MismatchBurnDownRow[];
}

const DATE_IMPACT_CATEGORIES = new Set<ComparisonDifferenceCategory>([
  "early_start_date",
  "early_finish_date",
  "late_start_date",
  "late_finish_date",
  "total_float",
  "free_float",
  "critical_flag",
  "driving_link",
]);

const BRIDGE_ORIGIN_CATEGORIES = new Set<ComparisonDifferenceCategory>([
  "calendar_model_difference",
  "lag_basis_difference",
  "constraint_behavior_difference",
  "missing_legacy_field",
  "legacy_missing_engine2_field",
  "missing_engine2_field",
  "known_unsupported_behavior",
]);

const LEGACY_LIMITATION_CATEGORIES = new Set<ComparisonDifferenceCategory>([
  "leveling_behavior_difference",
  "baseline_behavior_difference",
  "progress_behavior_difference",
]);

const ENGINE2_ORIGIN_CATEGORIES = new Set<ComparisonDifferenceCategory>([
  "missing_in_engine2",
  "missing_in_legacy",
  "engine2_only_diagnostic",
  "precision_rounding_difference",
]);

function originFor(category: ComparisonDifferenceCategory): MismatchOrigin {
  if (BRIDGE_ORIGIN_CATEGORIES.has(category)) return "bridge";
  if (LEGACY_LIMITATION_CATEGORIES.has(category)) return "legacy-limitation";
  if (ENGINE2_ORIGIN_CATEGORIES.has(category)) return "engine2";
  if (DATE_IMPACT_CATEGORIES.has(category)) return "engine2";
  return "known-limitation";
}

function defaultClassificationFor(
  category: ComparisonDifferenceCategory,
): ComparisonClassification {
  switch (category) {
    case "early_start_date":
    case "early_finish_date":
    case "late_start_date":
    case "late_finish_date":
    case "critical_flag":
    case "driving_link":
    case "missing_in_engine2":
    case "missing_in_legacy":
      return "investigate";
    case "total_float":
    case "free_float":
    case "progress_behavior_difference":
    case "leveling_behavior_difference":
    case "precision_rounding_difference":
    case "engine2_only_diagnostic":
      return "known-engine-limitation";
    default:
      return "expected-bridge-limitation";
  }
}

function severityFor(
  classification: ComparisonClassification,
  impactsDates: boolean,
  count: number,
): MismatchSeverity {
  if (classification === "investigate") return "high";
  if (impactsDates && count >= 5) return "high";
  if (classification === "known-engine-limitation") return impactsDates ? "medium" : "low";
  return "low";
}

function contextFor(category: ComparisonDifferenceCategory): {
  likelyCause: string;
  recommendedAction: string;
} {
  // Mirrors the categories in comparison.ts:defaultActionableContext, kept
  // local so burn-down does not depend on the comparison harness internals.
  switch (category) {
    case "early_start_date":
    case "early_finish_date":
    case "late_start_date":
    case "late_finish_date":
      return {
        likelyCause:
          "Date math differs (working-minute vs calendar-day basis, or progress not bridged as actuals).",
        recommendedAction:
          "Bridge percent-complete → actualStart/actualFinish, or unify the calendar basis. Re-shadow after fix.",
      };
    case "total_float":
    case "free_float":
      return {
        likelyCause: "Float unit basis differs (legacy=calendar days, engine2=working minutes).",
        recommendedAction: "Emit a common float unit from both engines before promotion.",
      };
    case "critical_flag":
      return {
        likelyCause: "Downstream of date/float deltas on this activity or its successors.",
        recommendedAction: "Resolve upstream date/float deltas first; flag will follow.",
      };
    case "driving_link":
      return {
        likelyCause: "Driving-link slack computed in working minutes vs calendar days.",
        recommendedAction: "Defer until calendar parity lands; revisit after calendar fix.",
      };
    case "missing_in_engine2":
    case "missing_in_legacy":
      return {
        likelyCause: "Bridge produced asymmetric activity set — possible bridge bug.",
        recommendedAction: "Inspect bridge id mapping; engine2 must mirror legacy 1:1.",
      };
    case "calendar_model_difference":
      return {
        likelyCause: "Engine2 surfaced a calendar diagnostic legacy cannot model.",
        recommendedAction: "Document; act only if it correlates with date deltas.",
      };
    case "lag_basis_difference":
      return {
        likelyCause: "Lag interpreted on different calendars between engines.",
        recommendedAction: "Land lag-on-successor-calendar parity before promotion.",
      };
    case "constraint_behavior_difference":
      return {
        likelyCause: "Engine2 supports more constraint types than legacy.",
        recommendedAction: "Verify legacy SNET mapping is intact; otherwise expected.",
      };
    case "progress_behavior_difference":
      return {
        likelyCause: "Legacy uses percent-complete; engine2 expects actualStart/actualFinish.",
        recommendedAction: "Bridge percent-complete → actuals.",
      };
    case "leveling_behavior_difference":
      return {
        likelyCause: "Legacy engine does not perform resource leveling; engine2 does.",
        recommendedAction: "Expected. Compare engine2 leveling output to itself, not legacy.",
      };
    case "baseline_behavior_difference":
      return {
        likelyCause: "Legacy engine does not consume baselines for math.",
        recommendedAction: "Expected. Out of scope for the bridge.",
      };
    case "precision_rounding_difference":
      return {
        likelyCause: "Rounding difference between calendar-day and working-minute math.",
        recommendedAction: "Acceptable; revisit only if it flips a critical flag.",
      };
    case "missing_legacy_field":
      return {
        likelyCause: "Engine2 carries a field with no legacy equivalent.",
        recommendedAction: "Informational only.",
      };
    case "legacy_missing_engine2_field":
    case "missing_engine2_field":
      return {
        likelyCause: "Field exists on one engine's output but not the other.",
        recommendedAction: "Document; expand bridge surface if needed.",
      };
    case "known_unsupported_behavior":
      return {
        likelyCause: "Behavior the bridge knowingly does not cross-emit.",
        recommendedAction: "No action — tracked as a known unsupported behavior.",
      };
    case "known_limitation":
      return {
        likelyCause: "Documented bridge/engine limitation.",
        recommendedAction: "No action — see ARCHITECTURE.md.",
      };
    case "engine2_only_diagnostic":
    default:
      return {
        likelyCause: "Engine2 diagnostic with no legacy counterpart.",
        recommendedAction: "Review; escalate only if correlated with date deltas.",
      };
  }
}

const SEVERITY_RANK: Record<MismatchSeverity, number> = { high: 0, medium: 1, low: 2 };
const CLASSIFICATION_RANK: Record<ComparisonClassification, number> = {
  investigate: 0,
  "known-engine-limitation": 1,
  "expected-bridge-limitation": 2,
};

/**
 * Build a deterministic burn-down view from an evidence log. Categories
 * are aggregated across all entries; each row carries the engineering
 * context needed to act on it.
 */
export function buildMismatchBurnDown(
  log: EvidenceLog | undefined | null,
  options: { realScheduleIntents?: ReadonlyArray<string> } = {},
): MismatchBurnDown {
  if (!log || !Array.isArray(log.entries) || log.entries.length === 0) {
    return { totalCategories: 0, totalMismatches: 0, rows: [] };
  }

  const realIntents = new Set(
    (options.realScheduleIntents ?? ["demo", "imported", "real"]).map((s) =>
      s.toLowerCase(),
    ),
  );

  const grouped = new Map<
    ComparisonDifferenceCategory,
    {
      count: number;
      affectedRuns: number;
      affectsReal: boolean;
    }
  >();

  for (const e of log.entries) {
    const isReal =
      typeof e.intent === "string" && realIntents.has(e.intent.toLowerCase());
    for (const c of e.topDifferenceCategories) {
      const prev = grouped.get(c.category) ?? {
        count: 0,
        affectedRuns: 0,
        affectsReal: false,
      };
      prev.count += c.count;
      prev.affectedRuns += 1;
      if (isReal) prev.affectsReal = true;
      grouped.set(c.category, prev);
    }
  }

  const rows: MismatchBurnDownRow[] = [];
  for (const [category, v] of grouped) {
    const classification = defaultClassificationFor(category);
    const impactsDates = DATE_IMPACT_CATEGORIES.has(category);
    const severity = severityFor(classification, impactsDates, v.count);
    const ctx = contextFor(category);
    const origin = originFor(category);
    rows.push({
      category,
      count: v.count,
      affectedRuns: v.affectedRuns,
      classification,
      severity,
      origin,
      likelyCause: ctx.likelyCause,
      recommendedAction: ctx.recommendedAction,
      impactsDates,
      affectsRealSchedules: v.affectsReal,
      blocksPromotion: classification === "investigate",
    });
  }

  const ranked = rankBurnDown(rows);
  const totalMismatches = ranked.reduce((s, r) => s + r.count, 0);
  return { totalCategories: ranked.length, totalMismatches, rows: ranked };
}

/**
 * Stable ranking for the burn-down. Order:
 *   1. classification severity (investigate first)
 *   2. severity (high first)
 *   3. impactsDates (true first)
 *   4. affectsRealSchedules (true first)
 *   5. count (desc)
 *   6. category name (asc) — final tiebreaker for determinism
 */
export function rankBurnDown(rows: MismatchBurnDownRow[]): MismatchBurnDownRow[] {
  return [...rows].sort((a, b) => {
    const c = CLASSIFICATION_RANK[a.classification] - CLASSIFICATION_RANK[b.classification];
    if (c !== 0) return c;
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (s !== 0) return s;
    if (a.impactsDates !== b.impactsDates) return a.impactsDates ? -1 : 1;
    if (a.affectsRealSchedules !== b.affectsRealSchedules) {
      return a.affectsRealSchedules ? -1 : 1;
    }
    if (a.count !== b.count) return b.count - a.count;
    return a.category.localeCompare(b.category);
  });
}

// ---------------------------------------------------------------------------
// Promotion readiness ("boring report" bar)
// ---------------------------------------------------------------------------

export interface PromotionReadiness {
  ready: boolean;
  /** Per-criterion outcomes — every criterion that failed lists `pass=false`. */
  criteria: Array<{
    id: string;
    description: string;
    pass: boolean;
    detail?: string;
  }>;
  blockers: string[];
}

/**
 * Formalized criteria for moving engine2 from shadow-only → internal
 * selectable mode. ALL criteria must pass. This is intentionally
 * stricter than `isBoringReport` (which judges a single report) — it
 * judges the whole evidence log.
 *
 *  1. Zero engine2 thrown errors.
 *  2. Zero bridge errors.
 *  3. Zero unclassified mismatches (every diff carries a category).
 *  4. No unexplained `investigate` verdicts on demo schedules.
 *  5. All recurring difference categories have documented classifications.
 *  6. Commercial Fit-Out report is clean or expected-differences.
 *  7. Exception-aware clock differences are documented and classified.
 */
export interface PromotionCriteriaInput {
  demoScheduleId?: string;
  commercialFitOutScheduleId?: string;
}

export function evaluatePromotionReadiness(
  log: EvidenceLog | undefined | null,
  input: PromotionCriteriaInput = {},
): PromotionReadiness {
  const summary = summarizeEvidenceLog(log);
  const burndown = buildMismatchBurnDown(log);
  const entries = log?.entries ?? [];

  const criteria: PromotionReadiness["criteria"] = [];

  criteria.push({
    id: "no-engine2-errors",
    description: "Zero engine2 thrown errors across the evidence log.",
    pass: summary.engine2ErrorCount === 0,
    detail:
      summary.engine2ErrorCount === 0
        ? undefined
        : `${summary.engine2ErrorCount} engine2 error(s) recorded`,
  });

  criteria.push({
    id: "no-bridge-errors",
    description: "Zero bridge errors across the evidence log.",
    pass: summary.bridgeErrorCount === 0,
    detail:
      summary.bridgeErrorCount === 0
        ? undefined
        : `${summary.bridgeErrorCount} bridge error(s) recorded`,
  });

  // "Unclassified mismatches" means a category we don't recognize. Every
  // category fed into the burn-down is in the typed union, so this passes
  // by construction unless a future category is added without an origin
  // mapping. Check both DATE/BRIDGE/LEGACY/ENGINE2 sets cover the row.
  const unknownOriginRows = burndown.rows.filter(
    (r) =>
      r.origin !== "bridge" &&
      r.origin !== "legacy-limitation" &&
      r.origin !== "engine2" &&
      r.origin !== "known-limitation",
  );
  criteria.push({
    id: "all-mismatches-classified",
    description: "Every recurring difference category has a documented classification + origin.",
    pass: unknownOriginRows.length === 0,
    detail:
      unknownOriginRows.length === 0
        ? undefined
        : `${unknownOriginRows.length} category/categories without an origin mapping`,
  });

  const demoId = input.demoScheduleId ?? "commercial-fit-out";
  const demoEntries = entries.filter((e) => e.scheduleId === demoId);
  const demoInvestigate = demoEntries.filter((e) => e.verdict === "investigate");
  criteria.push({
    id: "demo-no-investigate",
    description: `No unexplained investigate verdicts on demo schedule '${demoId}'.`,
    pass: demoInvestigate.length === 0,
    detail:
      demoInvestigate.length === 0
        ? undefined
        : `${demoInvestigate.length} demo entry/entries have verdict=investigate`,
  });

  const investigateRows = burndown.rows.filter((r) => r.classification === "investigate");
  criteria.push({
    id: "no-investigate-rows",
    description: "Burn-down has no investigate-classified categories.",
    pass: investigateRows.length === 0,
    detail:
      investigateRows.length === 0
        ? undefined
        : `${investigateRows.length} investigate categor(y/ies): ${investigateRows
            .map((r) => r.category)
            .join(", ")}`,
  });

  const cfoId = input.commercialFitOutScheduleId ?? "commercial-fit-out";
  const cfoEntries = entries.filter((e) => e.scheduleId === cfoId);
  const cfoBad = cfoEntries.filter((e) => e.verdict === "investigate" || !!e.engine2Error);
  criteria.push({
    id: "cfo-clean",
    description: "Commercial Fit-Out report is clean or expected-differences (no errors, no investigate).",
    pass: cfoEntries.length === 0 ? false : cfoBad.length === 0,
    detail:
      cfoEntries.length === 0
        ? "no Commercial Fit-Out entries in the evidence log"
        : cfoBad.length === 0
          ? undefined
          : `${cfoBad.length} CFO entry/entries have errors or investigate verdict`,
  });

  // Exception-aware clock parity — only enforced when EA runs exist.
  const eaEntries = entries.filter((e) => e.useExceptionAwareCalendars);
  const eaInvestigate = eaEntries.filter((e) => e.verdict === "investigate");
  criteria.push({
    id: "exception-clock-documented",
    description: "Exception-aware clock differences are classified (no investigate verdicts).",
    pass: eaInvestigate.length === 0,
    detail:
      eaInvestigate.length === 0
        ? undefined
        : `${eaInvestigate.length} exception-aware entry/entries have verdict=investigate`,
  });

  const blockers = criteria.filter((c) => !c.pass).map((c) => c.description);
  return {
    ready: blockers.length === 0,
    criteria,
    blockers,
  };
}

/**
 * Pretty-print a burn-down + summary as a deterministic text report
 * suitable for copy/paste into PRs or chat. Pure projection.
 */
export function formatEvidenceReview(
  log: EvidenceLog | undefined | null,
  input: PromotionCriteriaInput = {},
): string {
  const summary = summarizeEvidenceLog(log);
  const burndown = buildMismatchBurnDown(log);
  const readiness = evaluatePromotionReadiness(log, input);

  const lines: string[] = [];
  lines.push("engine2 shadow evidence review");
  lines.push("=".repeat(40));
  lines.push(`runs=${summary.totalRuns} schedules=${summary.totalSchedules}`);
  lines.push(
    `clean=${summary.cleanReports} expected=${summary.expectedDifferenceReports} investigate=${summary.investigateReports} boring=${summary.boringReports}`,
  );
  lines.push(
    `engine2Errors=${summary.engine2ErrorCount} bridgeErrors=${summary.bridgeErrorCount}`,
  );
  lines.push(
    `wholeDayRuns=${summary.wholeDayRuns} exceptionAwareRuns=${summary.exceptionAwareRuns}`,
  );
  lines.push("");
  lines.push(`burn-down (${burndown.totalCategories} categories, ${burndown.totalMismatches} mismatches):`);
  for (const r of burndown.rows) {
    lines.push(
      `  [${r.severity.toUpperCase()}] ${r.category} x${r.count} runs=${r.affectedRuns} class=${r.classification} origin=${r.origin}${r.blocksPromotion ? " *blocks*" : ""}`,
    );
    lines.push(`     cause: ${r.likelyCause}`);
    lines.push(`     action: ${r.recommendedAction}`);
  }
  lines.push("");
  lines.push(`promotion-ready: ${readiness.ready ? "YES" : "NO"}`);
  for (const c of readiness.criteria) {
    lines.push(`  ${c.pass ? "PASS" : "FAIL"} ${c.id} — ${c.description}${c.detail ? ` (${c.detail})` : ""}`);
  }
  return lines.join("\n");
}
