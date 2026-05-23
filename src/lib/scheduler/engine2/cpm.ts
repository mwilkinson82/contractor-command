/**
 * engine2 — Phase 1.2 CPM with constraints, data date, and actuals.
 *
 * Phase 1.1 implemented baseline forward/backward CPM over the WorkClock
 * foundation. Phase 1.2 adds the next layer of construction-schedule state:
 *
 *   - Full P6-style constraint set on the forward and backward passes:
 *     SNET, SNLT, FNET, FNLT, MSO, MFO, ALAP.
 *   - Data-date behavior: not-started activities cannot schedule before the
 *     data date; in-progress activities preserve `actualStart` and project
 *     remaining work from the data date; completed activities preserve
 *     `actualStart` / `actualFinish` verbatim.
 *   - Structured per-activity diagnostics explaining what drove each date
 *     (logic, constraint, data date, actuals).
 *
 * Out of scope (deferred):
 *   - Multiple float-path analysis, retained-logic / progress-override toggle,
 *     resource leveling, XER reconciliation.
 *   - Physical / Units percent-complete behavior (Duration is the only mode
 *     wired into the calculation — see ARCHITECTURE.md §12 for limitations).
 *   - ALAP propagation through downstream successors: ALAP is honored on the
 *     activity itself by pinning early=late, but does not re-run forward for
 *     its successors. Documented limitation.
 */

import type {
  Constraint,
  EngineActivity,
  EngineActivityResult,
  EngineDiagnostic,
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
  /** Per-activity diagnostic notes accumulated during the passes. */
  notes: EngineDiagnostic[];
  /** Activity is fully complete (has actualFinish). */
  completed: boolean;
  /** Activity is in progress (actualStart set, no actualFinish). */
  inProgress: boolean;
}

