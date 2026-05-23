/**
 * engine2 XER Import — Phase 1.7
 *
 * Higher-fidelity XER reader that preserves more Primavera/P6 semantics in
 * engine2's internal model. This is intentionally SEPARATE from the legacy
 * `src/lib/scheduler/xer.ts` importer — the legacy importer still powers
 * the production UI (XerImportButton) and the legacy engine, untouched.
 *
 * Scope of this pass (per Phase 1.7):
 *  - Parse PROJECT / PROJWBS / TASK / TASKPRED (same as legacy, but mapped
 *    into engine2 shapes).
 *  - Parse CALENDAR identity + work-day flags + holidays where parseable.
 *  - Map supported constraints: SNET, SNLT, FNET, FNLT, MSO, MFO, ALAP.
 *  - Map actuals/progress: actual_start, actual_end, remaining/original
 *    duration hours, percent complete + percent complete type, status.
 *  - Map activity type + duration type into engine2 enums.
 *  - Parse RSRC / ROLES / TASKRSRC into engine2 resource/assignment shapes.
 *  - Emit structured diagnostics rather than silently dropping data.
 *  - Preserve raw rows so future reconciliation/export work has the data.
 *
 * NOT in scope for 1.7:
 *  - Calendar shifts / non-uniform hours-per-day → diagnostic, preserved raw.
 *  - Full P6 duration-type behavior → preserved verbatim, no behavior change.
 *  - Auto-running leveling, baseline reconstruction, XER export, or
 *    Update/Replace/Add-Into import strategies.
 */

import type {
  ActivityType,
  Constraint,
  ConstraintType,
  DurationType,
  EngineActivity,
  EngineDiagnostic,
  EngineRelationship,
  Instant,
  PercentCompleteType,
  RelationshipType,
  Resource,
  ResourceAssignment,
  ResourceType,
  Role,
} from "./types";

// ---------------------------------------------------------------------------
// Generic XER block parser
// ---------------------------------------------------------------------------

export type XerRow = Record<string, string>;
export type XerTables = Map<string, XerRow[]>;

export function parseXerTables(text: string): XerTables {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const tables: XerTables = new Map();
  let table: string | null = null;
  let fields: string[] | null = null;
  let rows: XerRow[] | null = null;

  for (const raw of lines) {
    if (!raw) continue;
    const parts = raw.split("\t");
    const tag = parts[0];
    if (tag === "%T") {
      if (table && rows) tables.set(table, rows);
      table = parts[1] ?? null;
      fields = null;
      rows = [];
    } else if (tag === "%F" && table) {
      fields = parts.slice(1);
    } else if (tag === "%R" && table && fields && rows) {
      const vals = parts.slice(1);
      const row: XerRow = {};
      for (let i = 0; i < fields.length; i++) row[fields[i]] = vals[i] ?? "";
      rows.push(row);
    } else if (tag === "%E") {
      if (table && rows) tables.set(table, rows);
      table = null;
      fields = null;
      rows = null;
    }
  }
  if (table && rows) tables.set(table, rows);
  return tables;
}

// ---------------------------------------------------------------------------
// Field-level helpers
// ---------------------------------------------------------------------------

function parseInstant(s: string | undefined): Instant | undefined {
  if (!s) return undefined;
  // P6: "YYYY-MM-DD HH:mm" (most common) or "YYYY-MM-DD"
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s.trim());
  if (!m) return undefined;
  const y = +m[1];
  const mo = +m[2] - 1;
  const d = +m[3];
  const hh = m[4] ? +m[4] : 0;
  const mm = m[5] ? +m[5] : 0;
  return Date.UTC(y, mo, d, hh, mm);
}

