/**
 * engine2 — Phase 1.5 resource/assignment math helpers.
 *
 * Pure, deterministic functions over `ResourceAssignment[]`. They do NOT
 * mutate inputs and do NOT consult calendars (Phase 1.5 leaves activity
 * calendar in charge of CPM dates; resource calendars are stored but
 * deferred — see ARCHITECTURE.md §15).
 *
 * What lives here:
 *   - per-assignment at-completion / remaining derivation
 *   - per-activity rollup (units + cost)
 *   - units percent-complete derivation
 *   - shallow consistency check (no negative units, no actual > budget when
 *     remaining is 0, etc.) returning diagnostic-shaped messages
 *
 * What does NOT live here:
 *   - leveling, resource-calendar-driven date math, rate-book pricing,
 *     curve spreading, manual future-period reconciliation.
 */

import type {
  ActivityAssignmentSummary,
  EngineDiagnostic,
  Resource,
  ResourceAssignment,
} from "./types";

/** at-completion units for a single assignment. */
export function assignmentAtCompletionUnits(a: ResourceAssignment): number {
  return safeNum(a.actualUnits) + safeNum(a.remainingUnits);
}

/**
 * Deterministic remaining units. If `remainingUnits` is finite & >= 0 we
 * trust the authored value; otherwise we fall back to `budgeted - actual`
 * clamped at 0.
 */
export function assignmentRemainingUnits(a: ResourceAssignment): number {
  const rem = a.remainingUnits;
  if (Number.isFinite(rem) && rem >= 0) return rem;
  return Math.max(0, safeNum(a.budgetedUnits) - safeNum(a.actualUnits));
}

/** Units % complete for a single assignment. 0 when at-completion <= 0. */
export function assignmentUnitsPercentComplete(a: ResourceAssignment): number {
  const ac = assignmentAtCompletionUnits(a);
  if (ac <= 0) return 0;
  const pct = (safeNum(a.actualUnits) / ac) * 100;
  return clampPct(pct);
}

/** at-completion cost for a single assignment (uses authored cost fields). */
export function assignmentAtCompletionCost(a: ResourceAssignment): number {
  return safeNum(a.actualCost) + safeNum(a.remainingCost);
}

/**
 * Roll up a set of assignments belonging to one activity. Returns `undefined`
 * when the activity has no assignments — engine should emit the
 * `units_percent_without_assignments` diagnostic in that case if the
 * activity declared `percentCompleteType === "units"`.
 */
export function rollupActivityAssignments(
  activityId: string,
  assignments: ResourceAssignment[],
): ActivityAssignmentSummary | undefined {
  if (assignments.length === 0) return undefined;

  let budgetedUnits = 0;
  let actualUnits = 0;
  let remainingUnits = 0;
  let budgetedCost = 0;
  let actualCost = 0;
  let remainingCost = 0;

  for (const a of assignments) {
    budgetedUnits += safeNum(a.budgetedUnits);
    actualUnits += safeNum(a.actualUnits);
    remainingUnits += assignmentRemainingUnits(a);
    budgetedCost += safeNum(a.budgetedCost);
    actualCost += safeNum(a.actualCost);
    remainingCost += safeNum(a.remainingCost);
  }

  const atCompletionUnits = actualUnits + remainingUnits;
  const atCompletionCost = actualCost + remainingCost;
  const unitsPercentComplete =
    atCompletionUnits > 0 ? clampPct((actualUnits / atCompletionUnits) * 100) : 0;

  return {
    activityId,
    assignmentCount: assignments.length,
    budgetedUnits,
    actualUnits,
    remainingUnits,
    atCompletionUnits,
    unitsPercentComplete,
    budgetedCost,
    actualCost,
    remainingCost,
    atCompletionCost,
  };
}

/**
 * Phase 1.5 assignment consistency check. Returns diagnostic-shaped records;
 * the caller decides whether to push them onto the engine result.
 *
 * Codes emitted:
 *   - assignment_units_inconsistent
 *   - missing_resource
 *   - missing_resource_calendar
 *   - resource_calendar_deferred  (informational reminder)
 */
export function validateAssignments(args: {
  assignments: ResourceAssignment[];
  resources: Map<string, Resource>;
  calendars: Map<string, unknown>;
}): EngineDiagnostic[] {
  const out: EngineDiagnostic[] = [];
  const { assignments, resources, calendars } = args;
  let deferredEmitted = false;

  for (const a of assignments) {
    // Units sanity.
    const negs: string[] = [];
    if (safeNum(a.budgetedUnits) < 0) negs.push("budgeted");
    if (safeNum(a.actualUnits) < 0) negs.push("actual");
    if (safeNum(a.remainingUnits) < 0) negs.push("remaining");
    if (negs.length > 0) {
      out.push({
        severity: "warn",
        code: "assignment_units_inconsistent",
        message: `Assignment "${a.id}" has negative ${negs.join("/")} units`,
        activityId: a.activityId,
      });
    }

    const ac = assignmentAtCompletionUnits(a);
    if (ac > 0 && safeNum(a.actualUnits) > ac + 1e-9) {
      out.push({
        severity: "warn",
        code: "assignment_units_inconsistent",
        message: `Assignment "${a.id}" actual units (${a.actualUnits}) exceed at-completion (${ac})`,
        activityId: a.activityId,
      });
    }

    // Resource lookup.
    const res = resources.get(a.resourceId);
    if (!res) {
      out.push({
        severity: "warn",
        code: "missing_resource",
        message: `Assignment "${a.id}" references unknown resource "${a.resourceId}"`,
        activityId: a.activityId,
      });
      continue;
    }

    // Resource calendar wiring.
    if (res.calendarId) {
      if (!calendars.has(res.calendarId)) {
        out.push({
          severity: "warn",
          code: "missing_resource_calendar",
          message: `Resource "${res.id}" references unknown calendar "${res.calendarId}"`,
          activityId: a.activityId,
        });
      } else if (!deferredEmitted) {
        out.push({
          severity: "info",
          code: "resource_calendar_deferred",
          message:
            "Resource calendars are validated but do not yet drive CPM dates (Phase 1.5 — activity calendar governs).",
        });
        deferredEmitted = true;
      }
    }
  }

  return out;
}

function safeNum(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}
