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

  /**
   * Phase 1.5 — convenience denormalization listing assignment ids attached
   * to this activity. Full assignment records live on `CpmInput.assignments`
   * keyed by `activityId`; either form is accepted by the engine.
   */
  assignmentIds?: string[];

  /**
   * Phase 1.6 — leveling priority. Lower number = higher priority (P6
   * convention). Activities with no priority set are treated as lowest
   * priority and may be delayed first. Ignored when leveling is disabled.
   */
  levelingPriority?: number;
}

// ---------------------------------------------------------------------------
// Phase 1.5 — resource / role / assignment foundation
// ---------------------------------------------------------------------------

export type ResourceType = "labor" | "nonlabor" | "material";

/** Hierarchical identity (root → self). */
export type HierarchicalPath = string[];

export interface Role {
  id: string;
  name: string;
  path?: HierarchicalPath;
}

export interface Resource {
  id: string;
  name: string;
  type: ResourceType;
  /**
   * Calendar this resource works against. Phase 1.5: validated but does NOT
   * drive activity dates yet — activity calendar still governs CPM. See
   * ARCHITECTURE.md §15.
   */
  calendarId?: string;
  path?: HierarchicalPath;
  defaultRoleId?: string;
  /**
   * Phase 1.6 — per-day capacity in assignment units. Undefined means
   * unlimited (leveling will not consider this resource). Whole-day
   * granularity only; shift/hour-level capacity is deferred.
   */
  maxUnitsPerDay?: number;
}

/** Placeholder — rate book not yet consumed by the engine. */
export type RateSource = "resource" | "role" | "override";
export type RateType =
  | "price-per-unit"
  | "price-per-unit-2"
  | "price-per-unit-3"
  | "price-per-unit-4"
  | "price-per-unit-5";

/** Assignment-level units curve id placeholder; spread is deferred. */
export type AssignmentCurveId = string;

/** Manual future-period override marker (no recalc behavior in 1.5). */
export interface ManualFuturePeriodMarker {
  present: boolean;
  source?: "xer" | "user" | "engine";
}

export interface ResourceAssignment {
  id: string;
  activityId: string;
  resourceId: string;
  roleId?: string;

  budgetedUnits: number;
  actualUnits: number;
  remainingUnits: number;

  /** Units per working time-unit of the assignment calendar (e.g. units/hr). */
  unitsPerTime?: number;

  budgetedCost?: number;
  actualCost?: number;
  remainingCost?: number;

  rateSource?: RateSource;
  rateType?: RateType;

  curveId?: AssignmentCurveId;
  manualFuturePeriod?: ManualFuturePeriodMarker;
}

export interface ExpenseAssignment {
  id: string;
  activityId: string;
  name: string;
  budgetedCost: number;
  actualCost: number;
  remainingCost: number;
  /** P6 accrual: start | prorated | end. Stored only in 1.5. */
  accrualType?: "start" | "prorated" | "end";
}

/** Per-activity rollup of assignment math (Phase 1.5). */
export interface ActivityAssignmentSummary {
  activityId: string;
  assignmentCount: number;
  budgetedUnits: number;
  actualUnits: number;
  remainingUnits: number;
  atCompletionUnits: number;
  /** 0..100. NaN when atCompletionUnits <= 0 — engine coerces to 0 for reporting. */
  unitsPercentComplete: number;
  budgetedCost: number;
  actualCost: number;
  remainingCost: number;
  atCompletionCost: number;
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

/**
 * High-level grouping of `GoverningCause`. Useful for explainability UIs
 * that want to show "what kind of thing drove this date".
 */
export type GoverningCategory =
  | "logic"
  | "constraint"
  | "progress"
  | "calendar"
  | "leveling"
  | "external";

export interface DrivingLink {
  relationshipId: string;
  /** Predecessor id when listed in `drivingPredecessors`, successor id when listed in `drivingSuccessors`. */
  otherActivityId: string;
  type: RelationshipType;
  lagMinutes: number;
  lagCalendarBasis: LagCalendarBasis;
  /**
   * Slack on this link in the successor's calendar (working minutes).
   * <= criticalFloatToleranceMinutes when "driving".
   */
  slackMinutes: number;
}

export interface BaselineActivity {
  activityId: string;
  start: Instant;
  finish: Instant;
}

export interface BaselineVariance {
  /** Working-minute variance (current − baseline) in the activity's calendar. Positive = late. */
  startVarianceMinutes: number;
  finishVarianceMinutes: number;
  /** Calendar-day variance (current − baseline). Positive = late. */
  startVarianceCalendarDays: number;
  finishVarianceCalendarDays: number;
}

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
  governingCategory: GoverningCategory;
  drivingPredecessorId?: string;

  /** Phase 1.4 — full driving trace (may be empty for open-ended activities). */
  drivingPredecessors: DrivingLink[];
  /** Phase 1.4 — relationships where this activity is the driver of the successor. */
  drivingSuccessors: DrivingLink[];

  /** No predecessor relationships at all. */
  isOpenStart: boolean;
  /** No successor relationships at all. */
  isOpenFinish: boolean;
  /** totalFloat < 0. */
  hasNegativeFloat: boolean;

  /** Present only when a baseline was provided for this activity. */
  baselineVariance?: BaselineVariance;

  /** Derived from actualStart / actualFinish. */
  status: ActivityStatus;
  actualDurationMinutes: number;
  remainingDurationMinutes: number;
  atCompletionDurationMinutes: number;
  durationPercentComplete: number;
  reportedPercentComplete: number;

