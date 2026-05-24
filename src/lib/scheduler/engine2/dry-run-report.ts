/**
 * Phase 3.9 — pure formatters for dry-run comparison output.
 *
 * Produces a Markdown report and a JSON-safe structured payload from a
 * `PersistedDryRunReport` (Phase 3.6) so engineering can review engine2
 * vs legacy reconciliation results in a consistent, reviewable shape.
 *
 * GUARDRAILS — identical to §35/§36/§37/§38/§39:
 *   - Legacy is ALWAYS the authoritative engine. These reports never
 *     claim engine2 output is production-ready, even when normalized
 *     comparison shows a perfect match.
 *   - Raw engine2 vs legacy values are preserved and shown alongside the
 *     normalized (finish-convention-adjusted) view. Raw mismatches are
 *     never hidden.
 *   - Convention-only mismatches and true CPM mismatches are reported
 *     separately so a reader can never confuse the two.
 *   - This module is pure: it does not load schedules, hit the network,
 *     or read environment. Production routes never import it.
 *
 * See ARCHITECTURE.md §40.
 */

import type { PersistedDryRunReport } from "./persisted-dry-run";

export interface DryRunReportFormatOptions {
  /** ISO timestamp to stamp on the report. Defaults to `new Date().toISOString()`. */
  runTimestamp?: string;
}

/** JSON-safe structured projection of a persisted dry-run report. */
export interface DryRunReportJson {
  reportVersion: "phase-3.9";
  runTimestamp: string;
  legacyAuthoritative: true;
  schedule: {
    id: string;
    name: string;
  };
  engine2: {
    ran: boolean;
    skippedReason: string | null;
    diagnosticsCount: number;
    error: string | null;
  };
  eligibility: {
    blockers: string[];
    warnings: string[];
  };
  provenance: PersistedDryRunReport["provenance"];
  projectFinish: {
    raw: {
      legacy: string | null;
      engine2: string | null;
      deltaDays: number;
      match: boolean;
    };
    normalized: {
      legacy: string | null;
      engine2Normalized: string | null;
      deltaDays: number;
      match: boolean;
    };
  };
  activities: {
    raw: {
      matchingCount: number;
      differingCount: number;
      maxDateDeltaDays: number;
      maxFloatDeltaDays: number;
    };
    normalized: {
      matchingCount: number;
      differingCount: number;
      maxDateDeltaDays: number;
    };
  };
  conventionMismatchIds: PersistedDryRunReport["conventionMismatchIds"];
  trueDateMismatchIds: PersistedDryRunReport["trueDateMismatchIds"];
  differingIds: string[];
}

export function buildDryRunReportJson(
  report: PersistedDryRunReport,
  options: DryRunReportFormatOptions = {},
): DryRunReportJson {
  const runTimestamp = options.runTimestamp ?? new Date().toISOString();
  return {
    reportVersion: "phase-3.9",
    runTimestamp,
    legacyAuthoritative: true,
    schedule: { id: report.scheduleId, name: report.projectName },
    engine2: {
      ran: report.engine2Ran,
      skippedReason: report.skippedReason ?? null,
      diagnosticsCount: report.engine2DiagnosticsCount,
      error: report.engine2Error ?? null,
    },
    eligibility: {
      blockers: [...report.eligibilityBlockers],
      warnings: [...report.eligibilityWarnings],
    },
    provenance: { ...report.provenance },
    projectFinish: {
      raw: {
        legacy: report.projectFinish.legacy,
        engine2: report.projectFinish.engine2,
        deltaDays: report.projectFinish.deltaDays,
        match: report.projectFinish.match,
      },
      normalized: {
        legacy: report.projectFinish.legacy,
        engine2Normalized: report.normalizedProjectFinish.engine2Normalized,
        deltaDays: report.normalizedProjectFinish.deltaDays,
        match: report.normalizedProjectFinish.match,
      },
    },
    activities: {
      raw: {
        matchingCount: report.matchingCount,
        differingCount: report.differingCount,
        maxDateDeltaDays: report.maxDateDeltaDays,
        maxFloatDeltaDays: report.maxFloatDeltaDays,
      },
      normalized: {
        matchingCount: report.conventionAdjustedMatchingCount,
        differingCount: report.conventionAdjustedDifferingCount,
        maxDateDeltaDays: report.maxNormalizedDateDeltaDays,
      },
    },
    conventionMismatchIds: {
      earlyFinish: [...report.conventionMismatchIds.earlyFinish],
      lateFinish: [...report.conventionMismatchIds.lateFinish],
    },
    trueDateMismatchIds: {
      earlyStart: [...report.trueDateMismatchIds.earlyStart],
      earlyFinish: [...report.trueDateMismatchIds.earlyFinish],
      lateStart: [...report.trueDateMismatchIds.lateStart],
      lateFinish: [...report.trueDateMismatchIds.lateFinish],
    },
    differingIds: [...report.differingIds],
  };
}

function fmtIso(v: string | null): string {
  return v ?? "—";
}

function fmtIdList(ids: ReadonlyArray<string>): string {
  if (ids.length === 0) return "_(none)_";
  return ids.map((id) => `\`${id}\``).join(", ");
}

/**
 * Render a Markdown report. Pure — same input always produces same output
 * for a given `runTimestamp`.
 */
