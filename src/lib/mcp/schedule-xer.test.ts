import { describe, expect, it } from "vitest";
import { prepareSchedule, readScheduleControl } from "./schedule-control";
import type { LivingData } from "./living";
import { scheduleToXer, xerToScheduleRequest, XerImportError } from "./schedule-xer";
import { parseXerTables } from "../scheduler/engine2/xer-import";

const T = (name: string, fields: string[], rows: string[][]) =>
  [`%T\t${name}`, `%F\t${fields.join("\t")}`, ...rows.map((r) => `%R\t${r.join("\t")}`)].join("\n");
// A fictional P6 export: 5-day calendar with one holiday (serial 46167 = 2026-05-25) and one worked Saturday.
const clndr =
  "(0||CalendarData()(\x7f(0||DaysOfWeek()(\x7f(0||1()())\x7f(0||2()((0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|17:00)())))" +
  "(0||3()((0||0(s|08:00|f|17:00)())))(0||4()((0||0(s|08:00|f|17:00)())))(0||5()((0||0(s|08:00|f|17:00)())))" +
  "(0||6()((0||0(s|08:00|f|17:00)())))(0||7()())))\x7f(0||VIEW(ShowTotal|Y)())" +
  "(0||Exceptions()((0||0(d|46167)())(0||1(d|46172)((0||0(s|08:00|f|12:00)()))))))";
const xer = [
  "ERMHDR\t19.12\t2026-05-01\tProject\tadmin\tAdmin\tdbx\tProject Management\tUSD",
  T(
    "CALENDAR",
    ["clndr_id", "default_flag", "clndr_name", "day_hr_cnt", "clndr_data"],
    [["7", "Y", "Fictional 5 day", "8", clndr]],
  ),
  T(
    "PROJECT",
    ["proj_id", "proj_short_name", "clndr_id", "plan_start_date", "last_recalc_date"],
    [["11", "DEMO-1", "7", "2026-05-04 08:00", "2026-05-11 08:00"]],
  ),
  T(
    "PROJWBS",
    [
      "wbs_id",
      "proj_id",
      "seq_num",
      "proj_node_flag",
      "wbs_short_name",
      "wbs_name",
      "parent_wbs_id",
    ],
    [
      ["100", "11", "0", "Y", "DEMO-1", "Demo", ""],
      ["101", "11", "1", "N", "SW", "Sitework", "100"],
      ["102", "11", "2", "N", "BLD", "Building", "100"],
      ["103", "11", "1", "N", "FDN", "Foundations", "102"],
    ],
  ),
  T(
    "TASK",
    [
      "task_id",
      "proj_id",
      "wbs_id",
      "clndr_id",
      "task_code",
      "task_name",
      "task_type",
      "status_code",
      "phys_complete_pct",
      "target_drtn_hr_cnt",
      "remain_drtn_hr_cnt",
      "act_start_date",
      "act_end_date",
      "early_start_date",
      "early_end_date",
      "target_start_date",
      "target_end_date",
      "cstr_type",
      "cstr_date",
    ],
    [
      [
        "1",
        "11",
        "101",
        "7",
        "A1000",
        "NTP",
        "TT_Mile",
        "TK_Complete",
        "100",
        "0",
        "0",
        "2026-05-04 08:00",
        "",
        "",
        "",
        "2026-05-04 08:00",
        "",
        "",
        "",
      ],
      [
        "2",
        "11",
        "101",
        "7",
        "A1010",
        "Clear site",
        "TT_Task",
        "TK_Complete",
        "100",
        "24",
        "0",
        "2026-05-04 08:00",
        "2026-05-06 17:00",
        "",
        "",
        "2026-05-04 08:00",
        "2026-05-06 17:00",
        "",
        "",
      ],
      [
        "3",
        "11",
        "103",
        "7",
        "A1020",
        "Footings",
        "TT_Task",
        "TK_Active",
        "40",
        "80",
        "48",
        "2026-05-07 08:00",
        "",
        "2026-05-11 08:00",
        "2026-05-18 17:00",
        "2026-05-07 08:00",
        "2026-05-20 17:00",
        "",
        "",
      ],
      [
        "4",
        "11",
        "102",
        "7",
        "A1030",
        "Steel",
        "TT_Task",
        "TK_NotStart",
        "0",
        "120",
        "120",
        "",
        "",
        "2026-05-19 08:00",
        "2026-06-02 17:00",
        "2026-05-19 08:00",
        "2026-06-02 17:00",
        "CS_MSOA",
        "2026-05-19 00:00",
      ],
      [
        "5",
        "11",
        "102",
        "7",
        "A1040",
        "Sitework support",
        "TT_LOE",
        "TK_NotStart",
        "0",
        "40",
        "40",
        "",
        "",
        "2026-05-11 08:00",
        "2026-05-15 17:00",
        "",
        "",
        "CS_ALAP",
        "",
      ],
      [
        "6",
        "11",
        "102",
        "7",
        "A9999",
        "Substantial completion",
        "TT_FinMile",
        "TK_NotStart",
        "0",
        "0",
        "0",
        "",
        "",
        "",
        "2026-06-02 17:00",
        "",
        "2026-06-02 17:00",
        "CS_MEOB",
        "2026-06-30 17:00",
      ],
    ],
  ),
  T(
    "TASKPRED",
    [
      "task_pred_id",
      "task_id",
      "pred_task_id",
      "proj_id",
      "pred_proj_id",
      "pred_type",
      "lag_hr_cnt",
    ],
    [
      ["1", "2", "1", "11", "11", "PR_FS", "0"],
      ["2", "3", "2", "11", "11", "PR_FS", "0"],
      ["3", "4", "3", "11", "11", "PR_SS", "16"],
      ["4", "4", "3", "11", "11", "PR_FF", "8"],
      ["5", "6", "4", "11", "11", "PR_FS", "0"],
      ["6", "5", "1", "11", "11", "PR_FS", "0"],
      ["7", "6", "99", "11", "12", "PR_FS", "0"],
    ],
  ),
  "%E",
].join("\n");

