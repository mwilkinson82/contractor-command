/**
 * Phase 1.8 — minimal XER fixtures for the reconciliation harness.
 *
 * These are intentionally hand-written representative blocks rather than
 * real P6 exports. Each fixture exercises one or two specific importer
 * code paths so the pipeline tests stay focused and fast.
 *
 * Fixture-author convention: every TASK row carries `task_id`, `task_code`,
 * `task_name`, `target_drtn_hr_cnt` at minimum, plus whatever extra
 * fields the scenario needs.
 */

function block(table: string, fields: string, ...rows: string[]): string[] {
  return [table, fields, ...rows];
}

function build(...blocks: string[][]): string {
  const lines: string[] = ["ERMHDR\t6.2"];
  for (const b of blocks) {
    const [table, fields, ...rows] = b;
    lines.push(`%T\t${table}`);
    lines.push(`%F\t${fields}`);
    for (const r of rows) lines.push(`%R\t${r}`);
  }
  lines.push("%E");
  return lines.join("\n");
}

const PROJECT_HEADER = block(
  "PROJECT",
  "proj_short_name\tproj_name\tplan_start_date\tlast_recalc_date",
  "FX\tFixture Project\t2025-01-06 08:00\t2025-01-06 08:00",
);

const CAL_STD = block(
  "CALENDAR",
  "clndr_id\tclndr_name\tday_hr_cnt\tclndr_data",
  "CAL1\tStandard 5d\t8\t",
);

/** 1. Simple FS chain A → B → C (10d, 5d, 3d) on a single calendar. */
export const FIXTURE_SIMPLE_FS_CHAIN = build(
  PROJECT_HEADER,
  CAL_STD,
  block(
    "TASK",
    "task_id\ttask_code\ttask_name\tclndr_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt",
    "1\tA\tA\tCAL1\t80\t80",
    "2\tB\tB\tCAL1\t40\t40",
    "3\tC\tC\tCAL1\t24\t24",
  ),
  block(
    "TASKPRED",
    "task_id\tpred_task_id\tpred_type\tlag_hr_cnt",
    "2\t1\tPR_FS\t0",
    "3\t2\tPR_FS\t0",
  ),
);

/** 2. Parallel paths: A → C, B → C (5d/5d/3d). */
export const FIXTURE_PARALLEL_PATHS = build(
  PROJECT_HEADER,
  CAL_STD,
  block(
    "TASK",
    "task_id\ttask_code\ttask_name\tclndr_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt",
    "1\tA\tA\tCAL1\t40\t40",
    "2\tB\tB\tCAL1\t40\t40",
    "3\tC\tC\tCAL1\t24\t24",
  ),
  block(
    "TASKPRED",
    "task_id\tpred_task_id\tpred_type\tlag_hr_cnt",
    "3\t1\tPR_FS\t0",
    "3\t2\tPR_FS\t0",
  ),
);

/** 3. Constraints: SNET on activity B. */
export const FIXTURE_CONSTRAINTS = build(
  PROJECT_HEADER,
  CAL_STD,
  block(
    "TASK",
    "task_id\ttask_code\ttask_name\tclndr_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tcstr_type\tcstr_date",
    "1\tA\tA\tCAL1\t40\t40\t\t",
    "2\tB\tB\tCAL1\t40\t40\tCS_MSOA\t2025-02-03 08:00",
  ),
  block("TASKPRED", "task_id\tpred_task_id\tpred_type\tlag_hr_cnt", "2\t1\tPR_FS\t0"),
);

/** 4. Actuals/progress: A complete, B in progress. */
export const FIXTURE_ACTUALS = build(
  PROJECT_HEADER,
  CAL_STD,
  block(
    "TASK",
    "task_id\ttask_code\ttask_name\tclndr_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tact_start_date\tact_end_date\tphys_complete_pct",
    "1\tA\tA\tCAL1\t40\t0\t2025-01-06 08:00\t2025-01-10 17:00\t100",
    "2\tB\tB\tCAL1\t40\t20\t2025-01-13 08:00\t\t50",
  ),
  block("TASKPRED", "task_id\tpred_task_id\tpred_type\tlag_hr_cnt", "2\t1\tPR_FS\t0"),
);

/** 5. Resources / roles / assignments. */
export const FIXTURE_RESOURCES = build(
  PROJECT_HEADER,
  CAL_STD,
  block("ROLES", "role_id\trole_name", "R1\tForeman"),
  block(
    "RSRC",
    "rsrc_id\trsrc_name\trsrc_type\tclndr_id",
    "100\tCrew A\tRT_Labor\tCAL1",
  ),
  block(
    "TASK",
    "task_id\ttask_code\ttask_name\tclndr_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt",
    "1\tA\tPour\tCAL1\t16\t16",
  ),
  block(
    "TASKRSRC",
    "taskrsrc_id\ttask_id\trsrc_id\trole_id\ttarget_qty\tact_reg_qty\tremain_qty\ttarget_cost\tact_reg_cost\tremain_cost",
    "1\t1\t100\tR1\t16\t0\t16\t800\t0\t800",
  ),
);

