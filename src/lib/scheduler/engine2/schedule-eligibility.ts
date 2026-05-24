/**
 * Phase 3.1 — Engine Selector Safety Audit.
 *
 * Per-schedule eligibility check that runs BEFORE the boring-bar gate.
 * The boring-bar (Phase 2.9) judges the evidence log across many runs;
 * this check judges THIS schedule's shape, because some schedule features
 * are known to be unsupported (or only partially supported) by engine2's
 * current bridge.
 *
 * If a schedule contains any blocker feature, the selector must NOT pick
 * `engine2-internal` as the authoritative engine — even with
 * `forcePastReadinessGate`. Comparison mode is still allowed (engine2
 * runs alongside legacy, never overwrites the public payload).
 *
 * This module is a pure projection over `Schedule`. It never mutates the
 * schedule, the legacy result, or any feature flag. It never throws.
 *
 * See ARCHITECTURE.md §31.
 */

import type { Schedule } from "../types";
import {
  getCapabilityMetadata,
  projectCapabilityEligibility,
  type CapabilityFlagId,
} from "./capability-metadata";

export type EligibilityCheckId =
  | "no-tasks"
  | "in-progress-activities"
  | "completed-with-actuals-not-bridged"
  | "per-activity-calendars"
  | "multiple-named-calendars"
  | "non-standard-workweek-with-holidays"
  | "resource-loaded-activities"
  | "leveling-required"
  | "unsupported-constraints"
  | "external-relationships"
  | "baseline-required"
  | "unsupported-percent-type"
  | "unsupported-duration-type"
  | "unsupported-xer-semantics";

export interface EligibilityCheck {
  id: EligibilityCheckId;
  /** Human-readable requirement (what passing looks like). */
  description: string;
  /** True when this schedule passes the check. */
  pass: boolean;
  /** "blocker" = forces engine2 fallback. "warning" = informational only. */
  severity: "blocker" | "warning";
  detail?: string;
  /**
   * Phase 3.7 — short sentence describing why the check FAILED. Pushed
   * into `blockers`/`warnings` instead of the requirement text so the
   * reason matches the actual failure (e.g. "Schedule has no tasks."
   * not "Schedule has at least one task.").
   */
  failureMessage?: string;
}

export interface ScheduleEligibility {
  /** True when no blocker checks failed. Warnings do not flip this. */
  eligible: boolean;
  checks: EligibilityCheck[];
  blockers: string[];
  warnings: string[];
}

const EMPTY = (): ScheduleEligibility => ({
  eligible: true,
  checks: [],
  blockers: [],
  warnings: [],
});

/**
 * Inspect a Schedule and report which engine2-unsupported features it
 * carries. Deterministic and side-effect-free.
 *
 * Default policy (Phase 3.1):
 *   - In-progress activities (0 < percentComplete < 100) → BLOCKER. Engine2
 *     consumes actualStart/actualFinish, not legacy percent-complete; the
 *     bridge has not yet projected progress into actuals.
 *   - Completed activities (percentComplete === 100) without a bridged
 *     actualFinish → BLOCKER (same reason).
 *   - Tasks assigned a calendarId that is not the default → BLOCKER.
 *     Per-activity calendar math is partial-only in engine2 today.
 *   - More than one NamedCalendar defined on the schedule → BLOCKER, even
 *     if no task references the non-default ones, because importers may
 *     route through them implicitly.
 *   - Non-standard workweek (workDays !== 31) combined with holidays →
 *     WARNING. Calendar parity is fragile on irregular weeks.
 *   - Resource-loaded activities (resourceName or resourceUnitsPerDay) →
 *     WARNING. Engine2 leveling exists but is not validated against
 *     legacy, which does not level. Surfaces as expected differences,
 *     not authoritative engine selection.
 *   - Zero tasks → BLOCKER. Nothing to compute.
 *
 * Items in the user-facing audit list that the current `Schedule` shape
 * cannot express (unsupported constraint types beyond SNET, unsupported
 * percent-complete types, unsupported duration types, leveling
 * requirements, external/interproject relationships, baselines,
 * unsupported XER semantics) are stubbed as PASSING checks here so the
 * surface area is explicit. Importers that detect these features should
 * inject equivalent blockers via the bridge in a later phase.
 */