describe("P6 XER import and export", () => {
  it("maps a P6 project into a first-import organize request Athena accepts", () => {
    const imp = xerToScheduleRequest(xer);
    expect(imp.project).toEqual({
      name: "DEMO-1",
      data_date: "2026-05-11",
      project_start: "2026-05-04",
    });
    expect(imp.counts).toEqual({ activities: 6, relationships: 6, calendars: 1, wbs: 3 });
    const cal = imp.request.settings!.calendars[0];
    expect(cal).toMatchObject({
      id: "cal-7",
      work_days: 62,
      hours_per_day: 8,
      holidays: ["2026-05-25"],
    });
    const wbs = imp.request.wbs!;
    expect(wbs.find((w) => w.id === "xer:103")).toMatchObject({
      parent_id: "xer:102",
      name: "FDN - Foundations",
    });
    expect(wbs.find((w) => w.id === "xer:101")?.parent_id).toBeNull();
    const a = new Map(imp.request.initial_activities!.map((x) => [x.id, x]));
    expect(a.get("A1000")).toMatchObject({
      activity_type: "milestone-start",
      actual_start: "2026-05-04",
      actual_finish: "2026-05-04",
      duration: 0,
    });
    expect(a.get("A1010")).toMatchObject({
      duration: 3,
      actual_finish: "2026-05-06",
      pct_complete: 100,
      remaining_duration: 0,
    });
    expect(a.get("A1020")).toMatchObject({
      duration: 10,
      remaining_duration: 6,
      pct_complete: 40,
      actual_start: "2026-05-07",
      wbs_id: "xer:103",
    });
    expect(a.get("A1030")!.predecessors).toEqual([
      { id: "A1020", type: "SS", lag: 2 },
      { id: "A1020", type: "FF", lag: 1 },
    ]);
    expect(a.get("A1030")!.start_no_earlier_than).toBe("2026-05-19");
    expect(a.get("A9999")).toMatchObject({
      activity_type: "milestone-finish",
      finish_no_later_than: "2026-06-30",
    });
    expect(imp.notes.join(" ")).toMatch(/other projects/);
    expect(imp.notes.join(" ")).toMatch(/level-of-effort.*A1040/);
    expect(imp.notes.join(" ")).toMatch(/A1040 \(ALAP\)/);

    // Athena accepts it as a first import, then recalculates it.
    const first = prepareSchedule(null, 0, imp.request).data as LivingData;
    expect(first.activities).toHaveLength(6);
    const calc = prepareSchedule(first, 1, { operation: "recalculate", data_date: "2026-05-11" })
      .data as LivingData;
    const c = readScheduleControl(calc)!;
    expect(c.calculation.status).toBe("calculated");
    expect(c.calculation.longest_path).toContain("A9999");
  });

  it("exports a schedule P6 can read back with the same logic, calendar, WBS and progress", () => {
    const imp = xerToScheduleRequest(xer);
    const first = prepareSchedule(null, 0, imp.request).data as LivingData;
    const calc = prepareSchedule(first, 1, { operation: "recalculate", data_date: "2026-05-11" })
      .data as LivingData;
    const out = scheduleToXer(calc, {
      project_short_name: "2717",
      project_name: "Harbor (fictional)",
      exported_on: "2026-11-05",
    });
    expect(out.startsWith("ERMHDR")).toBe(true);
    expect(out.trimEnd().endsWith("%E")).toBe(true);
    const tables = parseXerTables(out);
    for (const t of ["PROJECT", "CALENDAR", "PROJWBS", "TASK", "TASKPRED"])
      expect(tables.get(t)?.length).toBeGreaterThan(0);
    // Every row has as many values as its table has fields.
    for (const block of out.split("%T\t").slice(1)) {
      const lines = block.split("\n");
      const width = lines[1].split("\t").length;
      for (const r of lines.filter((l) => l.startsWith("%R")))
        expect(r.split("\t").length).toBe(width);
    }
    const back = xerToScheduleRequest(out);
    expect(back.project.data_date).toBe("2026-05-11");
    expect(back.request.settings!.calendars[0]).toMatchObject({
      work_days: 62,
      holidays: ["2026-05-25"],
      hours_per_day: 8,
    });
    const before = new Map(calc.activities!.map((x) => [x.id, x]));
    for (const a of back.request.initial_activities!) {
      const b = before.get(a.id)!;
      expect(a.predecessors).toEqual(
        b.predecessors.map((p) => ({
          id: p.id,
          type: p.type ?? "FS",
          ...(p.lag ? { lag: p.lag } : {}),
        })),
      );
      expect([a.duration, a.actual_start ?? null, a.actual_finish ?? null]).toEqual([
        b.duration,
        b.actual_start ?? null,
        b.actual_finish ?? null,
      ]);
      expect(a.start_no_earlier_than ?? null).toBe(b.start_no_earlier_than ?? null);
      expect(a.finish_no_later_than ?? null).toBe(b.finish_no_later_than ?? null);
    }
    expect(back.request.wbs!.map((w) => w.name).sort()).toEqual(
      ["SW - Sitework", "BLD - Building", "FDN - Foundations"].sort(),
    );
    // The round trip is accepted as a new import.
    expect(prepareSchedule(null, 0, back.request).data.activities).toHaveLength(6);
  });

  it("refuses files Athena can't import without losing data", () => {
    expect(() => xerToScheduleRequest("ERMHDR\t19.12\n%E")).toThrow(XerImportError);
    const long = xer.replace("A1010\t", "A1010-THIS-ID-IS-TOO-LONG\t");
    expect(() => xerToScheduleRequest(long)).toThrow(/20 characters/);
  });
});
