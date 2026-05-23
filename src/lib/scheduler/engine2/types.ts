/**
 * engine2 — P6-class scheduling engine foundation (Phase 1.0).
 *
 * Pure types for the absolute-working-time-instant model. No runtime code,
 * no behavior. Mirrors §4 of `src/lib/scheduler/ARCHITECTURE.md`.
 *
 * Phase 1.0 ONLY introduces these shapes + the `WorkClock` interface and a
 * whole-day implementation. The forward/backward CPM passes against this
 * model are deferred to Phase 1.1.
 */

/** Absolute instant in UTC, epoch milliseconds. */
export type Instant = number;

/** A working duration, stored in native minutes. */
export interface Duration {
  /** Native unit is working minutes. Always >= 0. */
  minutes: number;
  /** Calendar this duration was authored against (round-trip / display). */
  authoringCalendarId: string;
}

export type ActivityType =
  | "task"
  | "resource"
  | "loe"
  | "milestone-start"
  | "milestone-finish"
  | "wbs-summary";

export type DurationType =
  | "fixed-dur-units"
  | "fixed-dur-units-per-time"
  | "fixed-units"
  | "fixed-units-per-time";

export type PercentCompleteType = "physical" | "duration" | "units";

export type ConstraintType =
  | "snet" // start-on-or-after
  | "snlt" // start-on-or-before
  | "fnet" // finish-on-or-after
  | "fnlt" // finish-on-or-before
  | "mso"  // mandatory-start-on
  | "mfo"  // mandatory-finish-on
  | "alap" // as-late-as-possible
  | "expected-finish";

export interface Constraint {
  type: ConstraintType;
  instant: Instant;
  /** Calendar whose working time the constraint is expressed in. */
  calendarId: string;
}

export interface EngineActivity {
  id: string;
  name: string;
  type: ActivityType;
  durationType: DurationType;
  percentCompleteType: PercentCompleteType;

  calendarId: string;

  originalDuration: Duration;
  remainingDuration: Duration;
  actualStart?: Instant;
  actualFinish?: Instant;

  /** 0..2 per P6 (primary + secondary). */
  constraints: Constraint[];

  /**
   * Independently editable Physical Percent Complete (0..100).
   * Only consumed when `percentCompleteType === "physical"`.
   * Phase 1.3: stored verbatim; does NOT influence date calculations.
   */
  physicalPercentComplete?: number;

  /**
   * Reported Units Percent Complete (0..100).
   * Only consumed when `percentCompleteType === "units"`.
   * Phase 1.3: structural stub — no resource-unit derivation yet. Treated
   * as a verbatim authored value for reporting; does NOT influence dates.
   */
  unitsPercentComplete?: number;

  /**
   * Deprecated catch-all percent value retained for backward compatibility
   * with earlier phases. Not consumed by the calculation; use
   * `physicalPercentComplete` / `unitsPercentComplete` instead.
   */
  percentComplete?: number;
}

/** Deterministically derived from actualStart / actualFinish. */
export type ActivityStatus = "not-started" | "in-progress" | "completed";

export type RelationshipType = "FS" | "SS" | "FF" | "SF";
export type LagCalendarBasis = "predecessor" | "successor" | "project" | "24h";

export interface EngineRelationship {
  id: string;
  from: string;
  to: string;
  type: RelationshipType;
  lag: Duration;
  lagCalendarBasis: LagCalendarBasis;
}

export type GoverningCause =
  | "logic"
  | "snet"
  | "snlt"
  | "fnet"
  | "fnlt"
  | "mso"
  | "mfo"
  | "alap"
  | "expected-finish"
  | "data-date"
  | "actual"
  | "calendar"
  | "leveling"
  | "external";

export interface EngineActivityResult {
  id: string;
  earlyStart: Instant;
  earlyFinish: Instant;
  lateStart: Instant;
  lateFinish: Instant;
  totalFloatMinutes: number;
  freeFloatMinutes: number;
  isCritical: boolean;
  governingCause: GoverningCause;
  drivingPredecessorId?: string;

  /** Derived from actualStart / actualFinish. */
  status: ActivityStatus;
  /** Working minutes of work already performed. 0 for not-started. */
  actualDurationMinutes: number;
  /** Working minutes still required to complete. 0 for completed. */
  remainingDurationMinutes: number;
  /** actual + remaining (= original for not-started, = actual for completed). */
  atCompletionDurationMinutes: number;
  /**
   * Computed 0..100 from actual / (actual + remaining). Independent of
   * `percentCompleteType` — this is the duration-based value only.
   */
  durationPercentComplete: number;
  /**
   * The 0..100 value that should be REPORTED to the user, selected by the
   * activity's `percentCompleteType`:
   *   - duration → durationPercentComplete
   *   - physical → activity.physicalPercentComplete ?? 0
   *   - units    → activity.unitsPercentComplete ?? 0 (Phase 1.3 stub)
   */
  reportedPercentComplete: number;
}

export interface EngineRelationshipResult {
  id: string;
  isDriving: boolean;
  slackMinutes: number;
}

export type DiagnosticSeverity = "info" | "warn" | "error";

export interface EngineDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  activityId?: string;
}

export interface EngineResult {
  dataDate: Instant;
  activities: EngineActivityResult[];
  relationships: EngineRelationshipResult[];
  criticalPath: string[];
  diagnostics: EngineDiagnostic[];
  runMeta: { startedAt: number; durationMs: number; optionsHash: string };
}
