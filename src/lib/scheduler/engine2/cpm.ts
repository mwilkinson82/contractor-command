/**
 * engine2 — Phase 1.1 CPM calculation over the WorkClock foundation.
 *
 * Scope (per Phase 1.1 plan in `ARCHITECTURE.md` §10/§11):
 *   - Forward and backward passes on a topologically sorted activity graph.
 *   - FS, SS, FF, SF relationships, with per-link lag and lag-calendar basis.
 *   - Per-activity calendars (any WorkClock implementation).
 *   - Total float and free float in working minutes (of the activity's own
 *     calendar) and critical marking by total-float tolerance.
 *   - SNET constraint clamping on the forward pass.
 *
 * Out of scope (deferred):
 *   - Other constraints (SNLT/FNET/FNLT/MSO/MFO/ALAP/Expected-Finish).
 *   - Actuals / data-date clamping.
 *   - Resource leveling, curves, multi-float-path analysis.
 *   - Behavioral percent-complete types beyond storing the value.
 *
 * Known limitation in Phase 1.1: free-float slack is measured in the
 * successor's calendar minutes (sufficient for single-calendar tests and a
 * defensible default for mixed-calendar links). A future pass may refine
 * per the link's lag-calendar basis.
 */

import type {
  EngineActivity,
  EngineActivityResult,
  EngineRelationship,
  EngineRelationshipResult,
  EngineResult,
  GoverningCause,
  Instant,
  LagCalendarBasis,
  RelationshipType,
} from "./types";
import { MS_PER_MIN, type WorkClock } from "./work-clock";

export interface CpmInput {
  /** Data date / status date as an absolute UTC instant. */
  dataDate: Instant;
  /** Project start as an absolute UTC instant. */
  projectStart: Instant;
  /** Calendar id used when a relationship's lagCalendarBasis is "project". */
  projectCalendarId: string;
  /** All calendars referenced by activities and links, keyed by id. */
  calendars: Map<string, WorkClock>;
  activities: EngineActivity[];
  relationships: EngineRelationship[];
  /** Activities with totalFloat <= this are critical. Default 0. */
  criticalFloatToleranceMinutes?: number;
}

interface WorkState {
  earlyStart: Instant;
  earlyFinish: Instant;
  lateStart: Instant;
  lateFinish: Instant;
  governingCause: GoverningCause;
  drivingPredecessorId?: string;
}

