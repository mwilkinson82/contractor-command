// Schedule files -> Athena import shape.
//
// Reads the two schedule exports contractors hand over most: a Primavera P6
// XER file and a Microsoft Project XML (MSPDI) file. Each becomes an ImportJob
// with the schedule, its WBS sections, the working calendar and the status
// date filled; everything else stays empty. Source rows go to the job's
// read-only archive so nothing is lost. No Node-only imports: this runs in the
// Worker as well as in vitest.
import { parseXerTables, type XerRow } from "../scheduler/engine2/xer-import";
import {
  ARCHIVE_MAX_ROWS,
  ImportInputError,
  clip,
  emptyImport,
  importJob,
  toDay,
  type ImportActivity,
  type ImportJob,
  type ImportSource,
} from "./model";

export type ScheduleFileOptions = { system: ImportSource; jobNumber?: string; jobName?: string };
type Link = NonNullable<ImportActivity["links"]>[number];
type Wbs = NonNullable<ImportJob["schedule_wbs"]>[number];

const MAX_ACTIVITIES = 400;
const MAX_LINKS = 20;
const MAX_HOLIDAYS = 1000;
const DAY_MS = 86_400_000;

const num = (v: unknown): number | null => {
  const s = v == null ? "" : String(v).trim();
  const n = Number(s);
  return s !== "" && Number.isFinite(n) ? n : null;
};
const clampInt = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.round(n))) || 0;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** P6 (like Excel) numbers days from 1899-12-30. */
const serialDay = (n: number) =>
  new Date(Date.UTC(1899, 11, 30) + Math.round(n) * DAY_MS).toISOString().slice(0, 10);
const nextDay = (d: string) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

/** A unique activity ID of at most 20 characters, built from what the source had. */
function uniqueId(want: string, used: Set<string>): string {
  const base = clip(want, 20) || "ACT";
  let id = base;
  for (let k = 2; used.has(id); k++) id = `${clip(base, 20 - String(k).length - 1)}-${k}`;
  used.add(id);
  return id;
}

/** Holidays within ten years of the project's dates, sorted, at most 1000. */
function keepHolidays(days: Iterable<string>, around: (string | null | undefined)[]): string[] {
  const years = around.filter((d): d is string => !!d).map((d) => Number(d.slice(0, 4)));
  const lo = years.length ? Math.min(...years) - 10 : -Infinity;
  const hi = years.length ? Math.max(...years) + 10 : Infinity;
  return [...new Set(days)]
    .filter((d) => Number(d.slice(0, 4)) >= lo && Number(d.slice(0, 4)) <= hi)
    .sort()
    .slice(0, MAX_HOLIDAYS);
}

function tooMany(n: number, from: string): never {
  throw new ImportInputError(
    `This schedule has ${n} activities; Athena's CPM holds up to ${MAX_ACTIVITIES}. Filter the ${from} export to this job's work (or a summary level) and import it again. Nothing was imported.`,
  );
}

/** Archive tables, inside the archive's overall row cap. */
function archiver(out: ImportJob) {
  let room = ARCHIVE_MAX_ROWS;
  let lost = 0;
  return {
    put(
      table: string,
      rows: Record<string, unknown>[],
      key: (r: Record<string, unknown>, i: number) => unknown,
    ) {
      const t: Record<string, Record<string, unknown>> = {};
      rows.forEach((r, i) => {
        if (room <= 0) return void lost++;
        let k = clip(key(r, i), 200) || `row-${i + 1}`;
        if (t[k]) k = clip(`${k}#${i + 1}`, 200);
        t[k] = { ...r };
        room--;
      });
      if (Object.keys(t).length) out.archive[table] = t;
    },
    done() {
      if (lost)
        out.held.push({
          kind: "Unarchived rows",
          count: lost,
          why: `The job's archive keeps up to ${ARCHIVE_MAX_ROWS} source rows; these did not fit.`,
        });
    },
  };
}

/** Validated with the import schema, so a reader slip shows here and not at save. */
function finish(out: ImportJob): ImportJob {
  out.problems = out.problems.map((p) => clip(p, 400)).slice(0, 200);
  out.held = out.held
    .slice(0, 40)
    .map((h) => ({ ...h, kind: clip(h.kind, 60), why: clip(h.why, 400) }));
  const r = importJob.safeParse(out);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new ImportInputError(
      `The schedule file couldn't be read: ${i.path.join(".")} ${i.message}`,
    );
  }
  return r.data;
}

/** One plain line on what the file holds that doesn't come in; nothing when there is none. */
function hold(out: ImportJob, kind: string, count: number, why: string, archived = false) {
  if (count) out.held.push({ kind, count, why, ...(archived ? { archived } : {}) });
}

function noJobNumber(out: ImportJob, from: string) {
  if (!out.job.job_number)
    out.problems.push(`The ${from} file has no job number. Name the job number here.`);
}

