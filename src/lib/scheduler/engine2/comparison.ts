/**
 * engine2 — Phase 2.4 side-by-side comparison harness.
 *
 * Runs the legacy `calculateSchedule` and engine2 `calculateCpm` over the
 * same input and produces a structured report. The legacy result is the
 * authoritative product output; engine2 output is *informational only* and
 * never overwrites legacy behavior. See ARCHITECTURE.md §24.
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
  | "engine2_only_diagnostic";

export interface ComparisonDifference {
  category: ComparisonDifferenceCategory;
  id: string;
  legacy?: string | number | boolean | null;
  engine2?: string | number | boolean | null;
  note?: string;
}

export interface ComparisonReport {
  legacyEngineVersion: "legacy-1.x";
  engine2Version: string;
  activityCount: { legacy: number; engine2: number };
  relationshipCount: { legacy: number; engine2: number };
  exactDateMatches: number;
  differences: ComparisonDifference[];
  countsByCategory: Record<ComparisonDifferenceCategory, number>;
  knownLimitations: string[];
  engine2DiagnosticsCount: number;
  runRecord: {
    legacyDurationMs: number;
    engine2DurationMs: number;
    diagnostics: { legacyCount: number; engine2Count: number };
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
  };
}

function pushDiff(
  diffs: ComparisonDifference[],
  counts: Record<ComparisonDifferenceCategory, number>,
  d: ComparisonDifference,
) {
  diffs.push(d);
  counts[d.category]++;
}

export interface CompareEnginesOptions {
  /** Treat float (which is unit-mismatched across engines) as a known limitation rather than a hard difference. */
  treatFloatAsLimitation?: boolean;
}

/**
 * Run both engines against the same schedule and produce a structured
 * comparison. Does not throw on mismatch — the report carries the verdict.
 */
