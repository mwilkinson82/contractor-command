/**
 * engine2 XER Import Action Semantics — Phase 2.0
 *
 * Implements Create / Update / Replace / Add-Into project import behavior
 * over the high-fidelity `XerEngine2ImportResult` shape produced by
 * `importXerForEngine2`. This is a pure engine-level layer — no UI wiring
 * yet. The legacy importer and engine remain untouched.
 *
 * The layer offers two entry points:
 *   - `planImportAction({ existing, incoming, options })` — produces a
 *     dry-run `ImportPlan` describing every record that would be
 *     created/updated/deleted/preserved, plus diagnostics and any
 *     critical errors that should block apply.
 *   - `applyImportAction({ existing, incoming, options })` — runs the
 *     plan and, if no critical errors, returns the merged
 *     `XerEngine2ImportResult` state. Mutations are transactional: the
 *     new state is built in memory and only swapped in if the plan
 *     validates. The original `existing` value is never mutated.
 *
 * Identity model:
 *   - Activities  → matched by `EngineActivity.id` (XER `task_code`,
 *                   de-duplicated by importer) scoped to a project id
 *                   via `XerEngine2ImportResult.activityProjectIds`.
 *   - Relationships → matched by `${from}|${to}|${type}` tuple.
 *   - Assignments  → matched by `ResourceAssignment.id` (XER
 *                   `taskrsrc_id`).
 *
 * Out of scope (deferred, surfaced as diagnostics where requested):
 *   - Calendar / resource / role delete-unreferenced.
 *   - XER export round-tripping.
 *   - UI wiring for action selection.
 */

import type {
  EngineActivity,
  EngineDiagnostic,
  EngineRelationship,
  ResourceAssignment,
} from "./types";
import type {
  ExternalRelationshipRecord,
  InterprojectRelationshipRecord,
  XerEngine2ImportResult,
  XerProject,
} from "./xer-import";

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

export type XerImportAction =
  | "create-new-project"
  | "update-existing-project"
  | "replace-existing-project"
  | "add-into-existing-project";

/**
 * Delete-unreferenced toggles. Activities / relationships / assignments
 * are supported. Other categories are honored as a request but currently
 * emit a `delete_unreferenced_category_unsupported` diagnostic instead of
 * silently ignoring the request.
 */
export interface DeleteUnreferencedOptions {
  activities?: boolean;
  relationships?: boolean;
  assignments?: boolean;
  calendars?: boolean;
  resources?: boolean;
  roles?: boolean;
}

export interface ImportActionOptions {
  action: XerImportAction;
  /**
   * The project id (in `incoming.projects`) being imported. For
   * update/replace/add-into this MUST also exist in `existing.projects`.
   * For create-new-project this is the id that will be created and must
   * NOT already exist in `existing.projects` (collision is a critical
   * error).
   *
   * If omitted, the importer uses `incoming.projects[0].id`.
   */
  targetProjectId?: string;
  deleteUnreferenced?: DeleteUnreferencedOptions;
}

// ---------------------------------------------------------------------------
// Plan output
// ---------------------------------------------------------------------------

export type ImportPlanSubject =
  | "activity"
  | "relationship"
  | "assignment"
  | "project"
  | "interproject-relationship"
  | "external-relationship";

export type ImportPlanKind = "create" | "update" | "delete" | "preserve";

export interface ImportPlanEntry {
  kind: ImportPlanKind;
  subject: ImportPlanSubject;
  id: string;
  reason?: string;
}

export interface ImportPlanSummary {
  create: number;
  update: number;
  delete: number;
  preserve: number;
  warnings: number;
  errors: number;
}

export interface ImportPlan {
  action: XerImportAction;
  targetProjectId: string;
  entries: ImportPlanEntry[];
  diagnostics: EngineDiagnostic[];
  /** Subset of `diagnostics` with severity === "error". */
  criticalErrors: EngineDiagnostic[];
  /** Subset of diagnostics describing categories preserved but not acted on. */
  unsupportedPreservedOnly: EngineDiagnostic[];
  summary: ImportPlanSummary;
  /**
   * True iff the engine could build a single in-memory snapshot and swap
   * it atomically. Currently always true because all merge work is pure;
   * exposed so future persistence layers can flip it to false and surface
   * the partial-commit risk diagnostic if they cannot.
   */
  transactional: boolean;
}