export function evaluateScheduleEligibility(
  schedule: Schedule | undefined | null,
): ScheduleEligibility {
  const out = EMPTY();
  if (!schedule) {
    out.checks.push({
      id: "no-tasks",
      description: "Schedule must exist.",
      pass: false,
      severity: "blocker",
      detail: "schedule is null/undefined",
    });
    out.eligible = false;
    out.blockers.push("Schedule is null or undefined.");
    return out;
  }

  const tasks = Array.isArray(schedule.tasks) ? schedule.tasks : [];

  // 1. no-tasks
  push(out, {
    id: "no-tasks",
    description: "Schedule has at least one task.",
    failureMessage: "Schedule has no tasks.",
    pass: tasks.length > 0,
    severity: "blocker",
    detail: tasks.length === 0 ? "0 tasks" : undefined,
  });

  // 2. in-progress activities
  const inProgress = tasks.filter(
    (t) =>
      typeof t.percentComplete === "number" &&
      t.percentComplete > 0 &&
      t.percentComplete < 100,
  );
  push(out, {
    id: "in-progress-activities",
    description:
      "No in-progress activities (engine2 has no percent-complete → actuals bridge yet).",
    failureMessage:
      "Schedule has in-progress activities — engine2 has no percent-complete → actuals bridge yet.",
    pass: inProgress.length === 0,
    severity: "blocker",
    detail:
      inProgress.length === 0
        ? undefined
        : `${inProgress.length} in-progress activit(y/ies)`,
  });

  // 3. completed activities without bridged actuals
  const completed = tasks.filter(
    (t) => typeof t.percentComplete === "number" && t.percentComplete === 100,
  );
  push(out, {
    id: "completed-with-actuals-not-bridged",
    description:
      "No completed activities without bridged actualStart/actualFinish.",
    failureMessage:
      "Schedule has completed activities without bridged actualStart/actualFinish.",
    pass: completed.length === 0,
    severity: "blocker",
    detail:
      completed.length === 0
        ? undefined
        : `${completed.length} completed activit(y/ies) without bridged actuals`,
  });

  // 4. per-activity calendars
  const calendars = Array.isArray(schedule.calendars) ? schedule.calendars : [];
  const defaultCalendarId = calendars.find((c) => c.isDefault)?.id;
  const taskCalendarIds = new Set(
    tasks
      .map((t) => t.calendarId)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  const nonDefaultRefs = [...taskCalendarIds].filter(
    (id) => id !== defaultCalendarId,
  );
  push(out, {
    id: "per-activity-calendars",
    description: "No tasks reference a non-default calendar.",
    failureMessage:
      "Schedule has tasks referencing a non-default calendar (per-activity calendar math is partial in engine2).",
    pass: nonDefaultRefs.length === 0,
    severity: "blocker",
    detail:
      nonDefaultRefs.length === 0
        ? undefined
        : `${nonDefaultRefs.length} non-default calendar id(s) in use`,
  });

  // 5. multiple named calendars defined
  push(out, {
    id: "multiple-named-calendars",
    description: "At most one named calendar is defined.",
    failureMessage:
      "Schedule defines more than one named calendar (importers may implicitly route through them).",
    pass: calendars.length <= 1,
    severity: "blocker",
    detail:
      calendars.length <= 1
        ? undefined
        : `${calendars.length} named calendars defined`,
  });

  // 6. non-standard workweek + holidays (warning)
  const projectCal = schedule.calendar;
  const nonStandardWeek =
    !!projectCal && typeof projectCal.workDays === "number" && projectCal.workDays !== 31;
  const hasHolidays =
    !!projectCal && Array.isArray(projectCal.holidays) && projectCal.holidays.length > 0;
  push(out, {
    id: "non-standard-workweek-with-holidays",
    description:
      "Standard Mon–Fri workweek OR no holidays (irregular weeks are fragile).",
    failureMessage:
      "Non-standard workweek combined with holidays (calendar parity is fragile on irregular weeks).",
    pass: !(nonStandardWeek && hasHolidays),
    severity: "warning",
    detail:
      nonStandardWeek && hasHolidays
        ? `workDays=${projectCal!.workDays}, holidays=${projectCal!.holidays.length}`
        : undefined,
  });

  // 7. resource-loaded activities (warning)
  const resourced = tasks.filter(
    (t) =>
      (typeof t.resourceName === "string" && t.resourceName.length > 0) ||
      typeof t.resourceUnitsPerDay === "number",
  );
  push(out, {
    id: "resource-loaded-activities",
    description:
      "No resource-loaded activities (legacy does not level; engine2 may diverge).",
    failureMessage:
      "Schedule has resource-loaded activities (legacy does not level; engine2 may diverge).",
    pass: resourced.length === 0,
    severity: "warning",
    detail:
      resourced.length === 0
        ? undefined
        : `${resourced.length} resource-loaded activit(y/ies)`,
  });

  // 8–14. Importer-owned feature checks (Phase 3.2).
  //
  // Replace the prior stubbed PASSING checks with real verdicts derived
  // from `schedule.engine2Capabilities`. Schedules without metadata fall
  // back to `defaultCapabilityMetadata()` (every flag PASS) so in-app
  // authored schedules behave exactly as before.
  //
  // Mapping: capability flag id → eligibility check id.
  const CAPABILITY_TO_CHECK: Record<CapabilityFlagId, EligibilityCheckId> = {
    "external-relationships": "external-relationships",
    "interproject-relationships": "external-relationships",
    "unsupported-constraints": "unsupported-constraints",
    "unsupported-percent-type": "unsupported-percent-type",
    "unsupported-duration-type": "unsupported-duration-type",
    "resource-loaded-imported": "leveling-required",
    "leveling-required": "leveling-required",
    "unknown-xer-semantics": "unsupported-xer-semantics",
    "baseline-assumed": "baseline-required",
    "calendar-shifts": "unsupported-xer-semantics",
  };

  const findings = projectCapabilityEligibility(getCapabilityMetadata(schedule));
  // Group by mapped eligibility check id so multiple capability flags can
  // contribute to the same audit row deterministically.
  const grouped = new Map<EligibilityCheckId, typeof findings>();
  for (const f of findings) {
    const checkId = CAPABILITY_TO_CHECK[f.flagId];
    const arr = grouped.get(checkId) ?? [];
    arr.push(f);
    grouped.set(checkId, arr);
  }
  for (const [checkId, group] of grouped) {
    // Conservative merge: any block → fail-blocker, else any unknown →
    // fail-blocker (unknown is treated as blocker per Phase 3.2 policy),
    // else pass.
    const verdict = group.some((g) => g.verdict === "block")
      ? "block"
      : group.some((g) => g.verdict === "unknown")
        ? "unknown"
        : "pass";
    const pass = verdict === "pass";
    const detailParts = group
      .filter((g) => g.detail)
      .map((g) => `${g.flagId}:${g.verdict} ${g.detail ?? ""}`.trim());
    push(out, {
      id: checkId,
      description:
        verdict === "unknown"
          ? `${checkId} — UNKNOWN per importer; conservatively blocking.`
          : `${checkId} — importer-owned verdict.`,
      pass,
      severity: "blocker",
      detail: pass
        ? undefined
        : detailParts.length > 0
          ? detailParts.join(" | ")
          : verdict,
    });
  }

  out.eligible = out.blockers.length === 0;
  return out;
}

function push(out: ScheduleEligibility, c: EligibilityCheck): void {
  out.checks.push(c);
  if (c.pass) return;
  if (c.severity === "blocker") out.blockers.push(c.description);
  else out.warnings.push(c.description);
}

/** Deterministic text projection for debug drawers / PRs. */
export function formatScheduleEligibility(e: ScheduleEligibility): string {
  const lines: string[] = [];
  lines.push(`schedule eligibility: ${e.eligible ? "ELIGIBLE" : "BLOCKED"}`);
  lines.push(`blockers=${e.blockers.length} warnings=${e.warnings.length}`);
  for (const c of e.checks) {
    lines.push(
      `  ${c.pass ? "PASS" : "FAIL"} [${c.severity}] ${c.id} — ${c.description}${c.detail ? ` (${c.detail})` : ""}`,
    );
  }
  return lines.join("\n");
}