export function calculateCpm(input: CpmInput): EngineResult {
  const startedAt = Date.now();
  const t0 =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  const diagnostics: EngineResult["diagnostics"] = [];
  const tolerance = input.criticalFloatToleranceMinutes ?? 0;

  const getCal = (id: string): WorkClock => {
    const c = input.calendars.get(id);
    if (!c) throw new Error(`engine2: unknown calendar "${id}"`);
    return c;
  };

  const activities = input.activities;
  const rels = input.relationships;
  const actMap = new Map(activities.map((a) => [a.id, a]));

  // Drop links that reference unknown activities (with diagnostic).
  const validRels: EngineRelationship[] = [];
  for (const r of rels) {
    if (!actMap.has(r.from)) {
      diagnostics.push({
        severity: "warn",
        code: "missing-predecessor",
        message: `Relationship "${r.id}" skipped: predecessor "${r.from}" not found`,
      });
      continue;
    }
    if (!actMap.has(r.to)) {
      diagnostics.push({
        severity: "warn",
        code: "missing-successor",
        message: `Relationship "${r.id}" skipped: successor "${r.to}" not found`,
      });
      continue;
    }
    validRels.push(r);
  }

  const order = topoSort(activities, validRels);
  const predsOf = groupBy(validRels, (r) => r.to);
  const succsOf = groupBy(validRels, (r) => r.from);

  const state = new Map<string, WorkState>();
  for (const a of activities) {
    state.set(a.id, {
      earlyStart: 0,
      earlyFinish: 0,
      lateStart: 0,
      lateFinish: 0,
      governingCause: "logic",
    });
  }

  // ---- Forward pass ----
  for (const a of order) {
    const cal = getCal(a.calendarId);
    const baseStart = cal.nextWorkInstant(input.projectStart);
    let es = baseStart;
    let governingCause: GoverningCause = "logic";
    let drivingPredecessorId: string | undefined;

    // SNET constraint (only constraint type handled in Phase 1.1).
    const snet = a.constraints.find((c) => c.type === "snet");
    if (snet) {
      const snetCal = getCal(snet.calendarId);
      const snetSnapped = snetCal.nextWorkInstant(snet.instant);
      const onSuccCal = cal.nextWorkInstant(snetSnapped);
      if (onSuccCal > es) {
        es = onSuccCal;
        governingCause = "snet";
      }
    }

    for (const dep of predsOf.get(a.id) ?? []) {
      const pred = actMap.get(dep.from)!;
      const predState = state.get(pred.id)!;
      const required = requiredSuccStart(
        dep,
        pred,
        a,
        predState,
        getCal,
        input.projectCalendarId,
      );
      if (required > es) {
        es = required;
        governingCause = "logic";
        drivingPredecessorId = dep.id;
      }
    }

    const dur = Math.max(0, a.remainingDuration.minutes | 0);
    const ef = dur === 0 ? es : cal.addWork(es, dur);

    const st = state.get(a.id)!;
    st.earlyStart = es;
    st.earlyFinish = ef;
    st.governingCause = governingCause;
    st.drivingPredecessorId = drivingPredecessorId;
  }

  const projectFinish = activities.reduce(
    (m, a) => Math.max(m, state.get(a.id)!.earlyFinish),
    input.projectStart,
  );

  // ---- Backward pass ----
  for (const a of activities) {
    state.get(a.id)!.lateFinish = projectFinish;
  }

  for (let i = order.length - 1; i >= 0; i--) {
    const a = order[i];
    const cal = getCal(a.calendarId);
    const succs = succsOf.get(a.id) ?? [];

    let lf: Instant;
    if (succs.length === 0) {
      lf = projectFinish;
    } else {
      lf = Number.POSITIVE_INFINITY;
      for (const dep of succs) {
        const succ = actMap.get(dep.to)!;
        const succState = state.get(succ.id)!;
        const required = requiredPredFinish(
          dep,
          a,
          succ,
          succState,
          getCal,
          input.projectCalendarId,
        );
        if (required < lf) lf = required;
      }
    }

    const dur = Math.max(0, a.remainingDuration.minutes | 0);
    const ls = dur === 0 ? lf : cal.addWork(lf, -dur);

    const st = state.get(a.id)!;
    st.lateFinish = lf;
    st.lateStart = ls;
  }

  // ---- Float + critical ----
  const activityResults: EngineActivityResult[] = activities.map((a) => {
    const st = state.get(a.id)!;
    const cal = getCal(a.calendarId);
    const totalFloat = cal.diffWork(st.earlyStart, st.lateStart);

    const succs = succsOf.get(a.id) ?? [];
    let freeFloat: number;
    if (succs.length === 0) {
      freeFloat = cal.diffWork(st.earlyFinish, st.lateFinish);
    } else {
      let min = Number.POSITIVE_INFINITY;
      for (const dep of succs) {
        const succ = actMap.get(dep.to)!;
        const succState = state.get(succ.id)!;
        const slack = linkSlackMinutes(
          dep,
          a,
          succ,
          state.get(a.id)!,
          succState,
          getCal,
          input.projectCalendarId,
        );
        if (slack < min) min = slack;
      }
      freeFloat = min === Number.POSITIVE_INFINITY ? 0 : min;
    }

    return {
      id: a.id,
      earlyStart: st.earlyStart,
      earlyFinish: st.earlyFinish,
      lateStart: st.lateStart,
      lateFinish: st.lateFinish,
      totalFloatMinutes: totalFloat,
      freeFloatMinutes: freeFloat,
      isCritical: totalFloat <= tolerance,
      governingCause: st.governingCause,
      drivingPredecessorId: st.drivingPredecessorId,
    };
  });

  const relResults: EngineRelationshipResult[] = validRels.map((dep) => {
    const pred = actMap.get(dep.from)!;
    const succ = actMap.get(dep.to)!;
    const slack = linkSlackMinutes(
      dep,
      pred,
      succ,
      state.get(pred.id)!,
      state.get(succ.id)!,
      getCal,
      input.projectCalendarId,
    );
    return { id: dep.id, isDriving: slack <= tolerance, slackMinutes: slack };
  });

  const criticalPath = activityResults
    .filter((r) => r.isCritical)
    .sort((a, b) => a.earlyStart - b.earlyStart || a.id.localeCompare(b.id))
    .map((r) => r.id);

  const t1 =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

  return {
    dataDate: input.dataDate,
    activities: activityResults,
    relationships: relResults,
    criticalPath,
    diagnostics,
    runMeta: {
      startedAt,
      durationMs: t1 - t0,
      optionsHash: `tol:${tolerance}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyLagForward(
  ref: Instant,
  lagMin: number,
  basis: LagCalendarBasis,
  predCalId: string,
  succCalId: string,
  projCalId: string,
  getCal: (id: string) => WorkClock,
): Instant {
  if (lagMin === 0) return ref;
  if (basis === "24h") return ref + lagMin * MS_PER_MIN;
  const id =
    basis === "predecessor" ? predCalId : basis === "successor" ? succCalId : projCalId;
  return getCal(id).addWork(ref, lagMin);
}

function applyLagBackward(
  ref: Instant,
  lagMin: number,
  basis: LagCalendarBasis,
  predCalId: string,
  succCalId: string,
  projCalId: string,
  getCal: (id: string) => WorkClock,
): Instant {
  if (lagMin === 0) return ref;
  if (basis === "24h") return ref - lagMin * MS_PER_MIN;
  const id =
    basis === "predecessor" ? predCalId : basis === "successor" ? succCalId : projCalId;
  return getCal(id).addWork(ref, -lagMin);
}

function refForLagForward(
  type: RelationshipType,
  predState: WorkState,
): Instant {
  switch (type) {
    case "FS":
    case "FF":
      return predState.earlyFinish;
    case "SS":
    case "SF":
      return predState.earlyStart;
  }
}

function requiredSuccStart(
  dep: EngineRelationship,
  pred: EngineActivity,
  succ: EngineActivity,
  predState: WorkState,
  getCal: (id: string) => WorkClock,
  projCalId: string,
): Instant {
  const succCal = getCal(succ.calendarId);
  const target = applyLagForward(
    refForLagForward(dep.type, predState),
    dep.lag.minutes,
    dep.lagCalendarBasis,
    pred.calendarId,
    succ.calendarId,
    projCalId,
    getCal,
  );

  switch (dep.type) {
    case "FS":
    case "SS":
      return succCal.nextWorkInstant(target);
    case "FF":
    case "SF": {
      // `target` is the required successor *finish* instant. Snap up to a
      // working instant, then back-walk by the successor's duration so that
      // succ.earlyStart + duration lands at (or after) the requirement.
      const finishReq = succCal.nextWorkInstant(target);
      const dur = Math.max(0, succ.remainingDuration.minutes | 0);
      return dur === 0 ? finishReq : succCal.addWork(finishReq, -dur);
    }
  }
}

function requiredPredFinish(
  dep: EngineRelationship,
  pred: EngineActivity,
  succ: EngineActivity,
  succState: WorkState,
  getCal: (id: string) => WorkClock,
  projCalId: string,
): Instant {
  const predCal = getCal(pred.calendarId);
  const predDur = Math.max(0, pred.remainingDuration.minutes | 0);

  switch (dep.type) {
    case "FS":
      // pred.lateFinish + lag <= succ.lateStart
      return applyLagBackward(
        succState.lateStart,
        dep.lag.minutes,
        dep.lagCalendarBasis,
        pred.calendarId,
        succ.calendarId,
        projCalId,
        getCal,
      );
    case "SS": {
      // pred.lateStart + lag <= succ.lateStart → pred.lateFinish = pred.lateStart + dur
      const ls = applyLagBackward(
        succState.lateStart,
        dep.lag.minutes,
        dep.lagCalendarBasis,
        pred.calendarId,
        succ.calendarId,
        projCalId,
        getCal,
      );
      return predDur === 0 ? ls : predCal.addWork(ls, predDur);
    }
    case "FF":
      // pred.lateFinish + lag <= succ.lateFinish
      return applyLagBackward(
        succState.lateFinish,
        dep.lag.minutes,
        dep.lagCalendarBasis,
        pred.calendarId,
        succ.calendarId,
        projCalId,
        getCal,
      );
    case "SF": {
      // pred.lateStart + lag <= succ.lateFinish
      const ls = applyLagBackward(
        succState.lateFinish,
        dep.lag.minutes,
        dep.lagCalendarBasis,
        pred.calendarId,
        succ.calendarId,
        projCalId,
        getCal,
      );
      return predDur === 0 ? ls : predCal.addWork(ls, predDur);
    }
  }
}

function linkSlackMinutes(
  dep: EngineRelationship,
  pred: EngineActivity,
  succ: EngineActivity,
  predState: WorkState,
  succState: WorkState,
  getCal: (id: string) => WorkClock,
  projCalId: string,
): number {
  const succCal = getCal(succ.calendarId);
  // For FS/SS the slack target is succ.earlyStart vs the required successor
  // start. For FF/SF, the meaningful comparison is between required and
  // actual successor finish; equivalently we can compute the would-be
  // required start (already produced by requiredSuccStart for FF/SF) and
  // compare in succ-calendar minutes — both formulations agree once snapped.
  const required = requiredSuccStart(dep, pred, succ, predState, getCal, projCalId);
  const actual =
    dep.type === "FF" || dep.type === "SF" ? succState.earlyStart : succState.earlyStart;
  return succCal.diffWork(required, actual);
}

function topoSort(
  activities: EngineActivity[],
  rels: EngineRelationship[],
): EngineActivity[] {
  const inbound = new Map<string, number>(activities.map((a) => [a.id, 0]));
  const outbound = new Map<string, EngineRelationship[]>(
    activities.map((a) => [a.id, []]),
  );
  for (const r of rels) {
    inbound.set(r.to, (inbound.get(r.to) ?? 0) + 1);
    outbound.get(r.from)!.push(r);
  }

  const byId = new Map(activities.map((a) => [a.id, a]));
  const queue: EngineActivity[] = activities.filter(
    (a) => (inbound.get(a.id) ?? 0) === 0,
  );
  const sorted: EngineActivity[] = [];
  while (queue.length > 0) {
    const a = queue.shift()!;
    sorted.push(a);
    for (const r of outbound.get(a.id) ?? []) {
      const n = (inbound.get(r.to) ?? 0) - 1;
      inbound.set(r.to, n);
      if (n === 0) queue.push(byId.get(r.to)!);
    }
  }
  if (sorted.length !== activities.length) {
    throw new Error("engine2: dependency cycle detected");
  }
  return sorted;
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const arr = m.get(k);
    if (arr) arr.push(item);
    else m.set(k, [item]);
  }
  return m;
}
