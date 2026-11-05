/**
 * Primavera P6 XER in and out of an Athena schedule.
 *
 * Import turns an XER file into a first-import `organize` request: activities with their reported dates,
 * logic, calendars, WBS, progress and the two constraints Athena calculates (start on or after, finish on or
 * before). Nothing is recalculated on import, so the reported P6 dates stay in history; the member
 * recalculates in a later revision. Anything Athena cannot carry is listed, never silently dropped.
 *
 * Export writes the saved schedule as an XER that P6 imports as a new project: PROJECT, CALENDAR,
 * PROJWBS, TASK and TASKPRED. Durations and lags are written in hours on each calendar's hours per day.
 */
import type { Activity, LivingData } from "./living";
import type { ScheduleRequest, ScheduleSettings, WbsNode } from "./schedule-schema";
import { orderedWbs, readScheduleControl, type ScheduleControl } from "./schedule-control";
import { parseXerTables, type XerRow } from "../scheduler/engine2/xer-import";

export const XER_ACTIVITY_LIMIT = 400;
type Logic = Activity["predecessors"][number];

const dateOnly = (v: string | undefined): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec((v ?? "").trim());
  return m ? m[1] : null;
};
const num = (v: string | undefined) => {
  const n = Number((v ?? "").trim());
  return Number.isFinite(n) ? n : null;
};
/** P6 numbers holidays as serial days from 1899-12-30. */
const serialToIso = (n: number) =>
  new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 10);
const isoToSerial = (iso: string) =>
  Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);

type CalNode = { name: string; args: string; children: CalNode[] };
/** Parses P6's clndr_data tree: each node is (0||NAME(args)(children)). */
function parseClndrData(text: string): CalNode[] {
  const s = text.replace(/[\x7f\r\n\t]/g, " ");
  let i = 0;
  const ws = () => {
    while (s[i] === " ") i++;
  };
  const group = (): string => {
    // reads "(…)" with no nested parentheses (the args); returns its inside
    if (s[i] !== "(") return "";
    const close = s.indexOf(")", i);
    if (close < 0) return "";
    const inner = s.slice(i + 1, close);
    i = close + 1;
    return inner;
  };
  const node = (): CalNode | null => {
    ws();
    if (!s.startsWith("(0||", i)) return null;
    i += 4;
    const nameEnd = s.indexOf("(", i);
    if (nameEnd < 0) return null;
    const name = s.slice(i, nameEnd);
    i = nameEnd;
    const args = group();
    ws();
    const children: CalNode[] = [];
    if (s[i] === "(") {
      i++;
      for (;;) {
        ws();
        if (s[i] === ")") {
          i++;
          break;
        }
        const c = node();
        if (!c) break;
        children.push(c);
      }
    }
    ws();
    if (s[i] === ")") i++;
    return { name, args, children };
  };
  const out: CalNode[] = [];
  for (let guard = 0; guard < 10_000 && i < s.length; guard++) {
    const start = s.indexOf("(0||", i);
    if (start < 0) break;
    i = start;
    const n = node();
    if (!n) break;
    out.push(n);
  }
  return out;
}
const find = (nodes: CalNode[], name: string): CalNode | undefined => {
  for (const n of nodes) {
    if (n.name === name) return n;
    const hit = find(n.children, name);
    if (hit) return hit;
  }
  return undefined;
};
const hasShift = (n: CalNode): boolean => /s\|\d/.test(n.args) || n.children.some(hasShift);

function parseCalendar(row: XerRow) {
  const tree = parseClndrData(row["clndr_data"] ?? "");
  let mask = 0;
  let parsed = false;
  const week = find(tree, "DaysOfWeek");
  if (week) {
    for (const d of week.children) {
      const idx = parseInt(d.name, 10) - 1; // P6: 1 = Sunday
      if (idx >= 0 && idx < 7) {
        parsed = true;
        if (hasShift(d)) mask |= 1 << idx;
      }
    }
  }
  const holidays = new Set<string>();
  const exc = find(tree, "Exceptions");
  for (const e of exc?.children ?? []) {
    // An exception with shifts is an extra work day; only empty ones are days off.
    if (hasShift(e)) continue;
    const m = /d\|(\d{4}-\d{2}-\d{2}|\d{5})/.exec(e.args);
    if (m) holidays.add(/^\d{5}$/.test(m[1]) ? serialToIso(Number(m[1])) : m[1]);
  }
  const hpd = Math.round(num(row["day_hr_cnt"]) ?? 8);
  return {
    id: `cal-${(row["clndr_id"] ?? "").trim()}`,
    name: (row["clndr_name"] || `Calendar ${row["clndr_id"]}`).trim().slice(0, 160),
    work_days: mask || 0b0111110,
    holidays: [...holidays].sort().slice(0, 1000),
    hours_per_day: Math.min(24, Math.max(1, hpd || 8)),
    parsed: parsed && mask !== 0,
  };
}