export interface ImportApplyResult {
  ok: boolean;
  plan: ImportPlan;
  /**
   * Merged state. If `ok === false` this is referentially equal to
   * `existing` (no mutation occurred).
   */
  state: XerEngine2ImportResult;
  /**
   * Diagnostics emitted during apply (in addition to the plan diagnostics).
   * Always includes one `import_action_applied` info entry on success.
   */
  diagnostics: EngineDiagnostic[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function relIdentity(r: EngineRelationship | { from: string; to: string; type: string }): string {
  return `${r.from}|${r.to}|${r.type}`;
}

function activityScope(
  state: XerEngine2ImportResult,
  projectId: string,
): {
  activityIds: Set<string>;
  relationshipKeys: Set<string>;
  assignmentIds: Set<string>;
} {
  const activityIds = new Set<string>();
  for (const a of state.activities) {
    if (state.activityProjectIds[a.id] === projectId) activityIds.add(a.id);
  }
  const relationshipKeys = new Set<string>();
  for (const r of state.relationships) {
    if (activityIds.has(r.from) && activityIds.has(r.to)) {
      relationshipKeys.add(relIdentity(r));
    }
  }
  const assignmentIds = new Set<string>();
  for (const a of state.assignments) {
    if (activityIds.has(a.activityId)) assignmentIds.add(a.id);
  }
  return { activityIds, relationshipKeys, assignmentIds };
}

function shallowEqualActivity(a: EngineActivity, b: EngineActivity): boolean {
  // Fields the importer can change. Constraints and durations are compared
  // structurally enough for change detection — we don't deep-diff dates.
  return (
    a.name === b.name &&
    a.type === b.type &&
    a.durationType === b.durationType &&
    a.percentCompleteType === b.percentCompleteType &&
    a.calendarId === b.calendarId &&
    a.originalDuration.minutes === b.originalDuration.minutes &&
    a.remainingDuration.minutes === b.remainingDuration.minutes &&
    a.actualStart === b.actualStart &&
    a.actualFinish === b.actualFinish &&
    a.physicalPercentComplete === b.physicalPercentComplete &&
    JSON.stringify(a.constraints) === JSON.stringify(b.constraints)
  );
}

function shallowEqualAssignment(
  a: ResourceAssignment,
  b: ResourceAssignment,
): boolean {
  return (
    a.activityId === b.activityId &&
    a.resourceId === b.resourceId &&
    a.roleId === b.roleId &&
    a.budgetedUnits === b.budgetedUnits &&
    a.actualUnits === b.actualUnits &&
    a.remainingUnits === b.remainingUnits &&
    a.budgetedCost === b.budgetedCost &&
    a.actualCost === b.actualCost &&
    a.remainingCost === b.remainingCost
  );
}

function emptyState(): XerEngine2ImportResult {
  return {
    projectName: "",
    projectStartDate: undefined,
    dataDate: undefined,
    projects: [],
    calendars: [],
    defaultCalendarId: "cal-default",
    activities: [],
    activityProjectIds: {},
    relationships: [],
    interprojectRelationships: [],
    externalRelationships: [],
    resources: [],
    roles: [],
    assignments: [],
    diagnostics: [],
    raw: {
      projects: [],
      calendars: [],
      wbs: [],
      tasks: [],
      taskpred: [],
      resources: [],
      roles: [],
      taskrsrc: [],
      otherTableNames: [],
    },
    stats: {
      projectsParsed: 0,
      tasksParsed: 0,
      relationshipsParsed: 0,
      interprojectRelationshipsCount: 0,
      calendarsParsed: 0,
      resourcesParsed: 0,
      rolesParsed: 0,
      assignmentsParsed: 0,
      constraintsMapped: 0,
      constraintsUnsupported: 0,
      externalRelationshipsPreservedRaw: 0,
      externalProjectsMissingCount: 0,
    },
  };
}

function cloneState(s: XerEngine2ImportResult): XerEngine2ImportResult {
  return {
    ...s,
    projects: [...s.projects],
    calendars: [...s.calendars],
    activities: [...s.activities],
    activityProjectIds: { ...s.activityProjectIds },
    relationships: [...s.relationships],
    interprojectRelationships: [...s.interprojectRelationships],
    externalRelationships: [...s.externalRelationships],
    resources: [...s.resources],
    roles: [...s.roles],
    assignments: [...s.assignments],
    diagnostics: [...s.diagnostics],
    raw: { ...s.raw },
    stats: { ...s.stats },
  };
}

function recomputeStats(s: XerEngine2ImportResult): void {
  s.stats = {
    ...s.stats,
    projectsParsed: s.projects.length,
    tasksParsed: s.activities.length,
    relationshipsParsed: s.relationships.length,
    interprojectRelationshipsCount: s.interprojectRelationships.length,
    calendarsParsed: s.calendars.length,
    resourcesParsed: s.resources.length,
    rolesParsed: s.roles.length,
    assignmentsParsed: s.assignments.length,
  };
}

function noteUnsupportedDeleteCategories(
  opts: DeleteUnreferencedOptions | undefined,
  diagnostics: EngineDiagnostic[],
  unsupported: EngineDiagnostic[],
): void {
  if (!opts) return;
  const unsupportedKeys: Array<keyof DeleteUnreferencedOptions> = [
    "calendars",
    "resources",
    "roles",
  ];
  for (const k of unsupportedKeys) {
    if (opts[k]) {
      const d: EngineDiagnostic = {
        severity: "warn",
        code: "delete_unreferenced_category_unsupported",
        message: `delete-unreferenced for ${k} is preserved as a request but not yet implemented; ${k} will be left untouched.`,
      };
      diagnostics.push(d);
      unsupported.push(d);
    }
  }
}

function emptySummary(): ImportPlanSummary {
  return { create: 0, update: 0, delete: 0, preserve: 0, warnings: 0, errors: 0 };
}

function tallyEntry(s: ImportPlanSummary, e: ImportPlanEntry): void {
  s[e.kind]++;
}

function tallyDiagnostic(s: ImportPlanSummary, d: EngineDiagnostic): void {
  if (d.severity === "warn") s.warnings++;
  else if (d.severity === "error") s.errors++;
}

// ---------------------------------------------------------------------------
// Plan builders per action
// ---------------------------------------------------------------------------

interface BuildContext {
  existing: XerEngine2ImportResult;
  incoming: XerEngine2ImportResult;
  targetProjectId: string;
  options: ImportActionOptions;
  diagnostics: EngineDiagnostic[];
  unsupportedPreservedOnly: EngineDiagnostic[];
}

function planCreate(ctx: BuildContext): ImportPlan {
  const { existing, incoming, targetProjectId, diagnostics, unsupportedPreservedOnly } = ctx;
  const entries: ImportPlanEntry[] = [];
  const criticalErrors: EngineDiagnostic[] = [];

  if (existing.projects.some((p) => p.id === targetProjectId)) {
    const err: EngineDiagnostic = {
      severity: "error",
      code: "import_collision_project_id",
      message: `create-new-project: project id "${targetProjectId}" already exists in target state. Use update/replace/add-into instead.`,
    };
    diagnostics.push(err);
    criticalErrors.push(err);
  }

  // Entries: every incoming record scoped to target project becomes a "create".
  entries.push({ kind: "create", subject: "project", id: targetProjectId });
  const scope = activityScope(incoming, targetProjectId);
  for (const id of scope.activityIds) {
    entries.push({ kind: "create", subject: "activity", id });
  }
  for (const r of incoming.relationships) {
    if (scope.relationshipKeys.has(relIdentity(r))) {
      entries.push({ kind: "create", subject: "relationship", id: r.id });
    }
  }
  for (const a of incoming.assignments) {
    if (scope.assignmentIds.has(a.id)) {
      entries.push({ kind: "create", subject: "assignment", id: a.id });
    }
  }

  const summary = emptySummary();
  for (const e of entries) tallyEntry(summary, e);
  for (const d of diagnostics) tallyDiagnostic(summary, d);

  return {
    action: "create-new-project",
    targetProjectId,
    entries,
    diagnostics,
    criticalErrors,
    unsupportedPreservedOnly,
    summary,
    transactional: true,
  };
}

function planReplace(ctx: BuildContext): ImportPlan {
  const { existing, incoming, targetProjectId, diagnostics, unsupportedPreservedOnly } =
    ctx;
  const entries: ImportPlanEntry[] = [];
  const criticalErrors: EngineDiagnostic[] = [];

  if (!existing.projects.some((p) => p.id === targetProjectId)) {
    const err: EngineDiagnostic = {
      severity: "error",
      code: "import_target_project_missing",
      message: `replace-existing-project: target project id "${targetProjectId}" not found in existing state.`,
    };
    diagnostics.push(err);
    criticalErrors.push(err);
  }
  if (!incoming.projects.some((p) => p.id === targetProjectId)) {
    const err: EngineDiagnostic = {
      severity: "error",
      code: "import_target_project_missing_in_incoming",
      message: `replace-existing-project: target project id "${targetProjectId}" not found in incoming XER.`,
    };
    diagnostics.push(err);
    criticalErrors.push(err);
  }

  // Delete entire existing scope, then recreate from incoming scope.
  const oldScope = activityScope(existing, targetProjectId);
  for (const id of oldScope.activityIds) {
    entries.push({ kind: "delete", subject: "activity", id, reason: "replace" });
  }
  for (const r of existing.relationships) {
    if (oldScope.relationshipKeys.has(relIdentity(r))) {
      entries.push({ kind: "delete", subject: "relationship", id: r.id, reason: "replace" });
    }
  }
  for (const a of existing.assignments) {
    if (oldScope.assignmentIds.has(a.id)) {
      entries.push({ kind: "delete", subject: "assignment", id: a.id, reason: "replace" });
    }
  }

  const newScope = activityScope(incoming, targetProjectId);
  for (const id of newScope.activityIds) {
    entries.push({ kind: "create", subject: "activity", id });
  }
  for (const r of incoming.relationships) {
    if (newScope.relationshipKeys.has(relIdentity(r))) {
      entries.push({ kind: "create", subject: "relationship", id: r.id });
    }
  }
  for (const a of incoming.assignments) {
    if (newScope.assignmentIds.has(a.id)) {
      entries.push({ kind: "create", subject: "assignment", id: a.id });
    }
  }

  const summary = emptySummary();
  for (const e of entries) tallyEntry(summary, e);
  for (const d of diagnostics) tallyDiagnostic(summary, d);

  return {
    action: "replace-existing-project",
    targetProjectId,
    entries,
    diagnostics,
    criticalErrors,
    unsupportedPreservedOnly,
    summary,
    transactional: true,
  };
}

function planUpdate(ctx: BuildContext): ImportPlan {
  const { existing, incoming, targetProjectId, options, diagnostics, unsupportedPreservedOnly } =
    ctx;
  const entries: ImportPlanEntry[] = [];
  const criticalErrors: EngineDiagnostic[] = [];

  if (!existing.projects.some((p) => p.id === targetProjectId)) {
    const err: EngineDiagnostic = {
      severity: "error",
      code: "import_target_project_missing",
      message: `update-existing-project: target project id "${targetProjectId}" not found in existing state.`,
    };
    diagnostics.push(err);
    criticalErrors.push(err);
  }
  if (!incoming.projects.some((p) => p.id === targetProjectId)) {
    const err: EngineDiagnostic = {
      severity: "error",
      code: "import_target_project_missing_in_incoming",
      message: `update-existing-project: target project id "${targetProjectId}" not found in incoming XER.`,
    };
    diagnostics.push(err);
    criticalErrors.push(err);
  }

  const oldScope = activityScope(existing, targetProjectId);
  const newScope = activityScope(incoming, targetProjectId);

  const existingActivityById = new Map(
    existing.activities.filter((a) => oldScope.activityIds.has(a.id)).map((a) => [a.id, a]),
  );
  const incomingActivityById = new Map(
    incoming.activities.filter((a) => newScope.activityIds.has(a.id)).map((a) => [a.id, a]),
  );

  // Activities: create / update / preserve / (optional) delete unreferenced.
  for (const [id, inc] of incomingActivityById) {
    const ex = existingActivityById.get(id);
    if (!ex) {
      entries.push({ kind: "create", subject: "activity", id });
    } else if (!shallowEqualActivity(ex, inc)) {
      entries.push({ kind: "update", subject: "activity", id });
    } else {
      entries.push({ kind: "preserve", subject: "activity", id, reason: "unchanged" });
    }
  }
  for (const id of oldScope.activityIds) {
    if (!incomingActivityById.has(id)) {
      if (options.deleteUnreferenced?.activities) {
        entries.push({
          kind: "delete",
          subject: "activity",
          id,
          reason: "delete-unreferenced",
        });
      } else {
        entries.push({
          kind: "preserve",
          subject: "activity",
          id,
          reason: "not-in-incoming",
        });
      }
    }
  }

  // Relationships
  const existingRelByKey = new Map<string, EngineRelationship>();
  for (const r of existing.relationships) {
    if (oldScope.relationshipKeys.has(relIdentity(r))) existingRelByKey.set(relIdentity(r), r);
  }
  const incomingRelByKey = new Map<string, EngineRelationship>();
  for (const r of incoming.relationships) {
    if (newScope.relationshipKeys.has(relIdentity(r))) incomingRelByKey.set(relIdentity(r), r);
  }
  for (const [key, inc] of incomingRelByKey) {
    const ex = existingRelByKey.get(key);
    if (!ex) {
      entries.push({ kind: "create", subject: "relationship", id: inc.id });
    } else if (
      ex.lag.minutes !== inc.lag.minutes ||
      ex.lagCalendarBasis !== inc.lagCalendarBasis
    ) {
      entries.push({ kind: "update", subject: "relationship", id: inc.id });
    } else {
      entries.push({
        kind: "preserve",
        subject: "relationship",
        id: ex.id,
        reason: "unchanged",
      });
    }
  }
  for (const [key, ex] of existingRelByKey) {
    if (!incomingRelByKey.has(key)) {
      if (options.deleteUnreferenced?.relationships) {
        entries.push({
          kind: "delete",
          subject: "relationship",
          id: ex.id,
          reason: "delete-unreferenced",
        });
      } else {
        entries.push({
          kind: "preserve",
          subject: "relationship",
          id: ex.id,
          reason: "not-in-incoming",
        });
      }
    }
  }

  // Assignments
  const existingAssignById = new Map(
    existing.assignments.filter((a) => oldScope.assignmentIds.has(a.id)).map((a) => [a.id, a]),
  );
  const incomingAssignById = new Map(
    incoming.assignments.filter((a) => newScope.assignmentIds.has(a.id)).map((a) => [a.id, a]),
  );
  for (const [id, inc] of incomingAssignById) {
    const ex = existingAssignById.get(id);
    if (!ex) entries.push({ kind: "create", subject: "assignment", id });
    else if (!shallowEqualAssignment(ex, inc))
      entries.push({ kind: "update", subject: "assignment", id });
    else
      entries.push({ kind: "preserve", subject: "assignment", id, reason: "unchanged" });
  }
  for (const id of oldScope.assignmentIds) {
    if (!incomingAssignById.has(id)) {
      if (options.deleteUnreferenced?.assignments) {
        entries.push({
          kind: "delete",
          subject: "assignment",
          id,
          reason: "delete-unreferenced",
        });
      } else {
        entries.push({
          kind: "preserve",
          subject: "assignment",
          id,
          reason: "not-in-incoming",
        });
      }
    }
  }

  const summary = emptySummary();
  for (const e of entries) tallyEntry(summary, e);
  for (const d of diagnostics) tallyDiagnostic(summary, d);

  return {
    action: "update-existing-project",
    targetProjectId,
    entries,
    diagnostics,
    criticalErrors,
    unsupportedPreservedOnly,
    summary,
    transactional: true,
  };
}

function planAddInto(ctx: BuildContext): ImportPlan {
  const { existing, incoming, targetProjectId, diagnostics, unsupportedPreservedOnly } =
    ctx;
  const entries: ImportPlanEntry[] = [];
  const criticalErrors: EngineDiagnostic[] = [];

  if (!existing.projects.some((p) => p.id === targetProjectId)) {
    const err: EngineDiagnostic = {
      severity: "error",
      code: "import_target_project_missing",
      message: `add-into-existing-project: target project id "${targetProjectId}" not found in existing state.`,
    };
    diagnostics.push(err);
    criticalErrors.push(err);
  }
  // The source project id in incoming may differ from the target id;
  // we let the caller specify only the target, and merge from
  // `incoming.projects[0]` if the incoming side has only one.
  const incomingSourceProjectId =
    incoming.projects.find((p) => p.id === targetProjectId)?.id ??
    incoming.projects[0]?.id;

  if (!incomingSourceProjectId) {
    const err: EngineDiagnostic = {
      severity: "error",
      code: "import_target_project_missing_in_incoming",
      message: `add-into-existing-project: incoming XER has no projects to merge.`,
    };
    diagnostics.push(err);
    criticalErrors.push(err);
    const summary = emptySummary();
    for (const d of diagnostics) tallyDiagnostic(summary, d);
    return {
      action: "add-into-existing-project",
      targetProjectId,
      entries,
      diagnostics,
      criticalErrors,
      unsupportedPreservedOnly,
      summary,
      transactional: true,
    };
  }

  const oldScope = activityScope(existing, targetProjectId);
  const newScope = activityScope(incoming, incomingSourceProjectId);

  // Activities: detect collisions on id.
  for (const id of newScope.activityIds) {
    if (oldScope.activityIds.has(id)) {
      const d: EngineDiagnostic = {
        severity: "warn",
        code: "activity_id_collision",
        message: `add-into-existing-project: incoming activity "${id}" collides with existing activity in project "${targetProjectId}"; existing record preserved, incoming skipped.`,
        activityId: id,
      };
      diagnostics.push(d);
      entries.push({ kind: "preserve", subject: "activity", id, reason: "collision" });
    } else {
      entries.push({ kind: "create", subject: "activity", id });
    }
  }
  // Relationships: only those whose both endpoints will exist in merged state.
  const mergedActivityIds = new Set<string>([...oldScope.activityIds, ...newScope.activityIds]);
  for (const r of incoming.relationships) {
    if (!newScope.relationshipKeys.has(relIdentity(r))) continue;
    if (!mergedActivityIds.has(r.from) || !mergedActivityIds.has(r.to)) {
      diagnostics.push({
        severity: "warn",
        code: "relationship_endpoint_missing",
        message: `add-into-existing-project: relationship ${r.id} endpoint missing in merged state; skipped.`,
      });
      continue;
    }
    const key = relIdentity(r);
    const alreadyExists = existing.relationships.some(
      (er) => relIdentity(er) === key,
    );
    if (alreadyExists) {
      entries.push({
        kind: "preserve",
        subject: "relationship",
        id: r.id,
        reason: "already-present",
      });
    } else {
      entries.push({ kind: "create", subject: "relationship", id: r.id });
    }
  }
  // Assignments: incoming ids may collide with existing taskrsrc ids.
  const existingAssignIds = new Set(existing.assignments.map((a) => a.id));
  for (const a of incoming.assignments) {
    if (!newScope.assignmentIds.has(a.id)) continue;
    if (existingAssignIds.has(a.id)) {
      diagnostics.push({
        severity: "warn",
        code: "assignment_id_collision",
        message: `add-into-existing-project: incoming assignment "${a.id}" collides with existing; existing preserved.`,
      });
      entries.push({ kind: "preserve", subject: "assignment", id: a.id, reason: "collision" });
    } else {
      entries.push({ kind: "create", subject: "assignment", id: a.id });
    }
  }

  const summary = emptySummary();
  for (const e of entries) tallyEntry(summary, e);
  for (const d of diagnostics) tallyDiagnostic(summary, d);

  return {
    action: "add-into-existing-project",
    targetProjectId,
    entries,
    diagnostics,
    criticalErrors,
    unsupportedPreservedOnly,
    summary,
    transactional: true,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PlanArgs {
  /** Current engine2 state. Pass `undefined` to start from an empty state. */
  existing?: XerEngine2ImportResult;
  incoming: XerEngine2ImportResult;
  options: ImportActionOptions;
}

export function planImportAction(args: PlanArgs): ImportPlan {
  const existing = args.existing ?? emptyState();
  const incoming = args.incoming;
  const targetProjectId =
    args.options.targetProjectId ?? incoming.projects[0]?.id ?? "proj-unknown";
  const diagnostics: EngineDiagnostic[] = [];
  const unsupportedPreservedOnly: EngineDiagnostic[] = [];
  noteUnsupportedDeleteCategories(
    args.options.deleteUnreferenced,
    diagnostics,
    unsupportedPreservedOnly,
  );

  const ctx: BuildContext = {
    existing,
    incoming,
    targetProjectId,
    options: args.options,
    diagnostics,
    unsupportedPreservedOnly,
  };

  switch (args.options.action) {
    case "create-new-project":
      return planCreate(ctx);
    case "replace-existing-project":
      return planReplace(ctx);
    case "update-existing-project":
      return planUpdate(ctx);
    case "add-into-existing-project":
      return planAddInto(ctx);
  }
}

export function applyImportAction(args: PlanArgs): ImportApplyResult {
  const existing = args.existing ?? emptyState();
  const plan = planImportAction({ ...args, existing });

  if (plan.criticalErrors.length > 0) {
    return {
      ok: false,
      plan,
      state: existing,
      diagnostics: [
        {
          severity: "error",
          code: "import_action_aborted",
          message: `Import action "${plan.action}" aborted: ${plan.criticalErrors.length} critical error(s). No state changes applied.`,
        },
      ],
    };
  }

  const incoming = args.incoming;
  const targetProjectId = plan.targetProjectId;
  const next = cloneState(existing);
  const applyDiags: EngineDiagnostic[] = [];

  // Build a quick lookup of entries
  const entryIndex = new Map<string, ImportPlanEntry>();
  for (const e of plan.entries) entryIndex.set(`${e.subject}:${e.id}`, e);

  switch (plan.action) {
    case "create-new-project":
      mergeCreate(next, incoming, targetProjectId);
      break;
    case "replace-existing-project":
      mergeReplace(next, incoming, targetProjectId);
      break;
    case "update-existing-project":
      mergeUpdate(next, incoming, targetProjectId, plan);
      break;
    case "add-into-existing-project":
      mergeAddInto(next, incoming, targetProjectId, plan);
      break;
  }

  recomputeStats(next);
  applyDiags.push({
    severity: "info",
    code: "import_action_applied",
    message: `Import action "${plan.action}" applied to project "${targetProjectId}": ${plan.summary.create} created, ${plan.summary.update} updated, ${plan.summary.delete} deleted, ${plan.summary.preserve} preserved.`,
  });
  next.diagnostics = [...next.diagnostics, ...plan.diagnostics, ...applyDiags];

  return { ok: true, plan, state: next, diagnostics: applyDiags };
}

// ---------------------------------------------------------------------------
// Merge implementations
// ---------------------------------------------------------------------------

function mergeCreate(
  next: XerEngine2ImportResult,
  incoming: XerEngine2ImportResult,
  targetProjectId: string,
): void {
  const proj = incoming.projects.find((p) => p.id === targetProjectId);
  if (proj) next.projects.push(proj);
  copyProjectScope(next, incoming, targetProjectId);
  if (!next.defaultCalendarId || next.defaultCalendarId === "cal-default") {
    next.defaultCalendarId = incoming.defaultCalendarId;
  }
  if (next.projects.length === 1) {
    next.projectName = next.projects[0].name;
    next.projectStartDate = next.projects[0].planStartDate;
    next.dataDate = next.projects[0].dataDate;
  }
}

function mergeReplace(
  next: XerEngine2ImportResult,
  incoming: XerEngine2ImportResult,
  targetProjectId: string,
): void {
  removeProjectScope(next, targetProjectId);
  const proj = incoming.projects.find((p) => p.id === targetProjectId);
  if (proj) {
    const idx = next.projects.findIndex((p) => p.id === targetProjectId);
    if (idx >= 0) next.projects[idx] = proj;
    else next.projects.push(proj);
  }
  copyProjectScope(next, incoming, targetProjectId);
}

function mergeUpdate(
  next: XerEngine2ImportResult,
  incoming: XerEngine2ImportResult,
  targetProjectId: string,
  plan: ImportPlan,
): void {
  const incScope = activityScope(incoming, targetProjectId);

  const toDeleteActivities = new Set(
    plan.entries
      .filter((e) => e.subject === "activity" && e.kind === "delete")
      .map((e) => e.id),
  );
  const toDeleteRels = new Set(
    plan.entries
      .filter((e) => e.subject === "relationship" && e.kind === "delete")
      .map((e) => e.id),
  );
  const toDeleteAssigns = new Set(
    plan.entries
      .filter((e) => e.subject === "assignment" && e.kind === "delete")
      .map((e) => e.id),
  );

  // Activity update / create / delete.
  const incomingActById = new Map(
    incoming.activities.filter((a) => incScope.activityIds.has(a.id)).map((a) => [a.id, a]),
  );
  next.activities = next.activities.filter((a) => {
    if (next.activityProjectIds[a.id] !== targetProjectId) return true;
    if (toDeleteActivities.has(a.id)) {
      delete next.activityProjectIds[a.id];
      return false;
    }
    const inc = incomingActById.get(a.id);
    if (inc) {
      // Replace fields in-place by substituting the activity object.
      Object.assign(a, inc);
    }
    return true;
  });
  // Append new ones (in incoming but not in existing).
  const existingIds = new Set(next.activities.map((a) => a.id));
  for (const [id, inc] of incomingActById) {
    if (!existingIds.has(id)) {
      next.activities.push(inc);
      next.activityProjectIds[id] = targetProjectId;
    }
  }

  // Relationships
  const incomingRelByKey = new Map<string, EngineRelationship>();
  for (const r of incoming.relationships) {
    if (incScope.relationshipKeys.has(relIdentity(r))) {
      incomingRelByKey.set(relIdentity(r), r);
    }
  }
  next.relationships = next.relationships.filter((r) => {
    const inScope =
      next.activityProjectIds[r.from] === targetProjectId &&
      next.activityProjectIds[r.to] === targetProjectId;
    if (!inScope) return true;
    if (toDeleteRels.has(r.id)) return false;
    const inc = incomingRelByKey.get(relIdentity(r));
    if (inc) Object.assign(r, inc);
    return true;
  });
  const existingKeys = new Set(next.relationships.map(relIdentity));
  for (const [key, inc] of incomingRelByKey) {
    if (!existingKeys.has(key)) next.relationships.push(inc);
  }

  // Assignments
  const incomingAssignById = new Map(
    incoming.assignments.filter((a) => incScope.assignmentIds.has(a.id)).map((a) => [a.id, a]),
  );
  next.assignments = next.assignments.filter((a) => {
    if (next.activityProjectIds[a.activityId] !== targetProjectId) return true;
    if (toDeleteAssigns.has(a.id)) return false;
    const inc = incomingAssignById.get(a.id);
    if (inc) Object.assign(a, inc);
    return true;
  });
  const existingAssignIds = new Set(next.assignments.map((a) => a.id));
  for (const [id, inc] of incomingAssignById) {
    if (!existingAssignIds.has(id)) next.assignments.push(inc);
  }

  // Refresh project header fields from incoming.
  const proj = incoming.projects.find((p) => p.id === targetProjectId);
  if (proj) {
    const idx = next.projects.findIndex((p) => p.id === targetProjectId);
    if (idx >= 0) next.projects[idx] = proj;
  }
}

function mergeAddInto(
  next: XerEngine2ImportResult,
  incoming: XerEngine2ImportResult,
  targetProjectId: string,
  plan: ImportPlan,
): void {
  const incomingSourceProjectId =
    incoming.projects.find((p) => p.id === targetProjectId)?.id ??
    incoming.projects[0]?.id;
  if (!incomingSourceProjectId) return;
  const incScope = activityScope(incoming, incomingSourceProjectId);

  const createActivityIds = new Set(
    plan.entries.filter((e) => e.subject === "activity" && e.kind === "create").map((e) => e.id),
  );
  const createRelIds = new Set(
    plan.entries.filter((e) => e.subject === "relationship" && e.kind === "create").map((e) => e.id),
  );
  const createAssignIds = new Set(
    plan.entries.filter((e) => e.subject === "assignment" && e.kind === "create").map((e) => e.id),
  );

  for (const id of incScope.activityIds) {
    if (!createActivityIds.has(id)) continue;
    const inc = incoming.activities.find((a) => a.id === id);
    if (!inc) continue;
    next.activities.push(inc);
    next.activityProjectIds[id] = targetProjectId;
  }
  for (const r of incoming.relationships) {
    if (!createRelIds.has(r.id)) continue;
    next.relationships.push(r);
  }
  for (const a of incoming.assignments) {
    if (!createAssignIds.has(a.id)) continue;
    next.assignments.push(a);
  }
}

// ---------------------------------------------------------------------------
// Scope copy / remove
// ---------------------------------------------------------------------------

function copyProjectScope(
  next: XerEngine2ImportResult,
  incoming: XerEngine2ImportResult,
  projectId: string,
): void {
  const scope = activityScope(incoming, projectId);
  for (const a of incoming.activities) {
    if (scope.activityIds.has(a.id)) {
      next.activities.push(a);
      next.activityProjectIds[a.id] = projectId;
    }
  }
  for (const r of incoming.relationships) {
    if (scope.relationshipKeys.has(relIdentity(r))) next.relationships.push(r);
  }
  for (const a of incoming.assignments) {
    if (scope.assignmentIds.has(a.id)) next.assignments.push(a);
  }
  // Merge calendars/resources/roles in best-effort (de-duped by id).
  const calIds = new Set(next.calendars.map((c) => c.id));
  for (const c of incoming.calendars) if (!calIds.has(c.id)) next.calendars.push(c);
  const resIds = new Set(next.resources.map((r) => r.id));
  for (const r of incoming.resources) if (!resIds.has(r.id)) next.resources.push(r);
  const roleIds = new Set(next.roles.map((r) => r.id));
  for (const r of incoming.roles) if (!roleIds.has(r.id)) next.roles.push(r);

  // External/interproject records pulled along too (filtered to project).
  for (const ip of incoming.interprojectRelationships) {
    if (ip.predProjectId === projectId || ip.succProjectId === projectId) {
      next.interprojectRelationships.push(ip);
    }
  }
  for (const ex of incoming.externalRelationships) {
    if (ex.predProjectId === projectId || ex.succProjectId === projectId) {
      next.externalRelationships.push(ex);
    }
  }
}

function removeProjectScope(
  state: XerEngine2ImportResult,
  projectId: string,
): void {
  const scope = activityScope(state, projectId);
  state.activities = state.activities.filter((a) => !scope.activityIds.has(a.id));
  for (const id of scope.activityIds) delete state.activityProjectIds[id];
  state.relationships = state.relationships.filter(
    (r) => !scope.relationshipKeys.has(relIdentity(r)),
  );
  state.assignments = state.assignments.filter((a) => !scope.assignmentIds.has(a.id));
  state.interprojectRelationships = state.interprojectRelationships.filter(
    (ip) => ip.predProjectId !== projectId && ip.succProjectId !== projectId,
  );
  state.externalRelationships = state.externalRelationships.filter(
    (ex) => ex.predProjectId !== projectId && ex.succProjectId !== projectId,
  );
  // Project header removed last.
  state.projects = state.projects.filter((p) => p.id !== projectId);
}

// ---------------------------------------------------------------------------
// Re-exports for callers
// ---------------------------------------------------------------------------

export type {
  EngineActivity,
  EngineRelationship,
  ResourceAssignment,
  XerEngine2ImportResult,
  XerProject,
  InterprojectRelationshipRecord,
  ExternalRelationshipRecord,
};

/** Version bump marker. */
export const ENGINE2_XER_IMPORT_ACTIONS_VERSION = "0.10.0-phase2.0";