export function compareEnginesOnSchedule(
  schedule: Schedule,
  options: CompareEnginesOptions = {},
): ComparisonRun {
  const t0Legacy = Date.now();
  const legacy = calculateSchedule(schedule);
  const legacyMs = Date.now() - t0Legacy;

  const bridge = bridgeLegacyScheduleToEngine2(schedule);
  const t0Engine2 = Date.now();
  const engine2 = calculateCpm(bridge.input);
  const engine2Ms = Date.now() - t0Engine2;

  const differences: ComparisonDifference[] = [];
  const counts = emptyCounts();
  const knownLimitations: string[] = [...bridge.conversionNotes];

  // Index activities by id.
  const legacyById = new Map(legacy.tasks.map((t) => [t.id, t]));
  const engine2ById = new Map(engine2.activities.map((a) => [a.id, a]));

  for (const lid of legacyById.keys()) {
    if (!engine2ById.has(lid)) {
      pushDiff(differences, counts, {
        category: "missing_in_engine2",
        id: lid,
        note: "Activity present in legacy result but not in engine2 result",
      });
    }
  }
  for (const eid of engine2ById.keys()) {
    if (!legacyById.has(eid)) {
      pushDiff(differences, counts, {
        category: "missing_in_legacy",
        id: eid,
        note: "Activity present in engine2 result but not in legacy result",
      });
    }
  }

  let exactDateMatches = 0;

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

    let exact = true;
    if (legacyEs !== engine2Es) {
      pushDiff(differences, counts, {
        category: "early_start_date",
        id,
        legacy: legacyEs,
        engine2: engine2Es,
      });
      exact = false;
    }
    if (legacyEf !== engine2Ef) {
      pushDiff(differences, counts, {
        category: "early_finish_date",
        id,
        legacy: legacyEf,
        engine2: engine2Ef,
      });
      exact = false;
    }
    if (legacyLs !== engine2Ls) {
      pushDiff(differences, counts, {
        category: "late_start_date",
        id,
        legacy: legacyLs,
        engine2: engine2Ls,
      });
      exact = false;
    }
    if (legacyLf !== engine2Lf) {
      pushDiff(differences, counts, {
        category: "late_finish_date",
        id,
        legacy: legacyLf,
        engine2: engine2Lf,
      });
      exact = false;
    }
    if (exact) exactDateMatches++;

    // Float — unit mismatch (legacy = calendar days, engine2 = minutes
    // converted to working days). Bucket as limitation when requested.
    const legacyTf = lt.totalFloat;
    const engine2TfDays = Math.round(er.totalFloatMinutes / MINUTES_PER_LEGACY_DAY);
    if (legacyTf !== engine2TfDays) {
      pushDiff(differences, counts, {
        category: options.treatFloatAsLimitation ? "known_limitation" : "total_float",
        id,
        legacy: legacyTf,
        engine2: engine2TfDays,
        note: "Float unit basis differs (legacy=calendar days, engine2=working days)",
      });
    }
    const legacyFf = lt.freeFloat;
    const engine2FfDays = Math.round(er.freeFloatMinutes / MINUTES_PER_LEGACY_DAY);
    if (legacyFf !== engine2FfDays) {
      pushDiff(differences, counts, {
        category: options.treatFloatAsLimitation ? "known_limitation" : "free_float",
        id,
        legacy: legacyFf,
        engine2: engine2FfDays,
        note: "Float unit basis differs (legacy=calendar days, engine2=working days)",
      });
    }

    if (lt.isCritical !== er.isCritical) {
      pushDiff(differences, counts, {
        category: "critical_flag",
        id,
        legacy: lt.isCritical,
        engine2: er.isCritical,
      });
    }
  }

  // Driving links.
  const engine2RelById = new Map(engine2.relationships.map((r) => [r.id, r]));
  for (const ldep of legacy.dependencies) {
    const er = engine2RelById.get(ldep.id);
    if (!er) {
      pushDiff(differences, counts, {
        category: "missing_in_engine2",
        id: ldep.id,
        note: "Relationship present in legacy result but not in engine2",
      });
      continue;
    }
    if (ldep.isDriving !== er.isDriving) {
      pushDiff(differences, counts, {
        category: "driving_link",
        id: ldep.id,
        legacy: ldep.isDriving,
        engine2: er.isDriving,
      });
    }
  }

  // engine2-only diagnostics surfaced for visibility.
  for (const d of engine2.diagnostics as EngineDiagnostic[]) {
    if (d.severity === "info") continue;
    pushDiff(differences, counts, {
      category: "engine2_only_diagnostic",
      id: d.activityId ?? d.code,
      engine2: d.message,
      note: `[${d.severity}] ${d.code}`,
    });
  }

  knownLimitations.push(
    "Legacy float is expressed in calendar days; engine2 in working minutes. Differences here are unit-basis, not logic.",
    "Legacy engine does not model actualStart/actualFinish; engine2 status is therefore 'not-started' for percent-complete activities.",
    "Engine2 driving-link slack is computed in working minutes against the successor's calendar; legacy uses default-calendar offset slack.",
  );

  const report: ComparisonReport = {
    legacyEngineVersion: "legacy-1.x",
    engine2Version: engine2.runRecord.engineVersion,
    activityCount: {
      legacy: legacy.tasks.length,
      engine2: engine2.activities.length,
    },
    relationshipCount: {
      legacy: legacy.dependencies.length,
      engine2: engine2.relationships.length,
    },
    exactDateMatches,
    differences,
    countsByCategory: counts,
    knownLimitations,
    engine2DiagnosticsCount: engine2.diagnostics.length,
    runRecord: {
      legacyDurationMs: legacyMs,
      engine2DurationMs: engine2Ms,
      diagnostics: {
        legacyCount: legacy.diagnostics.length,
        engine2Count: engine2.diagnostics.length,
      },
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
    `engine2 comparison (legacy=${report.legacyEngineVersion}, engine2=${report.engine2Version})`,
  );
  lines.push(
    `  activities: legacy=${report.activityCount.legacy} engine2=${report.activityCount.engine2}`,
  );
  lines.push(
    `  relationships: legacy=${report.relationshipCount.legacy} engine2=${report.relationshipCount.engine2}`,
  );
  lines.push(
    `  exact date matches: ${report.exactDateMatches}/${report.activityCount.legacy}`,
  );
  lines.push(`  diagnostics: engine2=${report.engine2DiagnosticsCount}`);
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