export function formatDryRunReportMarkdown(
  report: PersistedDryRunReport,
  options: DryRunReportFormatOptions = {},
): string {
  const runTimestamp = options.runTimestamp ?? new Date().toISOString();
  const lines: string[] = [];

  lines.push(`# Engine2 Dry-Run Report`);
  lines.push("");
  lines.push(`- **Schedule**: ${report.projectName} (\`${report.scheduleId}\`)`);
  lines.push(`- **Run timestamp**: ${runTimestamp}`);
  lines.push(`- **Legacy authoritative**: true`);
  lines.push(
    `- **Engine2 ran**: ${report.engine2Ran ? "true" : "false"}` +
      (report.engine2Ran ? "" : ` — _skipped_`),
  );
  if (!report.engine2Ran && report.skippedReason) {
    lines.push(`- **Skipped reason**: ${report.skippedReason}`);
  }
  lines.push("");

  lines.push(`## Provenance`);
  lines.push("");
  lines.push(`- effectiveMode: \`${report.provenance.effectiveMode}\``);
  lines.push(`- engineUsed: \`${report.provenance.engineUsed}\``);
  lines.push(`- gateDecision: \`${report.provenance.gateDecision}\``);
  lines.push(`- scheduleEligible: ${report.provenance.scheduleEligible}`);
  lines.push(`- legacyAuthoritative: true`);
  lines.push("");

  lines.push(`## Eligibility`);
  lines.push("");
  lines.push(`- **Blockers**: ${fmtIdList(report.eligibilityBlockers)}`);
  lines.push(`- **Warnings**: ${fmtIdList(report.eligibilityWarnings)}`);
  lines.push("");

  // Even when skipped, render the project-finish + activity sections so
  // operators see the legacy values rather than a blank report.
  lines.push(`## Project Finish`);
  lines.push("");
  lines.push(`### Raw (no normalization)`);
  lines.push("");
  lines.push(`| | Legacy | Engine2 | Δ days | Match |`);
  lines.push(`|---|---|---|---|---|`);
  lines.push(
    `| finish | ${fmtIso(report.projectFinish.legacy)} | ${fmtIso(
      report.projectFinish.engine2,
    )} | ${report.projectFinish.deltaDays} | ${report.projectFinish.match} |`,
  );
  lines.push("");
  lines.push(`### Normalized (finish-convention adjusted, reporting only)`);
  lines.push("");
  lines.push(`| | Legacy | Engine2 (normalized) | Δ days | Match |`);
  lines.push(`|---|---|---|---|---|`);
  lines.push(
    `| finish | ${fmtIso(report.projectFinish.legacy)} | ${fmtIso(
      report.normalizedProjectFinish.engine2Normalized,
    )} | ${report.normalizedProjectFinish.deltaDays} | ${report.normalizedProjectFinish.match} |`,
  );
  lines.push("");

  lines.push(`## Activity Comparison`);
  lines.push("");
  lines.push(`| View | Matching | Differing | Max date Δ (d) | Max float Δ (d) |`);
  lines.push(`|---|---|---|---|---|`);
  lines.push(
    `| Raw | ${report.matchingCount} | ${report.differingCount} | ${report.maxDateDeltaDays} | ${report.maxFloatDeltaDays} |`,
  );
  lines.push(
    `| Convention-adjusted | ${report.conventionAdjustedMatchingCount} | ${report.conventionAdjustedDifferingCount} | ${report.maxNormalizedDateDeltaDays} | ${report.maxFloatDeltaDays} |`,
  );
  lines.push("");

  lines.push(`## Convention-only Mismatches`);
  lines.push("");
  lines.push(
    `Activity IDs whose only divergence is the finish-rendering convention (legacy exclusive-end vs engine2 inclusive last-work-moment). These are NOT considered true CPM divergences but ARE included in the raw counts above.`,
  );
  lines.push("");
  lines.push(`- earlyFinish: ${fmtIdList(report.conventionMismatchIds.earlyFinish)}`);
  lines.push(`- lateFinish: ${fmtIdList(report.conventionMismatchIds.lateFinish)}`);
  lines.push("");

  lines.push(`## True Date Mismatches`);
  lines.push("");
  lines.push(
    `Activity IDs whose divergence survives finish-convention normalization. These represent real disagreement between the two engines and are the only date mismatches that block engine2 from ever becoming candidate-authoritative.`,
  );
  lines.push("");
  lines.push(`- earlyStart: ${fmtIdList(report.trueDateMismatchIds.earlyStart)}`);
  lines.push(`- earlyFinish: ${fmtIdList(report.trueDateMismatchIds.earlyFinish)}`);
  lines.push(`- lateStart: ${fmtIdList(report.trueDateMismatchIds.lateStart)}`);
  lines.push(`- lateFinish: ${fmtIdList(report.trueDateMismatchIds.lateFinish)}`);
  lines.push("");

  lines.push(`## Differing Activity IDs (raw, all dimensions)`);
  lines.push("");
  lines.push(fmtIdList(report.differingIds));
  lines.push("");

  lines.push(`## Engine2 Diagnostics`);
  lines.push("");
  lines.push(`- diagnosticsCount: ${report.engine2DiagnosticsCount}`);
  if (report.engine2Error) {
    lines.push(`- **engine2 error**: ${report.engine2Error}`);
  }
  lines.push("");

  lines.push(`---`);
  lines.push("");
  lines.push(
    `_Legacy \`calculateSchedule\` remains the sole authoritative engine in production. ` +
      `A normalized match here does NOT mean engine2 is production-ready — it means raw ` +
      `differences are explained by the documented finish-rendering convention (see ARCHITECTURE.md §38/§39). ` +
      `Only when \`trueDateMismatchIds\` is consistently empty across a broad corpus of real ` +
      `persisted schedules can engine2 be considered for candidate-authoritative rollout._`,
  );

  return lines.join("\n");
}
