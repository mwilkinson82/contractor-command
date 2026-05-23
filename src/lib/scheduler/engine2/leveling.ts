/**
 * engine2 — Phase 1.6 deterministic resource leveling foundation.
 *
 * This is a NARROW, AUDITABLE leveling pass. It is not P6 parity.
 *
 * Algorithm (whole-day granularity):
 *   1. Snap each non-completed activity's working interval to a set of
 *      UTC workdays under its own calendar. Per assignment, daily demand
 *      = atCompletionUnits / numWorkdays (uniform spread). Completed and
 *      in-progress activities are pinned to their CPM dates and consume
 *      capacity but are never moved.
 *   2. Compute pre-leveling overallocations for every considered resource
 *      (any resource in `selectedResourceIds`, or every resource with a
 *      finite `maxUnitsPerDay` if no selection given).
 *   3. Sort eligible (not-pinned) activities by:
 *        levelingPriority asc (undefined → +∞ → leveled last),
 *        CPM earlyStart asc,
 *        id asc.
 *   4. Place activities in that order. For each, try to keep at its CPM
 *      earlyStart; if placing it would exceed capacity on any considered
 *      resource's workday, push the activity forward by one workday under
 *      its own calendar and retry. Up to `maxDelayWorkdays`.
 *   5. Emit a `LevelingEntry` for every activity (move or no-move) that
 *      participates in a considered resource; record post-leveling
 *      overallocations and warnings.
 *
 * Deferred / NOT done in Phase 1.6 (documented as warnings in the result):
 *   - Successor re-flow. Moving an activity does not re-drive its
 *     successors' CPM dates. Callers that need post-leveling logic must
 *     re-run CPM with leveled dates as constraints. Logged as
 *     `leveling_successors_not_reflowed`.
 *   - Preserve-scheduled-early-and-late-dates option is parsed and echoed
 *     but does not block moves yet. Logged as
 *     `leveling_preserve_dates_deferred`.
 *   - Shift/hour-level granularity. Logged as `leveling_whole_day_only`.
 *   - Resource calendars do not drive demand windows. Activity calendar
 *     governs (matches Phase 1.5).
 */

import type {
  EngineActivity,
  EngineActivityResult,
  EngineDiagnostic,
  EngineResult,
  Instant,
  LevelingAnalysis,
  LevelingEntry,
  LevelingOptions,
  Resource,
  ResourceAssignment,
  ResourceDayDemand,
  ResourceOverallocation,
} from "./types";
import { MS_PER_DAY, MS_PER_MIN, type WorkClock } from "./work-clock";

export interface LevelingInput {
  options: LevelingOptions;
  /** CPM result to level on top of (read-only). */
  cpm: EngineResult;
  activities: EngineActivity[];
  calendars: Map<string, WorkClock>;
  resources: Resource[];
  assignments: ResourceAssignment[];
  dataDate: Instant;
}

interface Placement {
  activityId: string;
  start: Instant;
  finish: Instant;
  /** Working minutes pushed past CPM earlyStart, under activity calendar. */
  delayMinutes: number;
  pinned: boolean;
  /** Per-resource daily demand contributed by this activity. */
  perResource: Map<string, Map<number, number>>;
}