  /**
   * Phase 1.5 — per-activity assignment rollup. Present only when at least
   * one `ResourceAssignment` references this activity in `CpmInput`.
   */
  assignmentSummary?: ActivityAssignmentSummary;
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

export type FloatPathBasis = "total-float" | "free-float";

export interface FloatPathStep {
  activityId: string;
  /** Relationship id walked from the previous step to this step. Absent on the endpoint. */
  relationshipIdFromPrev?: string;
}

export interface FloatPath {
  rank: number;
  basis: FloatPathBasis;
  /** The governing float of the chain (worst-case along the path) in working minutes. */
  pathFloatMinutes: number;
  /** Steps in chronological order from start of chain to endpoint. */
  steps: FloatPathStep[];
}

export interface FloatPathAnalysis {
  basis: FloatPathBasis;
  /** Activity used as the chain endpoint. Defaults to project-finish-driving activity. */
  endpointActivityId: string;
  paths: FloatPath[];
}

export interface EngineRunRecord {
  startedAt: number;
  durationMs: number;
  engineVersion: string;
  dataDate: Instant;
  activityCount: number;
  relationshipCount: number;
  diagnosticCounts: { info: number; warn: number; error: number };
  /** Present only when a `priorResult` was passed in to compare against. */
  changedActivityCount?: number;
  optionsSnapshot: {
    criticalFloatToleranceMinutes: number;
    floatPathCount: number;
    floatPathBasis: FloatPathBasis;
    floatPathEndpointActivityId?: string;
    baselinesProvided: boolean;
  };
}

export interface EngineResult {
  dataDate: Instant;
  activities: EngineActivityResult[];
  relationships: EngineRelationshipResult[];
  criticalPath: string[];
  diagnostics: EngineDiagnostic[];
  /** Phase 1.4 — multiple float-path analysis. Present when floatPathCount > 0. */
  floatPaths?: FloatPathAnalysis;
  /** Phase 1.4 — auditable run summary. */
  runRecord: EngineRunRecord;
  /** @deprecated use `runRecord`. Retained for back-compat through Phase 1.x. */
  runMeta: { startedAt: number; durationMs: number; optionsHash: string };
  /**
   * Phase 1.6 — deterministic resource leveling analysis. Present only when
   * `CpmInput.leveling.enabled === true`. CPM dates on `activities` are NOT
   * mutated; leveled dates live exclusively here.
   */
  leveling?: LevelingAnalysis;
}

// ---------------------------------------------------------------------------
// Phase 1.6 — resource leveling foundation
// ---------------------------------------------------------------------------

export interface LevelingOptions {
  enabled: boolean;
  /**
   * If set, only these resources are considered for leveling. Other
   * overallocations are reported as informational but never cause moves.
   * Default: every resource with a finite `maxUnitsPerDay`.
   */
  selectedResourceIds?: string[];
  /**
   * If true, an activity is never delayed past its CPM `lateStart` (i.e.
   * the leveler refuses to consume float beyond zero). Phase 1.6: DEFERRED —
   * the leveler logs a `leveling_preserve_dates_deferred` warning and
   * proceeds as if `false`. See ARCHITECTURE.md §16.
   */
  preserveScheduledEarlyAndLateDates?: boolean;
  /**
   * Hard cap on how many workdays a single activity may be delayed.
   * Default 365. Prevents runaway loops on infeasible inputs.
   */
  maxDelayWorkdays?: number;
}

export interface ResourceDayDemand {
  /** UTC day-start instant (00:00). */
  dayStart: Instant;
  /** Sum of demand on this resource on this day across all active activities. */
  totalUnits: number;
  /** `totalUnits - capacity`. Positive = over. */
  overUnits: number;
  /** Activities contributing demand on this day. */
  activityIds: string[];
}

export interface ResourceOverallocation {
  resourceId: string;
  /** `maxUnitsPerDay` snapshot at run time. */
  capacityPerDay: number;
  days: ResourceDayDemand[];
}

export interface LevelingEntry {
  activityId: string;
  /** Snapshot of CPM dates before leveling moved the activity. */
  cpmEarlyStart: Instant;
  cpmEarlyFinish: Instant;
  /** Post-leveling dates. */
  leveledStart: Instant;
  leveledFinish: Instant;
  /** Working-minute delay under the activity calendar. >= 0. */
  delayMinutes: number;
  /** Resources whose capacity drove the move (empty if the activity didn't move). */
  resourcesCausingConflict: string[];
  /** Human-readable reason: priority comparison and trigger. */
  priorityReason: string;
}

export interface LevelingAnalysis {
  /** Echo of the options the run was executed with. */
  options: Required<Pick<LevelingOptions, "enabled" | "preserveScheduledEarlyAndLateDates" | "maxDelayWorkdays">> & {
    selectedResourceIds: string[];
  };
  /** Resources actually considered (after defaulting). */
  consideredResourceIds: string[];
  overallocationsBefore: ResourceOverallocation[];
  overallocationsAfter: ResourceOverallocation[];
  entries: LevelingEntry[];
  /**
   * Structured warnings explaining simplifications / deferred behavior.
   * Codes include `leveling_whole_day_only`,
   * `leveling_preserve_dates_deferred`, `leveling_successors_not_reflowed`,
   * `leveling_no_capacity_defined`, `leveling_max_delay_reached`.
   */
  warnings: EngineDiagnostic[];
}