// ---------------------------------------------------------------------------
// Primavera P6 XER
// ---------------------------------------------------------------------------

export const isXer = (text: string): boolean => /^\uFEFF?\s*ERMHDR/.test(text);

type CalNode = { name: string; args: string; kids: CalNode[] };
/** P6's clndr_data is a tree of nodes written as (0||NAME(args)(children)). */
function clndrTree(src: string): CalNode[] {
  const s = src.replace(/[\x7f\r\n\t]/g, " ");
  let i = 0;
  const skip = () => {
    while (s[i] === " ") i++;
  };
  const node = (depth: number): CalNode | null => {
    skip();
    if (depth > 20 || !s.startsWith("(0||", i)) return null;
    const open = s.indexOf("(", i + 4);
    const close = open < 0 ? -1 : s.indexOf(")", open);
    if (close < 0) return null;
    const n: CalNode = {
      name: s.slice(i + 4, open).trim(),
      args: s.slice(open + 1, close),
      kids: [],
    };
    i = close + 1;
    skip();
    if (s[i] === "(" && !s.startsWith("(0||", i)) {
      i++;
      for (let c = node(depth + 1); c; c = node(depth + 1)) n.kids.push(c);
      skip();
      if (s[i] === ")") i++;
    }
    skip();
    if (s[i] === ")") i++;
    return n;
  };
  const out: CalNode[] = [];
  for (let guard = 0; guard < 100_000 && i < s.length; guard++) {
    const at = s.indexOf("(0||", i);
    if (at < 0) break;
    i = at;
    const n = node(0);
    if (n) out.push(n);
    else i = at + 4;
  }
  return out;
}
const findNode = (nodes: CalNode[], name: string): CalNode | undefined => {
  for (const n of nodes) {
    const hit = n.name === name ? n : findNode(n.kids, name);
    if (hit) return hit;
  }
  return undefined;
};
const hasShift = (n: CalNode): boolean => /s\|/.test(n.args) || n.kids.some(hasShift);

function xerCalendar(row: XerRow) {
  const tree = clndrTree(row.clndr_data ?? "");
  const week = findNode(tree, "DaysOfWeek");
  const work = new Set<number>();
  for (const d of week?.kids ?? []) {
    const n = parseInt(d.name, 10);
    if (n >= 1 && n <= 7 && hasShift(d)) work.add(n - 1); // P6: 1 = Sunday
  }
  if (!work.size) return null;
  const holidays: string[] = [];
  let worked = 0;
  for (const e of findNode(tree, "Exceptions")?.kids ?? []) {
    const m = /d\|(\d{4}-\d{2}-\d{2}|\d{1,6})/.exec(e.args);
    const d = !m ? null : m[1].includes("-") ? toDay(m[1]) : serialDay(Number(m[1]));
    if (!d) continue;
    if (hasShift(e)) worked++;
    else holidays.push(d);
  }
  return { work_days: [...work].sort(), holidays, worked };
}

const XER_LINK: Record<string, Link["type"]> = {
  PR_FS: "FS",
  PR_SS: "SS",
  PR_FF: "FF",
  PR_SF: "SF",
};
const XER_SKIP: Record<string, { kind: string; why: string }> = {
  TT_LOE: {
    kind: "Level of effort tasks",
    why: "Level of effort activities take their dates from the work they span, so they don't come into Athena's CPM. Their rows are kept in the job's archive.",
  },
  TT_WBS: {
    kind: "WBS summary tasks",
    why: "WBS summary activities roll up the work under them; Athena rolls up by WBS section instead. Their rows are kept in the job's archive.",
  },
};

