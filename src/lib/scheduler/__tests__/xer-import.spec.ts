/**
 * Phase 1.7 — XER import (engine2) focused unit tests.
 *
 * These tests prove that the new engine2 XER importer preserves more
 * Primavera/P6 semantics than the legacy importer: calendars, constraints,
 * actuals, activity/duration/percent-complete types, resources/roles/
 * assignments, structured diagnostics, and raw-row preservation.
 *
 * The corresponding acceptance tests XER-17..20 remain `.todo()` in
 * `p6-acceptance.spec.ts` — we are not yet claiming full multi-project
 * relationship execution or Update/Replace/Add-Into behaviors.
 */

import { describe, expect, it } from "vitest";
import { importXerForEngine2, parseXerTables } from "../engine2/xer-import";

function buildXer(blocks: string[][]): string {
  // Each block: ["TABLE_NAME", "field1\tfield2", "row1col1\trow1col2", ...]
  const lines: string[] = ["ERMHDR\t6.2\t..."]; // header is ignored by parser
  for (const b of blocks) {
    const [table, fields, ...rows] = b;
    lines.push(`%T\t${table}`);
    lines.push(`%F\t${fields}`);
    for (const r of rows) lines.push(`%R\t${r}`);
  }
  lines.push("%E");
  return lines.join("\n");
}