export function calculateCpm(input: CpmInput): EngineResult {
  const startedAt = Date.now();
  const t0 =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  const diagnostics: EngineDiagnostic[] = [];
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
    const completed = a.actualFinish !== undefined;
    const inProgress = a.actualStart !== undefined && a.actualFinish === undefined;
    state.set(a.id, {
      earlyStart: 0,
      earlyFinish: 0,
      lateStart: 0,
      lateFinish: 0,
      governingCause: "logic",
      notes: [],
      completed,
      inProgress,
    });

    // ---- Activity status consistency diagnostics (Phase 1.3) ----
    const orig = a.originalDuration.minutes | 0;
    const rem = a.remainingDuration.minutes | 0;
    if (a.actualFinish !== undefined && a.actualStart === undefined) {
      diagnostics.push({
        severity: "warn",
        code: "status-inconsistent",
        message: `Activity "${a.id}" has actualFinish without actualStart`,
        activityId: a.id,
      });
    }
    if (
      a.actualStart !== undefined &&
      a.actualFinish !== undefined &&
      a.actualFinish < a.actualStart
    ) {
      diagnostics.push({
        severity: "warn",
        code: "status-inconsistent",
        message: `Activity "${a.id}" actualFinish precedes actualStart`,
        activityId: a.id,
      });
    }
    if (completed && rem > 0) {
      diagnostics.push({
        severity: "warn",
        code: "status-inconsistent",
        message: `Activity "${a.id}" is completed but remainingDuration=${rem}m (treated as 0)`,
        activityId: a.id,
      });
    }
    if (!completed && !inProgress && orig > 0 && rem !== orig) {
      diagnostics.push({
        severity: "info",
        code: "status-baseline-drift",
        message: `Activity "${a.id}" not started but remainingDuration (${rem}m) differs from originalDuration (${orig}m)`,
        activityId: a.id,
      });
    }
    if (orig < 0 || rem < 0) {
      diagnostics.push({
        severity: "warn",
        code: "status-inconsistent",
        message: `Activity "${a.id}" has negative duration (orig=${orig}m, rem=${rem}m)`,
        activityId: a.id,
      });
    }
    if (a.percentCompleteType === "physical") {
      const v = a.physicalPercentComplete;
      if (v !== undefined && (v < 0 || v > 100 || Number.isNaN(v))) {
        diagnostics.push({
          severity: "warn",
          code: "percent-out-of-range",
          message: `Activity "${a.id}" physicalPercentComplete=${v} outside [0,100]`,
          activityId: a.id,
        });
      }
    }
    if (a.percentCompleteType === "units") {
      const v = a.unitsPercentComplete;
      if (v !== undefined && (v < 0 || v > 100 || Number.isNaN(v))) {
        diagnostics.push({
          severity: "warn",
          code: "percent-out-of-range",
          message: `Activity "${a.id}" unitsPercentComplete=${v} outside [0,100]`,
          activityId: a.id,
        });
      }
    }
  }


  // ---- Forward pass ----
  for (const a of order) {
    const cal = getCal(a.calendarId);
    const st = state.get(a.id)!;

    // Completed activities: pin to actuals.
    if (st.completed) {
      st.earlyStart = a.actualStart ?? a.actualFinish!;
      st.earlyFinish = a.actualFinish!;
      st.governingCause = "actual";
      st.notes.push({
        severity: "info",
        code: "actual-finish",
        message: `Activity "${a.id}" pinned to actual finish`,
        activityId: a.id,
      });
      continue;
    }

    // In-progress: ES is the actual start; EF projects from data date.
    if (st.inProgress) {
      const dur = Math.max(0, a.remainingDuration.minutes | 0);
      const projectionStart = cal.nextWorkInstant(input.dataDate);
      st.earlyStart = a.actualStart!;
      st.earlyFinish = dur === 0 ? projectionStart : cal.addWork(projectionStart, dur);
      st.governingCause = "data-date";
      st.notes.push({
        severity: "info",
        code: "in-progress",
        message: `Activity "${a.id}" projects remaining ${dur}m from data date`,
        activityId: a.id,
      });
      continue;
    }

    // Not started: project start, data date, logic, then constraints.
    const dataDateSnapped = cal.nextWorkInstant(input.dataDate);
    let es = cal.nextWorkInstant(input.projectStart);
    let governingCause: GoverningCause = "logic";
    let drivingPredecessorId: string | undefined;

    if (dataDateSnapped > es) {
      es = dataDateSnapped;
      governingCause = "data-date";
      st.notes.push({
        severity: "info",
        code: "data-date-shift",
        message: `Activity "${a.id}" early start clamped forward to data date`,
        activityId: a.id,
      });
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

    // Constraints affecting the forward pass.
    for (const c of a.constraints) {
      const cInst = getCal(c.calendarId).nextWorkInstant(c.instant);
      switch (c.type) {
        case "snet": {
          const onCal = cal.nextWorkInstant(cInst);
          if (onCal > es) {
            es = onCal;
            governingCause = "snet";
            drivingPredecessorId = undefined;
            pushConstraintNote(st, a, c, "snet", "forward");
          }
          break;
        }
        case "fnet": {
          // EF must be >= constraint instant. Back-solve a required ES.
          const dur = Math.max(0, a.remainingDuration.minutes | 0);
          const reqEs = dur === 0 ? cInst : cal.addWork(cInst, -dur);
          if (reqEs > es) {
            es = reqEs;
            governingCause = "fnet";
            drivingPredecessorId = undefined;
            pushConstraintNote(st, a, c, "fnet", "forward");
          }
          break;
        }
        case "mso": {
          // Mandatory start: pin ES to the constraint regardless of logic.
          es = cInst;
          governingCause = "mso";
          drivingPredecessorId = undefined;
          pushConstraintNote(st, a, c, "mso", "forward");
          break;
        }
        case "mfo": {
          // Mandatory finish: back-solve from the pinned finish.
          const dur = Math.max(0, a.remainingDuration.minutes | 0);
          es = dur === 0 ? cInst : cal.addWork(cInst, -dur);
          governingCause = "mfo";
          drivingPredecessorId = undefined;
          pushConstraintNote(st, a, c, "mfo", "forward");
          break;
        }
        case "snlt":
        case "fnlt":
        case "alap":
        case "expected-finish":
          // Handled in backward pass (or not at all in 1.2).
          break;
      }
    }

    const dur = Math.max(0, a.remainingDuration.minutes | 0);
    const ef = dur === 0 ? es : cal.addWork(es, dur);

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
    const st = state.get(a.id)!;
    const cal = getCal(a.calendarId);

    if (st.completed) {
      // Late = early for completed activities.
      st.lateStart = st.earlyStart;
      st.lateFinish = st.earlyFinish;
      continue;
    }

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

    // Apply backward-pass constraints.
    let lateGoverning: GoverningCause | undefined;
    for (const c of a.constraints) {
      const cInst = getCal(c.calendarId).prevWorkInstant(c.instant);
      switch (c.type) {
        case "fnlt": {
          if (cInst < lf) {
            lf = cInst;
            lateGoverning = "fnlt";
            pushConstraintNote(st, a, c, "fnlt", "backward");
          }
          break;
        }
        case "snlt": {
          const dur = Math.max(0, a.remainingDuration.minutes | 0);
          const reqLf = dur === 0 ? cInst : cal.addWork(cInst, dur);
          if (reqLf < lf) {
            lf = reqLf;
            lateGoverning = "snlt";
            pushConstraintNote(st, a, c, "snlt", "backward");
          }
          break;
        }
        case "mso": {
          const dur = Math.max(0, a.remainingDuration.minutes | 0);
          const reqLf = dur === 0 ? cInst : cal.addWork(cInst, dur);
          lf = reqLf;
          lateGoverning = "mso";
          break;
        }
        case "mfo": {
          lf = cInst;
          lateGoverning = "mfo";
          break;
        }
        default:
          break;
      }
    }

    const dur = Math.max(0, a.remainingDuration.minutes | 0);
    const ls = dur === 0 ? lf : cal.addWork(lf, -dur);
    st.lateFinish = lf;
    st.lateStart = ls;

    // ALAP: pin early to late on the activity itself.
    const hasAlap = a.constraints.some((c) => c.type === "alap");
    if (hasAlap) {
      st.earlyStart = ls;
      st.earlyFinish = lf;
      st.governingCause = "alap";
      st.drivingPredecessorId = undefined;
      st.notes.push({
        severity: "info",
        code: "alap",
        message: `Activity "${a.id}" scheduled As Late As Possible`,
        activityId: a.id,
      });
    } else if (lateGoverning && st.governingCause === "logic") {
      // Surface backward-pass constraint as the governing cause when
      // forward pass had no constraint override.
      // (Float will be zero or negative; the constraint is the binding edge.)
    }
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

    // Flush per-activity diagnostic notes into the global diagnostics list.
    for (const n of st.notes) diagnostics.push(n);

    // ---- Progress / duration derivation (Phase 1.3) ----
    const status: import("./types").ActivityStatus = st.completed
      ? "completed"
      : st.inProgress
        ? "in-progress"
        : "not-started";

    let actualDurationMinutes: number;
    let remainingDurationMinutes: number;
    if (st.completed) {
      actualDurationMinutes =
        a.actualStart !== undefined
          ? Math.max(0, cal.diffWork(a.actualStart, a.actualFinish!))
          : 0;
      remainingDurationMinutes = 0;
    } else if (st.inProgress) {
      actualDurationMinutes = Math.max(
        0,
        cal.diffWork(a.actualStart!, input.dataDate),
      );
      remainingDurationMinutes = Math.max(0, a.remainingDuration.minutes | 0);
    } else {
      actualDurationMinutes = 0;
      remainingDurationMinutes = Math.max(0, a.remainingDuration.minutes | 0);
    }
    const atCompletionDurationMinutes =
      actualDurationMinutes + remainingDurationMinutes;

    let durationPercentComplete: number;
    if (st.completed) {
      durationPercentComplete = 100;
    } else if (atCompletionDurationMinutes <= 0) {
      durationPercentComplete = st.inProgress ? 100 : 0;
    } else {
      durationPercentComplete = clampPct(
        (actualDurationMinutes / atCompletionDurationMinutes) * 100,
      );
    }

    let reportedPercentComplete: number;
    switch (a.percentCompleteType) {
      case "physical":
        reportedPercentComplete = clampPct(a.physicalPercentComplete ?? 0);
        break;
      case "units":
        reportedPercentComplete = clampPct(a.unitsPercentComplete ?? 0);
        break;
      case "duration":
      default:
        reportedPercentComplete = durationPercentComplete;
        break;
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
      status,
      actualDurationMinutes,
      remainingDurationMinutes,
      atCompletionDurationMinutes,
      durationPercentComplete,
      reportedPercentComplete,
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

function pushConstraintNote(
  st: WorkState,
  a: EngineActivity,
  c: Constraint,
  code: string,
  direction: "forward" | "backward",
): void {
  st.notes.push({
    severity: "info",
    code: `constraint-${code}`,
    message: `Activity "${a.id}" ${direction}-pass driven by ${code.toUpperCase()} constraint @ ${new Date(c.instant).toISOString()}`,
    activityId: a.id,
  });
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

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
  const required = requiredSuccStart(dep, pred, succ, predState, getCal, projCalId);
  const actual = succState.earlyStart;
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