export function fromXer(
  text: string,
  opts: ScheduleFileOptions & { projectId?: string },
): ImportJob {
  if (!isXer(text))
    throw new ImportInputError(
      "This file isn't a Primavera P6 XER export (an XER starts with ERMHDR). Export the project from P6 as XER and try again.",
    );
  const t = parseXerTables(text.replace(/^\uFEFF/, ""));
  const header = text
    .replace(/^\uFEFF/, "")
    .trimStart()
    .split(/\r?\n/, 1)[0]
    .split("\t");
  const projects = t.get("PROJECT") ?? [];
  const allTasks = t.get("TASK") ?? [];
  if (!projects.length || !allTasks.length)
    throw new ImportInputError(
      "This XER file holds no project with activities. Export the project itself from P6 (File > Export > XER) and try again.",
    );
  const taskCount = new Map<string, number>();
  for (const r of allTasks) taskCount.set(r.proj_id, (taskCount.get(r.proj_id) ?? 0) + 1);
  const named = (p: XerRow) => clip(p.proj_short_name, 60) || `project ${p.proj_id}`;
  let project: XerRow | undefined;
  if (opts.projectId?.trim()) {
    const want = opts.projectId.trim().toLowerCase();
    project = projects.find(
      (p) =>
        p.proj_id === opts.projectId!.trim() || clip(p.proj_short_name, 200).toLowerCase() === want,
    );
    if (!project)
      throw new ImportInputError(
        `This XER file has no project ${clip(opts.projectId, 60)}. It holds ${projects.map(named).join(", ")}.`,
      );
  } else
    project = projects.reduce((best, p) =>
      (taskCount.get(p.proj_id) ?? 0) > (taskCount.get(best.proj_id) ?? 0) ? p : best,
    );
  const pid = project.proj_id;
  const others = projects.filter((p) => p !== project);
  const wbsRows = (t.get("PROJWBS") ?? []).filter((w) => w.proj_id === pid);
  const projNodes = new Set(wbsRows.filter((w) => w.proj_node_flag === "Y").map((w) => w.wbs_id));
  const rootName = wbsRows.find((w) => projNodes.has(w.wbs_id))?.wbs_name;

  const jobNumber = clip(opts.jobNumber, 40) || clip(project.proj_short_name, 40);
  const name =
    clip(opts.jobName, 200) ||
    clip(project.proj_long_name, 200) ||
    clip(rootName, 200) ||
    clip(project.proj_short_name, 200);
  const out = emptyImport(opts.system, clip(`P6 schedule (XER) for job ${jobNumber || name}`, 200));
  out.source.exported_at = toDay(header[2]);
  out.job = {
    ...out.job,
    source_id: clip(`p6:${clip(project.proj_short_name, 100) || pid}`, 120),
    job_number: jobNumber,
    name,
    completion_date: toDay(project.scd_end_date) ?? toDay(project.plan_end_date),
  };
  out.schedule_data_date = toDay(project.last_recalc_date);
  noJobNumber(out, "P6");
  if (others.length) {
    if (!opts.projectId?.trim())
      out.problems.push(
        `This XER file holds ${projects.length} projects; Athena read ${named(project)}, the one with the most activities (${taskCount.get(pid) ?? 0}). If this job is ${others.map(named).join(" or ")} instead, say which project to read.`,
      );
    hold(
      out,
      "Other projects",
      others.length,
      "The XER file holds other P6 projects too. P6 keeps baselines as separate projects, so they don't come in as this job's schedule. Athena captures its own first baseline (BL1) when it calculates the import.",
    );
  }

  // Tasks of the project, and the ones that don't come in.
  const tasks = allTasks.filter((r) => r.proj_id === pid);
  const kept = tasks.filter((r) => !XER_SKIP[r.task_type]);
  if (!kept.length)
    throw new ImportInputError(`P6 project ${named(project)} has no activities to import.`);
  if (kept.length > MAX_ACTIVITIES) tooMany(kept.length, "P6");
  for (const [type, h] of Object.entries(XER_SKIP)) {
    const n = tasks.filter((r) => r.task_type === type).length;
    if (n) out.held.push({ ...h, count: n, archived: true });
  }

  // Calendar: the project's default, else the one most activities use.
  const cals = t.get("CALENDAR") ?? [];
  const calById = new Map(cals.map((c) => [c.clndr_id, c]));
  const uses = new Map<string, number>();
  for (const r of kept) uses.set(r.clndr_id, (uses.get(r.clndr_id) ?? 0) + 1);
  const mostUsed = [...uses].filter(([id]) => calById.has(id)).sort((a, b) => b[1] - a[1])[0]?.[0];
  const projCal =
    calById.get(project.clndr_id) ??
    (mostUsed ? calById.get(mostUsed) : undefined) ??
    cals.find((c) => c.default_flag === "Y");
  const hpdOfRow = (c: XerRow | undefined) => {
    const h = num(c?.day_hr_cnt);
    return h && h > 0 && h <= 24 ? h : null;
  };
  const projHpd = hpdOfRow(projCal) ?? 8;
  const hpdOf = (clndrId: string | undefined) => hpdOfRow(calById.get(clndrId ?? "")) ?? projHpd;
  const cal = projCal ? xerCalendar(projCal) : null;
  const calName = clip(projCal?.clndr_name, 80) || "the project calendar";
  if (cal) {
    out.schedule_calendar = {
      work_days: cal.work_days,
      holidays: keepHolidays(
        cal.holidays,
        [
          project.plan_start_date,
          project.plan_end_date,
          project.scd_end_date,
          project.last_recalc_date,
        ].map(toDay),
      ),
    };
    if (cal.worked)
      out.problems.push(
        `P6 calendar ${calName} has ${plural(cal.worked, "worked exception day")} (extra work on a usual day off); Athena's calendar keeps the work week and holidays, so those days follow the regular week.`,
      );
  } else
    out.problems.push(
      "Athena couldn't read the project calendar's work week from the XER, so the schedule comes in with P6's reported dates until a calendar is set.",
    );
  const offCal = projCal
    ? kept.filter((r) => r.clndr_id && r.clndr_id !== projCal.clndr_id).length
    : 0;
  hold(
    out,
    "Other-calendar tasks",
    offCal,
    `These P6 activities use a calendar other than ${calName}. Athena schedules every activity on the project calendar; their durations are converted at their own calendar's hours per day.`,
  );

  // WBS sections, without the project node; pruned to the ones in use past 400.
  let secs = wbsRows
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => !projNodes.has(w.wbs_id))
    .sort((a, b) => (num(a.w.seq_num) ?? 0) - (num(b.w.seq_num) ?? 0) || a.i - b.i);
  if (secs.length > 400) {
    const parentOf = new Map(wbsRows.map((w) => [w.wbs_id, w.parent_wbs_id]));
    const need = new Set<string>();
    for (const r of kept)
      for (let id: string | undefined = r.wbs_id, g = 0; id && g < 50 && !need.has(id); g++) {
        need.add(id);
        id = parentOf.get(id);
      }
    const before = secs.length;
    secs = secs.filter(({ w }) => need.has(w.wbs_id)).slice(0, 400);
    out.problems.push(
      `The P6 project has ${before} WBS elements; Athena keeps up to 400, so it brought in the ${secs.length} that hold activities.`,
    );
  }
  const secIds = new Set(secs.map(({ w }) => w.wbs_id));
  const wbs: Wbs[] = secs.map(({ w }, order) => ({
    source_id: `wbs:${w.wbs_id}`,
    name: clip(`${w.wbs_short_name ?? ""} ${w.wbs_name ?? ""}`, 160),
    order,
    parent: secIds.has(w.parent_wbs_id) ? `wbs:${w.parent_wbs_id}` : null,
  }));
  if (wbs.length) out.schedule_wbs = wbs;

  // Activity IDs: P6's activity ID, made unique within 20 characters.
  const used = new Set<string>();
  const idOf = new Map<string, string>();
  const renamed: string[] = [];
  for (const r of kept) {
    const id = uniqueId(r.task_code?.trim() || `T${r.task_id}`, used);
    if (id !== clip(r.task_code, 400))
      renamed.push(`${clip(r.task_code, 40) || "(blank)"} → ${id}`);
    idOf.set(r.task_id, id);
  }
  if (renamed.length)
    out.problems.push(
      `${plural(renamed.length, "P6 activity ID was", "P6 activity IDs were")} blank, longer than 20 characters or repeated, so Athena gave ${renamed.length === 1 ? "it a unique ID" : "them unique IDs"}: ${renamed.slice(0, 5).join(", ")}${renamed.length > 5 ? ", …" : ""}.`,
    );

  // Logic, kept on the successor.
  const taskById = new Map(tasks.map((r) => [r.task_id, r]));
  const skippedIds = new Set(tasks.filter((r) => XER_SKIP[r.task_type]).map((r) => r.task_id));
  const preds = (t.get("TASKPRED") ?? []).filter(
    (p) => taskById.has(p.task_id) || taskById.has(p.pred_task_id),
  );
  const linksOf = new Map<string, Link[]>();
  let toSkipped = 0;
  let outside = 0;
  const overflow = new Set<string>();
  let overflowLinks = 0;
  for (const p of preds) {
    if (skippedIds.has(p.task_id) || skippedIds.has(p.pred_task_id)) {
      toSkipped++;
      continue;
    }
    const succ = idOf.get(p.task_id);
    const pred = idOf.get(p.pred_task_id);
    if (!succ || !pred) {
      outside++;
      continue;
    }
    if (succ === pred) continue;
    const type = XER_LINK[p.pred_type] ?? "FS";
    const lagH = num(p.lag_hr_cnt) ?? 0;
    const lag = clampInt(lagH / hpdOf(taskById.get(p.pred_task_id)?.clndr_id), -5000, 5000);
    const list = linksOf.get(succ) ?? [];
    if (list.some((l) => l.id === pred && l.type === type)) continue;
    if (list.length >= MAX_LINKS) {
      overflow.add(succ);
      overflowLinks++;
      continue;
    }
    list.push({ id: pred, type, lag });
    linksOf.set(succ, list);
  }
  hold(
    out,
    "Skipped-task logic ties",
    toSkipped,
    "These ties connect to activities that don't come in (level of effort or WBS summary), so they are left off. They are kept in the job's archive.",
    true,
  );
  hold(
    out,
    "Cross-project logic ties",
    outside,
    "These ties connect to activities in another P6 project, so they are left off. They are kept in the job's archive.",
    true,
  );
  if (overflow.size)
    out.problems.push(
      `${[...overflow].slice(0, 5).join(", ")}${overflow.size > 5 ? " and others" : ""} ${overflow.size === 1 ? "has" : "have"} more than ${MAX_LINKS} predecessors in P6; Athena keeps the first ${MAX_LINKS} each (${plural(overflowLinks, "tie")} left off, kept in the job's archive).`,
    );

  out.schedule = kept.map((r): ImportActivity => {
    const id = idOf.get(r.task_id)!;
    const started = r.status_code === "TK_Active" || r.status_code === "TK_Complete";
    const done = r.status_code === "TK_Complete";
    const milestone = r.task_type === "TT_Mile" || r.task_type === "TT_FinMile";
    const hpd = hpdOf(r.clndr_id);
    const days = (h: string | undefined) => {
      const n = num(h);
      return n == null ? null : clampInt(n / hpd, 0, 5000);
    };
    const targetH = num(r.target_drtn_hr_cnt);
    const remainH = num(r.remain_drtn_hr_cnt);
    let pct: number | null;
    if (done) pct = 100;
    else if (r.complete_pct_type === "CP_Phys") pct = num(r.phys_complete_pct);
    else if (targetH && targetH > 0 && remainH != null) pct = ((targetH - remainH) / targetH) * 100;
    else pct = started ? null : 0;
    let start =
      (started ? toDay(r.act_start_date) : null) ??
      toDay(r.early_start_date) ??
      toDay(r.restart_date) ??
      toDay(r.target_start_date);
    let end =
      (done ? toDay(r.act_end_date) : null) ??
      toDay(r.early_end_date) ??
      toDay(r.reend_date) ??
      toDay(r.target_end_date);
    if (milestone) {
      start = start ?? end;
      end = end ?? start;
    }
    const links = linksOf.get(id) ?? [];
    let actualStart = started ? toDay(r.act_start_date) : null;
    let actualFinish = done ? toDay(r.act_end_date) : null;
    // A finished milestone keeps one actual date in P6; it is both here.
    if (milestone && done) {
      actualStart = actualStart ?? actualFinish;
      actualFinish = actualFinish ?? actualStart;
    }
    return {
      source_id: clip(`task:${r.task_id || id}`, 120),
      id,
      name: clip(r.task_name, 160),
      start,
      finish: end,
      duration_days: milestone ? 0 : days(r.target_drtn_hr_cnt),
      pct_complete: pct == null ? null : Math.min(100, Math.max(0, Math.round(pct * 10) / 10)),
      predecessors: [...new Set(links.map((l) => l.id))],
      links,
      actual_start: actualStart,
      actual_finish: actualFinish,
      remaining_days: done || milestone ? 0 : days(r.remain_drtn_hr_cnt),
      wbs: secIds.has(r.wbs_id) ? `wbs:${r.wbs_id}` : null,
      milestone,
    };
  });

  const arc = archiver(out);
  arc.put("p6_project", [project], (r) => r.proj_id);
  arc.put("p6_wbs", wbsRows, (r) => r.wbs_id);
  arc.put("p6_calendars", cals, (r) => r.clndr_id);
  arc.put("p6_tasks", tasks, (r) => r.task_id);
  arc.put("p6_links", preds, (r) => r.task_pred_id);
  arc.done();
  return finish(out);
}