export function levelResources(input: LevelingInput): LevelingAnalysis {
  const { options, cpm, activities, calendars, resources, assignments } = input;
  const warnings: EngineDiagnostic[] = [];

  // ---- Option normalization ----
  const maxDelayWorkdays = options.maxDelayWorkdays ?? 365;
  const preserveDates = !!options.preserveScheduledEarlyAndLateDates;
  if (preserveDates) {
    warnings.push({
      severity: "warn",
      code: "leveling_preserve_dates_deferred",
      message:
        "preserveScheduledEarlyAndLateDates is recognized but not enforced in Phase 1.6; leveling proceeded without the float ceiling.",
    });
  }
  warnings.push({
    severity: "info",
    code: "leveling_whole_day_only",
    message: "Phase 1.6 leveling uses whole-day capacity granularity; shift/hour leveling is deferred.",
  });
  warnings.push({
    severity: "info",
    code: "leveling_successors_not_reflowed",
    message:
      "Phase 1.6 leveling does not re-drive CPM dates for successors of moved activities; rerun CPM with leveled dates as constraints if needed.",
  });

  // ---- Considered resources ----
  const resourceMap = new Map<string, Resource>(resources.map((r) => [r.id, r]));
  let consideredIds: string[];
  if (options.selectedResourceIds && options.selectedResourceIds.length > 0) {
    consideredIds = options.selectedResourceIds.filter((id) => resourceMap.has(id));
  } else {
    consideredIds = resources
      .filter((r) => Number.isFinite(r.maxUnitsPerDay))
      .map((r) => r.id);
  }
  if (consideredIds.length === 0) {
    warnings.push({
      severity: "warn",
      code: "leveling_no_capacity_defined",
      message:
        "No resources had a finite maxUnitsPerDay (or selected set was empty); leveling pass produced no moves.",
    });
  }
  const consideredSet = new Set(consideredIds);

  // ---- Map activities + assignments ----
  const actMap = new Map(activities.map((a) => [a.id, a]));
  const cpmById = new Map(cpm.activities.map((a) => [a.id, a]));
  const assignmentsByActivity = new Map<string, ResourceAssignment[]>();
  for (const asn of assignments) {
    if (!actMap.has(asn.activityId)) continue;
    const list = assignmentsByActivity.get(asn.activityId) ?? [];
    list.push(asn);
    assignmentsByActivity.set(asn.activityId, list);
  }

  // ---- Per-activity demand fingerprint at a tentative start ----
  function getCal(id: string): WorkClock {
    const c = calendars.get(id);
    if (!c) throw new Error(`leveling: unknown calendar "${id}"`);
    return c;
  }

  function workdaysCovered(
    cal: WorkClock,
    start: Instant,
    finish: Instant,
  ): Instant[] {
    // Return distinct UTC day-start instants for every workday touched by
    // [start, finish). Zero-duration → empty (milestones don't consume).
    if (finish <= start) return [];
    const out: Instant[] = [];
    let cur = cal.nextWorkInstant(start);
    let guard = 0;
    while (cur < finish && guard++ < 4 * 365) {
      const ds = Math.floor(cur / MS_PER_DAY) * MS_PER_DAY;
      out.push(ds);
      // Jump to next day's start.
      cur = cal.nextWorkInstant(ds + MS_PER_DAY);
    }
    return out;
  }

  function demandFor(
    act: EngineActivity,
    tentativeStart: Instant,
    tentativeFinish: Instant,
  ): Map<string, Map<number, number>> {
    const cal = getCal(act.calendarId);
    const days = workdaysCovered(cal, tentativeStart, tentativeFinish);
    const out = new Map<string, Map<number, number>>();
    const asns = assignmentsByActivity.get(act.id) ?? [];
    if (asns.length === 0 || days.length === 0) return out;
    for (const asn of asns) {
      const ac = safeNum(asn.actualUnits) + safeNum(asn.remainingUnits);
      if (ac <= 0) continue;
      const perDay = ac / days.length;
      const inner = out.get(asn.resourceId) ?? new Map<number, number>();
      for (const ds of days) {
        inner.set(ds, (inner.get(ds) ?? 0) + perDay);
      }
      out.set(asn.resourceId, inner);
    }
    return out;
  }

  // ---- Build placements ----
  const placements = new Map<string, Placement>();

  // Pin completed + in-progress activities at their CPM dates first.
  for (const a of activities) {
    const cpmRes = cpmById.get(a.id);
    if (!cpmRes) continue;
    if (cpmRes.status === "completed" || cpmRes.status === "in-progress") {
      const start = cpmRes.earlyStart;
      const finish = cpmRes.earlyFinish;
      placements.set(a.id, {
        activityId: a.id,
        start,
        finish,
        delayMinutes: 0,
        pinned: true,
        perResource: demandFor(a, start, finish),
      });
    }
  }

  // Sort the eligible (movable) activities.
  const eligible = activities.filter((a) => !placements.has(a.id));
  eligible.sort((a, b) => {
    const pa = a.levelingPriority ?? Number.POSITIVE_INFINITY;
    const pb = b.levelingPriority ?? Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb;
    const ea = cpmById.get(a.id)?.earlyStart ?? 0;
    const eb = cpmById.get(b.id)?.earlyStart ?? 0;
    if (ea !== eb) return ea - eb;
    return a.id.localeCompare(b.id);
  });

  // Running ledger of committed demand per considered resource.
  const ledger = new Map<string, Map<number, number>>();
  for (const id of consideredIds) ledger.set(id, new Map());
  // Seed the ledger with pinned activities' demand.
  for (const p of placements.values()) {
    for (const [resId, byDay] of p.perResource) {
      if (!consideredSet.has(resId)) continue;
      const slot = ledger.get(resId)!;
      for (const [ds, d] of byDay) {
        slot.set(ds, (slot.get(ds) ?? 0) + d);
      }
    }
  }

  function placementFits(
    perResource: Map<string, Map<number, number>>,
  ): { ok: true } | { ok: false; resourceIds: string[] } {
    const offenders = new Set<string>();
    for (const [resId, byDay] of perResource) {
      if (!consideredSet.has(resId)) continue;
      const res = resourceMap.get(resId)!;
      const cap = Number.isFinite(res.maxUnitsPerDay) ? (res.maxUnitsPerDay as number) : Number.POSITIVE_INFINITY;
      const slot = ledger.get(resId)!;
      for (const [ds, d] of byDay) {
        const cur = slot.get(ds) ?? 0;
        if (cur + d > cap + 1e-9) {
          offenders.add(resId);
          break;
        }
      }
    }
    return offenders.size === 0
      ? { ok: true }
      : { ok: false, resourceIds: [...offenders] };
  }

  for (const a of eligible) {
    const cpmRes = cpmById.get(a.id);
    if (!cpmRes) continue;
    const cal = getCal(a.calendarId);
    const durMinutes = Math.max(0, cpmRes.atCompletionDurationMinutes);
    let start = cpmRes.earlyStart;
    let finish = durMinutes === 0 ? start : cal.addWork(start, durMinutes);
    let delaySteps = 0;
    let causingResources: string[] = [];

    // Skip activities with no demand on considered resources — no leveling work.
    const initialDemand = demandFor(a, start, finish);
    let touchesConsidered = false;
    for (const resId of initialDemand.keys()) {
      if (consideredSet.has(resId)) {
        touchesConsidered = true;
        break;
      }
    }
    if (!touchesConsidered) {
      placements.set(a.id, {
        activityId: a.id,
        start,
        finish,
        delayMinutes: 0,
        pinned: false,
        perResource: initialDemand,
      });
      continue;
    }

    let demand = initialDemand;
    while (delaySteps <= maxDelayWorkdays) {
      const fit = placementFits(demand);
      if (fit.ok) break;
      causingResources = fit.resourceIds;
      // Push by one workday: jump start to the day AFTER current start's workday.
      const ds = Math.floor(start / MS_PER_DAY) * MS_PER_DAY;
      const nextStart = cal.nextWorkInstant(ds + MS_PER_DAY);
      start = nextStart;
      finish = durMinutes === 0 ? start : cal.addWork(start, durMinutes);
      demand = demandFor(a, start, finish);
      delaySteps++;
    }

    if (delaySteps > maxDelayWorkdays) {
      warnings.push({
        severity: "warn",
        code: "leveling_max_delay_reached",
        message: `Activity "${a.id}" hit maxDelayWorkdays=${maxDelayWorkdays} without resolving overallocation on ${causingResources.join(", ")}`,
        activityId: a.id,
      });
    }

    // Commit demand to ledger.
    for (const [resId, byDay] of demand) {
      if (!consideredSet.has(resId)) continue;
      const slot = ledger.get(resId)!;
      for (const [ds, d] of byDay) {
        slot.set(ds, (slot.get(ds) ?? 0) + d);
      }
    }
    placements.set(a.id, {
      activityId: a.id,
      start,
      finish,
      delayMinutes:
        start === cpmRes.earlyStart ? 0 : cal.diffWork(cpmRes.earlyStart, start),
      pinned: false,
      perResource: demand,
    });

    if (start !== cpmRes.earlyStart) {
      // We'll create the LevelingEntry below; remember which resources caused it.
      (placements.get(a.id)! as Placement & { _cause?: string[] })._cause = causingResources;
    }
  }

  // ---- Build entries ----
  const entries: LevelingEntry[] = [];
  for (const a of activities) {
    const p = placements.get(a.id);
    const cpmRes = cpmById.get(a.id);
    if (!p || !cpmRes) continue;
    if (p.pinned) continue;
    // Only include activities whose demand touches a considered resource.
    let touches = false;
    for (const resId of p.perResource.keys()) {
      if (consideredSet.has(resId)) {
        touches = true;
        break;
      }
    }
    if (!touches) continue;
    const cause = (p as Placement & { _cause?: string[] })._cause ?? [];
    const priorityReason = buildPriorityReason(a, cause, p.delayMinutes);
    entries.push({
      activityId: a.id,
      cpmEarlyStart: cpmRes.earlyStart,
      cpmEarlyFinish: cpmRes.earlyFinish,
      leveledStart: p.start,
      leveledFinish: p.finish,
      delayMinutes: p.delayMinutes,
      resourcesCausingConflict: cause,
      priorityReason,
    });
  }

  // ---- Build overallocation reports ----
  const before = buildOverallocations({
    consideredIds,
    resourceMap,
    activities,
    cpmById,
    assignmentsByActivity,
    demandFor,
    usePlacements: null,
  });
  const after = buildOverallocations({
    consideredIds,
    resourceMap,
    activities,
    cpmById,
    assignmentsByActivity,
    demandFor,
    usePlacements: placements,
  });

  return {
    options: {
      enabled: true,
      preserveScheduledEarlyAndLateDates: preserveDates,
      maxDelayWorkdays,
      selectedResourceIds: options.selectedResourceIds ?? [],
    },
    consideredResourceIds: consideredIds,
    overallocationsBefore: before,
    overallocationsAfter: after,
    entries,
    warnings,
  };
}

