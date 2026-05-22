// Primavera P6 XER parser.
// XER is a tab-delimited export with table blocks:
//   %T <TABLE>
//   %F <field1> <field2> ...
//   %R <val1> <val2> ...
//   ...
//   %E
//
// We extract PROJECT, PROJWBS, TASK, TASKPRED, and CALENDAR to build a Schedule.

import type { Dependency, DependencyType, Task } from "./types";

export interface XerImportResult {
  projectName: string;
  projectStartDate?: string;
  tasks: Task[];
  dependencies: Dependency[];
  warnings: string[];
  stats: { tasksParsed: number; depsParsed: number; wbsParsed: number };
}

type Row = Record<string, string>;

function parseXer(text: string): Map<string, Row[]> {
  // P6 XER is typically Windows-1252; modern exports are often UTF-8.
  // We normalize line endings and split on tabs.
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const tables = new Map<string, Row[]>();
  let currentTable: string | null = null;
  let currentFields: string[] | null = null;
  let currentRows: Row[] | null = null;

  for (const raw of lines) {
    if (!raw) continue;
    const parts = raw.split("\t");
    const tag = parts[0];
    if (tag === "%T") {
      if (currentTable && currentRows) tables.set(currentTable, currentRows);
      currentTable = parts[1] ?? null;
      currentFields = null;
      currentRows = [];
    } else if (tag === "%F" && currentTable) {
      currentFields = parts.slice(1);
    } else if (tag === "%R" && currentTable && currentFields && currentRows) {
      const vals = parts.slice(1);
      const row: Row = {};
      for (let i = 0; i < currentFields.length; i++) {
        row[currentFields[i]] = vals[i] ?? "";
      }
      currentRows.push(row);
    } else if (tag === "%E") {
      if (currentTable && currentRows) tables.set(currentTable, currentRows);
      currentTable = null;
      currentFields = null;
      currentRows = null;
    }
  }
  if (currentTable && currentRows) tables.set(currentTable, currentRows);
  return tables;
}

const DEP_MAP: Record<string, DependencyType> = {
  PR_FS: "FS",
  PR_SS: "SS",
  PR_FF: "FF",
  PR_SF: "SF",
};

function hoursToDays(hours: number, hoursPerDay: number): number {
  if (!isFinite(hours) || hours <= 0) return 0;
  return Math.max(1, Math.round(hours / hoursPerDay));
}

function parseDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  // P6 dates: "YYYY-MM-DD HH:mm" or "YYYY-MM-DD"
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

export function importXer(text: string, hoursPerDay = 8): XerImportResult {
  const warnings: string[] = [];
  const tables = parseXer(text);

  const projects = tables.get("PROJECT") ?? [];
  const wbsRows = tables.get("PROJWBS") ?? [];
  const taskRows = tables.get("TASK") ?? [];
  const predRows = tables.get("TASKPRED") ?? [];

  if (taskRows.length === 0) {
    warnings.push("No TASK rows found — file may not be a valid XER export.");
  }

  const project = projects[0];
  const projectName =
    project?.["proj_short_name"] || project?.["proj_name"] || "Imported P6 schedule";
  const projectStartDate = parseDate(project?.["plan_start_date"] || project?.["scd_end_date"]);

  // WBS lookup: wbs_id -> readable name
  const wbsName = new Map<string, string>();
  for (const w of wbsRows) {
    const id = w["wbs_id"];
    if (!id) continue;
    const short = w["wbs_short_name"]?.trim();
    const name = w["wbs_name"]?.trim();
    wbsName.set(id, [short, name].filter(Boolean).join(" ").trim() || id);
  }

  // Tasks
  const tasks: Task[] = [];
  const taskIdByXerId = new Map<string, string>();
  const seenIds = new Set<string>();

  for (const t of taskRows) {
    const xerId = t["task_id"];
    if (!xerId) continue;
    const code = (t["task_code"] || `A${xerId}`).trim();
    // Avoid collisions
    let unique = code;
    let n = 2;
    while (seenIds.has(unique)) unique = `${code}_${n++}`;
    seenIds.add(unique);
    taskIdByXerId.set(xerId, unique);

    const hours = parseFloat(t["target_drtn_hr_cnt"] || "0");
    const duration = hoursToDays(hours, hoursPerDay);

    const wbsId = t["wbs_id"];
    const wbs = wbsId ? wbsName.get(wbsId) : undefined;

    const pct = parseFloat(t["phys_complete_pct"] || "0");

    tasks.push({
      id: unique,
      name: (t["task_name"] || code).trim(),
      duration,
      wbs: wbs || undefined,
      percentComplete: isFinite(pct) && pct > 0 ? Math.min(100, pct) : undefined,
    });
  }

  // Dependencies
  const dependencies: Dependency[] = [];
  let skipped = 0;
  for (const p of predRows) {
    const fromX = p["pred_task_id"];
    const toX = p["task_id"];
    const from = taskIdByXerId.get(fromX);
    const to = taskIdByXerId.get(toX);
    if (!from || !to) {
      skipped++;
      continue;
    }
    const type = DEP_MAP[p["pred_type"] || "PR_FS"] ?? "FS";
    const lagHours = parseFloat(p["lag_hr_cnt"] || "0");
    const lag = isFinite(lagHours) ? Math.round(lagHours / hoursPerDay) : 0;
    dependencies.push({ from, to, type, lag });
  }
  if (skipped > 0) {
    warnings.push(`${skipped} dependencies skipped (missing predecessor or successor task).`);
  }

  if (tasks.length > 2000) {
    warnings.push(`Schedule has ${tasks.length} tasks; only first 2000 will be saved.`);
  }
  if (dependencies.length > 5000) {
    warnings.push(
      `Schedule has ${dependencies.length} dependencies; only first 5000 will be saved.`,
    );
  }

  return {
    projectName,
    projectStartDate,
    tasks: tasks.slice(0, 2000),
    dependencies: dependencies.slice(0, 5000),
    warnings,
    stats: {
      tasksParsed: tasks.length,
      depsParsed: dependencies.length,
      wbsParsed: wbsName.size,
    },
  };
}