// ---------------------------------------------------------------------------
// Microsoft Project XML (MSPDI)
// ---------------------------------------------------------------------------

export function isMspdi(text: string): boolean {
  const s = text.replace(/^\uFEFF/, "").trimStart();
  if (!s.startsWith("<")) return false;
  return (
    /<Project\b[^>]*\bxmlns\s*=\s*["']http:\/\/schemas\.microsoft\.com\/project["']/.test(
      s.slice(0, 8000),
    ) || /<Tasks>\s*<Task>/.test(s)
  );
}

type XNode = { name: string; kids: XNode[]; text: string };
const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== "#") return ENTITIES[e] ?? m;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });

/** Element tree of an XML document: names without prefix, text decoded, attributes ignored. */
function parseXml(src: string): XNode {
  const root: XNode = { name: "#root", kids: [], text: "" };
  const stack = [root];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    const top = stack[stack.length - 1];
    if (lt < 0) break;
    if (lt > i) top.text += decode(src.slice(i, lt));
    const skipTo = (end: string, from: number) => {
      const e = src.indexOf(end, from);
      return e < 0 ? src.length : e + end.length;
    };
    if (src.startsWith("<!--", lt)) i = skipTo("-->", lt + 4);
    else if (src.startsWith("<![CDATA[", lt)) {
      const e = src.indexOf("]]>", lt + 9);
      top.text += src.slice(lt + 9, e < 0 ? src.length : e);
      i = e < 0 ? src.length : e + 3;
    } else if (src[lt + 1] === "?" || src[lt + 1] === "!") i = skipTo(">", lt);
    else {
      let j = lt + 1;
      for (let q = ""; j < src.length; j++) {
        const c = src[j];
        if (q) q = c === q ? "" : q;
        else if (c === '"' || c === "'") q = c;
        else if (c === ">") break;
      }
      const tag = src.slice(lt + 1, j).trim();
      i = j + 1;
      const local = (q: string) => q.slice(q.indexOf(":") + 1);
      if (tag[0] === "/") {
        const name = local(tag.slice(1).trim());
        for (let k = stack.length - 1; k > 0; k--)
          if (stack[k].name === name) {
            stack.length = k;
            break;
          }
        continue;
      }
      const n: XNode = {
        name: local(tag.replace(/\/$/, "").trim().split(/\s/)[0]),
        kids: [],
        text: "",
      };
      top.kids.push(n);
      if (!tag.endsWith("/")) stack.push(n);
    }
  }
  return root;
}
const kid = (n: XNode | undefined, name: string) => n?.kids.find((k) => k.name === name);
const kidsOf = (n: XNode | undefined, name: string) => n?.kids.filter((k) => k.name === name) ?? [];
const val = (n: XNode | undefined, name: string) => (kid(n, name)?.text ?? "").trim();