function buildPriorityReason(
  a: EngineActivity,
  causing: string[],
  delayMinutes: number,
): string {
  const prio =
    a.levelingPriority === undefined
      ? "no priority (lowest)"
      : `priority=${a.levelingPriority}`;
  if (delayMinutes === 0) {
    return `Placed at CPM early start (${prio}); no resource conflict.`;
  }
  return `Delayed ${delayMinutes}m (${prio}) to resolve capacity on: ${causing.join(", ")}.`;
}

function buildOverallocations(args: {
  consideredIds: string[];
  resourceMap: Map<string, Resource>;
  activities: EngineActivity[];
  cpmById: Map<string, EngineActivityResult>;
  assignmentsByActivity: Map<string, ResourceAssignment[]>;
  demandFor: (
    a: EngineActivity,
    start: Instant,
    finish: Instant,
  ) => Map<string, Map<number, number>>;
  usePlacements: Map<string, Placement> | null;
}): ResourceOverallocation[] {
  const out: ResourceOverallocation[] = [];
  for (const resId of args.consideredIds) {
    const res = args.resourceMap.get(resId)!;
    const cap = Number.isFinite(res.maxUnitsPerDay)
      ? (res.maxUnitsPerDay as number)
      : Number.POSITIVE_INFINITY;
    const dayTotals = new Map<number, { total: number; ids: string[] }>();

    for (const a of args.activities) {
      const cpmRes = args.cpmById.get(a.id);
      if (!cpmRes) continue;
      let start = cpmRes.earlyStart;
      let finish = cpmRes.earlyFinish;
      if (args.usePlacements) {
        const p = args.usePlacements.get(a.id);
        if (p) {
          start = p.start;
          finish = p.finish;
        }
      }
      const demand = args.demandFor(a, start, finish);
      const byDay = demand.get(resId);
      if (!byDay) continue;
      for (const [ds, d] of byDay) {
        const slot = dayTotals.get(ds) ?? { total: 0, ids: [] };
        slot.total += d;
        slot.ids.push(a.id);
        dayTotals.set(ds, slot);
      }
    }

    const days: ResourceDayDemand[] = [];
    for (const [ds, slot] of [...dayTotals.entries()].sort((a, b) => a[0] - b[0])) {
      const over = slot.total - cap;
      if (over > 1e-9) {
        days.push({
          dayStart: ds,
          totalUnits: round6(slot.total),
          overUnits: round6(over),
          activityIds: slot.ids,
        });
      }
    }
    if (days.length > 0) {
      out.push({ resourceId: resId, capacityPerDay: cap, days });
    }
  }
  return out;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function safeNum(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

// Keep MS_PER_MIN referenced for downstream consumers expecting the export shape.
void MS_PER_MIN;