describe("Phase 1.7 — engine2 XER importer", () => {
  it("parses PROJECT header, data date, and calendar identity", () => {
    const xer = buildXer([
      [
        "PROJECT",
        "proj_short_name\tproj_name\tplan_start_date\tlast_recalc_date",
        "DEMO\tDemo Project\t2025-01-06 08:00\t2025-01-13 17:00",
      ],
      [
        "CALENDAR",
        "clndr_id\tclndr_name\tclndr_type\tday_hr_cnt\tclndr_data",
        "CAL1\tStandard 5-day\tCA_Base\t8\t",
      ],
      [
        "TASK",
        "task_id\ttask_code\ttask_name\tclndr_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt",
        "100\tA1000\tFoundation\tCAL1\t40\t40",
      ],
    ]);
    const r = importXerForEngine2(xer);

    expect(r.projectName).toBe("DEMO");
    expect(r.projectStartDate).toBe("2025-01-06");
    expect(r.dataDate).toBe(Date.UTC(2025, 0, 13, 17, 0));
    expect(r.calendars).toHaveLength(1);
    expect(r.calendars[0]).toMatchObject({ id: "CAL1", name: "Standard 5-day", hoursPerDay: 8 });
    expect(r.activities[0]).toMatchObject({
      id: "A1000",
      name: "Foundation",
      calendarId: "CAL1",
    });
    expect(r.activities[0].originalDuration.minutes).toBe(40 * 60);
  });

  it("maps supported constraints (SNET/SNLT/FNET/FNLT/MSO/MFO/ALAP)", () => {
    const cases: Array<[string, string]> = [
      ["CS_MSO", "snet"],
      ["CS_MSOB", "snlt"],
      ["CS_MEOA", "fnet"],
      ["CS_MEOB", "fnlt"],
      ["CS_MANDSTART", "mso"],
      ["CS_MANDFIN", "mfo"],
    ];
    for (const [xerType, engineType] of cases) {
      const xer = buildXer([
        [
          "TASK",
          "task_id\ttask_code\ttask_name\ttarget_drtn_hr_cnt\tcstr_type\tcstr_date",
          `1\tT1\tWork\t8\t${xerType}\t2025-02-01 08:00`,
        ],
      ]);
      const r = importXerForEngine2(xer);
      const c = r.activities[0].constraints[0];
      expect(c, `mapping ${xerType}`).toBeDefined();
      expect(c.type).toBe(engineType);
      expect(c.instant).toBe(Date.UTC(2025, 1, 1, 8, 0));
    }
  });

  it("preserves unsupported constraint types as diagnostics, not silent drops", () => {
    const xer = buildXer([
      [
        "TASK",
        "task_id\ttask_code\ttask_name\ttarget_drtn_hr_cnt\tcstr_type\tcstr_date",
        "1\tT1\tWork\t8\tCS_WEIRD\t2025-02-01 08:00",
      ],
    ]);
    const r = importXerForEngine2(xer);
    expect(r.activities[0].constraints).toHaveLength(0);
    expect(r.stats.constraintsUnsupported).toBe(1);
    expect(r.diagnostics.some((d) => d.code === "unsupported_constraint_type")).toBe(true);
  });

  it("maps actuals: actual start/finish and remaining/original duration in working minutes", () => {
    const xer = buildXer([
      [
        "TASK",
        "task_id\ttask_code\ttask_name\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tact_start_date\tact_end_date\tphys_complete_pct",
        "1\tT1\tDigging\t80\t20\t2025-01-06 08:00\t\t75",
      ],
    ]);
    const r = importXerForEngine2(xer);
    const a = r.activities[0];
    expect(a.actualStart).toBe(Date.UTC(2025, 0, 6, 8, 0));
    expect(a.actualFinish).toBeUndefined();
    expect(a.originalDuration.minutes).toBe(80 * 60);
    expect(a.remainingDuration.minutes).toBe(20 * 60);
    expect(a.physicalPercentComplete).toBe(75);
  });

  it("maps activity type, duration type, and percent-complete type into engine2 enums", () => {
    const xer = buildXer([
      [
        "TASK",
        "task_id\ttask_code\ttask_name\ttarget_drtn_hr_cnt\ttask_type\tduration_type\tcomplete_pct_type",
        "1\tT1\tStart\t0\tTT_StartMile\tDT_FixedDUR\tCP_Phys",
        "2\tT2\tWork\t8\tTT_Task\tDT_FixedRate\tCP_Units",
      ],
    ]);
    const r = importXerForEngine2(xer);
    expect(r.activities[0]).toMatchObject({
      type: "milestone-start",
      durationType: "fixed-dur-units",
      percentCompleteType: "physical",
    });
    expect(r.activities[1]).toMatchObject({
      type: "task",
      durationType: "fixed-units-per-time",
      percentCompleteType: "units",
    });
  });

  it("imports resources, roles, and assignments with units/cost", () => {
    const xer = buildXer([
      ["ROLES", "role_id\trole_name", "R1\tForeman"],
      [
        "RSRC",
        "rsrc_id\trsrc_name\trsrc_type\tclndr_id",
        "100\tCrew A\tRT_Labor\tCAL1",
        "200\tConcrete\tRT_Mat\t",
      ],
      [
        "CALENDAR",
        "clndr_id\tclndr_name\tday_hr_cnt\tclndr_data",
        "CAL1\tStd\t8\t",
      ],
      ["TASK", "task_id\ttask_code\ttask_name\ttarget_drtn_hr_cnt", "10\tA10\tPour\t16"],
      [
        "TASKRSRC",
        "taskrsrc_id\ttask_id\trsrc_id\trole_id\ttarget_qty\tact_reg_qty\tremain_qty\ttarget_cost\tact_reg_cost\tremain_cost",
        "1\t10\t100\tR1\t16\t8\t8\t800\t400\t400",
      ],
    ]);
    const r = importXerForEngine2(xer);
    expect(r.resources).toHaveLength(2);
    expect(r.resources[0]).toMatchObject({ id: "100", name: "Crew A", type: "labor" });
    expect(r.resources[1]).toMatchObject({ type: "material" });
    expect(r.roles).toHaveLength(1);
    expect(r.assignments).toHaveLength(1);
    expect(r.assignments[0]).toMatchObject({
      activityId: "A10",
      resourceId: "100",
      roleId: "R1",
      budgetedUnits: 16,
      actualUnits: 8,
      remainingUnits: 8,
      budgetedCost: 800,
    });
    // Resource calendar deferral diagnostic is emitted.
    expect(r.diagnostics.some((d) => d.code === "resource_calendar_deferred")).toBe(true);
  });

  it("preserves cross-project (external) relationships as raw diagnostics", () => {
    const xer = buildXer([
      ["TASK", "task_id\ttask_code\ttask_name\ttarget_drtn_hr_cnt", "1\tA1\tA\t8"],
      ["TASKPRED", "task_id\tpred_task_id\tpred_type\tlag_hr_cnt", "1\t999\tPR_FS\t0"],
    ]);
    const r = importXerForEngine2(xer);
    expect(r.relationships).toHaveLength(0);
    expect(r.stats.externalRelationshipsPreservedRaw).toBe(1);
    const d = r.diagnostics.find((x) => x.code === "external_relationship_preserved_raw");
    expect(d).toBeDefined();
    // Raw row still preserved for later reconciliation.
    expect(r.raw.taskpred).toHaveLength(1);
  });

  it("always emits baseline_not_in_xer (no fabricated baseline)", () => {
    const xer = buildXer([
      ["TASK", "task_id\ttask_code\ttask_name\ttarget_drtn_hr_cnt", "1\tA1\tA\t8"],
    ]);
    const r = importXerForEngine2(xer);
    expect(r.diagnostics.some((d) => d.code === "baseline_not_in_xer")).toBe(true);
  });

  it("preserves raw rows for every imported XER table", () => {
    const xer = buildXer([
      ["PROJECT", "proj_name\tplan_start_date", "P\t2025-01-06"],
      ["TASK", "task_id\ttask_code\ttask_name\ttarget_drtn_hr_cnt", "1\tA1\tA\t8"],
      ["TASKPRED", "task_id\tpred_task_id\tpred_type\tlag_hr_cnt", "1\t1\tPR_FS\t0"],
      ["UDFTYPE", "udf_type_id\tudf_type_name", "1\tCustom"],
    ]);
    const r = importXerForEngine2(xer);
    expect(r.raw.projects).toHaveLength(1);
    expect(r.raw.tasks).toHaveLength(1);
    expect(r.raw.taskpred).toHaveLength(1);
    expect(r.raw.otherTableNames).toContain("UDFTYPE");
  });

  it("parseXerTables exposes generic table access for future reconciliation work", () => {
    const xer = buildXer([["PROJECT", "proj_name", "Demo"]]);
    const tables = parseXerTables(xer);
    expect(tables.get("PROJECT")?.[0]).toEqual({ proj_name: "Demo" });
  });
});