/** ISO 8601 duration (PT40H0M0S, P5D, P1W) in minutes; days and weeks are working days. */
function isoMinutes(s: string, mpd: number, mpw: number): number | null {
  const m =
    /^(-)?P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      s.trim(),
    );
  if (!m || s.trim() === "P" || s.trim() === "PT") return null;
  const [w, d, h, mi, se] = m.slice(2).map((x) => Number(x ?? 0));
  return (m[1] ? -1 : 1) * (w * mpw + d * mpd + h * 60 + mi + se / 60);
}

const MSP_FIELDS = (
  "UID ID Name WBS OutlineNumber OutlineLevel Summary Milestone Active Duration Start Finish " +
  "ActualStart ActualFinish PercentComplete RemainingDuration"
).split(" ");
const MSP_LINK: Record<string, Link["type"]> = { "0": "FF", "1": "FS", "2": "SF", "3": "SS" };
const ELAPSED_LAG = new Set([4, 6, 8, 10, 12, 36, 38, 40, 42, 44]);
const PERCENT_LAG = new Set([19, 20, 51, 52]);

export function fromMspdi(text: string, opts: ScheduleFileOptions): ImportJob {
  if (!isMspdi(text))
    throw new ImportInputError(
      "This file isn't Microsoft Project XML. In MS Project choose File > Save As > XML Format (*.xml) and try again.",
    );
  const proj = parseXml(text.replace(/^\uFEFF/, "")).kids.find((k) => k.name === "Project");
  const taskNodes = kidsOf(kid(proj, "Tasks"), "Task").filter(
    (t) => val(t, "IsNull") !== "1" && val(t, "UID") !== "0" && val(t, "UID") !== "",
  );
  if (!proj || !taskNodes.length)
    throw new ImportInputError(
      "This MS Project XML file holds no tasks. Save the project itself as XML and try again.",
    );
  const mpdRaw = num(val(proj, "MinutesPerDay"));
  const mpd = mpdRaw && mpdRaw > 0 ? mpdRaw : 480;
  const mpwRaw = num(val(proj, "MinutesPerWeek"));
  const mpw = mpwRaw && mpwRaw > 0 ? mpwRaw : mpd * 5;

  const fileName = val(proj, "Name").replace(/\.(xml|mpp)$/i, "");
  const jobNumber = clip(opts.jobNumber, 40);
  const name = clip(opts.jobName, 200) || clip(val(proj, "Title"), 200) || clip(fileName, 200);
  const out = emptyImport(
    opts.system,
    clip(`MS Project schedule (XML) for job ${jobNumber || name}`, 200),
  );
  out.source.exported_at = clip(val(proj, "LastSaved"), 40) || null;
  out.job = {
    ...out.job,
    source_id: clip(`msp:${val(proj, "GUID") || fileName || name || "project"}`, 120),
    job_number: jobNumber,
    name,
    completion_date: toDay(val(proj, "FinishDate")),
  };
  out.schedule_data_date = toDay(val(proj, "StatusDate"));
  noJobNumber(out, "MS Project");

  // Calendar: the project calendar on top of its base calendar.
  const calByUid = new Map(
    kidsOf(kid(proj, "Calendars"), "Calendar").map((c) => [val(c, "UID"), c]),
  );
  let worked = 0;
  let recurring = 0;
  const readCal = (
    uid: string,
    depth: number,
  ): { week: (boolean | undefined)[]; off: Set<string> } | null => {
    const c = calByUid.get(uid);
    if (!c || depth > 5) return null;
    const baseUid = val(c, "BaseCalendarUID");
    const base =
      baseUid && baseUid !== "-1" && baseUid !== uid ? readCal(baseUid, depth + 1) : null;
    const res = base ?? {
      week: new Array<boolean | undefined>(7).fill(undefined),
      off: new Set<string>(),
    };
    const range = (tp: XNode | undefined, working: boolean) => {
      const from = toDay(val(tp, "FromDate"));
      const to = toDay(val(tp, "ToDate")) ?? from;
      if (!from || !to) return;
      if (working) return void worked++;
      for (let d = from, n = 0; d <= to && n < 3660; d = nextDay(d), n++) res.off.add(d);
    };
    for (const wd of kidsOf(kid(c, "WeekDays"), "WeekDay")) {
      const type = num(val(wd, "DayType"));
      const working = val(wd, "DayWorking") === "1";
      if (type != null && type >= 1 && type <= 7) res.week[type - 1] = working;
      else if (type === 0) range(kid(wd, "TimePeriod"), working);
    }
    for (const ex of kidsOf(kid(c, "Exceptions"), "Exception")) {
      const type = val(ex, "Type");
      if (type && type !== "1") recurring++;
      else range(kid(ex, "TimePeriod"), val(ex, "DayWorking") === "1");
    }
    return res;
  };
  const calUid =
    val(proj, "CalendarUID") ||
    [...calByUid].find(([, c]) => val(c, "IsBaseCalendar") === "1")?.[0] ||
    "";
  const cal = readCal(calUid, 0);
  const workDays = cal ? cal.week.flatMap((w, d) => ((w ?? (d >= 1 && d <= 5)) ? [d] : [])) : [];
  if (cal && workDays.length) {
    const dates = taskNodes.flatMap((t) => [toDay(val(t, "Start")), toDay(val(t, "Finish"))]);
    out.schedule_calendar = {
      work_days: workDays,
      holidays: keepHolidays(cal.off, [...dates, out.job.completion_date]),
    };
  } else
    out.problems.push(
      "Athena couldn't read the project calendar from the MS Project file, so the schedule comes in with its reported dates until a calendar is set.",
    );
  if (worked)
    out.problems.push(
      `The MS Project calendar has ${plural(worked, "worked exception")} (extra work on a usual day off); Athena's calendar keeps the work week and holidays, so those days follow the regular week.`,
    );
  if (recurring)
    out.problems.push(
      `The MS Project calendar has ${plural(recurring, "recurring exception")}; Athena reads single-date and date-range exceptions only, so add those days off as holidays in Athena.`,
    );

  // Summary tasks become WBS sections, nested by outline level in file order.
  const wbs: Wbs[] = [];
  const summaryUids = new Set<string>();
  const stack: { level: number; sid: string }[] = [];
  const rows: { t: XNode; uid: string; parent: string | null }[] = [];
  let inactive = 0;
  for (const t of taskNodes) {
    const uid = val(t, "UID");
    const level = num(val(t, "OutlineLevel")) ?? 1;
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].sid : null;
    if (val(t, "Summary") === "1") {
      const sid = clip(`wbs:${uid}`, 120);
      summaryUids.add(uid);
      stack.push({ level, sid });
      if (wbs.length < 400)
        wbs.push({
          source_id: sid,
          name: clip(`${val(t, "WBS")} ${val(t, "Name")}`, 160),
          order: wbs.length,
          parent,
        });
    } else if (val(t, "Active") === "0") inactive++;
    else rows.push({ t, uid, parent });
  }
  if (!rows.length)
    throw new ImportInputError("The MS Project file has no tasks to import, only summary tasks.");
  if (rows.length > MAX_ACTIVITIES) tooMany(rows.length, "MS Project");
  const secIds = new Set(wbs.map((w) => w.source_id));
  if (summaryUids.size > wbs.length)
    out.problems.push(
      `The MS Project file has ${summaryUids.size} summary tasks; Athena keeps the first 400 as WBS sections.`,
    );
  if (wbs.length)
    out.schedule_wbs = wbs.map((w) => ({
      ...w,
      parent: w.parent && secIds.has(w.parent) ? w.parent : null,
    }));
  hold(
    out,
    "Inactive tasks",
    inactive,
    "Inactive tasks don't drive the MS Project schedule, so they don't come into Athena's CPM. They are kept in the job's archive.",
    true,
  );

  const used = new Set<string>();
  const idByUid = new Map<string, string>();
  for (const { t, uid } of rows) {
    const code = val(t, "WBS");
    idByUid.set(
      uid,
      uniqueId(
        code && code.length <= 20 && !used.has(code) ? code : `A${val(t, "ID") || uid}`,
        used,
      ),
    );
  }
  const durDays = (s: string) => {
    const m = s ? isoMinutes(s, mpd, mpw) : null;
    return m == null ? null : clampInt(m / mpd, 0, 5000);
  };
  const durByUid = new Map(rows.map(({ t, uid }) => [uid, durDays(val(t, "Duration")) ?? 0]));
  let toSummary = 0;
  let outside = 0;
  let elapsed = 0;
  let percent = 0;
  let overflow = 0;

  out.schedule = rows.map(({ t, uid, parent }): ImportActivity => {
    const id = idByUid.get(uid)!;
    const links: Link[] = [];
    for (const pl of kidsOf(t, "PredecessorLink")) {
      const puid = val(pl, "PredecessorUID");
      const pred = idByUid.get(puid);
      if (summaryUids.has(puid)) {
        toSummary++;
        continue;
      }
      if (!pred || pred === id || val(pl, "CrossProject") === "1") {
        outside++;
        continue;
      }
      const tenths = num(val(pl, "LinkLag")) ?? 0;
      const fmt = num(val(pl, "LagFormat")) ?? 7;
      let lagDays: number;
      if (PERCENT_LAG.has(fmt)) {
        percent++;
        lagDays = (tenths / 10 / 100) * (durByUid.get(puid) ?? 0);
      } else if (ELAPSED_LAG.has(fmt)) {
        elapsed++;
        lagDays = (tenths / 10 / 1440) * (mpw / mpd / 7);
      } else lagDays = tenths / 10 / mpd;
      const type = MSP_LINK[val(pl, "Type") || "1"] ?? "FS";
      if (links.some((l) => l.id === pred && l.type === type)) continue;
      if (links.length >= MAX_LINKS) {
        overflow++;
        continue;
      }
      links.push({ id: pred, type, lag: clampInt(lagDays, -5000, 5000) });
    }
    const milestone = val(t, "Milestone") === "1";
    const actualFinish = toDay(val(t, "ActualFinish"));
    const pct = num(val(t, "PercentComplete"));
    const bl = kidsOf(t, "Baseline").find((b) => val(b, "Number") === "0");
    return {
      source_id: clip(`task:${uid}`, 120),
      id,
      name: clip(val(t, "Name"), 160),
      start: toDay(val(t, "Start")),
      finish: toDay(val(t, "Finish")),
      duration_days: milestone ? 0 : durDays(val(t, "Duration")),
      pct_complete: actualFinish ? 100 : pct == null ? null : Math.min(100, Math.max(0, pct)),
      predecessors: [...new Set(links.map((l) => l.id))],
      links,
      actual_start: toDay(val(t, "ActualStart")),
      actual_finish: actualFinish,
      remaining_days: actualFinish || milestone ? 0 : durDays(val(t, "RemainingDuration")),
      wbs: parent && secIds.has(parent) ? parent : null,
      milestone,
      ...(bl
        ? { baseline_start: toDay(val(bl, "Start")), baseline_finish: toDay(val(bl, "Finish")) }
        : {}),
    };
  });
  hold(
    out,
    "Summary-task logic ties",
    toSummary,
    "Athena's CPM ties activities to activities, not to WBS sections, so ties to or from MS Project summary tasks are left off. They are listed on each task in the job's archive.",
    true,
  );
  hold(
    out,
    "External logic ties",
    outside,
    "These ties point at tasks in another project or not in the file, so they are left off. They are listed on each task in the job's archive.",
    true,
  );
  if (elapsed)
    out.problems.push(
      `${plural(elapsed, "tie uses", "ties use")} an elapsed lag in MS Project; Athena counts lag in working days, so it converted at ${Math.round(mpw / mpd)} working days a week and rounded to whole days.`,
    );
  if (percent)
    out.problems.push(
      `${plural(percent, "tie uses", "ties use")} a percent lag in MS Project; Athena converted each to whole working days of the predecessor's duration.`,
    );
  if (overflow)
    out.problems.push(
      `${plural(overflow, "tie was", "ties were")} left off because an MS Project task had more than ${MAX_LINKS} predecessors; they are listed on the task in the job's archive.`,
    );

  const flat = (t: XNode) => {
    const bl = kidsOf(t, "Baseline").find((b) => val(b, "Number") === "0");
    const r: Record<string, string> = {};
    for (const f of MSP_FIELDS) {
      const v = val(t, f);
      if (v) r[f] = v;
    }
    if (bl)
      Object.assign(r, { BaselineStart: val(bl, "Start"), BaselineFinish: val(bl, "Finish") });
    const preds = kidsOf(t, "PredecessorLink").map(
      (pl) =>
        `${val(pl, "PredecessorUID")}:${MSP_LINK[val(pl, "Type") || "1"] ?? val(pl, "Type")}:${val(pl, "LinkLag") || "0"}:${val(pl, "LagFormat") || "7"}`,
    );
    if (preds.length) r.Predecessors = preds.join("; ");
    return r;
  };
  const arc = archiver(out);
  arc.put("msp_tasks", taskNodes.map(flat), (r) => r.UID);
  arc.done();
  return finish(out);
}