const PRED_TYPES: Record<string, Logic["type"]> = {
  PR_FS: "FS",
  PR_SS: "SS",
  PR_FF: "FF",
  PR_SF: "SF",
};

export type XerImport = {
  project: { name: string; data_date: string; project_start: string };
  request: ScheduleRequest;
  counts: { activities: number; relationships: number; calendars: number; wbs: number };
  /** What Athena could not carry, in plain words. */
  notes: string[];
};

export class XerImportError extends Error {}

/** Builds the first-import request for one P6 project. Throws XerImportError when the file can't be used. */
export function xerToScheduleRequest(text: string, projectShortName?: string): XerImport {
  const tables = parseXerTables(text);
  const projects = tables.get("PROJECT") ?? [];
  if (!projects.length)
    throw new XerImportError("This file has no PROJECT table; export it from P6 as XER.");
  const project = projectShortName
    ? projects.find((p) => p["proj_short_name"]?.trim() === projectShortName.trim())
    : projects[0];
  if (!project)
    throw new XerImportError(
      `Project ${projectShortName} is not in this file. It holds: ${projects.map((p) => p["proj_short_name"]).join(", ")}.`,
    );
  const notes: string[] = [];
  if (projects.length > 1 && !projectShortName)
    notes.push(
      `The file holds ${projects.length} projects; imported ${project["proj_short_name"]}. Name another to import it instead.`,
    );
  const projId = project["proj_id"];
  const ofProject = (r: XerRow) => !projId || !r["proj_id"] || r["proj_id"] === projId;
  const taskRows = (tables.get("TASK") ?? []).filter(ofProject);
  if (!taskRows.length) throw new XerImportError("The project has no activities.");
  if (taskRows.length > XER_ACTIVITY_LIMIT)
    throw new XerImportError(
      `The project has ${taskRows.length} activities; Athena calculates up to ${XER_ACTIVITY_LIMIT} per job today. Nothing was imported.`,
    );

  // Calendars actually used, keeping the project default first.
  const calRows = tables.get("CALENDAR") ?? [];
  const calById = new Map(calRows.map((r) => [r["clndr_id"], parseCalendar(r)]));
  const defaultCal =
    project["clndr_id"] && calById.has(project["clndr_id"])
      ? project["clndr_id"]
      : (calRows.find((r) => r["default_flag"] === "Y")?.["clndr_id"] ?? taskRows[0]["clndr_id"]);
  const usedIds = [...new Set([defaultCal, ...taskRows.map((t) => t["clndr_id"])].filter(Boolean))];
  const calendars = usedIds.map(
    (id) =>
      calById.get(id) ?? {
        id: `cal-${id}`,
        name: `Calendar ${id} (not in file, Mon to Fri)`,
        work_days: 0b0111110,
        holidays: [],
        hours_per_day: 8,
        parsed: false,
      },
  );
  if (!calendars.length)
    calendars.push({
      id: "cal-default",
      name: "Mon to Fri",
      work_days: 0b0111110,
      holidays: [],
      hours_per_day: 8,
      parsed: false,
    });
  for (const c of calendars)
    if (!c.parsed)
      notes.push(`${c.name}: work days were not readable, so it uses Monday to Friday.`);
  const hpdOf = new Map(calendars.map((c) => [c.id, c.hours_per_day]));

  // WBS: the project's root node becomes the top; its children are Athena's top level.
  const wbsRows = (tables.get("PROJWBS") ?? []).filter(ofProject);
  const root = wbsRows.find((w) => w["proj_node_flag"] === "Y");
  const wbs: WbsNode[] = wbsRows
    .filter((w) => w !== root)
    .map((w) => ({
      id: `xer:${w["wbs_id"]}`,
      name: (
        [w["wbs_short_name"], w["wbs_name"]].filter((s) => s && s.trim()).join(" - ") ||
        `WBS ${w["wbs_id"]}`
      ).slice(0, 160),
      parent_id:
        w["parent_wbs_id"] && w["parent_wbs_id"] !== root?.["wbs_id"]
          ? `xer:${w["parent_wbs_id"]}`
          : null,
      order: Math.max(0, Math.min(10000, Math.round(num(w["seq_num"]) ?? 0))),
    }));
  const wbsIds = new Set(wbs.map((w) => w.id));
  for (const w of wbs) if (w.parent_id && !wbsIds.has(w.parent_id)) w.parent_id = null;

  const codeOf = new Map<string, string>();
  const tooLong: string[] = [];
  for (const t of taskRows) {
    const code = (t["task_code"] || t["task_id"] || "").trim();
    if (code.length > 20) tooLong.push(code);
    codeOf.set(t["task_id"], code);
  }
  if (tooLong.length)
    throw new XerImportError(
      `Athena activity IDs are 20 characters at most; ${tooLong.length} are longer (${tooLong.slice(0, 3).join(", ")}). Shorten them in P6 and export again.`,
    );
  const dupes = [...codeOf.values()].filter((c, i, all) => all.indexOf(c) !== i);
  if (dupes.length)
    throw new XerImportError(
      `Activity IDs repeat in the file: ${[...new Set(dupes)].slice(0, 5).join(", ")}.`,
    );

  const preds = new Map<string, Logic[]>();
  let relCount = 0;
  let external = 0;
  for (const p of tables.get("TASKPRED") ?? []) {
    const succ = codeOf.get(p["task_id"]);
    if (!succ) continue;
    const pred = codeOf.get(p["pred_task_id"]);
    if (!pred) {
      external++;
      continue;
    }
    if (pred === succ) continue;
    const succRow = taskRows.find((t) => t["task_id"] === p["task_id"])!;
    const hpd = hpdOf.get(`cal-${succRow["clndr_id"]}`) ?? 8;
    const lag = Math.round((num(p["lag_hr_cnt"]) ?? 0) / hpd);
    const type = PRED_TYPES[p["pred_type"]] ?? "FS";
    const list = preds.get(succ) ?? preds.set(succ, []).get(succ)!;
    if (list.some((l) => l.id === pred && (l.type ?? "FS") === type)) continue;
    if (list.length >= 20) {
      notes.push(`${succ}: more than 20 predecessors; the rest were left out.`);
      continue;
    }
    list.push({ id: pred, type, ...(lag ? { lag: Math.max(-999, Math.min(999, lag)) } : {}) });
    relCount++;
  }
  if (external)
    notes.push(`${external} relationships to activities in other projects were left out.`);

  const dropped: string[] = [];
  const loe: string[] = [];
  const activities: Activity[] = taskRows.map((t) => {
    const id = codeOf.get(t["task_id"])!;
    const calId = `cal-${t["clndr_id"]}`;
    const hpd = hpdOf.get(calId) ?? 8;
    const type = t["task_type"];
    const milestone = type === "TT_Mile" || type === "TT_FinMile";
    if (type === "TT_LOE" || type === "TT_WBS") loe.push(id);
    const status = t["status_code"];
    let actualStart = dateOnly(t["act_start_date"]);
    let actualFinish = status === "TK_Complete" ? dateOnly(t["act_end_date"]) : null;
    if (milestone && status === "TK_Complete") {
      // P6 records a start milestone's date as its start and a finish milestone's as its finish.
      actualFinish = actualFinish ?? actualStart;
      actualStart = type === "TT_Mile" ? (actualStart ?? actualFinish) : actualStart;
    }
    if (milestone && status !== "TK_Complete") actualStart = null;
    const hours = (k: string) => {
      const h = num(t[k]);
      return h === null ? null : Math.max(0, Math.min(5000, Math.round(h / hpd)));
    };
    const duration = milestone ? 0 : (hours("target_drtn_hr_cnt") ?? 0);
    const remaining = milestone ? 0 : hours("remain_drtn_hr_cnt");
    const cstr = t["cstr_type"];
    const cdate = dateOnly(t["cstr_date"]);
    const a: Activity = {
      id,
      name: (t["task_name"] || id).trim().slice(0, 160),
      duration,
      start:
        dateOnly(t["act_start_date"]) ??
        dateOnly(t["early_start_date"]) ??
        dateOnly(t["target_start_date"]),
      finish:
        dateOnly(t["act_end_date"]) ??
        dateOnly(t["early_end_date"]) ??
        dateOnly(t["target_end_date"]),
      predecessors: preds.get(id) ?? [],
      total_float: null,
      critical: null,
      pct_complete: actualFinish
        ? 100
        : Math.max(0, Math.min(100, num(t["phys_complete_pct"]) ?? 0)),
      value: null,
      sov_line: null,
      cost_code: null,
      wbs_id: wbsIds.has(`xer:${t["wbs_id"]}`) ? `xer:${t["wbs_id"]}` : null,
      calendar_id: hpdOf.has(calId) ? calId : calendars[0].id,
      ...(milestone
        ? {
            activity_type:
              type === "TT_Mile" ? ("milestone-start" as const) : ("milestone-finish" as const),
          }
        : {}),
      ...(actualStart ? { actual_start: actualStart } : {}),
      ...(actualFinish ? { actual_finish: actualFinish, remaining_duration: 0 } : {}),
      ...(actualStart && !actualFinish && remaining !== null
        ? { remaining_duration: remaining }
        : {}),
      ...(cdate && cstr === "CS_MSOA" ? { start_no_earlier_than: cdate } : {}),
      ...(cdate && cstr === "CS_MEOB" ? { finish_no_later_than: cdate } : {}),
    };
    if (cstr && cstr !== "CS_MSOA" && cstr !== "CS_MEOB")
      dropped.push(`${id} (${cstr.replace(/^CS_/, "")})`);
    if (t["cstr_type2"]) dropped.push(`${id} (secondary ${t["cstr_type2"].replace(/^CS_/, "")})`);
    return a;
  });
  if (loe.length)
    notes.push(
      `${loe.length} level-of-effort or WBS summary activities came in as ordinary tasks: ${loe.slice(0, 5).join(", ")}${loe.length > 5 ? " and more" : ""}.`,
    );
  if (dropped.length)
    notes.push(
      `Constraints Athena does not calculate were left off: ${dropped.slice(0, 6).join(", ")}${dropped.length > 6 ? ` and ${dropped.length - 6} more` : ""}.`,
    );
  if ((tables.get("TASKRSRC") ?? []).length)
    notes.push("Resource and cost assignments were not imported.");

  const dataDate =
    dateOnly(project["last_recalc_date"]) ??
    dateOnly(project["plan_start_date"]) ??
    activities
      .map((a) => a.start)
      .filter(Boolean)
      .sort()[0]!;
  const projectStart =
    dateOnly(project["plan_start_date"]) ??
    activities
      .map((a) => a.actual_start ?? a.start)
      .filter(Boolean)
      .sort()[0] ??
    dataDate;
  const settings: ScheduleSettings = {
    project_start: projectStart,
    default_calendar_id: calendars[0].id,
    calendars: calendars.map(({ parsed: _p, ...c }) => c),
    finish_convention: "inclusive-last-work-day",
    out_of_sequence: "retained-logic",
  };
  return {
    project: {
      name: (project["proj_short_name"] || project["proj_name"] || "P6 project").trim(),
      data_date: dataDate,
      project_start: projectStart,
    },
    request: {
      operation: "organize",
      data_date: dataDate,
      settings,
      wbs,
      initial_activities: activities,
    },
    counts: {
      activities: activities.length,
      relationships: relCount,
      calendars: calendars.length,
      wbs: wbs.length,
    },
    notes,
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** "SW - Sitework" splits back into P6's code and name; other names get a W1, W2 code. */
const wbsCode = (name: string, i: number): [string, string] => {
  const m = /^(\S{1,20}) - (.+)$/.exec(name);
  return m ? [m[1], m[2]] : [`W${i + 1}`, name];
};
const xerDate = (d: string | null | undefined, time: string) => (d ? `${d} ${time}` : "");
const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ");
function table(name: string, fields: string[], rows: (string | number | null)[][]): string {
  return [
    `%T\t${name}`,
    `%F\t${fields.join("\t")}`,
    ...rows.map((r) => `%R\t${r.map((v) => clean(String(v ?? ""))).join("\t")}`),
  ].join("\n");
}
function clndrData(c: ScheduleSettings["calendars"][number]): string {
  const hpd = c.hours_per_day;
  const finish = `${String(8 + Math.min(hpd, 15) + (hpd > 4 ? 1 : 0)).padStart(2, "0")}:00`;
  const day = (i: number) =>
    c.work_days & (1 << i)
      ? hpd > 4
        ? `(0||${i + 1}()((0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|${finish})())))`
        : `(0||${i + 1}()((0||0(s|08:00|f|${String(8 + hpd).padStart(2, "0")}:00)())))`
      : `(0||${i + 1}()())`;
  const exceptions = c.holidays.map((h, i) => `(0||${i}(d|${isoToSerial(h)})())`).join("");
  return `(0||CalendarData()((0||DaysOfWeek()(${[0, 1, 2, 3, 4, 5, 6].map(day).join("")}))(0||VIEW(ShowTotal|Y)())(0||Exceptions()(${exceptions}))))`;
}

/** The saved schedule as an XER file P6 imports as a new project. */
export function scheduleToXer(
  data: LivingData,
  meta: {
    project_short_name: string;
    project_name: string;
    exported_on: string;
    data_date?: string | null;
  },
): string {
  const control: ScheduleControl | null = readScheduleControl(data);
  const acts = data.activities ?? [];
  if (!acts.length) throw new XerImportError("There is no saved schedule to export.");
  const settings: ScheduleSettings = control?.settings ?? {
    project_start:
      acts
        .map((a) => a.start)
        .filter(Boolean)
        .sort()[0] ?? meta.exported_on,
    default_calendar_id: "default",
    calendars: [
      { id: "default", name: "Mon to Fri", work_days: 0b0111110, holidays: [], hours_per_day: 8 },
    ],
    finish_convention: "inclusive-last-work-day",
    out_of_sequence: "retained-logic",
  };
  const calNo = new Map(settings.calendars.map((c, i) => [c.id, 1000 + i]));
  const hpd = new Map(settings.calendars.map((c) => [c.id, c.hours_per_day]));
  const defCal = settings.default_calendar_id;
  const PROJ = 1000;
  const ROOT = 1000;
  const nodes = control?.wbs.length ? orderedWbs(control.wbs) : [];
  const wbsNo = new Map(nodes.map((n, i) => [n.id, ROOT + 1 + i]));
  const taskNo = new Map(acts.map((a, i) => [a.id, 10_000 + i]));
  const dd = meta.data_date ?? control?.calculation.data_date ?? meta.exported_on;

  const out: string[] = [
    `ERMHDR\t19.12\t${meta.exported_on}\tProject\tathena\tAthena\tdbxDatabaseNoName\tProject Management\tUSD`,
  ];
  out.push(
    table(
      "CURRTYPE",
      [
        "curr_id",
        "decimal_digit_cnt",
        "curr_symbol",
        "decimal_symbol",
        "digit_group_symbol",
        "pos_curr_fmt_type",
        "neg_curr_fmt_type",
        "curr_type",
        "curr_short_name",
        "group_digit_cnt",
        "base_exch_rate",
      ],
      [[1, 2, "$", ".", ",", "#1.1", "(#1.1)", "US Dollar", "USD", 3, 1]],
    ),
  );
  out.push(
    table(
      "CALENDAR",
      [
        "clndr_id",
        "default_flag",
        "clndr_name",
        "proj_id",
        "base_clndr_id",
        "last_chng_date",
        "clndr_type",
        "day_hr_cnt",
        "week_hr_cnt",
        "month_hr_cnt",
        "year_hr_cnt",
        "rsrc_private",
        "clndr_data",
      ],
      settings.calendars.map((c) => {
        const days = [0, 1, 2, 3, 4, 5, 6].filter((i) => c.work_days & (1 << i)).length;
        return [
          calNo.get(c.id)!,
          c.id === defCal ? "Y" : "N",
          c.name,
          "",
          "",
          xerDate(meta.exported_on, "00:00"),
          "CA_Base",
          c.hours_per_day,
          c.hours_per_day * days,
          Math.round((c.hours_per_day * days * 52) / 12),
          c.hours_per_day * days * 52,
          "N",
          clndrData(c),
        ];
      }),
    ),
  );
  out.push(
    table(
      "PROJECT",
      [
        "proj_id",
        "fy_start_month_num",
        "allow_complete_flag",
        "project_flag",
        "name_sep_char",
        "acct_id",
        "orig_proj_id",
        "source_proj_id",
        "base_type_id",
        "clndr_id",
        "sum_base_proj_id",
        "task_code_base",
        "task_code_step",
        "priority_num",
        "wbs_max_sum_level",
        "risk_level",
        "strgy_priority_num",
        "last_checksum",
        "critical_drtn_hr_cnt",
        "def_cost_per_qty",
        "last_recalc_date",
        "plan_start_date",
        "plan_end_date",
        "scd_end_date",
        "add_date",
        "last_tasksum_date",
        "fcst_start_date",
        "def_duration_type",
        "task_code_prefix",
        "guid",
        "def_qty_type",
        "add_by_name",
        "web_local_root_path",
        "proj_short_name",
        "def_rate_type",
        "act_this_per_link_flag",
        "def_task_type",
        "act_pct_link_flag",
        "critical_path_type",
        "task_code_prefix_flag",
        "def_rollup_dates_flag",
        "rem_target_link_flag",
        "reset_planned_flag",
        "allow_neg_act_flag",
        "rsrc_self_add_flag",
        "rsrc_multi_assign_flag",
        "checkout_flag",
        "project_flag2",
        "def_complete_pct_type",
        "cost_qty_recalc_flag",
        "batch_sum_flag",
        "name_sep_char2",
        "sum_assign_level",
      ],
      [
        [
          PROJ,
          1,
          "Y",
          "Y",
          ".",
          "",
          "",
          "",
          "",
          calNo.get(defCal)!,
          "",
          1000,
          10,
          10,
          2,
          "",
          500,
          "",
          0,
          0,
          xerDate(dd, "08:00"),
          xerDate(settings.project_start, "08:00"),
          "",
          "",
          xerDate(meta.exported_on, "00:00"),
          "",
          "",
          "DT_FixedDUR2",
          "",
          "",
          "QT_Hour",
          "Athena",
          "",
          meta.project_short_name,
          "COST_PER_QTY",
          "Y",
          "TT_Task",
          "N",
          "CT_DrivPath",
          "Y",
          "Y",
          "Y",
          "N",
          "N",
          "Y",
          "Y",
          "N",
          "N",
          "CP_Phys",
          "N",
          "Y",
          ".",
          "SL_Taskrsrc",
        ],
      ],
    ),
  );
  out.push(
    table(
      "PROJWBS",
      [
        "wbs_id",
        "proj_id",
        "obs_id",
        "seq_num",
        "est_wt",
        "proj_node_flag",
        "sum_data_flag",
        "status_code",
        "wbs_short_name",
        "wbs_name",
        "phase_id",
        "parent_wbs_id",
        "ev_user_pct",
        "ev_etc_user_value",
        "orig_cost",
        "indep_remain_total_cost",
        "ann_dscnt_rate_pct",
        "dscnt_period_type",
        "indep_remain_work_qty",
        "anticip_start_date",
        "anticip_end_date",
        "ev_compute_type",
        "ev_etc_compute_type",
        "guid",
        "tmpl_guid",
        "plan_open_state",
      ],
      [
        [
          ROOT,
          PROJ,
          "",
          0,
          1,
          "Y",
          "N",
          "WS_Open",
          meta.project_short_name,
          meta.project_name,
          "",
          "",
          6,
          0.88,
          0,
          0,
          "",
          "",
          0,
          "",
          "",
          "EC_Cmp_pct",
          "EE_Rem_hr",
          "",
          "",
          "",
        ],
        ...nodes.map((n, i) => [
          wbsNo.get(n.id)!,
          PROJ,
          "",
          n.order ?? i,
          1,
          "N",
          "N",
          "WS_Open",
          wbsCode(n.name, i)[0],
          wbsCode(n.name, i)[1],
          "",
          n.parent_id && wbsNo.has(n.parent_id) ? wbsNo.get(n.parent_id)! : ROOT,
          6,
          0.88,
          0,
          0,
          "",
          "",
          0,
          "",
          "",
          "EC_Cmp_pct",
          "EE_Rem_hr",
          "",
          "",
          "",
        ]),
      ],
    ),
  );
  out.push(
    table(
      "TASK",
      [
        "task_id",
        "proj_id",
        "wbs_id",
        "clndr_id",
        "phys_complete_pct",
        "rev_fdbk_flag",
        "est_wt",
        "lock_plan_flag",
        "auto_compute_act_flag",
        "complete_pct_type",
        "task_type",
        "duration_type",
        "status_code",
        "task_code",
        "task_name",
        "rsrc_id",
        "total_float_hr_cnt",
        "free_float_hr_cnt",
        "remain_drtn_hr_cnt",
        "act_work_qty",
        "remain_work_qty",
        "target_work_qty",
        "target_drtn_hr_cnt",
        "target_equip_qty",
        "act_equip_qty",
        "remain_equip_qty",
        "cstr_date",
        "act_start_date",
        "act_end_date",
        "late_start_date",
        "late_end_date",
        "expect_end_date",
        "early_start_date",
        "early_end_date",
        "restart_date",
        "reend_date",
        "target_start_date",
        "target_end_date",
        "rem_late_start_date",
        "rem_late_end_date",
        "cstr_type",
        "priority_type",
        "suspend_date",
        "resume_date",
        "float_path",
        "float_path_order",
        "guid",
        "tmpl_guid",
        "cstr_date2",
        "cstr_type2",
        "driving_path_flag",
        "act_this_per_work_qty",
        "act_this_per_equip_qty",
        "external_early_start_date",
        "external_late_end_date",
        "create_date",
        "update_date",
        "create_user",
        "update_user",
        "location_id",
      ],
      acts.map((a) => {
        const cal = a.calendar_id && calNo.has(a.calendar_id) ? a.calendar_id : defCal;
        const h = hpd.get(cal) ?? 8;
        const milestone = a.duration === 0;
        const done = !!a.actual_finish;
        const started = !!a.actual_start;
        const type = milestone
          ? a.activity_type === "milestone-start" ||
            (!a.activity_type && !(a.predecessors ?? []).length)
            ? "TT_Mile"
            : "TT_FinMile"
          : "TT_Task";
        const remaining = done ? 0 : (a.remaining_duration ?? a.duration ?? 0);
        const cstr = a.finish_no_later_than
          ? ["CS_MEOB", a.finish_no_later_than]
          : a.start_no_earlier_than
            ? ["CS_MSOA", a.start_no_earlier_than]
            : ["", null];
        const tf = a.total_float == null ? "" : a.total_float * h;
        return [
          taskNo.get(a.id)!,
          PROJ,
          a.wbs_id && wbsNo.has(a.wbs_id) ? wbsNo.get(a.wbs_id)! : ROOT,
          calNo.get(cal)!,
          done ? 100 : (a.pct_complete ?? 0),
          "N",
          1,
          "N",
          "N",
          "CP_Phys",
          type,
          "DT_FixedDUR2",
          done ? "TK_Complete" : started ? "TK_Active" : "TK_NotStart",
          a.id,
          a.name,
          "",
          tf,
          "",
          remaining * h,
          0,
          0,
          0,
          (a.duration ?? 0) * h,
          0,
          0,
          0,
          xerDate(cstr[1], cstr[0] === "CS_MEOB" ? "17:00" : "08:00"),
          xerDate(a.actual_start, "08:00"),
          xerDate(done ? a.actual_finish : null, "17:00"),
          "",
          "",
          "",
          xerDate(a.start, "08:00"),
          xerDate(a.finish, "17:00"),
          xerDate(done ? null : a.start, "08:00"),
          xerDate(done ? null : a.finish, "17:00"),
          xerDate(a.start, "08:00"),
          xerDate(a.finish, "17:00"),
          "",
          "",
          cstr[0],
          "PT_Normal",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          a.critical ? "Y" : "N",
          0,
          0,
          "",
          "",
          xerDate(meta.exported_on, "00:00"),
          xerDate(meta.exported_on, "00:00"),
          "athena",
          "athena",
          "",
        ];
      }),
    ),
  );
  let pk = 100_000;
  out.push(
    table(
      "TASKPRED",
      [
        "task_pred_id",
        "task_id",
        "pred_task_id",
        "proj_id",
        "pred_proj_id",
        "pred_type",
        "lag_hr_cnt",
        "comments",
        "float_path",
        "aref",
        "arls",
      ],
      acts.flatMap((a) => {
        const cal = a.calendar_id && hpd.has(a.calendar_id) ? a.calendar_id : defCal;
        return (a.predecessors ?? [])
          .filter((p) => taskNo.has(p.id))
          .map((p) => [
            pk++,
            taskNo.get(a.id)!,
            taskNo.get(p.id)!,
            PROJ,
            PROJ,
            `PR_${p.type ?? "FS"}`,
            (p.lag ?? 0) * (hpd.get(cal) ?? 8),
            "",
            "",
            "",
            "",
          ]);
      }),
    ),
  );
  return `${out.join("\n")}\n%E\n`;
}