/** 6. External relationship (pred not in TASK table) — should be preserved raw. */
export const FIXTURE_EXTERNAL_REL = build(
  PROJECT_HEADER,
  CAL_STD,
  block(
    "TASK",
    "task_id\ttask_code\ttask_name\tclndr_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt",
    "1\tA\tA\tCAL1\t40\t40",
  ),
  block(
    "TASKPRED",
    "task_id\tpred_task_id\tpred_type\tlag_hr_cnt",
    "1\t9999\tPR_FS\t0",
  ),
);

/** 7. Baseline absence + minimal one-activity project (default diagnostics path). */
export const FIXTURE_NO_BASELINE = build(
  PROJECT_HEADER,
  CAL_STD,
  block(
    "TASK",
    "task_id\ttask_code\ttask_name\tclndr_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt",
    "1\tA\tOnly\tCAL1\t8\t8",
  ),
);

/** 8. Mixed calendars: activity A on CAL1 (5d), B on CAL2 (also 5d but synthesized fallback). */
export const FIXTURE_MIXED_CALENDARS = build(
  PROJECT_HEADER,
  CAL_STD,
  block(
    "TASK",
    "task_id\ttask_code\ttask_name\tclndr_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt",
    "1\tA\tA\tCAL1\t40\t40",
    "2\tB\tB\tCAL2\t40\t40",
  ),
  block("TASKPRED", "task_id\tpred_task_id\tpred_type\tlag_hr_cnt", "2\t1\tPR_FS\t0"),
);

/** 9. Unsupported constraint type to exercise diagnostics. */
export const FIXTURE_UNSUPPORTED_CONSTRAINT = build(
  PROJECT_HEADER,
  CAL_STD,
  block(
    "TASK",
    "task_id\ttask_code\ttask_name\tclndr_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tcstr_type\tcstr_date",
    "1\tA\tA\tCAL1\t40\t40\tCS_UNKNOWN\t2025-02-01 08:00",
  ),
);

/** 10. Unsupported calendar hours-per-day (10h) — diagnostic, not silent. */
export const FIXTURE_NONSTANDARD_HPD = build(
  PROJECT_HEADER,
  block(
    "CALENDAR",
    "clndr_id\tclndr_name\tday_hr_cnt\tclndr_data",
    "CAL1\t4x10\t10\t(0||1()(s|08:00|f|18:00))(0||2()(s|08:00|f|18:00))",
  ),
  block(
    "TASK",
    "task_id\ttask_code\ttask_name\tclndr_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt",
    "1\tA\tA\tCAL1\t40\t40",
  ),
);

/**
 * 11. Phase 1.9 — multi-project XER. Two projects (P1, P2) included in
 * the same file. P1.A → P2.B is an interproject FS relationship; both
 * projects are present so it must be wired into the engine graph.
 */
export const FIXTURE_MULTI_PROJECT_INTERPROJECT = build(
  block(
    "PROJECT",
    "proj_id\tproj_short_name\tproj_name\tplan_start_date\tlast_recalc_date",
    "P1\tP1\tProject One\t2025-01-06 08:00\t2025-01-06 08:00",
    "P2\tP2\tProject Two\t2025-01-06 08:00\t2025-01-06 08:00",
  ),
  CAL_STD,
  block(
    "TASK",
    "task_id\tproj_id\ttask_code\ttask_name\tclndr_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt",
    "1\tP1\tP1A\tP1 Activity A\tCAL1\t40\t40",
    "2\tP2\tP2B\tP2 Activity B\tCAL1\t24\t24",
  ),
  block(
    "TASKPRED",
    "task_id\tproj_id\tpred_task_id\tpred_proj_id\tpred_type\tlag_hr_cnt",
    "2\tP2\t1\tP1\tPR_FS\t0",
  ),
);

/**
 * 12. Phase 1.9 — single project that references a predecessor in an
 * EXTERNAL project (P_EXT) that is NOT included in this XER. Used to
 * exercise the ignore-external-relationships option + diagnostics.
 */
export const FIXTURE_MISSING_EXTERNAL_PROJECT = build(
  block(
    "PROJECT",
    "proj_id\tproj_short_name\tproj_name\tplan_start_date\tlast_recalc_date",
    "P1\tP1\tProject One\t2025-01-06 08:00\t2025-01-06 08:00",
  ),
  CAL_STD,
  block(
    "TASK",
    "task_id\tproj_id\ttask_code\ttask_name\tclndr_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt",
    "1\tP1\tA\tA\tCAL1\t40\t40",
  ),
  block(
    "TASKPRED",
    "task_id\tproj_id\tpred_task_id\tpred_proj_id\tpred_type\tlag_hr_cnt",
    "1\tP1\t9999\tP_EXT\tPR_FS\t0",
  ),
);