function parseDateOnly(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

function num(s: string | undefined): number {
  if (!s) return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

const RELATIONSHIP_MAP: Record<string, RelationshipType> = {
  PR_FS: "FS",
  PR_SS: "SS",
  PR_FF: "FF",
  PR_SF: "SF",
};

// CSTR_* identifier set seen in real XER exports.
const CONSTRAINT_MAP: Record<string, ConstraintType> = {
  CS_MSO: "snet",
  CS_MSOB: "snlt",
  CS_MEO: "fnlt",
  CS_MEOB: "fnlt",
  CS_MEOA: "fnet",
  CS_MANDFIN: "mfo",
  CS_MANDSTART: "mso",
  CS_ALAP: "alap",
  CS_MSOA: "snet",
};

// activity type (task_type) → engine2 ActivityType
const ACTIVITY_TYPE_MAP: Record<string, ActivityType | "unsupported"> = {
  TT_Task: "task",
  TT_Rsrc: "resource",
  TT_LOE: "loe",
  TT_Mile: "milestone-finish",
  TT_FinMile: "milestone-finish",
  TT_StartMile: "milestone-start",
  TT_WBS: "wbs-summary",
  TT_WbsSum: "wbs-summary",
};

// duration type (duration_type) → engine2 DurationType
const DURATION_TYPE_MAP: Record<string, DurationType | "unsupported"> = {
  DT_FixedDUR: "fixed-dur-units",
  DT_FixedDUR2: "fixed-dur-units-per-time",
  DT_FixedQty: "fixed-units",
  DT_FixedRate: "fixed-units-per-time",
};

const PERCENT_TYPE_MAP: Record<string, PercentCompleteType | "unsupported"> = {
  CP_Drtn: "duration",
  CP_Phys: "physical",
  CP_Units: "units",
};

const RESOURCE_TYPE_MAP: Record<string, ResourceType> = {
  RT_Labor: "labor",
  RT_Mat: "material",
  RT_Equip: "nonlabor",
};

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

export interface XerCalendarRaw {
  id: string;
  name: string;
  type?: string;
  hoursPerDay?: number;
  workDays?: boolean[]; // index 0..6 = Sun..Sat
  holidays?: string[]; // ISO date strings (UTC day boundary)
  raw: XerRow;
}

/** Phase 1.9 — preserved per-project header. */
export interface XerProject {
  /** XER `proj_id`. May be synthesized when PROJECT omits it. */
  id: string;
  shortName: string;
  name: string;
  planStartDate?: string;
  dataDate?: Instant;
  raw: XerRow;
}

/**
 * Phase 1.9 — relationship between activities in two DIFFERENT projects
 * where both projects are present in this XER. Wired into engine2's
 * graph normally; this record exists for reporting/reconciliation.
 */
export interface InterprojectRelationshipRecord {
  relationshipId: string;
  predProjectId: string;
  succProjectId: string;
  predActivityId: string;
  succActivityId: string;
  predTaskXerId: string;
  succTaskXerId: string;
  type: RelationshipType;
  lagMinutes: number;
  raw: XerRow;
}

/**
 * Phase 1.9 — relationship to/from an activity (or whole project) NOT
 * present in this XER. Identity preserved raw; NOT added to the engine
 * graph. External dates must be supplied elsewhere to schedule it.
 */
export interface ExternalRelationshipRecord {
  predProjectId?: string;
  succProjectId?: string;
  predTaskXerId: string;
  succTaskXerId: string;
  type: RelationshipType;
  lagMinutes: number;
  predProjectMissing: boolean;
  succProjectMissing: boolean;
  activityMissing: boolean;
  raw: XerRow;
}

export interface XerRawPreservation {
  projects: XerRow[];
  calendars: XerRow[];
  wbs: XerRow[];
  tasks: XerRow[];
  taskpred: XerRow[];
  resources: XerRow[];
  roles: XerRow[];
  taskrsrc: XerRow[];
  /** Tables we encountered but did not interpret. Keys preserved. */
  otherTableNames: string[];
}

export interface XerEngine2ImportResult {
  /** Backwards-compatible single-project header (first PROJECT row). */
  projectName: string;
  projectStartDate?: string;
  /** P6 data date (last_recalc_date) when present in first PROJECT row. */
  dataDate?: Instant;

  /** Phase 1.9 — every PROJECT row imported. */
  projects: XerProject[];

  calendars: XerCalendarRaw[];
  /** Calendar id → activity calendar mapping used for engine2 activities. */
  defaultCalendarId: string;

  activities: EngineActivity[];
  /** Phase 1.9 — internal activityId → projectId. */
  activityProjectIds: Record<string, string>;
  relationships: EngineRelationship[];
  /** Phase 1.9 — cross-project relationships where BOTH projects are present. */
  interprojectRelationships: InterprojectRelationshipRecord[];
  /** Phase 1.9 — relationships referencing tasks/projects NOT in this XER. */
  externalRelationships: ExternalRelationshipRecord[];

  resources: Resource[];
  roles: Role[];
  assignments: ResourceAssignment[];

  diagnostics: EngineDiagnostic[];
  raw: XerRawPreservation;

  stats: {
    projectsParsed: number;
    tasksParsed: number;
    relationshipsParsed: number;
    interprojectRelationshipsCount: number;
    calendarsParsed: number;
    resourcesParsed: number;
    rolesParsed: number;
    assignmentsParsed: number;
    constraintsMapped: number;
    constraintsUnsupported: number;
    externalRelationshipsPreservedRaw: number;
    externalProjectsMissingCount: number;
  };
}

// ---------------------------------------------------------------------------
// Calendar parsing
// ---------------------------------------------------------------------------

/**
 * P6 stores calendar definitions in `clndr_data`, an embedded
 * pseudo-property-list. We do NOT attempt a full parse here — that is a
 * follow-up pass. Instead, we extract the bits that are reliably present
 * (hours-per-day, day-of-week working flags, explicit holiday dates) and
 * emit diagnostics for the rest.
 */
function parseCalendarRow(
  row: XerRow,
  diagnostics: EngineDiagnostic[],
): XerCalendarRaw {
  const id = row["clndr_id"] || `cal-${row["clndr_name"] || "unknown"}`;
  const name = row["clndr_name"] || id;
  const type = row["clndr_type"] || undefined;

  const hpdRaw = row["day_hr_cnt"];
  const hoursPerDay = hpdRaw ? num(hpdRaw) : undefined;

  const data = row["clndr_data"] ?? "";
  const workDays: boolean[] = [false, false, false, false, false, false, false];
  const holidays: string[] = [];

  if (data) {
    // Detect work days from "(0||N()(...))" patterns. P6 numbers days 1..7
    // starting Sunday=1.
    const dayBlockRe = /\(0\|\|(\d)\(\)\s*\(([^)]*)\)/g;
    let dm: RegExpExecArray | null;
    while ((dm = dayBlockRe.exec(data))) {
      const dayIndex = (parseInt(dm[1], 10) - 1) & 7;
      if (dayIndex >= 0 && dayIndex < 7) {
        // If the inner block has any "s|...|f|..." shift, treat as working.
        if (/s\|/.test(dm[2])) workDays[dayIndex] = true;
      }
    }

    // Detect explicit exception dates: "d|YYYY-MM-DD"
    const excRe = /d\|(\d{4}-\d{2}-\d{2})/g;
    let em: RegExpExecArray | null;
    while ((em = excRe.exec(data))) holidays.push(em[1]);

    // Per-day hour variation / non-uniform shifts: flag once.
    if (/s\|\d{2}:\d{2}\|f\|\d{2}:\d{2}.*\n.*s\|/s.test(data)) {
      diagnostics.push({
        severity: "info",
        code: "unsupported_calendar_shift",
        message: `Calendar "${name}" defines shifts; engine2 treats it as whole-day for now.`,
      });
    }
    if (hoursPerDay && hoursPerDay !== 8) {
      diagnostics.push({
        severity: "info",
        code: "unsupported_calendar_hours_per_day",
        message: `Calendar "${name}" has hours-per-day=${hoursPerDay}; preserved raw, engine2 still computes against authoring duration.`,
      });
    }
  }

  return {
    id,
    name,
    type,
    hoursPerDay,
    workDays: data ? workDays : undefined,
    holidays: holidays.length ? holidays : undefined,
    raw: row,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface XerEngine2ImportOptions {
  /** Default hours-per-day when calendar row omits it. */
  hoursPerDay?: number;
  /** Default calendar id used when a TASK row has no clndr_id reference. */
  fallbackCalendarId?: string;
}

export function importXerForEngine2(
  text: string,
  options: XerEngine2ImportOptions = {},
): XerEngine2ImportResult {
  const hoursPerDay = options.hoursPerDay ?? 8;
  const minutesPerHour = 60;

  const tables = parseXerTables(text);
  const diagnostics: EngineDiagnostic[] = [];

  const projectRows = tables.get("PROJECT") ?? [];
  const wbsRows = tables.get("PROJWBS") ?? [];
  const taskRows = tables.get("TASK") ?? [];
  const predRows = tables.get("TASKPRED") ?? [];
  const calendarRows = tables.get("CALENDAR") ?? [];
  const rsrcRows = tables.get("RSRC") ?? [];
  const roleRows = tables.get("ROLES") ?? [];
  const taskrsrcRows = tables.get("TASKRSRC") ?? [];

  const handledTables = new Set([
    "PROJECT",
    "PROJWBS",
    "TASK",
    "TASKPRED",
    "CALENDAR",
    "RSRC",
    "ROLES",
    "TASKRSRC",
  ]);
  const otherTableNames: string[] = [];
  for (const name of tables.keys()) {
    if (!handledTables.has(name)) otherTableNames.push(name);
  }

  // -- Project header(s) — Phase 1.9 multi-project support.
  const projects: XerProject[] = [];
  for (let i = 0; i < projectRows.length; i++) {
    const r = projectRows[i];
    const id =
      r["proj_id"]?.trim() ||
      r["proj_short_name"]?.trim() ||
      `proj-${i + 1}`;
    projects.push({
      id,
      shortName: (r["proj_short_name"] || r["proj_name"] || id).trim(),
      name: (r["proj_name"] || r["proj_short_name"] || id).trim(),
      planStartDate: parseDateOnly(r["plan_start_date"] || r["scd_end_date"]),
      dataDate:
        parseInstant(r["last_recalc_date"]) ??
        parseInstant(r["plan_start_date"]),
      raw: r,
    });
  }
  const projectIdSet = new Set(projects.map((p) => p.id));
  const primaryProject = projects[0];
  const projectName = primaryProject?.name || "Imported P6 schedule";
  const projectStartDate = primaryProject?.planStartDate;
  const dataDate = primaryProject?.dataDate;

  // -- Calendars
  const calendars: XerCalendarRaw[] = [];
  for (const r of calendarRows) calendars.push(parseCalendarRow(r, diagnostics));
  const calendarById = new Map<string, XerCalendarRaw>();
  for (const c of calendars) calendarById.set(c.id, c);

  const fallbackCalendarId =
    options.fallbackCalendarId ?? calendars[0]?.id ?? "cal-default";

  // -- Resources & roles
  const roles: Role[] = [];
  for (const r of roleRows) {
    const id = r["role_id"];
    if (!id) continue;
    roles.push({
      id,
      name: (r["role_name"] || r["role_short_name"] || id).trim(),
    });
  }

  const resources: Resource[] = [];
  for (const r of rsrcRows) {
    const id = r["rsrc_id"];
    if (!id) continue;
    const typeRaw = r["rsrc_type"] || "RT_Labor";
    const type = RESOURCE_TYPE_MAP[typeRaw] ?? "labor";
    const calendarId = r["clndr_id"] || undefined;
    if (calendarId && !calendarById.has(calendarId)) {
      diagnostics.push({
        severity: "warn",
        code: "missing_calendar_reference",
        message: `Resource "${id}" references calendar ${calendarId} not in CALENDAR table.`,
      });
    }
    if (calendarId) {
      // Phase 1.5 stance: resource calendars stored but do not drive dates yet.
      diagnostics.push({
        severity: "info",
        code: "resource_calendar_deferred",
        message: `Resource "${id}" calendar ${calendarId} preserved; activity calendar still governs CPM dates.`,
      });
    }
    resources.push({
      id,
      name: (r["rsrc_name"] || r["rsrc_short_name"] || id).trim(),
      type,
      calendarId,
    });
  }

  // -- Tasks (activities)
  const activities: EngineActivity[] = [];
  const taskIdByXer = new Map<string, string>();
  /** Phase 1.9 — xer task_id → owning xer proj_id. */
  const taskProjectByXer = new Map<string, string>();
  /** Phase 1.9 — internal activity id → owning xer proj_id. */
  const activityProjectIds: Record<string, string> = {};
  const seen = new Set<string>();
  let constraintsMapped = 0;
  let constraintsUnsupported = 0;
  const defaultProjectId = primaryProject?.id ?? "proj-unknown";

  for (const t of taskRows) {
    const xerId = t["task_id"];
    if (!xerId) continue;

    const code = (t["task_code"] || `A${xerId}`).trim();
    let unique = code;
    let n = 2;
    while (seen.has(unique)) unique = `${code}_${n++}`;
    seen.add(unique);
    taskIdByXer.set(xerId, unique);
    const taskProjId = (t["proj_id"] || "").trim() || defaultProjectId;
    taskProjectByXer.set(xerId, taskProjId);
    activityProjectIds[unique] = taskProjId;

    const calendarId = t["clndr_id"] || fallbackCalendarId;
    if (t["clndr_id"] && !calendarById.has(t["clndr_id"])) {
      diagnostics.push({
        severity: "warn",
        code: "missing_calendar_reference",
        message: `Activity ${code} references calendar ${t["clndr_id"]} not in CALENDAR table.`,
        activityId: unique,
      });
    }

    // Duration: P6 stores in hours. Convert to engine2 working minutes.
    const origHr = num(t["target_drtn_hr_cnt"]);
    const remHr = num(t["remain_drtn_hr_cnt"] || t["target_drtn_hr_cnt"]);
    const originalDurationMin = Math.max(0, Math.round(origHr * minutesPerHour));
    const remainingDurationMin = Math.max(0, Math.round(remHr * minutesPerHour));

    // Activity type
    const rawAct = t["task_type"] || "TT_Task";
    const mappedAct = ACTIVITY_TYPE_MAP[rawAct];
    const activityType: ActivityType =
      mappedAct && mappedAct !== "unsupported" ? mappedAct : "task";
    if (!mappedAct) {
      diagnostics.push({
        severity: "info",
        code: "unsupported_activity_type_behavior",
        message: `Activity ${code} has activity type ${rawAct}; treated as task, raw preserved.`,
        activityId: unique,
      });
    }

    // Duration type
    const rawDur = t["duration_type"] || "DT_FixedDUR";
    const mappedDur = DURATION_TYPE_MAP[rawDur];
    const durationType: DurationType =
      mappedDur && mappedDur !== "unsupported" ? mappedDur : "fixed-dur-units";
    if (!mappedDur) {
      diagnostics.push({
        severity: "info",
        code: "unsupported_duration_type_behavior",
        message: `Activity ${code} has duration type ${rawDur}; behavior not fully modeled, raw preserved.`,
        activityId: unique,
      });
    }

    // Percent complete type
    const rawPct = t["complete_pct_type"] || "CP_Drtn";
    const mappedPct = PERCENT_TYPE_MAP[rawPct];
    const percentCompleteType: PercentCompleteType =
      mappedPct && mappedPct !== "unsupported" ? mappedPct : "duration";
    if (!mappedPct) {
      diagnostics.push({
        severity: "info",
        code: "unsupported_percent_complete_type_behavior",
        message: `Activity ${code} has % complete type ${rawPct}; raw preserved.`,
        activityId: unique,
      });
    }

    // Actuals
    const actualStart = parseInstant(t["act_start_date"]);
    const actualFinish = parseInstant(t["act_end_date"]);

    // Constraints — TASK row carries up to 2 (primary + secondary).
    const constraints: Constraint[] = [];
    const constraintPairs: Array<[string | undefined, string | undefined]> = [
      [t["cstr_type"], t["cstr_date"]],
      [t["cstr_type2"], t["cstr_date2"]],
    ];
    for (const [cType, cDate] of constraintPairs) {
      if (!cType) continue;
      const mapped = CONSTRAINT_MAP[cType];
      if (!mapped) {
        constraintsUnsupported++;
        diagnostics.push({
          severity: "warn",
          code: "unsupported_constraint_type",
          message: `Activity ${code} constraint type ${cType} not mapped; preserved raw.`,
          activityId: unique,
        });
        continue;
      }
      if (mapped === "alap") {
        constraints.push({ type: "alap", instant: 0, calendarId });
        constraintsMapped++;
        continue;
      }
      const instant = parseInstant(cDate);
      if (instant === undefined) {
        diagnostics.push({
          severity: "warn",
          code: "unsupported_constraint_type",
          message: `Activity ${code} constraint ${cType} missing/unparseable date.`,
          activityId: unique,
        });
        continue;
      }
      constraints.push({ type: mapped, instant, calendarId });
      constraintsMapped++;
    }

    // Percent complete values (raw)
    const physPct = num(t["phys_complete_pct"]);

    const activity: EngineActivity = {
      id: unique,
      name: (t["task_name"] || code).trim(),
      type: activityType,
      durationType,
      percentCompleteType,
      calendarId,
      originalDuration: { minutes: originalDurationMin, authoringCalendarId: calendarId },
      remainingDuration: { minutes: remainingDurationMin, authoringCalendarId: calendarId },
      actualStart,
      actualFinish,
      constraints,
      physicalPercentComplete: physPct > 0 ? Math.min(100, physPct) : undefined,
    };
    activities.push(activity);
  }

  // -- Relationships (Phase 1.9 multi-project classification)
  const relationships: EngineRelationship[] = [];
  const interprojectRelationships: InterprojectRelationshipRecord[] = [];
  const externalRelationships: ExternalRelationshipRecord[] = [];
  let externalRelationshipsPreservedRaw = 0;
  const missingExternalProjects = new Set<string>();

  for (const p of predRows) {
    const fromX = p["pred_task_id"] || "";
    const toX = p["task_id"] || "";
    const from = taskIdByXer.get(fromX);
    const to = taskIdByXer.get(toX);
    const type = RELATIONSHIP_MAP[p["pred_type"] || "PR_FS"] ?? "FS";
    const lagHours = num(p["lag_hr_cnt"]);
    const lagMinutes = Math.round(lagHours * minutesPerHour);

    // Project ids on the TASKPRED row. Fall back to the owning task's
    // project when only one side is given; fall back to the default
    // project when nothing is.
    const predProjIdRaw = (p["pred_proj_id"] || "").trim();
    const succProjIdRaw = (p["proj_id"] || "").trim();
    const predProjectId =
      predProjIdRaw || taskProjectByXer.get(fromX) || undefined;
    const succProjectId =
      succProjIdRaw || taskProjectByXer.get(toX) || undefined;

    if (!from || !to) {
      // External / cross-project relationship — preserve raw, do not drop.
      externalRelationshipsPreservedRaw++;
      const predProjectMissing =
        !!predProjectId && !projectIdSet.has(predProjectId);
      const succProjectMissing =
        !!succProjectId && !projectIdSet.has(succProjectId);
      externalRelationships.push({
        predProjectId,
        succProjectId,
        predTaskXerId: fromX,
        succTaskXerId: toX,
        type,
        lagMinutes,
        predProjectMissing,
        succProjectMissing,
        activityMissing: true,
        raw: p,
      });
      // Back-compat broad code (kept so legacy tests / consumers keep working).
      diagnostics.push({
        severity: "info",
        code: "external_relationship_preserved_raw",
        message: `Relationship ${fromX}→${toX} references a task outside this XER; preserved raw, not added to engine2 graph.`,
      });
      // Phase 1.9 finer-grained code with project identity.
      diagnostics.push({
        severity: "info",
        code: "external_relationship_preserved",
        message: `External relationship pred=${predProjectId ?? "?"}/${fromX} → succ=${succProjectId ?? "?"}/${toX} (${type}, lag ${lagMinutes}min) preserved; not in engine graph.`,
      });
      if (predProjectMissing && predProjectId) {
        if (!missingExternalProjects.has(predProjectId)) {
          missingExternalProjects.add(predProjectId);
          diagnostics.push({
            severity: "warn",
            code: "external_project_missing",
            message: `Predecessor project ${predProjectId} referenced by external relationship is not present in this XER; activity dates cannot be derived from imported data.`,
          });
        }
      }
      if (succProjectMissing && succProjectId) {
        if (!missingExternalProjects.has(succProjectId)) {
          missingExternalProjects.add(succProjectId);
          diagnostics.push({
            severity: "warn",
            code: "external_project_missing",
            message: `Successor project ${succProjectId} referenced by external relationship is not present in this XER; activity dates cannot be derived from imported data.`,
          });
        }
      }
      if (!predProjectMissing && !succProjectMissing) {
        // Both projects present but the activity itself is missing — rare;
        // surface as unresolved so reconciliation can flag it.
        diagnostics.push({
          severity: "warn",
          code: "interproject_relationship_unresolved",
          message: `Relationship ${fromX}→${toX} references activities not found in TASK; preserved raw.`,
        });
      }
      continue;
    }

    const relId = `${fromX}->${toX}:${type}`;
    relationships.push({
      id: relId,
      from,
      to,
      type,
      lag: { minutes: lagMinutes, authoringCalendarId: fallbackCalendarId },
      lagCalendarBasis: "successor",
    });

    // Phase 1.9: track interproject relationships (both projects present).
    const fromProj = taskProjectByXer.get(fromX);
    const toProj = taskProjectByXer.get(toX);
    if (fromProj && toProj && fromProj !== toProj) {
      interprojectRelationships.push({
        relationshipId: relId,
        predProjectId: fromProj,
        succProjectId: toProj,
        predActivityId: from,
        succActivityId: to,
        predTaskXerId: fromX,
        succTaskXerId: toX,
        type,
        lagMinutes,
        raw: p,
      });
      diagnostics.push({
        severity: "info",
        code: "interproject_relationship_mapped",
        message: `Interproject relationship ${fromProj}/${fromX} → ${toProj}/${toX} mapped into engine2 graph (both projects present).`,
      });
    }
  }

  // -- Assignments
  const assignments: ResourceAssignment[] = [];
  for (const a of taskrsrcRows) {
    const id = a["taskrsrc_id"];
    if (!id) continue;
    const activityXerId = a["task_id"];
    const resourceId = a["rsrc_id"];
    const activityId = taskIdByXer.get(activityXerId);
    if (!activityId) {
      diagnostics.push({
        severity: "warn",
        code: "missing_resource_reference",
        message: `Assignment ${id} references activity ${activityXerId} not in TASK table.`,
      });
      continue;
    }
    if (resourceId && !resources.find((r) => r.id === resourceId)) {
      diagnostics.push({
        severity: "warn",
        code: "missing_resource_reference",
        message: `Assignment ${id} references resource ${resourceId} not in RSRC table; preserved raw.`,
        activityId,
      });
    }
    const budgetedUnits = num(a["target_qty"]);
    const actualUnits = num(a["act_reg_qty"]) + num(a["act_ot_qty"]);
    const remainingUnits = num(a["remain_qty"]);
    const budgetedCost = num(a["target_cost"]);
    const actualCost = num(a["act_reg_cost"]) + num(a["act_ot_cost"]);
    const remainingCost = num(a["remain_cost"]);
    assignments.push({
      id,
      activityId,
      resourceId: resourceId || "",
      roleId: a["role_id"] || undefined,
      budgetedUnits,
      actualUnits,
      remainingUnits,
      budgetedCost,
      actualCost,
      remainingCost,
      manualFuturePeriod: a["curv_id"] ? { present: true, source: "xer" } : undefined,
    });
  }

  // -- Baseline flag (Phase 1.7 explicit handling: we do not fabricate one)
  diagnostics.push({
    severity: "info",
    code: "baseline_not_in_xer",
    message:
      "XER imports do not include baseline schedule data; engine2 will not fabricate a baseline. Provide one explicitly to enable baseline variance.",
  });

  return {
    projectName,
    projectStartDate,
    dataDate,
    projects,
    calendars,
    defaultCalendarId: fallbackCalendarId,
    activities,
    activityProjectIds,
    relationships,
    interprojectRelationships,
    externalRelationships,
    resources,
    roles,
    assignments,
    diagnostics,
    raw: {
      projects: projectRows,
      calendars: calendarRows,
      wbs: wbsRows,
      tasks: taskRows,
      taskpred: predRows,
      resources: rsrcRows,
      roles: roleRows,
      taskrsrc: taskrsrcRows,
      otherTableNames,
    },
    stats: {
      projectsParsed: projects.length,
      tasksParsed: activities.length,
      relationshipsParsed: relationships.length,
      interprojectRelationshipsCount: interprojectRelationships.length,
      calendarsParsed: calendars.length,
      resourcesParsed: resources.length,
      rolesParsed: roles.length,
      assignmentsParsed: assignments.length,
      constraintsMapped,
      constraintsUnsupported,
      externalRelationshipsPreservedRaw,
      externalProjectsMissingCount: missingExternalProjects.size,
    },
  };
}

/** Bump engine2 version marker for Phase 1.9. */
export const ENGINE2_XER_IMPORT_VERSION = "0.9.0-phase1.9";
