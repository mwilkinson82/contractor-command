/**
 * The calculated schedule page: a P6-style Gantt drawn without scripts (the share page's policy allows none and the
 * signed-in page injects HTML). Views, filters and layers switch with CSS (:has on native inputs); the activity
 * inspector opens with :target. Rows have one fixed height so logic lines can be drawn in one overlay.
 * Pure: reads saved results only, never recalculates or invents dates, float or logic.
 */
import type { Activity, LivingData } from "./mcp/living";
import {
  orderedWbs,
  wbsPaths,
  type ScheduleControl,
  type ScheduleBaseline,
} from "./mcp/schedule-control";
import type { ScheduleLayout } from "./mcp/schedule-schema";
import {
  codeValueName,
  describeFilter,
  layoutFilter,
  startStatus,
  startVariance,
  type StartStatus,
} from "./schedule-layouts";
import { ICONS, athenaControlsCss } from "./athena-controls";

const DAY = 86_400_000;
export const CPM_ROW_PX = 28;
const HEAD = 40;
const INK = "#1E3A5F",
  INK2 = "#4D6480",
  MUTED = "#6B7280",
  LINE = "#DFE7F0",
  LINE2 = "#EDF1F6",
  BLUE = "#2563EB",
  ACT = "#2F4D74",
  CRIT = "#C8322B",
  NEG = "#D9822B",
  POS = "#1F8A5B",
  BL = "#C3CCD8",
  FLT = "#8A9BB0";
export const PATH_COLORS = [
  CRIT,
  "#B45309",
  "#0F766E",
  "#6D28D9",
  "#BE185D",
  "#0E7490",
  "#4D7C0F",
  "#9F1239",
  "#475569",
  "#78350F",
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const day = (v: string | null | undefined): number | null => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const t = Date.parse(`${v.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(t) ? t : null;
};
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
/** 03/14/26 style, as on the printed schedules contractors trade. */
export const shortDay = (t: number | null) => {
  if (t === null) return "";
  const d = new Date(t);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(2)}`;
};
const longDay = (t: number | null) => {
  if (t === null) return "Not dated";
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};
const px = (n: number) => `${Math.round(n * 10) / 10}px`;

type Cal = { name: string; works: (t: number) => boolean };
function calendars(control: ScheduleControl): { get: (id?: string) => Cal } {
  const s = control.settings;
  const map = new Map<string, Cal>();
  for (const c of s?.calendars ?? []) {
    const holidays = new Set(c.holidays);
    map.set(c.id, {
      name: c.name,
      works: (t) => (c.work_days & (1 << new Date(t).getUTCDay())) !== 0 && !holidays.has(iso(t)),
    });
  }
  const fallback: Cal = {
    name: "Monday to Friday",
    works: (t) => {
      const d = new Date(t).getUTCDay();
      return d !== 0 && d !== 6;
    },
  };
  return {
    get: (id) =>
      map.get(id ?? s?.default_calendar_id ?? "") ??
      map.get(s?.default_calendar_id ?? "") ??
      fallback,
  };
}
/** The day n working days after t (n ≥ 0). Bounded so a calendar with no working days cannot hang the page. */
function addWork(t: number, n: number, cal: Cal): number {
  let d = t;
  for (let left = n, guard = 0; left > 0 && guard < 20000; guard++) {
    d += DAY;
    if (cal.works(d)) left--;
  }
  return d;
}
/** Working days from a to b, counted over (a, b]; negative when b is earlier. */
export function workDaysBetween(a: number, b: number, cal: Cal): number {
  let n = 0;
  if (b >= a) for (let d = a + DAY; d <= b && n < 20000; d += DAY) n += cal.works(d) ? 1 : 0;
  else for (let d = a; d > b && n > -20000; d -= DAY) n -= cal.works(d) ? 1 : 0;
  return n;
}

export type GanttRow = {
  a: Activity;
  idx: number;
  start: number | null;
  finish: number | null;
  milestone: boolean;
  done: boolean;
  started: boolean;
  critical: boolean;
  tf: number | null;
  ff: number | null;
  path: number | null;
  driving: Set<string>;
  wbsTokens: string[];
  costToken: string | null;
  /** Activity code value tokens (v<code>_<value>) for the code filter. */
  codeTokens: string[];
  /** Passes the open layout's filter (always true with no layout). */
  keep: boolean;
  fragnet: boolean;
  base?: Activity;
  /** Baseline start, start variance against it (WD), and start status at the data date. */
  bs: number | null;
  sv: number | null;
  ss: StartStatus | null;
  prior?: Activity;
  cal: Cal;
};
type Item =
  | {
      kind: "group";
      label: string;
      color?: string;
      kids: GanttRow[];
      tokens: string[];
      costs: string[];
      codes?: string[];
    }
  | { kind: "act"; r: GanttRow };

/** Columns the table sorts by; each row carries its rank under every one. Code columns add k0, k1… */
export const SORT_KEYS = ["id", "name", "od", "rd", "pc", "st", "fi", "tf", "ff", "bs", "sv", "ss"] as const;
/** Start status, most urgent first, for sorting. */
const SS_RANK: Record<StartStatus["kind"], number> = {
  "past-due": 0,
  "started-late": 1,
  "this-week": 2,
  "two-weeks": 3,
  upcoming: 4,
  started: 5,
  finished: 6,
};
type SortKey = string;
/** Pixel width of a code column. */
const CODE_COL_W = 104;
const CODE_COL_MAX_W = 210;
/** Pixels per day for a layout's timescale. */
const TIMESCALE_PX = { week: 7, month: 3, quarter: 1 } as const;

export type GanttInput = {
  data: LivingData;
  control: ScheduleControl;
  dataDate: string | null | undefined;
  contractCompletion?: string | null;
  /** Saved layout to open (schedule_control.layouts[].id). Unknown IDs open the default view. */
  layout?: string | null;
  /** Link that opens a layout, or the default view with null. Default: ?layout=<id>. */
  layoutHref?: (id: string | null) => string;
};

/** Everything the page needs, derived once. Exported for tests and the PDF. */
export function ganttModel({
  data,
  control,
  dataDate,
  contractCompletion,
  layout: layoutId,
}: GanttInput) {
  const acts = data.activities ?? [];
  const layout: ScheduleLayout | null =
    (layoutId && control.layouts?.find((l) => l.id === layoutId)) || null;
  const keep = layoutFilter(control, layout);
  const codes = control.activity_codes ?? [];
  const codeCols = codes.map((c, i) => ({
    k: `k${i}`,
    code: c.id,
    label: c.name,
    title: `Activity code: ${c.name}`,
    // Fit the longest value (a sub's company name runs long), within a cap so the bars keep room.
    w: Math.round(Math.min(
      CODE_COL_MAX_W,
      Math.max(CODE_COL_W, 24 + 6.6 * Math.max(c.name.length, ...c.values.map((v) => v.name.length))),
    )),
  }));
  const codeToken = (codeId: string, valueId: string) => {
    const ci = codes.findIndex((c) => c.id === codeId);
    const vi = ci < 0 ? -1 : codes[ci].values.findIndex((v) => v.id === valueId);
    return vi < 0 ? null : `v${ci}_${vi}`;
  };
  const cals = calendars(control);
  const paths = control.wbs.length ? wbsPaths(control.wbs) : new Map<string, string>();
  const nodes = control.wbs.length ? orderedWbs(control.wbs) : [];
  const nodeToken = new Map(nodes.map((n, i) => [n.id, `w${i}`]));
  const parent = new Map(control.wbs.map((n) => [n.id, n.parent_id]));
  const lineage = (id: string | null | undefined) => {
    const out: string[] = [];
    for (let at = id ?? null, guard = 0; at && guard < 50; at = parent.get(at) ?? null, guard++)
      if (nodeToken.has(at)) out.push(nodeToken.get(at)!);
    return out;
  };
  const costs = [
    ...new Set(acts.map((a) => a.cost_code?.trim()).filter((c): c is string => !!c)),
  ].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
  const costToken = new Map(costs.map((c, i) => [c, `c${i}`]));
  const baseline: ScheduleBaseline | undefined = control.baselines.find(
    (b) => b.id === control.active_baseline_id,
  );
  const baseById = new Map((baseline?.activities ?? []).map((b) => [b.id, b]));
  const prior = control.prior_update;
  const priorById = new Map((prior?.activities ?? []).map((b) => [b.id, b]));
  const results = control.calculation.activity_results ?? {};
  const fragnetIds = new Set(control.analysis?.fragnet_ids ?? []);
  const rows: GanttRow[] = acts.map((a, idx) => {
    const res = results[a.id];
    const done = !!a.actual_finish || (a.pct_complete === 100 && !!a.actual_start);
    return {
      a,
      idx,
      start: day(a.start),
      finish: day(a.finish),
      milestone: a.duration === 0,
      done,
      started: !!a.actual_start,
      critical: !done && a.critical === true,
      tf: done ? null : a.total_float,
      ff: done ? null : (res?.free_float ?? null),
      path: done ? null : (res?.float_path ?? null),
      driving: new Set(res?.driving_predecessors ?? []),
      wbsTokens: lineage(a.wbs_id),
      costToken: a.cost_code?.trim() ? costToken.get(a.cost_code.trim())! : null,
      codeTokens: Object.entries(control.code_values?.[a.id] ?? {})
        .map(([c, v]) => codeToken(c, v))
        .filter((t): t is string => !!t),
      keep: keep(a) || fragnetIds.has(a.id),
      fragnet: fragnetIds.has(a.id),
      base: baseById.get(a.id),
      bs: day(baseById.get(a.id)?.start),
      sv: startVariance(control, a),
      ss: startStatus(control, a),
      prior: priorById.get(a.id),
      cal: cals.get(a.calendar_id),
    };
  });
  const byId = new Map(rows.map((r) => [r.a.id, r]));
  // Rank of each activity under every sortable column, so the page can sort with CSS order alone.
  const sortValue = (r: GanttRow, k: SortKey): number | string | null =>
    k.startsWith("k")
      ? codeValueName(control, r.a.id, codeCols[Number(k.slice(1))]?.code ?? "") || null
      : k === "id"
        ? r.a.id
        : k === "name"
          ? r.a.name
          : k === "od"
            ? (r.a.duration ?? null)
            : k === "rd"
              ? r.done
                ? 0
                : (r.a.remaining_duration ?? r.a.duration ?? null)
              : k === "pc"
                ? r.done
                  ? 100
                  : (r.a.pct_complete ?? null)
                : k === "st"
                  ? r.start
                  : k === "fi"
                    ? r.finish
                    : k === "tf"
                      ? r.tf
                      : k === "bs"
                        ? r.bs
                        : k === "sv"
                          ? r.sv
                          : k === "ss"
                            ? r.ss
                              ? SS_RANK[r.ss.kind] * 100000 - (r.ss.late_wd ?? 0)
                              : null
                            : r.ff;
  const sortKeys: string[] = [...SORT_KEYS, ...codeCols.map((c) => c.k)];
  const order = Object.fromEntries(
    sortKeys.map((k) => {
      const ranked = [...rows].sort((x, y) => {
        const a = sortValue(x, k),
          b = sortValue(y, k);
        if (a === null || b === null) return a === b ? x.idx - y.idx : a === null ? 1 : -1;
        const c =
          typeof a === "number" && typeof b === "number"
            ? a - b
            : String(a).localeCompare(String(b), undefined, { numeric: true });
        return c || x.idx - y.idx;
      });
      return [k, new Map(ranked.map((r, i) => [r.a.id, i + 1]))];
    }),
  ) as Record<SortKey, Map<string, number>>;
  const succ = new Map<string, GanttRow[]>();
  for (const r of rows)
    for (const p of r.a.predecessors ?? [])
      (succ.get(p.id) ?? succ.set(p.id, []).get(p.id)!).push(r);
  const dd = day(dataDate);
  const cc = day(contractCompletion);
  const times = [
    ...rows.flatMap((r) => [r.start, r.finish]),
    ...(baseline?.activities ?? []).flatMap((b) => [day(b.start), day(b.finish)]),
    ...(prior?.activities ?? []).flatMap((b) => [day(b.start), day(b.finish)]),
    dd,
    cc,
    day(control.analysis?.prior_completion),
    day(control.analysis?.updated_completion),
  ].filter((t): t is number => t !== null);
  const lo = times.length ? Math.min(...times) : null;
  const hi = times.length ? Math.max(...times) : null;
  const t0 =
    lo === null ? null : Date.UTC(new Date(lo).getUTCFullYear(), new Date(lo).getUTCMonth(), 1);
  // One spare month after the last date leaves room for the completion label and the delay callout.
  const t1 =
    hi === null ? null : Date.UTC(new Date(hi).getUTCFullYear(), new Date(hi).getUTCMonth() + 2, 1);
  const days = t0 === null || t1 === null ? 0 : Math.round((t1 - t0) / DAY);
  // Readable on a phone and bounded for multi-year jobs; the page scrolls sideways either way.
  const scale = layout?.timescale
    ? TIMESCALE_PX[layout.timescale]
    : days <= 420
      ? 4
      : days <= 900
        ? 3
        : days <= 2200
          ? 2
          : 1;
  const width = Math.max(360, days * scale);
  const finishOf = (list: { finish: string | null }[]) => {
    const f = list.map((a) => day(a.finish)).filter((t): t is number => t !== null);
    return f.length ? Math.max(...f) : null;
  };
  const projectCal = cals.get();
  const forecast = finishOf(acts);
  const baselineFinish = baseline ? finishOf(baseline.activities) : null;
  return {
    rows,
    byId,
    order,
    sortKeys,
    control,
    codes,
    codeCols,
    layout,
    layouts: control.layouts ?? [],
    filterLine: layout ? describeFilter(control, layout) : null,
    columns: [...GANTT_COLUMNS, ...codeCols] as Col[],
    succ,
    paths,
    nodes,
    nodeToken,
    costs,
    costToken,
    baseline,
    prior,
    dd,
    cc,
    t0,
    t1,
    days,
    scale,
    width,
    projectCal,
    forecast,
    baselineFinish,
    longest: control.calculation.longest_path ?? [],
    floatPaths: control.calculation.float_paths ?? [],
    definition: control.calculation.critical_definition ?? "longest-path",
    analysis: control.analysis,
    calculated: control.calculation.status === "calculated",
  };
}
type Model = ReturnType<typeof ganttModel>;

const pathColor = (rank: number) => PATH_COLORS[(rank - 1) % PATH_COLORS.length];
const orderKey = (r: GanttRow) => (r.start ?? Number.MAX_SAFE_INTEGER) * 1 + (r.finish ?? 0) / 1e15;

function wbsItems(m: Model, list: GanttRow[]): Item[] {
  if (!m.nodes.length) return list.map((r) => ({ kind: "act", r }));
  const rank = new Map(m.nodes.map((n, i) => [n.id, i]));
  const sorted = [...list].sort(
    (a, b) =>
      (rank.get(a.a.wbs_id ?? "") ?? 1e6) - (rank.get(b.a.wbs_id ?? "") ?? 1e6) || a.idx - b.idx,
  );
  const items: Item[] = [];
  let current: Extract<Item, { kind: "group" }> | null = null;
  for (const r of sorted) {
    const key = r.a.wbs_id && m.paths.has(r.a.wbs_id) ? r.a.wbs_id : "";
    if (!current || (current as { key?: string }).key !== key) {
      current = {
        kind: "group",
        label: key ? m.paths.get(key)! : "WBS unassigned",
        kids: [],
        tokens: r.wbsTokens,
        costs: [],
      };
      (current as { key?: string }).key = key;
      items.push(current);
    }
    current.kids.push(r);
    items.push({ kind: "act", r });
  }
  for (const it of items)
    if (it.kind === "group") {
      it.costs = [...new Set(it.kids.map((k) => k.costToken).filter((c): c is string => !!c))];
      it.codes = [...new Set(it.kids.flatMap((k) => k.codeTokens))];
    }
  return items;
}
function pathItems(m: Model): Item[] {
  const items: Item[] = [];
  for (const p of m.floatPaths) {
    const kids = p.activity_ids
      .map((id) => m.byId.get(id))
      .filter((r): r is GanttRow => !!r && r.keep);
    if (!kids.length) continue;
    items.push({
      kind: "group",
      label: `Float path ${p.rank}${p.rank === 1 ? " · longest path" : ""} · total float ${String(p.total_float).replace("-", "−")} WD`,
      color: pathColor(p.rank),
      kids,
      tokens: [...new Set(kids.flatMap((k) => k.wbsTokens))],
      costs: [...new Set(kids.map((k) => k.costToken).filter((c): c is string => !!c))],
      codes: [...new Set(kids.flatMap((k) => k.codeTokens))],
    });
    kids.forEach((r) => items.push({ kind: "act", r }));
  }
  return items;
}

export type GanttView = "all" | "cascade" | "longest" | "paths" | "tf0" | `code${number}`;
export const GANTT_VIEWS: [GanttView, string][] = [
  ["all", "By WBS"],
  ["cascade", "Cascade"],
  ["longest", "Longest path"],
  ["paths", "Float paths"],
  ["tf0", "Total float ≤ 0"],
];
/**
 * Group by an activity code (Responsible party, Subcontractor, Location or any code the member makes), each
 * group in start order, activities without a value last. Marshall (Nov 5): filters and groups stack, so a sub's
 * work can be filtered and then grouped by location or WBS.
 */
function codeItems(m: Model, ci: number): Item[] {
  const code = m.codes[ci];
  if (!code) return [];
  const keep = m.rows.filter((r) => r.keep).sort((a, b) => orderKey(a) - orderKey(b) || a.idx - b.idx);
  const items: Item[] = [];
  const add = (label: string, kids: GanttRow[], color?: string) => {
    if (!kids.length) return;
    items.push({ kind: "group", label, color, kids, tokens: [], costs: [] });
    kids.forEach((r) => items.push({ kind: "act", r }));
  };
  code.values.forEach((v, vi) =>
    add(`${code.name}: ${v.name}`, keep.filter((r) => r.codeTokens.includes(`v${ci}_${vi}`))),
  );
  add(
    `${code.name}: not assigned`,
    keep.filter((r) => !r.codeTokens.some((t) => t.startsWith(`v${ci}_`))),
    MUTED,
  );
  return withCodes(items);
}

export function viewItems(m: Model, view: GanttView): Item[] {
  if (view.startsWith("code")) return codeItems(m, Number(view.slice(4)));
  if (view === "paths") return pathItems(m);
  if (view === "longest") {
    const ids = m.floatPaths[0]?.activity_ids ?? m.longest;
    return ids
      .map((id) => m.byId.get(id))
      .filter((r): r is GanttRow => !!r && r.keep)
      .map((r) => ({ kind: "act", r }) as Item);
  }
  // The logic cascade: every activity in date order, no WBS bands, as P6 shows it ungrouped.
  if (view === "cascade")
    return m.rows
      .filter((r) => r.keep)
      .sort((a, b) => orderKey(a) - orderKey(b) || a.idx - b.idx)
      .map((r) => ({ kind: "act", r }) as Item);
  if (view === "tf0")
    return wbsItems(
      m,
      m.rows
        .filter((r) => r.keep && !r.done && r.tf !== null && r.tf <= 0)
        .sort((a, b) => orderKey(a) - orderKey(b)),
    );
  return wbsItems(
    m,
    m.rows.filter((r) => r.keep),
  );
}

/** Pixel geometry shared by bars and logic lines. */
function geometry(m: Model) {
  const X = (t: number) => (m.t0 === null ? 0 : ((t - m.t0) / DAY) * m.scale);
  const startMilestone = (r: GanttRow) =>
    r.a.activity_type === "milestone-start" ||
    (r.a.activity_type !== "milestone-finish" && !(r.a.predecessors ?? []).length);
  const mx = (r: GanttRow) => {
    const t = r.milestone
      ? startMilestone(r)
        ? (r.start ?? r.finish)
        : (r.finish ?? r.start)
      : null;
    return t === null ? null : X(t) + (startMilestone(r) ? 0 : m.scale);
  };
  const left = (r: GanttRow) => (r.milestone ? mx(r) : r.start === null ? null : X(r.start));
  const right = (r: GanttRow) =>
    r.milestone ? mx(r) : r.finish === null ? null : X(r.finish + DAY);
  return { X, mx, left, right };
}

function colorOf(r: GanttRow) {
  if (r.done) return ACT;
  if (r.critical) return CRIT;
  return r.tf !== null && r.tf < 0 ? NEG : POS;
}

function barsHtml(m: Model, r: GanttRow, g: ReturnType<typeof geometry>, label: boolean): string {
  const out: string[] = [];
  const { X } = g;
  // Comparison bars beneath the current bars: the active baseline, or the last update (chosen on the page).
  for (const [b, cls, label] of [
    [r.base, "cpm-b", "baseline"],
    [r.prior, "cpm-p", "prior-update"],
  ] as const) {
    const bs = day(b?.start),
      bf = day(b?.finish);
    if (!b || bs === null || bf === null) continue;
    const name = label === "baseline" ? "Baseline" : "Last update";
    if (b.duration === 0)
      out.push(
        `<i class="${cls} cpm-bm" data-bar="${label}" title="${name} ${esc(shortDay(bf))}" style="left:${px(X(bf) + (r.milestone && !(r.a.predecessors ?? []).length ? 0 : m.scale))}"></i>`,
      );
    else
      out.push(
        `<i class="${cls}" data-bar="${label}" title="${name} ${esc(shortDay(bs))} to ${esc(shortDay(bf))}" style="left:${px(X(bs))};width:${px(Math.max(2, X(bf + DAY) - X(bs)))}"></i>`,
      );
  }
  if (r.milestone) {
    const x = g.mx(r);
    if (x !== null)
      out.push(
        `<i class="cpm-m" data-bar="milestone" style="left:${px(x)};background:${colorOf(r)}"></i><span class="cpm-lab" style="left:${px(x + 10)}">${esc(shortDay(r.finish ?? r.start))}${r.done ? " A" : ""}</span>`,
      );
    return out.join("");
  }
  if (r.start === null || r.finish === null || r.finish < r.start)
    return `<span class="cpm-lab" style="left:4px;color:${MUTED}">${r.start !== null && r.finish !== null ? "Check dates" : "Dates needed"}</span>`;
  const s = X(r.start),
    f = X(r.finish + DAY);
  const frag = r.fragnet ? ` cpm-frag` : "";
  if (r.done)
    out.push(
      `<i class="cpm-a" data-bar="actual" style="left:${px(s)};width:${px(Math.max(2, f - s))}"></i>`,
    );
  else {
    let rs = s;
    if (r.started && m.dd !== null && m.dd > r.start) {
      const ae = Math.min(X(m.dd), f);
      out.push(
        `<i class="cpm-a" data-bar="actual" style="left:${px(s)};width:${px(Math.max(1, ae - s))}"></i>`,
      );
      rs = ae;
    }
    out.push(
      `<i class="cpm-r${frag}" data-bar="remaining" style="left:${px(rs)};width:${px(Math.max(2, f - rs))};background:${r.fragnet ? "" : colorOf(r)}"></i>`,
    );
    if (r.tf !== null && r.tf > 0) {
      const end = X(addWork(r.finish, r.tf, r.cal) + DAY);
      out.push(
        `<i class="cpm-f" data-bar="float" title="Total float ${esc(r.tf)} WD" style="left:${px(f)};width:${px(Math.max(1, end - f))}"></i>`,
      );
    }
  }
  if (label || r.fragnet)
    out.push(
      `<span class="cpm-lab${r.fragnet ? " cpm-lab-frag" : ""}" style="left:${px(f + 4)}">${esc(r.a.id)}${r.fragnet ? ` · ${esc(r.a.duration ?? "")} WD fragnet` : ""}</span>`,
    );
  return out.join("");
}

function logicSvg(
  m: Model,
  items: Item[],
  g: ReturnType<typeof geometry>,
  view: GanttView,
): string {
  const y = new Map<string, number>();
  items.forEach((it, i) => it.kind === "act" && y.set(it.r.a.id, i * CPM_ROW_PX + CPM_ROW_PX / 2));
  const paths: string[] = [];
  for (const it of items) {
    if (it.kind !== "act") continue;
    const a = it.r;
    for (const link of a.a.predecessors ?? []) {
      const p = m.byId.get(link.id);
      if (!p || !y.has(p.a.id)) continue;
      const type = link.type ?? "FS";
      const from = type === "SS" || type === "SF" ? g.left(p) : g.right(p);
      const to = type === "FF" || type === "SF" ? g.right(a) : g.left(a);
      if (from === null || to === null) continue;
      const y1 = y.get(p.a.id)!,
        y2 = y.get(a.a.id)!;
      const driving = a.driving.has(p.a.id);
      const crit = driving && a.critical && p.critical;
      const cls = crit ? "cpm-k-c" : driving ? "cpm-k-d" : "cpm-k-n";
      const dir = y2 >= y1 ? 1 : -1;
      const toEnd = type === "FF" || type === "SF";
      let d: string;
      if (toEnd) d = `M${from} ${y1}H${Math.max(from, to) + 8}V${y2}H${to + 1}`;
      else if (to - 6 >= from + 4) {
        const elbow = Math.max(from + 5, Math.min(to - 6, from + 10));
        d = `M${from} ${y1}H${elbow}V${y2}H${to - 1}`;
      } else d = `M${from} ${y1}h5V${y1 + (dir * CPM_ROW_PX) / 2}H${to - 8}V${y2}H${to - 1}`;
      const faded = a.done && p.done ? ' opacity=".35"' : "";
      paths.push(
        `<path class="${cls}" data-logic-from="${esc(p.a.id)}" data-logic-to="${esc(a.a.id)}" d="${d.replace(/(\d+\.\d)\d+/g, "$1")}" marker-end="url(#cpm-ah-${view}-${cls})"${faded}/>`,
      );
    }
  }
  const marker = (cls: string, color: string) =>
    `<marker id="cpm-ah-${view}-${cls}" viewBox="0 0 6 6" refX="5.5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L6 3L0 6z" fill="${color}"/></marker>`;
  const h = items.length * CPM_ROW_PX;
  return `<svg class="cpm-logic" width="${m.width}" height="${h}" viewBox="0 0 ${m.width} ${h}" aria-hidden="true"><defs>${marker("cpm-k-c", CRIT)}${marker("cpm-k-d", INK)}${marker("cpm-k-n", FLT)}</defs>${paths.join("")}</svg>`;
}

const projectWorks = (m: Model, t: number) => m.projectCal.works(t);

/** A lookahead passes winEnd: the end of the picked window, marked on the timeline. */
type WinModel = Model & { winEnd?: number | null };

function axisSvg(m: WinModel): string {
  if (m.t0 === null || m.t1 === null)
    return `<div class="cpm-axis-empty">Timeline needs saved dates</div>`;
  const g = geometry(m);
  const out: string[] = [];
  for (let t = m.t0; t < m.t1; ) {
    const d = new Date(t),
      next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    const x = g.X(t);
    out.push(`<line x1="${x}" x2="${x}" y1="0" y2="${HEAD}" stroke="${LINE}"/>`);
    if (g.X(next) - x > 34)
      out.push(
        `<text x="${x + 5}" y="14" font-size="11" font-weight="600" fill="${INK}">${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}</text>`,
      );
    // A quarter timescale is too tight for month names: label each quarter instead.
    else if (d.getUTCMonth() % 3 === 0)
      out.push(
        `<text x="${x + 4}" y="14" font-size="11" font-weight="600" fill="${INK}">Q${d.getUTCMonth() / 3 + 1} ${String(d.getUTCFullYear()).slice(2)}</text>`,
      );
    if (m.scale >= 12)
      for (let w = t; w < next && w < m.t1; w += DAY) {
        const wx = g.X(w),
          dow = new Date(w).getUTCDay();
        out.push(
          `<line x1="${wx}" x2="${wx}" y1="${dow === 1 ? HEAD - 22 : HEAD - 12}" y2="${HEAD}" stroke="${LINE}"/><text x="${wx + m.scale / 2}" y="${HEAD - 14}" font-size="8.5" fill="${MUTED}" text-anchor="middle">${"SMTWTFS"[dow]}</text><text x="${wx + m.scale / 2}" y="${HEAD - 3}" font-size="9.5" font-weight="${dow === 1 ? 700 : 400}" fill="${projectWorks(m, w) ? INK : MUTED}" text-anchor="middle">${new Date(w).getUTCDate()}</text>`,
        );
      }
    else for (let w = t; w < next; w += DAY)
      if (new Date(w).getUTCDay() === 1 && m.scale >= 3) {
        const wx = g.X(w);
        out.push(
          `<line x1="${wx}" x2="${wx}" y1="${HEAD - 10}" y2="${HEAD}" stroke="${LINE}"/><text x="${wx + 2}" y="${HEAD - 3}" font-size="9" fill="${MUTED}">${new Date(w).getUTCDate()}</text>`,
        );
      }
    t = next;
  }
  if (m.cc !== null) {
    const x = g.X(m.cc + DAY);
    out.push(
      `<text x="${x - 3}" y="27" font-size="9.5" font-weight="700" fill="${INK}" text-anchor="end">Contract ${esc(shortDay(m.cc))}</text>`,
    );
  }
  if (m.winEnd != null) {
    const x = g.X(m.winEnd);
    out.push(
      `<rect data-window-end="true" x="${x - 128}" y="17" width="128" height="13" rx="3" fill="${BLUE}"/><text x="${x - 64}" y="27" font-size="9" font-weight="700" fill="#fff" text-anchor="middle">End of lookahead period</text>`,
    );
  }
  if (m.dd !== null) {
    // Keep the flag inside the timeline when the data date sits at its edge (a lookahead starts on it).
    const x = Math.min(Math.max(g.X(m.dd), 32), m.width - 32);
    out.push(
      `<rect x="${x - 31}" y="17" width="62" height="13" rx="3" fill="${BLUE}"/><text x="${x}" y="27" font-size="9" font-weight="700" fill="#fff" text-anchor="middle">DD ${esc(shortDay(m.dd))}</text>`,
    );
  }
  return `<svg width="${m.width}" height="${HEAD}" viewBox="0 0 ${m.width} ${HEAD}" role="img" aria-label="Timeline by month">${out.join("")}</svg>`;
}

/** Month bands, data date and contract lines behind the bars. Stretches with the visible rows. */
function backdropSvg(m: WinModel): string {
  if (m.t0 === null || m.t1 === null) return "";
  const g = geometry(m);
  const out: string[] = [];
  let i = 0;
  for (let t = m.t0; t < m.t1; i++) {
    const d = new Date(t),
      next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    if (i % 2)
      out.push(
        `<rect x="${g.X(t)}" y="0" width="${g.X(next) - g.X(t)}" height="1" fill="#FAFBFD"/>`,
      );
    out.push(
      `<line x1="${g.X(t)}" x2="${g.X(t)}" y1="0" y2="1" stroke="${LINE}" vector-effect="non-scaling-stroke"/>`,
    );
    t = next;
  }
  // Day scale (lookahead): shade non-working days, a line at each week start.
  if (m.scale >= 12)
    for (let d = m.t0; d < m.t1; d += DAY) {
      if (!projectWorks(m, d))
        out.push(`<rect x="${g.X(d)}" y="0" width="${m.scale}" height="1" fill="#F1F4F8"/>`);
      if (new Date(d).getUTCDay() === 1)
        out.push(
          `<line x1="${g.X(d)}" x2="${g.X(d)}" y1="0" y2="1" stroke="${LINE}" vector-effect="non-scaling-stroke"/>`,
        );
    }
  // The end of the lookahead window: work that runs past it stops at this line.
  if (m.winEnd != null) {
    const x = g.X(m.winEnd);
    out.push(
      `<line data-window-end-line="true" x1="${x}" x2="${x}" y1="0" y2="1" stroke="${BLUE}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>`,
    );
  }
  if (m.cc !== null) {
    const x = g.X(m.cc + DAY);
    out.push(
      `<line data-contract-line="true" x1="${x}" x2="${x}" y1="0" y2="1" stroke="${INK}" stroke-width="1.2" stroke-dasharray="5 3" vector-effect="non-scaling-stroke"/>`,
    );
  }
  if (m.dd !== null) {
    const x = g.X(m.dd);
    out.push(
      `<line data-date-marker="true" x1="${x}" x2="${x}" y1="0" y2="1" stroke="${BLUE}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>`,
    );
  }
  return `<svg class="cpm-bg" width="${m.width}" height="100%" viewBox="0 0 ${m.width} 1" preserveAspectRatio="none" aria-hidden="true">${out.join("")}</svg>`;
}

const cell = (cls: string, v: unknown, extra = "") =>
  `<span class="cpm-c ${cls}"${extra}>${esc(v)}</span>`;

function rowHtml(
  m: Model,
  it: Item,
  g: ReturnType<typeof geometry>,
  view: GanttView,
  delay: { row: string; html: string } | null,
): string {
  if (it.kind === "group") {
    const dated = it.kids.filter((k) => g.left(k) !== null && g.right(k) !== null);
    const s = dated.length ? Math.min(...dated.map((k) => g.left(k)!)) : null;
    const f = dated.length ? Math.max(...dated.map((k) => g.right(k)!)) : null;
    const bar =
      s !== null && f !== null
        ? `<i class="cpm-s" data-bar="summary" style="left:${px(s)};width:${px(Math.max(8, f - s))};background:${it.color ?? INK2}"></i>`
        : "";
    return `<div class="cpm-row cpm-grp" data-wbs="${it.tokens.join(" ")}" data-cc="${it.costs.join(" ")}" data-code="${(it.codes ?? []).join(" ")}" role="row"><div class="cpm-l"><span class="cpm-gl" style="color:${it.color ?? INK}" title="${esc(it.label)}">${esc(it.label)}</span></div><div class="cpm-t">${bar}</div></div>`;
  }
  const r = it.r;
  const tf = r.tf === null ? "" : String(r.tf);
  const rd = r.done ? 0 : (r.a.remaining_duration ?? r.a.duration ?? "");
  const name = `<a class="cpm-c c-name" href="#cpm-a-${r.idx}" title="${esc(r.a.name)}"${r.critical ? ' style="font-weight:600"' : ""}>${esc(r.a.name)}</a>`;
  const actual = (on: boolean) => (on ? ' <b class="cpm-A" title="Actual">A</b>' : "");
  const dateCell = (cls: string, t: number | null, on: boolean) =>
    `<span class="cpm-c ${cls}">${t === null ? "" : `${esc(shortDay(t))}${actual(on)}`}</span>`;
  const cells: Record<GanttColumn, string> = {
    id: cell("c-id", r.a.id),
    name,
    od: cell("c-od", r.a.duration ?? ""),
    rd: cell("c-rd", rd),
    pc: cell("c-pc", r.done ? "100%" : r.a.pct_complete == null ? "" : `${r.a.pct_complete}%`),
    bs: dateCell("c-bs", r.bs, false),
    st: dateCell("c-st", r.start, r.started),
    sv: cell(
      "c-sv",
      r.sv === null || r.milestone ? "" : r.sv > 0 ? `+${r.sv}` : String(r.sv),
      r.sv !== null && r.sv > 0 && !r.milestone ? ' style="color:#9F243A;font-weight:700"' : "",
    ),
    ss: `<span class="cpm-c c-ss">${r.ss ? `<span class="ss ss-${r.ss.kind}">${esc(r.ss.label)}</span>` : ""}</span>`,
    fi: dateCell("c-fi", r.finish, r.done),
    tf: cell("c-tf", tf, r.tf !== null && r.tf < 0 ? ' style="color:#B42318;font-weight:700"' : ""),
    ff: cell("c-ff", r.ff === null ? "" : r.ff),
  };
  // Cells follow GANTT_COLUMNS, the same order as the header and the width variables.
  const left =
    GANTT_COLUMNS.map((c) => cells[c.k]).join("") +
    m.codeCols.map((c) => cell(`c-${c.k}`, codeValueName(m.control, r.a.id, c.code))).join("");
  const status = r.done
    ? "complete"
    : r.critical
      ? "critical"
      : r.tf !== null && r.tf < 0
        ? "negative float"
        : "float";
  const extra = delay && delay.row === r.a.id ? delay.html : "";
  const order = m.sortKeys.map((k) => `--o-${k}:${m.order[k].get(r.a.id) ?? 0}`).join(";");
  return `<div class="cpm-row cpm-act" style="${order}" data-activity="${esc(r.a.id)}" data-path="${r.path ?? ""}" data-wbs="${r.wbsTokens.join(" ")}" data-cc="${r.costToken ?? ""}" data-code="${r.codeTokens.join(" ")}" role="row" aria-label="${esc(`${r.a.id} ${r.a.name}, ${status}`)}"><div class="cpm-l">${left}</div><div class="cpm-t">${barsHtml(m, r, g, view !== "all")}${extra}</div></div>`;
}

/** The delay bar on the completion activity: prior to updated completion, with the modeled impact. */
function delayMark(m: Model, g: ReturnType<typeof geometry>): { row: string; html: string } | null {
  const a = m.analysis;
  if (!a || !a.fragnet_ids.some((id) => m.byId.has(id))) return null;
  const pre = day(a.prior_completion),
    post = day(a.updated_completion);
  if (pre === null || post === null || post <= pre) return null;
  const target = [...m.rows]
    .filter((r) => r.finish === post)
    .sort((x, y) => Number(y.milestone) - Number(x.milestone) || y.idx - x.idx)[0];
  if (!target) return null;
  const x1 = g.X(pre + DAY),
    x2 = g.X(post + DAY);
  const label = `${a.event_id} delay +${a.impact_project_work_days} WD (${a.impact_calendar_days} CD)`;
  return {
    row: target.a.id,
    html: `<i class="cpm-delay" data-delay="${esc(a.event_id)}" style="left:${px(x1)};width:${px(Math.max(3, x2 - x1))}"></i><span class="cpm-dlab" style="left:${px(x2 + 14)}">${esc(label)}</span>`,
  };
}

/** Path and float views start at the month of the remaining work, so the action is on screen without scrolling. */
function windowFor(m: Model, items: Item[]): Model {
  if (m.t0 === null || m.t1 === null) return m;
  const starts = items
    .flatMap((it) =>
      it.kind === "act" ? [it.r.started && !it.r.done && m.dd !== null ? m.dd : it.r.start] : [],
    )
    .filter((t): t is number => t !== null);
  if (m.dd !== null) starts.push(m.dd);
  if (!starts.length) return m;
  const lo = Math.min(...starts);
  const t0 = Date.UTC(new Date(lo).getUTCFullYear(), new Date(lo).getUTCMonth(), 1);
  if (t0 <= m.t0) return m;
  const days = Math.round((m.t1 - t0) / DAY);
  return { ...m, t0, days, width: Math.max(360, days * m.scale) };
}

function viewHtml(full: Model, view: GanttView): string {
  const items = viewItems(full, view);
  const m = view === "all" || view.startsWith("code") ? full : windowFor(full, items);
  const g = geometry(m);
  if (!items.length)
    return `<div class="cpmv" data-view="${view}"><p class="cpm-empty">${m.layout && m.rows.some((r) => !r.keep) ? "No activity in this view matches the layout's filter." : view === "all" ? "No activities saved yet." : m.calculated ? (view === "tf0" ? "No remaining activity has total float of zero or less." : "No float paths were saved with this version.") : "Paths show once Athena calculates this schedule."}</p></div>`;
  const delay = delayMark(m, g);
  const rows = items.map((it) => rowHtml(m, it, g, view, delay)).join("");
  // Each heading sorts: first tap ascending, second descending, third back to the view's own order.
  const headCells = m.columns
    .map(
      (c) =>
        `<span class="cpm-c c-${c.k}" title="${esc(c.title)}"><label class="cpm-h0" for="cpm-s-${c.k}-a">${esc(c.label)}</label><label class="cpm-h1" for="cpm-s-${c.k}-d">${esc(c.label)} ▲</label><label class="cpm-h2" for="cpm-s-none">${esc(c.label)} ▼</label></span>`,
    )
    .join("");
  const head = `<div class="cpm-row cpm-head"><div class="cpm-l cpm-lh">${headCells}</div><div class="cpm-t">${axisSvg(m)}</div></div>`;
  return `<div class="cpmv" data-view="${view}" style="--cpm-w:${m.width}px"><div class="cpm-scroll" tabindex="0" role="region" aria-label="${esc(GANTT_VIEWS.find((v) => v[0] === view)?.[1] ?? "Grouped")} schedule, scroll sideways"><div class="cpm-grid cpm-fit" role="table" style="width:calc(var(--cpm-left) + ${m.width}px)">${head}<div class="cpm-body">${backdropSvg(m)}${logicSvg(m, items, g, view)}${rows}</div></div></div></div>`;
}

function inspectorHtml(m: Model, r: GanttRow): string {
  const chip = (text: string, color: string) =>
    `<span class="cpm-chip" style="color:${color};border-color:${color}">${esc(text)}</span>`;
  const status = r.done
    ? chip("Complete", MUTED)
    : r.path === 1
      ? chip("Longest path", CRIT)
      : r.path
        ? chip(`Float path ${r.path}`, pathColor(r.path))
        : r.critical
          ? chip("Critical", CRIT)
          : r.tf !== null && r.tf < 0
            ? chip("Negative float", NEG)
            : chip(r.tf === null ? "Float not saved" : `Float ${r.tf} WD`, POS);
  const bf = day(r.base?.finish);
  const variance = bf !== null && r.finish !== null ? workDaysBetween(bf, r.finish, r.cal) : null;
  const lagText = (type?: string, lag?: number) =>
    `${type ?? "FS"}${lag ? ` ${lag > 0 ? "+" : ""}${lag}` : ""}`;
  const pred = (r.a.predecessors ?? []).map((l) => {
    const p = m.byId.get(l.id);
    const tag = r.done ? "Complete" : r.driving.has(l.id) ? "Driving" : "Not driving";
    return `<tr><td class="cpm-mono">${esc(l.id)}</td><td>${esc(p?.a.name ?? "Not in this version")}</td><td>${esc(lagText(l.type, l.lag))}</td><td>${tag === "Driving" ? `<strong style="color:${r.critical ? CRIT : INK}">Driving</strong>` : esc(tag)}</td></tr>`;
  });
  const succ = (m.succ.get(r.a.id) ?? []).map((s) => {
    const l = (s.a.predecessors ?? []).find((x) => x.id === r.a.id);
    const tag = s.done ? "Complete" : s.driving.has(r.a.id) ? "Driving" : "Not driving";
    return `<tr><td class="cpm-mono">${esc(s.a.id)}</td><td>${esc(s.a.name)}</td><td>${esc(lagText(l?.type, l?.lag))}</td><td>${tag === "Driving" ? `<strong style="color:${s.critical ? CRIT : INK}">Driving</strong>` : esc(tag)}</td></tr>`;
  });
  const dl = (k: string, v: string, style = "") =>
    `<div><dt>${esc(k)}</dt><dd${style}>${v}</dd></div>`;
  const wbs = r.a.wbs_id ? (m.paths.get(r.a.wbs_id) ?? r.a.wbs_id) : "Unassigned";
  return `<section class="cpm-insp" id="cpm-a-${r.idx}" aria-label="${esc(r.a.id)} details"><div class="cpm-insp-top"><div><div class="cpm-lbl">Activity</div><h3><span class="cpm-mono">${esc(r.a.id)}</span> ${esc(r.a.name)}</h3></div>${status}</div><dl class="cpm-dl">${[
    dl(
      "Original / remaining",
      `${esc(r.a.duration ?? "Not saved")} / ${esc(r.done ? 0 : (r.a.remaining_duration ?? r.a.duration ?? "Not saved"))} WD`,
    ),
    dl("Start", `${esc(longDay(r.start))}${r.started ? " (actual)" : ""}`),
    dl("Finish", `${esc(longDay(r.finish))}${r.done ? " (actual)" : ""}`),
    dl(
      "Baseline finish",
      r.base
        ? `${esc(longDay(bf))}${variance !== null && !r.milestone ? ` <span style="color:${variance > 0 ? "#B42318" : MUTED}">${variance > 0 ? "+" : ""}${variance} WD</span>` : ""}`
        : esc(m.baseline ? "New since baseline" : "No baseline"),
    ),
    ...(m.prior
      ? [
          dl(
            "Last update finish",
            r.prior
              ? `${esc(longDay(day(r.prior.finish)))}${(() => {
                  const pf = day(r.prior.finish);
                  const v =
                    pf !== null && r.finish !== null ? workDaysBetween(pf, r.finish, r.cal) : null;
                  return v === null
                    ? ""
                    : ` <span style="color:${v > 0 ? "#B42318" : MUTED}">${v > 0 ? "+" : ""}${v} WD</span>`;
                })()}`
              : "New this update",
          ),
        ]
      : []),
    dl(
      "Total float",
      r.tf === null ? "Complete" : `${esc(r.tf)} WD`,
      r.tf !== null && r.tf < 0 ? ' style="color:#B42318;font-weight:700"' : "",
    ),
    dl("Free float", r.ff === null ? (r.done ? "Complete" : "Not calculated") : `${esc(r.ff)} WD`),
    dl("Percent complete", `${esc(r.a.pct_complete ?? 0)}%`),
    dl("Calendar", esc(r.cal.name)),
    dl("WBS", esc(wbs)),
    dl("Cost code", esc(r.a.cost_code ?? "None")),
  ].join(
    "",
  )}</dl><div class="cpm-two"><div class="cpm-tbl"><div class="cpm-lbl">Predecessors</div><table><tbody>${pred.join("") || `<tr><td colspan="4">None. Open start.</td></tr>`}</tbody></table></div><div class="cpm-tbl"><div class="cpm-lbl">Successors</div><table><tbody>${succ.join("") || `<tr><td colspan="4">None. Open end.</td></tr>`}</tbody></table></div></div><p class="cpm-back"><a href="#cpm-gantt">Back to the schedule</a></p></section>`;
}

/** Table columns. ID and Activity always show; the rest are picked on the page. Widths in px. */
export const GANTT_COLUMNS = [
  { k: "id", label: "ID", title: "Activity ID", w: 64, fixed: true },
  { k: "name", label: "Activity", title: "Activity description", w: 230, fixed: true },
  { k: "od", label: "OD", title: "Original duration, working days", w: 40, on: true },
  { k: "rd", label: "RD", title: "Remaining duration, working days", w: 40 },
  { k: "pc", label: "%", title: "Percent complete", w: 46 },
  { k: "bs", label: "BL start", title: "Baseline start, the schedule submitted to the owner", w: 76 },
  { k: "st", label: "Start", title: "Start (A = actual)", w: 86, on: true },
  { k: "sv", label: "Start var", title: "Start variance against the baseline, working days (+ is later)", w: 74 },
  { k: "ss", label: "Start status", title: "Start against the baseline at the data date", w: 128 },
  { k: "fi", label: "Finish", title: "Finish (A = actual)", w: 86, on: true },
  { k: "tf", label: "TF", title: "Total float, working days", w: 42, on: true },
  { k: "ff", label: "FF", title: "Free float, working days", w: 42 },
] as const;
export type GanttColumn = (typeof GANTT_COLUMNS)[number]["k"];
type Col = {
  k: string;
  label: string;
  title: string;
  w: number;
  fixed?: boolean;
  on?: boolean;
  /** Activity code ID, for a code column. */
  code?: string;
};
/** Whether a pickable column starts on: the open layout's columns, otherwise the defaults. */
function columnOn(m: Model, c: Col): boolean {
  if (!m.layout) return !!c.on;
  return m.layout.columns.includes((c.code ? `code:${c.code}` : c.k) as never);
}
const LEFT_PHONE = 176;

function css(m: Model): string {
  const rule = (input: string, sel: string) => `.cpmx:has(${input}) ${sel}`;
  const views = [...GANTT_VIEWS.filter(([v]) => v !== "all"), ...m.codes.map((_, ci) => [`code${ci}`, ""] as const)]
    .map(
      ([v]) =>
        `${rule(`#cpm-v-${v}:checked`, `.cpmv[data-view="${v}"]`)}{display:block}${rule(`#cpm-v-${v}:checked`, `.cpmv[data-view="all"]`)}{display:none}`,
    )
    .join("");
  const grouped = m.codes
    .map(
      (_, ci) =>
        `${rule(`#cpm-v-code${ci}:checked`, `.cpm-grpm label[for="cpm-v-code${ci}"]`)}{background:${LINE2};box-shadow:inset 3px 0 0 ${INK}}${rule(`#cpm-v-code${ci}:checked`, `.cpm-grpm>summary`)}{border-color:${INK};box-shadow:inset 0 0 0 1px ${INK}}`,
    )
    .join("");
  const wbs = m.nodes
    .map(
      (_, i) =>
        `${rule(`#cpm-wbs option[value="w${i}"]:checked`, `.cpm-body .cpm-row:not([data-wbs~="w${i}"])`)}{display:none}`,
    )
    .join("");
  const cc = m.costs
    .map(
      (_, i) =>
        `${rule(`#cpm-cc option[value="c${i}"]:checked`, `.cpm-body .cpm-row:not([data-cc~="c${i}"])`)}{display:none}`,
    )
    .join("");
  const filters = ["#cpm-wbs", "#cpm-cc", ...m.codes.map((_, ci) => `#cpm-code${ci}`)];
  const filtered = `${filters.map((f) => rule(`${f} option:not([value=""]):checked`, `.cpm-logic`)).join(",")}{display:none}${filters.map((f) => rule(`${f} option:not([value=""]):checked`, `.cpm-fnote`)).join(",")}{display:block}`;
  const shown = m.columns.filter((c) => c.fixed || columnOn(m, c));
  const fit = Math.min(1, 1540 / (shown.reduce((t, c) => t + c.w, 0) + m.width));
  const widths = m.columns.map((c) => `--w-${c.k}:${c.fixed ? c.w : 0}px`).join(";");
  const left = `calc(${m.columns.map((c) => `var(--w-${c.k})`).join(" + ")})`;
  const codesCss = m.codes
    .flatMap((c, ci) =>
      c.values.map(
        (_, vi) =>
          `${rule(`#cpm-code${ci} option[value="v${ci}_${vi}"]:checked`, `.cpm-body .cpm-row:not([data-code~="v${ci}_${vi}"])`)}{display:none}`,
      ),
    )
    .join("");
  const pick = m.columns
    .filter((c) => !c.fixed)
    .map(
      (c) =>
        `.cpmx:has(#cpm-col-${c.k}:checked){--w-${c.k}:${c.w}px}.cpmx:not(:has(#cpm-col-${c.k}:checked)) .c-${c.k}{display:none}`,
    )
    .join("");
  const sorted = `.cpmx:has(.cpm-sort:not(#cpm-s-none):checked)`;
  // The Sort menu marks the sort that is on.
  const sortOn = ["none", ...m.sortKeys.flatMap((k) => [`${k}-a`, `${k}-d`])]
    .map((k) => `.cpmx:has(#cpm-s-${k}:checked) .cpm-sortm label[for="cpm-s-${k}"]`)
    .join(",")
    .concat(`{background:${LINE2};box-shadow:inset 3px 0 0 ${INK}}`);
  const sorts = m.sortKeys
    .map(
      (k) =>
        `.cpmx:has(#cpm-s-${k}-a:checked) .cpm-act{order:var(--o-${k})}.cpmx:has(#cpm-s-${k}-d:checked) .cpm-act{order:calc(${m.rows.length + 1} - var(--o-${k}))}.cpmx:has(#cpm-s-${k}-a:checked) .c-${k} .cpm-h0,.cpmx:has(#cpm-s-${k}-d:checked) .c-${k} .cpm-h0{display:none}.cpmx:has(#cpm-s-${k}-a:checked) .c-${k} .cpm-h1,.cpmx:has(#cpm-s-${k}-d:checked) .c-${k} .cpm-h2{display:inline}`,
    )
    .join("");
  return `<style>
.cpmx{${widths};--cpm-left:${left};color:${INK};font-size:12px}
${pick}
.cpmx .cpm-h1,.cpmx .cpm-h2{display:none}
.cpmx .cpm-lh label{cursor:pointer}
.cpmx .cpm-lh label:hover{color:${BLUE}}
${sorts}
${sorted} .cpm-grp,${sorted} .cpm-logic{display:none}
${sorted} .cpm-snote{display:block}
.cpmx .cpm-body{display:flex;flex-direction:column}
${athenaControlsCss(".cpmx")}
.cpmx .cpm-frame{border:1px solid ${LINE};border-radius:12px;background:#fff;box-shadow:0 1px 3px rgba(30,58,95,.06)}
.cpmx .cpm-bar{display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid ${LINE2};border-radius:12px 12px 0 0;background:#FAFBFD}
.cpmx .cpm-bar-end{display:flex;align-items:center;gap:6px;margin-left:auto}
.cpmx .cpm-filters{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid ${LINE}}
.cpmx .cpm-sep{width:1px;height:20px;background:${LINE};margin:0 4px}
.cpmx .cpm-frame .cpm-scroll{border:0;border-radius:0 0 12px 12px}
.cpmx .cpm-frame .cpm-empty{border:0;border-radius:0}
.cpmx .cpm-fs-on,.cpmx .cpm-fs-off{display:inline-flex}
.cpmx .cpm-fs-off{display:none}
.cpmx:has(#cpm-fs:checked){position:fixed;inset:0;z-index:2147483000;background:#F5F7FA;padding:12px;overflow:auto}
.cpmx:has(#cpm-fs:checked) .cpm-fs-on{display:none}
.cpmx:has(#cpm-fs:checked) .cpm-fs-off{display:inline-flex}
.cpmx:has(#cpm-fs:checked) .cpm-scroll{max-height:calc(100vh - 128px);overflow:auto}
.cpmx:has(#cpm-fs:checked) .cpm-head{position:sticky;top:0;z-index:6;background:#fff}
html:has(#cpm-fs:checked){overflow:hidden}
.cpmx .cpm-A{font-weight:800;color:${ACT};font-size:10.5px}
.cpmx .cpm-snote{display:none;margin:8px 0 0;color:${MUTED}}
.cpmx .cpm-sr{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
${sortOn}
.cpmx .cpmv[data-view]:not([data-view="all"]){display:none}
${views}
.cpmx .cpm-scroll{overflow-x:auto;overscroll-behavior-x:contain;border:1px solid ${LINE};border-radius:10px;background:#fff;-webkit-overflow-scrolling:touch}
.cpmx .cpm-scroll{scrollbar-width:thin;scrollbar-color:#B8C6D8 #F1F4F8}
.cpmx .cpm-scroll::-webkit-scrollbar{height:10px;width:10px}
.cpmx .cpm-scroll::-webkit-scrollbar-track{background:#F1F4F8}
.cpmx .cpm-scroll::-webkit-scrollbar-thumb{background:#B8C6D8;border-radius:6px;border:2px solid #F1F4F8}
.cpmx .cpm-scroll::-webkit-scrollbar-thumb:hover{background:#8FA3BE}
.cpmx .cpm-scroll:focus-visible{outline:2px solid ${BLUE};outline-offset:3px}
.cpmx .cpm-grid{position:relative}
.cpmx .cpm-row{display:flex;height:${CPM_ROW_PX}px;border-bottom:1px solid ${LINE2}}
.cpmx .cpm-head{height:${HEAD}px;border-bottom:1px solid ${LINE}}
.cpmx .cpm-l{position:sticky;left:0;z-index:4;flex:0 0 var(--cpm-left);width:var(--cpm-left);display:flex;align-items:center;background:#fff;box-shadow:1px 0 0 ${LINE};overflow:hidden}
${m.columns.map((c) => `.cpmx .cpm-l .c-${c.k}{flex:0 0 var(--w-${c.k});width:var(--w-${c.k})}`).join("")}
.cpmx .cpm-lh{color:${MUTED};font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;align-items:end;padding-bottom:7px}
.cpmx .cpm-c{box-sizing:border-box;padding:0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.cpmx .c-id{color:${INK2};font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:11px;padding-left:8px}
.cpmx a.c-name{color:${INK};text-decoration:none}
.cpmx a.c-name:hover,.cpmx a.c-name:focus-visible{color:${BLUE};text-decoration:underline}
.cpmx .c-od,.cpmx .c-rd,.cpmx .c-pc,.cpmx .c-tf,.cpmx .c-ff{text-align:right}
.cpmx .cpm-grp{background:${LINE2}}
.cpmx .cpm-grp .cpm-l{background:${LINE2};display:flex}
.cpmx .cpm-gl{padding:0 8px;font-weight:700;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cpmx .cpm-t{position:relative;flex:0 0 auto;width:var(--cpm-w);height:100%;overflow:hidden}
.cpmx .cpm-body{position:relative}
.cpmx .cpm-bg,.cpmx .cpm-logic{position:absolute;left:var(--cpm-left);top:0;pointer-events:none}
.cpmx .cpm-bg{z-index:0;height:100%}
.cpmx .cpm-logic{z-index:1;overflow:hidden;fill:none}
.cpmx .cpm-logic path{stroke-width:1.2}
.cpmx .cpm-k-c{stroke:${CRIT};stroke-width:1.4!important}
.cpmx .cpm-k-d{stroke:${INK}}
.cpmx .cpm-k-n{stroke:${FLT};stroke-dasharray:3 2;stroke-width:1!important}
.cpmx .cpm-act .cpm-t,.cpmx .cpm-grp .cpm-t{z-index:2}
.cpmx .cpm-t i{position:absolute;display:block}
.cpmx .cpm-r,.cpmx .cpm-a{top:7px;height:12px;border-radius:2px}
.cpmx .cpm-a{background:${ACT}}
.cpmx .cpm-frag{background:repeating-linear-gradient(45deg,${CRIT} 0 3px,#F6C2BF 3px 6px)!important;outline:1px solid ${CRIT}}
.cpmx .cpm-b{top:21px;height:4px;border-radius:1px;background:${BL}}
.cpmx .cpm-p{top:21px;height:4px;border-radius:1px;background:#8FB0DD;display:none}
.cpmx .cpm-bm{width:7px;height:7px;top:19px;transform:translateX(-50%) rotate(45deg)}
.cpmx .cpm-f{top:13px;height:2px;background:${FLT};border-right:2px solid ${FLT};box-sizing:content-box;margin-top:-2px;padding-top:2px;background-clip:content-box}
.cpmx .cpm-m{top:7px;width:11px;height:11px;transform:translateX(-50%) rotate(45deg);border:1px solid #fff}
.cpmx .cpm-s{top:9px;height:9px;opacity:.85;clip-path:polygon(0 0,100% 0,100% 100%,calc(100% - 4px) 60%,4px 60%,0 100%)}
.cpmx .cpm-lab{position:absolute;top:7px;font-size:10px;line-height:12px;color:${INK2};white-space:nowrap;font-weight:600}
.cpmx .cpm-lab-frag{color:${CRIT};font-weight:700}
.cpmx .cpm-delay{top:2px;height:4px;background:repeating-linear-gradient(45deg,${CRIT} 0 3px,#F6C2BF 3px 6px);outline:1px solid ${CRIT}}
.cpmx .cpm-dlab{position:absolute;top:2px;background:${CRIT};color:#fff;font-size:10px;font-weight:700;border-radius:4px;padding:1px 6px;white-space:nowrap}
.cpmx .cpm-axis-empty{padding:12px;color:${MUTED}}
.cpmx .cpm-empty{margin:0;padding:16px;border:1px solid ${LINE};border-radius:10px;color:${MUTED}}
.cpmx .cpm-fnote{display:none;margin:8px 0 0;color:${MUTED}}
${wbs}${cc}${codesCss}${filtered}
.cpmx .cpm-laynote{margin:0;padding:7px 12px;border-bottom:1px solid ${LINE};background:#F7F9FC;color:${INK2}}
.cpmx .ss{display:inline-block;padding:1px 7px;border-radius:999px;font-size:10.5px;font-weight:700;line-height:16px;border:1px solid transparent}
.cpmx .ss-past-due{background:#FFF3F5;color:#9F243A;border-color:#F3C8D0}
.cpmx .ss-started-late{color:#9F243A;border-color:#F3C8D0}
.cpmx .ss-this-week{background:${INK};color:#fff}
.cpmx .ss-two-weeks{background:#EAF0F8;color:${INK}}
.cpmx .ss-upcoming{color:${INK2};border-color:${LINE}}
.cpmx .ss-started,.cpmx .ss-finished{color:${MUTED}}
.cpmx .c-sv,.cpmx .c-bs{text-align:right}
.cpmx .cpm-laynote a{color:${BLUE}}
${rule(`#cpm-lg:not(:checked)`, `.cpm-logic`)}{display:none}
${rule(`#cpm-cmp option[value="p"]:checked`, `.cpm-b`)},${rule(`#cpm-cmp option[value="none"]:checked`, `.cpm-b`)}{display:none}
${rule(`#cpm-cmp option[value="p"]:checked`, `.cpm-p`)}{display:block}
${rule(`#cpm-fl:not(:checked)`, `.cpm-f`)}{display:none}
.cpmx .cpm-legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin:10px 0 0;color:${INK2}}
.cpmx .cpm-legend span{display:inline-flex;align-items:center;gap:5px}
.cpmx .cpm-sw{display:inline-block;width:14px;height:9px;border-radius:2px}
.cpmx .cpm-insp{display:none;border:1px solid ${LINE};border-radius:10px;padding:14px;margin:12px 0 0;background:#fff;scroll-margin-top:16px}
.cpmx .cpm-insp:target{display:block}
.cpmx:has(.cpm-insp:target) .cpm-insp-hint{display:none}
.cpmx .cpm-insp-hint{margin:12px 0 0;color:${MUTED}}
.cpmx .cpm-insp-top{display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:flex-start}
.cpmx .cpm-insp h3{margin:2px 0 10px;font-size:16px;line-height:1.3}
.cpmx .cpm-lbl{font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${MUTED}}
.cpmx .cpm-chip{display:inline-block;border:1px solid;border-radius:999px;padding:2px 9px;font-weight:700;font-size:11px;white-space:nowrap}
.cpmx .cpm-dl{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px 16px;margin:0}
.cpmx .cpm-dl dt{color:${MUTED};font-size:11px}
.cpmx .cpm-dl dd{margin:2px 0 0;font-weight:600;font-variant-numeric:tabular-nums}
.cpmx .cpm-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:14px;margin:14px 0 0}
.cpmx .cpm-tbl{overflow-x:auto}
.cpmx .cpm-tbl table{border-collapse:collapse;width:100%;margin-top:4px}
.cpmx .cpm-tbl td{padding:5px 6px;border-top:1px solid ${LINE2};vertical-align:top}
.cpmx .cpm-mono{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:11px;white-space:nowrap}
.cpmx .cpm-back{margin:12px 0 0}
.cpmx .cpm-back a{color:${BLUE}}
@media(max-width:899px){.cpmx{--w-name:168px}.cpmx .cpm-bar{flex-wrap:wrap}.cpmx .cpm-bar .ath-seg{order:2;flex:1 1 100%}.cpmx .cpm-bar-end{order:1;margin-left:0;flex:1 1 100%;justify-content:flex-end}.cpmx .cpm-bar-end .cpm-lays{margin-right:auto}.cpmx .cpm-bar-end .cpm-lays .ath-menu-box{left:0;right:auto}}
@media(max-width:559px){.cpmx{--w-id:60px;--w-name:116px;--cpm-left:${LEFT_PHONE}px!important}.cpmx .cpm-l .cpm-c:not(.c-id):not(.c-name){display:none!important}.cpmx .cpm-cols{display:none}.cpmx .cpm-filters{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.cpmx .cpm-filters::-webkit-scrollbar{display:none}.cpmx .cpm-layname{max-width:150px;overflow:hidden;text-overflow:ellipsis}.cpmx .ath-seg label{padding:0 10px}.cpmx .cpm-sortm span{display:none}}
@media print{@page{size:17in 11in;margin:.35in}.cpmx{--w-name:230px}.cpmx:has(#cpm-fs:checked){position:static;padding:0;overflow:visible}.cpmx .cpm-scroll{max-height:none!important}html:has(#cpm-fs:checked){overflow:visible}.cpmx .cpm-controls,.cpmx .cpm-insp,.cpmx .cpm-insp-hint{display:none!important}.cpmx .cpm-frame{border:0;box-shadow:none}.cpmx .cpm-scroll{overflow:visible;border:0}.cpmx .cpm-fit{zoom:${fit.toFixed(3)}}.cpmx .cpm-l{position:static}.cpmx .cpm-row{break-inside:avoid}.cpmx *{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>`;
}

function legendHtml(m: Model): string {
  const sw = (bg: string, extra = "") => `<i class="cpm-sw" style="background:${bg};${extra}"></i>`;
  return `<div class="cpm-legend" aria-label="Legend"><span>${sw(ACT)}Actual</span><span>${sw(CRIT)}${m.definition === "longest-path" ? "Remaining, longest path" : "Remaining, critical (TF ≤ 0)"}</span><span>${sw(NEG)}Remaining, negative float</span><span>${sw(POS)}Remaining, positive float</span><span>${sw(`repeating-linear-gradient(45deg,${CRIT} 0 3px,#F6C2BF 3px 6px)`)}Delay fragnet</span><span>${sw(BL, "height:4px")}Baseline</span>${m.prior ? `<span>${sw("#8FB0DD", "height:4px")}Last update</span>` : ""}<span>${sw(FLT, "height:2px")}Total float</span><span><svg width="11" height="11" aria-hidden="true"><path d="M5.5 0l5.5 5.5-5.5 5.5L0 5.5z" fill="${INK}"/></svg>Milestone</span><span><svg width="22" height="8" aria-hidden="true"><path d="M0 4h15" stroke="${INK}" stroke-width="1.4"/><path d="M15 1l6 3-6 3z" fill="${INK}"/></svg>Driving tie</span><span><svg width="22" height="8" aria-hidden="true"><path d="M0 4h15" stroke="${FLT}" stroke-dasharray="3 2"/><path d="M15 1l6 3-6 3z" fill="${FLT}"/></svg>Non-driving tie</span><span>${sw(BLUE, "width:2px;height:12px")}Data date</span>${m.cc !== null ? `<span>${sw(`repeating-linear-gradient(${INK} 0 3px,transparent 3px 5px)`, "width:2px;height:12px")}Contract completion</span>` : ""}</div>`;
}

/** Working days a contract completion may sit from the baseline finish before Athena asks which is right. */
export const COMPLETION_MISMATCH_WD = 5;

/** Headline numbers for the top of the page. */
export function ganttSummary(m: Model) {
  const driver = m.longest.map((id) => m.byId.get(id)).find((r) => r && !r.done && !r.milestone);
  const versusBaseline =
    m.baselineFinish !== null && m.forecast !== null
      ? workDaysBetween(m.baselineFinish, m.forecast, m.projectCal)
      : null;
  const versusContract =
    m.cc !== null && m.forecast !== null ? workDaysBetween(m.cc, m.forecast, m.projectCal) : null;
  // A contract completion far from the baseline's own finish is a date to confirm, not float: measured
  // against it, a job running behind its plan reads as early.
  const contractVsBaseline =
    m.cc !== null && m.baselineFinish !== null
      ? workDaysBetween(m.baselineFinish, m.cc, m.projectCal)
      : null;
  const completionMismatch =
    contractVsBaseline !== null && Math.abs(contractVsBaseline) > COMPLETION_MISMATCH_WD
      ? contractVsBaseline
      : null;
  return {
    forecast: m.forecast,
    baselineFinish: m.baselineFinish,
    contractCompletion: m.cc,
    versusBaseline,
    versusContract,
    /** Working days from the baseline finish to the contract completion, when they disagree by more than a few days. */
    completionMismatch,
    calendarDaysVsBaseline:
      m.baselineFinish !== null && m.forecast !== null
        ? Math.round((m.forecast - m.baselineFinish) / DAY)
        : null,
    driver: driver ? `${driver.a.id} ${driver.a.name}` : null,
    driverId: driver ? driver.a.id : null,
    /** "12-010 Cabinet fabrication → 12-020 → MS-900, total float −33 WD" */
    longestLine: (() => {
      const ids = (m.floatPaths[0]?.activity_ids ?? m.longest).filter((id) => m.byId.has(id));
      if (!ids.length) return null;
      const first = m.byId.get(ids[0])!.a;
      const tf = m.floatPaths[0]?.total_float ?? m.byId.get(ids[ids.length - 1])!.tf;
      return `${first.id} ${first.name}${ids.length > 1 ? ` → ${ids.slice(1).join(" → ")}` : ""}${tf === null || tf === undefined ? "" : `, total float ${tf < 0 ? "−" : ""}${Math.abs(tf)} WD`}`;
    })(),
    pathCount: m.floatPaths.length,
  };
}

export function ganttHtml(input: GanttInput): string {
  const m = ganttModel(input);
  const opt = (v: string, label: string) => `<option value="${esc(v)}">${esc(label)}</option>`;
  const caret = ICONS.caret;
  // Filters show only when the schedule has something to filter by: an empty select is clutter.
  const chip = (id: string, label: string, options: string, pick = false) =>
    `<label class="ath-chip${pick ? " ath-pick" : ""}" for="${id}"><span>${esc(label)}</span><select id="${id}">${options}</select>${caret}</label>`;
  const wbsSelect = m.nodes.length
    ? chip("cpm-wbs", "WBS", `${opt("", "All")}${m.nodes.map((n, i) => opt(`w${i}`, m.paths.get(n.id)!)).join("")}`)
    : "";
  const ccSelect = m.costs.length
    ? chip("cpm-cc", "Cost code", `${opt("", "All")}${m.costs.map((c, i) => opt(`c${i}`, c)).join("")}`)
    : "";
  // One chip per activity code, so Responsible party (every sub on a GC's job) filters the whole schedule.
  const codeSelects = m.codes
    .map((c, ci) =>
      chip(`cpm-code${ci}`, c.name, `${opt("", "All")}${c.values.map((v, vi) => opt(`v${ci}_${vi}`, v.name)).join("")}`),
    )
    .join("");
  const startView: GanttView = m.layout?.group === "cascade" ? "cascade" : "all";
  const pills = GANTT_VIEWS.map(
    ([v, l]) =>
      `<input class="ath-sr cpm-sr" type="radio" name="cpm-view" id="cpm-v-${v}"${v === startView ? " checked" : ""}><label for="cpm-v-${v}">${esc(l)}</label>`,
  ).join("");
  // Layouts open by link on the signed-in page; a share page has no layout links.
  const href = input.layoutHref ?? null;
  const layoutLinks = [
    `<a href="${esc(href?.(null) ?? "")}"${m.layout ? "" : ' aria-current="true"'}><span>Default view <small>all activities, by WBS</small></span></a>`,
    ...m.layouts.map(
      (l) =>
        `<a href="${esc(href?.(l.id) ?? "")}" data-layout="${esc(l.id)}"${m.layout?.id === l.id ? ' aria-current="true"' : ""}><span>${esc(l.name)} <small>${esc(describeFilter(m.control, l))}</small></span></a>`,
    ),
  ].join("");
  const layouts =
    m.layouts.length && href
      ? `<details class="ath-menu cpm-lays"><summary class="ath-menu-btn" aria-label="Saved layouts">${ICONS.layout}<span class="cpm-layname">Layout: ${esc(m.layout?.name ?? "Default")}</span>${caret}</summary><div class="ath-menu-box"><div class="ath-menu-title">Saved layouts</div>${layoutLinks}</div></details>`
      : "";
  const sortStart = m.layout?.sort
    ? `${m.layout.sort.key.startsWith("code:") ? (m.codeCols.find((c) => `code:${c.code}` === m.layout!.sort!.key)?.k ?? "") : m.layout.sort.key}-${m.layout.sort.dir === "desc" ? "d" : "a"}`
    : "";
  const compare = [
    ...(m.baseline ? [opt("b", `Baseline · ${m.baseline.name}`)] : []),
    ...(m.prior ? [opt("p", `Last update · ${shortDay(day(m.prior.data_date))}`)] : []),
    opt("none", "None"),
  ];
  const cmpSelect = chip("cpm-cmp", "Compare", compare.join(""), true);
  const toggles = [
    ["cpm-lg", "Logic"],
    ["cpm-fl", "Float"],
  ]
    .map(
      ([id, l]) =>
        `<label class="ath-chip ath-tog" for="${id}"><input class="ath-sr" type="checkbox" id="${id}" checked>${ICONS.check}${l}</label>`,
    )
    .join("");
  const sortInputs = [
    `<input class="cpm-sr cpm-sort" type="radio" name="cpm-sort" id="cpm-s-none"${m.sortKeys.some((k) => sortStart === `${k}-a` || sortStart === `${k}-d`) ? "" : " checked"} aria-label="View order">`,
    ...m.sortKeys.flatMap((k) =>
      (["a", "d"] as const).map(
        (d) =>
          `<input class="cpm-sr cpm-sort" type="radio" name="cpm-sort" id="cpm-s-${k}-${d}"${sortStart === `${k}-${d}` ? " checked" : ""} aria-label="Sort by ${esc(m.columns.find((c) => c.k === k)!.title)}, ${d === "a" ? "ascending" : "descending"}">`,
      ),
    ),
  ].join("");
  // The sorts a scheduler reaches for most, one tap each; every column heading still sorts too.
  const sortPicks: [string, string][] = [
    ["none", "View order"],
    ["st-a", "Start, earliest first"],
    ["tf-a", "Total float, lowest first"],
    ["fi-a", "Finish, earliest first"],
    ["ss-a", "Start status, most urgent first"],
    ...m.codeCols.map((c) => [`${c.k}-a`, `${c.label}, A to Z`] as [string, string]),
  ];
  // Group by WBS (the By WBS view) or by any activity code the schedule has. Shows only when codes exist.
  const groupMenu = m.codes.length
    ? `<details class="ath-menu cpm-grpm"><summary class="ath-menu-btn" aria-label="Group">${ICONS.layout}<span>Group</span>${caret}</summary><div class="ath-menu-box"><div class="ath-menu-title">Group activities by</div><label for="cpm-v-all">WBS</label>${m.codes.map((c, ci) => `<input class="ath-sr cpm-sr" type="radio" name="cpm-view" id="cpm-v-code${ci}"><label for="cpm-v-code${ci}">${esc(c.name)}</label>`).join("")}</div></details>`
    : "";
  const sortMenu = `<details class="ath-menu cpm-sortm"><summary class="ath-menu-btn" aria-label="Sort">${ICONS.sort}<span>Sort</span>${caret}</summary><div class="ath-menu-box"><div class="ath-menu-title">Sort activities</div>${sortPicks.map(([k, l]) => `<label for="cpm-s-${k}">${esc(l)}</label>`).join("")}</div></details>`;
  const colPicks = m.columns
    .filter((c) => !c.fixed)
    .map(
      (c) =>
        `<label for="cpm-col-${c.k}"><input type="checkbox" id="cpm-col-${c.k}"${columnOn(m, c) ? " checked" : ""}> ${esc(c.title)}</label>`,
    )
    .join("");
  const columns = `<details class="ath-menu ath-menu-end cpm-cols"><summary class="ath-ibtn" aria-label="Columns" data-tip="Columns">${ICONS.columns}</summary><div class="ath-menu-box"><div class="ath-menu-title">Columns</div>${colPicks}</div></details>`;
  const fullScreen = `<input class="ath-sr cpm-sr" type="checkbox" id="cpm-fs"><label class="ath-ibtn cpm-fsw" for="cpm-fs" aria-label="Full screen" data-tip="Full screen"><span class="cpm-fs-on">${ICONS.expand}</span><span class="cpm-fs-off">${ICONS.collapse}</span></label>`;
  const bar = `<div class="cpm-bar cpm-controls"><div class="ath-seg" role="radiogroup" aria-label="View">${pills}</div><div class="cpm-bar-end">${layouts}${groupMenu}${sortMenu}${columns}${fullScreen}</div></div>`;
  const filters = `<div class="cpm-filters cpm-controls" aria-label="Filters">${codeSelects}${wbsSelect}${ccSelect}<span class="cpm-sep" aria-hidden="true"></span>${cmpSelect}${toggles}</div>`;
  const laynote = m.layout ? `<p class="cpm-laynote" data-layout-open="${esc(m.layout.id)}"><strong>${esc(m.layout.name)}</strong> · ${esc(m.filterLine ?? "")}${href ? ` · <a href="${esc(href(null))}">Default view</a>` : ""}</p>` : "";
  const controls = `${sortInputs}${bar}${filters}${laynote}`;
  const views = [...GANTT_VIEWS.map(([v]) => v), ...m.codes.map((_, ci) => `code${ci}` as GanttView)]
    .map((v) => viewHtml(m, v))
    .join("");
  const inspectors = m.rows.map((r) => inspectorHtml(m, r)).join("");
  return `${css(m)}<div class="cpmx" id="cpm-gantt"><div class="cpm-frame">${controls}${views}</div><p class="cpm-fnote">Logic lines hide while a WBS, cost code or activity code filter is on, so no line points at a hidden activity.</p><p class="cpm-snote">Sorted by a column: WBS bands and logic lines hide until you tap the heading again to return to the view's order.</p>${legendHtml(m)}<p class="cpm-insp-hint">Tap an activity name for its dates, float, logic and what drives it. Tap a column heading to sort. A next to a date means it's the actual. To save a PDF, print this page (Ctrl+P or ⌘P) and choose Save as PDF; tabloid landscape fits the full schedule.</p>${inspectors}</div>`;
}

/** One activity compared against an earlier plan: the baseline or the last update. */
export type ActivityChange = {
  id: string;
  name: string;
  kind: "added" | "deleted" | "changed";
  start_variance: number | null;
  finish_variance: number | null;
  float_before: number | null;
  float_now: number | null;
  notes: string[];
};
export function compareActivities(m: Model, against: Activity[]): ActivityChange[] {
  const then = new Map(against.map((a) => [a.id, a]));
  const out: ActivityChange[] = [];
  const linkKey = (l: { id: string; type?: string; lag?: number }) =>
    `${l.id} ${l.type ?? "FS"}${l.lag ? ` ${l.lag > 0 ? "+" : ""}${l.lag}` : ""}`;
  for (const r of m.rows) {
    const b = then.get(r.a.id);
    if (!b) {
      out.push({
        id: r.a.id,
        name: r.a.name,
        kind: "added",
        start_variance: null,
        finish_variance: null,
        float_before: null,
        float_now: r.tf,
        notes: ["Added"],
      });
      continue;
    }
    const bs = day(b.start),
      bf = day(b.finish);
    const sv = bs !== null && r.start !== null ? workDaysBetween(bs, r.start, r.cal) : null;
    const fv = bf !== null && r.finish !== null ? workDaysBetween(bf, r.finish, r.cal) : null;
    const notes: string[] = [];
    if (!b.actual_start && r.a.actual_start) notes.push("Started");
    if (!b.actual_finish && r.a.actual_finish) notes.push("Finished");
    if (b.duration !== r.a.duration)
      notes.push(`Duration ${b.duration ?? "?"} → ${r.a.duration ?? "?"} WD`);
    const was = new Set((b.predecessors ?? []).map(linkKey)),
      now = new Set((r.a.predecessors ?? []).map(linkKey));
    const added = [...now].filter((k) => !was.has(k)),
      removed = [...was].filter((k) => !now.has(k));
    if (added.length) notes.push(`Logic added: ${added.join(", ")}`);
    if (removed.length) notes.push(`Logic removed: ${removed.join(", ")}`);
    const floatBefore = b.actual_finish ? null : b.total_float;
    if (sv || fv || notes.length || (floatBefore ?? null) !== (r.tf ?? null))
      out.push({
        id: r.a.id,
        name: r.a.name,
        kind: "changed",
        start_variance: sv,
        finish_variance: fv,
        float_before: floatBefore,
        float_now: r.tf,
        notes,
      });
  }
  for (const b of against)
    if (!m.byId.has(b.id))
      out.push({
        id: b.id,
        name: b.name,
        kind: "deleted",
        start_variance: null,
        finish_variance: null,
        float_before: b.total_float,
        float_now: null,
        notes: ["Deleted"],
      });
  return out.sort(
    (x, y) => (y.finish_variance ?? -1e9) - (x.finish_variance ?? -1e9) || x.id.localeCompare(y.id),
  );
}

/** With a layout open, the activities it shows and the line that says so; null shows everything. */
function layoutScope(m: Model): { ids: Set<string>; note: string } | null {
  if (!m.layout || m.rows.every((r) => r.keep)) return null;
  const ids = new Set(m.rows.filter((r) => r.keep).map((r) => r.a.id));
  return {
    ids,
    note: `Layout ${m.layout.name}: ${m.filterLine ?? ""}. Only its activities show here.`,
  };
}
const scopeNote = (scope: ReturnType<typeof layoutScope>) =>
  scope ? `<p class="cpmc-sum" data-layout-scope="true">${esc(scope.note)}</p>` : "";

const signed = (n: number | null) => (n === null ? "" : n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

function compareTable(
  m: Model,
  against: Activity[],
  label: string,
  dataDate: string | null,
  key: string,
): string {
  const scope = layoutScope(m);
  const changes = compareActivities(m, against).filter((c) => !scope || scope.ids.has(c.id));
  const finishOf = (list: { finish: string | null }[]) => {
    const f = list.map((a) => day(a.finish)).filter((t): t is number => t !== null);
    return f.length ? Math.max(...f) : null;
  };
  const was = finishOf(against);
  const moved =
    was !== null && m.forecast !== null ? workDaysBetween(was, m.forecast, m.projectCal) : null;
  const count = (k: ActivityChange["kind"]) => changes.filter((c) => c.kind === k).length;
  const later = changes.filter((c) => (c.finish_variance ?? 0) > 0).length;
  const facts = [
    moved === null
      ? null
      : `Completion ${moved > 0 ? `${moved} WD later` : moved < 0 ? `${-moved} WD earlier` : "unchanged"} (${shortDay(was)} → ${shortDay(m.forecast)})`,
    `${later} finishing later`,
    count("added") ? `${count("added")} added` : null,
    count("deleted") ? `${count("deleted")} deleted` : null,
    changes.filter((c) => c.notes.some((n) => n.startsWith("Logic"))).length
      ? `${changes.filter((c) => c.notes.some((n) => n.startsWith("Logic"))).length} with logic changes`
      : null,
  ].filter(Boolean);
  const rows = changes
    .map(
      (c) =>
        `<tr data-change="${esc(c.id)}"><td class="cpm-mono">${esc(c.id)}</td><td>${esc(c.name)}</td><td class="cpm-n"${(c.finish_variance ?? 0) > 0 ? ' style="color:#B42318;font-weight:700"' : ""}>${esc(signed(c.finish_variance))}</td><td class="cpm-n">${esc(signed(c.start_variance))}</td><td class="cpm-n">${esc(c.float_before !== null && c.float_now !== null ? `${c.float_before} → ${c.float_now}` : (c.float_now ?? c.float_before ?? ""))}</td><td>${esc(c.notes.join(" · "))}</td></tr>`,
    )
    .join("");
  return `<div class="cpmc-set" data-against="${key}"><p class="cpmc-sum"><strong>Against ${esc(label)}${dataDate ? ` (data date ${esc(shortDay(day(dataDate)))})` : ""}:</strong> ${esc(facts.join(" · "))}</p>${
    changes.length
      ? `<div class="cpm-tbl"><table><thead><tr><th>ID</th><th>Activity</th><th class="cpm-n" title="Working days">Finish</th><th class="cpm-n" title="Working days">Start</th><th class="cpm-n">Total float</th><th>What changed</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<p class="cpmc-none">No activity changed.</p>`
  }</div>`;
}

/** Baseline vs this update and last update vs this update, switchable without scripts. */
export function comparisonHtml(input: GanttInput): string {
  const m = ganttModel(input);
  const sets: [string, string, string, Activity[], string | null][] = [];
  if (m.baseline)
    sets.push([
      "b",
      /baseline/i.test(m.baseline.name) ? m.baseline.name : `baseline ${m.baseline.name}`,
      `Baseline: ${m.baseline.name}`,
      m.baseline.activities,
      m.baseline.data_date,
    ]);
  if (m.prior)
    sets.push([
      "p",
      "the last update",
      `Last update: ${shortDay(day(m.prior.data_date))}`,
      m.prior.activities,
      m.prior.data_date,
    ]);
  if (!sets.length) return "";
  const pills = sets
    .map(
      ([k, , pill], i) =>
        `<input class="ath-sr cpm-sr" type="radio" name="cpmc" id="cpmc-${k}"${i === 0 ? " checked" : ""}><label for="cpmc-${k}">${esc(pill)}</label>`,
    )
    .join("");
  const rules = sets
    .slice(1)
    .map(
      ([k]) =>
        `.cpmc:has(#cpmc-${k}:checked) .cpmc-set[data-against="${k}"]{display:block}.cpmc:has(#cpmc-${k}:checked) .cpmc-set[data-against="${sets[0][0]}"]{display:none}`,
    )
    .join("");
  const style = `<style>.cpmc{color:${INK};font-size:12px}.cpmc h2{margin:0 0 10px;font-size:13px;letter-spacing:.06em}${athenaControlsCss(".cpmc")}.cpmc .cpm-pills{margin:0 0 10px}.cpmc .cpmc-set{display:none}.cpmc .cpmc-set[data-against="${sets[0][0]}"]{display:block}${rules}.cpmc .cpmc-sum{margin:0 0 8px;font-size:13px}.cpmc .cpmc-none{color:${MUTED};margin:0}.cpmc .cpm-tbl{overflow-x:auto}.cpmc table{border-collapse:collapse;width:100%;min-width:640px}.cpmc th{text-align:left;color:${MUTED};font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;padding:5px 6px;white-space:nowrap}.cpmc td{padding:5px 6px;border-top:1px solid ${LINE2};vertical-align:top}.cpmc td:first-child,.cpmc th:first-child{position:sticky;left:0;background:#fff;z-index:1}.cpmc .cpm-n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.cpmc .cpm-mono{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:11px;white-space:nowrap}@media print{.cpmc .cpm-pills{display:none}.cpmc .cpmc-set{display:block!important;break-inside:auto}}</style>`;
  return `${style}<div class="cpmc" id="cpm-compare"><h2>UPDATE COMPARISON</h2>${scopeNote(layoutScope(m))}<div class="ath-seg cpm-pills" role="radiogroup" aria-label="Compare against">${pills}</div>${sets.map(([k, label, , acts, dd]) => compareTable(m, acts, label, dd, k)).join("")}<p class="cpmc-none" style="margin-top:8px">Variances are working days on each activity's calendar. Positive means later.</p></div>`;
}

/** Milestones against the baseline and the last update, with float and any finish-by date. */
export function milestoneHtml(input: GanttInput): string {
  const m = ganttModel(input);
  const scope = layoutScope(m);
  const ms = m.rows.filter((r) => r.milestone && (!scope || r.keep));
  if (!ms.length) return "";
  const v = (from: string | null | undefined, r: GanttRow) => {
    const f = day(from);
    return f === null || r.finish === null ? null : workDaysBetween(f, r.finish, r.cal);
  };
  const rows = ms
    .map((r) => {
      const vb = v(r.base?.finish, r),
        vp = v(r.prior?.finish, r);
      const late = (n: number | null) =>
        (n ?? 0) > 0 ? ' style="color:#B42318;font-weight:700"' : "";
      const fnlt = day(r.a.finish_no_later_than);
      return `<tr data-milestone-row="${esc(r.a.id)}"><td class="cpm-mono">${esc(r.a.id)}</td><td>${esc(r.a.name)}</td><td class="cpm-n">${esc(shortDay(day(r.base?.finish)))}</td>${m.prior ? `<td class="cpm-n">${esc(shortDay(day(r.prior?.finish)))}</td>` : ""}<td class="cpm-n"><strong>${esc(shortDay(r.finish))}${r.done ? " A" : ""}</strong></td><td class="cpm-n"${late(vb)}>${esc(signed(vb))}</td>${m.prior ? `<td class="cpm-n"${late(vp)}>${esc(signed(vp))}</td>` : ""}<td class="cpm-n"${(r.tf ?? 0) < 0 ? ' style="color:#B42318;font-weight:700"' : ""}>${esc(r.tf ?? (r.done ? "Done" : ""))}</td><td class="cpm-n">${fnlt === null ? "" : `${esc(shortDay(fnlt))}`}</td></tr>`;
    })
    .join("");
  const style = `<style>.cpmc{color:${INK};font-size:12px}.cpmc h2{margin:0 0 10px;font-size:13px;letter-spacing:.06em}.cpmc .cpm-tbl{overflow-x:auto}.cpmc table{border-collapse:collapse;width:100%;min-width:640px}.cpmc th{text-align:left;color:${MUTED};font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;padding:5px 6px;white-space:nowrap}.cpmc td{padding:5px 6px;border-top:1px solid ${LINE2};vertical-align:top}.cpmc td:first-child,.cpmc th:first-child{position:sticky;left:0;background:#fff;z-index:1}.cpmc .cpm-n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.cpmc .cpm-mono{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:11px;white-space:nowrap}</style>`;
  return `${style}<div class="cpmc" id="cpm-milestones"><h2>MILESTONES</h2>${scopeNote(scope)}<div class="cpm-tbl"><table><thead><tr><th>ID</th><th>Milestone</th><th class="cpm-n">Baseline</th>${m.prior ? `<th class="cpm-n">Last update</th>` : ""}<th class="cpm-n">Forecast / actual</th><th class="cpm-n" title="Working days">vs baseline</th>${m.prior ? `<th class="cpm-n" title="Working days">vs last update</th>` : ""}<th class="cpm-n">Total float</th><th class="cpm-n">Finish by</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

const tableStyle = `<style>.cpmc{color:${INK};font-size:12px}.cpmc h2{margin:0 0 10px;font-size:13px;letter-spacing:.06em}.cpmc .cpm-tbl{overflow-x:auto}.cpmc table{border-collapse:collapse;width:100%;min-width:640px}.cpmc th{text-align:left;color:${MUTED};font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;padding:5px 6px;white-space:nowrap}.cpmc td{padding:5px 6px;border-top:1px solid ${LINE2};vertical-align:top}.cpmc td:first-child,.cpmc th:first-child{position:sticky;left:0;background:#fff;z-index:1}.cpmc .cpm-n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.cpmc .cpm-mono{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:11px;white-space:nowrap}.cpmc .cpmc-sum{margin:0 0 8px;color:${INK2}}</style>`;
const lateStyle = (n: number | null) =>
  (n ?? 0) > 0 ? ' style="color:#B42318;font-weight:700"' : "";

export type ScheduleWindow = {
  from: string;
  to: string;
  completion: string;
  /** Completion movement in the window, project working days; positive is later. */
  movement: number | null;
  /** Completion against the baseline at the end of the window, project working days. */
  versus_baseline: number | null;
  driver: string | null;
  events: string[];
};

/** Contemporaneous windows: one window between each pair of saved updates, from the saved update history only. */
export function scheduleWindows(input: GanttInput): ScheduleWindow[] {
  const m = ganttModel(input);
  const h = input.control.update_history ?? [];
  const register = input.control.delay_register ?? [];
  const out: ScheduleWindow[] = [];
  for (let i = 1; i < h.length; i++) {
    const a = h[i - 1],
      b = h[i];
    const pa = day(a.completion),
      pb = day(b.completion);
    const driverId = b.longest_path.find((id) => {
      const r = m.byId.get(id);
      return !r || !r.milestone;
    });
    out.push({
      from: a.data_date,
      to: b.data_date,
      completion: b.completion,
      movement: pa === null || pb === null ? null : workDaysBetween(pa, pb, m.projectCal),
      versus_baseline:
        m.baselineFinish === null || pb === null
          ? null
          : workDaysBetween(m.baselineFinish, pb, m.projectCal),
      driver: driverId ?? null,
      events: register
        .filter((d) => d.data_date >= a.data_date && d.data_date < b.data_date)
        .map((d) => d.event_id),
    });
  }
  return out;
}

export function windowsHtml(input: GanttInput): string {
  const w = scheduleWindows(input);
  if (!w.length) return "";
  const m = ganttModel(input);
  const total = w.reduce((s, x) => s + (x.movement ?? 0), 0);
  const worst = w.reduce(
    (p, x) => ((x.movement ?? 0) > (p?.movement ?? 0) ? x : p),
    null as ScheduleWindow | null,
  );
  const sum = `Completion moved ${signed(total)} WD over ${w.length} ${w.length === 1 ? "window" : "windows"}${worst ? `; the most, ${signed(worst.movement)} WD, between ${shortDay(day(worst.from))} and ${shortDay(day(worst.to))}` : ""}.`;
  const rows = w
    .map((x) => {
      const r = x.driver ? m.byId.get(x.driver) : undefined;
      return `<tr data-window="${esc(x.to)}"><td class="cpm-mono">${esc(shortDay(day(x.from)))} → ${esc(shortDay(day(x.to)))}</td><td class="cpm-n"><strong>${esc(shortDay(day(x.completion)))}</strong></td><td class="cpm-n"${lateStyle(x.movement)}>${esc(signed(x.movement))}</td>${m.baselineFinish !== null ? `<td class="cpm-n"${lateStyle(x.versus_baseline)}>${esc(signed(x.versus_baseline))}</td>` : ""}<td>${x.driver ? `<span class="cpm-mono">${esc(x.driver)}</span> ${esc(r?.a.name ?? "")}` : ""}</td><td>${esc(x.events.join(", "))}</td></tr>`;
    })
    .join("");
  return `${tableStyle}<div class="cpmc" id="cpm-windows"><h2>WINDOWS ANALYSIS</h2><p class="cpmc-sum">${esc(sum)}</p><div class="cpm-tbl"><table><thead><tr><th>Window (data dates)</th><th class="cpm-n">Completion</th><th class="cpm-n" title="Working days">Movement</th>${m.baselineFinish !== null ? `<th class="cpm-n" title="Working days">vs baseline</th>` : ""}<th>Driving at window end</th><th>Delay events modeled</th></tr></thead><tbody>${rows}</tbody></table></div><p class="cpmc-sum" style="margin-top:8px">Each window compares two saved updates as they were calculated. Movement shows when the completion moved; it does not assign responsibility.</p></div>`;
}

/** The delay event register: every modeled fragnet and its isolated completion movement, kept through later updates. */
export function delaysHtml(input: GanttInput): string {
  const scope = input.layout ? layoutScope(ganttModel(input)) : null;
  // The layout's own activities: the fragnet the page always shows doesn't pull every event in.
  const own = scope
    ? new Set(
        (input.data.activities ?? [])
          .filter(layoutFilter(input.control, ganttModel(input).layout))
          .map((a) => a.id),
      )
    : null;
  // With a layout or code open, only events whose fragnet or affected activities fall inside it.
  const reg = (input.control.delay_register ?? []).filter(
    (d) => !own || [...d.fragnet_ids, ...d.affected_activity_ids].some((id) => own.has(id)),
  );
  if (!reg.length)
    return scope && input.control.delay_register?.length
      ? `${tableStyle}<div class="cpmc" id="cpm-delays"><h2>DELAY EVENTS</h2>${scopeNote(scope)}<p class="cpmc-sum">No modeled delay event touches this layout's activities.</p></div>`
      : "";
  const rows = [...reg]
    .sort((a, b) => a.data_date.localeCompare(b.data_date) || a.event_id.localeCompare(b.event_id))
    .map(
      (d) =>
        `<tr data-delay-event="${esc(d.event_id)}"><td class="cpm-mono">${esc(d.event_id)}</td><td style="min-width:200px">${esc(d.description ?? "")}</td><td class="cpm-n">${esc(d.event_date ? shortDay(day(d.event_date)) : "Not established")}</td><td class="cpm-n">${esc(shortDay(day(d.data_date)))}</td><td class="cpm-mono">${esc(d.fragnet_ids.join(", "))}</td><td class="cpm-n">${esc(shortDay(day(d.prior_completion)))} → ${esc(shortDay(day(d.updated_completion)))}</td><td class="cpm-n"${lateStyle(d.impact_project_work_days)}>${esc(signed(d.impact_project_work_days))} WD · ${esc(signed(d.impact_calendar_days))} CD</td></tr>`,
    )
    .join("");
  const cd = reg.reduce((s, d) => s + Math.max(0, d.impact_calendar_days), 0);
  return `${tableStyle}<div class="cpmc" id="cpm-delays"><h2>DELAY EVENTS</h2>${scopeNote(scope)}<p class="cpmc-sum">${esc(`${reg.length} modeled ${reg.length === 1 ? "event" : "events"} · ${cd} calendar days of modeled completion movement, each measured alone against the update it was inserted into.`)}</p><div class="cpm-tbl"><table><thead><tr><th>Event</th><th>Description</th><th class="cpm-n">Event date</th><th class="cpm-n">Data date</th><th>Fragnet</th><th class="cpm-n">Completion</th><th class="cpm-n">Modeled impact</th></tr></thead><tbody>${rows}</tbody></table></div><p class="cpmc-sum" style="margin-top:8px">Modeled impacts are not additive when events overlap, and they do not decide responsibility, concurrency or entitlement.</p></div>`;
}

/** Lookahead windows a scheduler works in, in weeks from the data date. */
export const LOOKAHEAD_WEEKS = [1, 2, 3, 4, 5, 6] as const;
/** Pixels per day: about 840 px of timeline for 2 to 6 weeks, so the window fills a desktop and scrolls on a phone. */
const LOOK_SCALE: Record<number, number> = { 1: 96, 2: 60, 3: 40, 4: 30, 5: 24, 6: 20 };
/** Room after the lookahead window for its end line. */
const LOOK_END_PAD = 14;

/** How a lookahead lists its work. Marshall (Nov 5): float groups are total float values, not logic paths. */
type LookGroup = "float" | "date" | "wbs" | `code${number}`;
const withCodes = (items: Item[]) => {
  for (const it of items)
    if (it.kind === "group") {
      it.tokens = [...new Set(it.kids.flatMap((k) => k.wbsTokens))];
      it.costs = [...new Set(it.kids.map((k) => k.costToken).filter((c): c is string => !!c))];
      it.codes = [...new Set(it.kids.flatMap((k) => k.codeTokens))];
    }
  return items;
};

/** Remaining work in the window, grouped by total float (lowest first), by WBS, or in start order. */
function lookItems(m: Model, t0: number, t1: number, group: LookGroup): Item[] {
  const inWin = m.rows.filter(
    (r) => !r.done && r.finish !== null && r.finish >= t0 && (r.start ?? r.finish) < t1,
  );
  const byStart = (list: GanttRow[]) => [...list].sort((a, b) => orderKey(a) - orderKey(b));
  if (group === "date") return byStart(inWin).map((r) => ({ kind: "act", r }) as Item);
  if (group === "wbs") return wbsItems(m, byStart(inWin));
  if (group.startsWith("code")) {
    const ids = new Set(inWin.map((r) => r.a.id));
    const only = codeItems(m, Number(group.slice(4))).filter((it) =>
      it.kind === "act" ? ids.has(it.r.a.id) : (it.kids = it.kids.filter((k) => ids.has(k.a.id))).length > 0,
    );
    return withCodes(only);
  }
  const values = [...new Set(inWin.map((r) => r.tf))].sort(
    (a, b) => (a ?? Number.POSITIVE_INFINITY) - (b ?? Number.POSITIVE_INFINITY),
  );
  const items: Item[] = [];
  values.forEach((tf, i) => {
    const kids = byStart(inWin.filter((r) => r.tf === tf));
    const wd = tf === null ? "" : String(tf).replace("-", "−");
    const label =
      tf === null
        ? "Total float not calculated"
        : tf < 0
          ? `Total float ${wd} WD · behind`
          : tf === 0
            ? "Total float 0 WD · critical"
            : `Total float ${wd} WD`;
    items.push({ kind: "group", label, color: tf !== null && tf <= 0 ? CRIT : pathColor(i + 2), kids, tokens: [], costs: [] });
    kids.forEach((r) => items.push({ kind: "act", r }));
  });
  return withCodes(items);
}

/**
 * The lookahead as a Gantt: 1 to 6 weeks from the data date, picked on the page, grouped by float path or in
 * start order. Same bars, logic and baseline as the full schedule, on a day scale. CSS only.
 */
export function lookaheadGanttHtml(input: GanttInput, defaultWeeks = 3): string {
  const full = ganttModel({ ...input, layout: null });
  if (full.dd === null || !full.rows.length) return "";
  const dd = full.dd;
  const baseGroups: [string, string, LookGroup][] = [
    ["f", "By total float", "float"],
    ["d", "By start", "date"],
    ["w", "By WBS", "wbs"],
  ];
  // Any activity code groups the lookahead too (Subcontractor, Location…), from the Group menu.
  const codeGroups = (input.control.activity_codes ?? []).map(
    (c, ci) => [`c${ci}`, c.name, `code${ci}`] as [string, string, LookGroup],
  );
  const groups: [string, string, LookGroup][] = [...baseGroups, ...codeGroups];
  // The column names who does the work: a code that names the sub or trade, else the first code.
  const party =
    full.codeCols.find((c) => /sub|trade|vendor|company/i.test(`${c.code} ${c.label}`) && c.label !== "Responsible party") ??
    full.codeCols[0];
  const windows = LOOKAHEAD_WEEKS.flatMap((w) =>
    groups.map(([gk, , mode]) => {
      const t1 = dd + w * 7 * DAY;
      const scale = LOOK_SCALE[w];
      const items = lookItems(full, dd, t1, mode);
      // Marshall (Nov 5): the window ends where it ends; work running past it stops at a marked line, not a
      // bare edge. One day before the data date keeps its blue line clear of the frozen columns, and a short
      // margin after the window keeps the end line and its tag in view.
      const t0 = dd - DAY;
      const days = Math.round((t1 - t0) / DAY);
      const m: WinModel = { ...full, t0, t1, days, scale, width: days * scale + LOOK_END_PAD, winEnd: t1 };
      const g = geometry(m);
      const view = `la${w}${gk}` as GanttView;
      const body = items.length
        ? items
            .map((it) => rowHtml(m, it, g, view, null))
            .join("")
            // The activity inspector lives on the Schedule screen; here the name is plain text.
            .replace(/<a class="cpm-c c-name" href="[^"]*"([^>]*)>([^<]*)<\/a>/g, '<span class="cpm-c c-name"$1>$2</span>')
        : "";
      const headCells = m.columns
        .map((c) => `<span class="cpm-c c-${c.k}" title="${esc(c.title)}">${esc(c.label)}</span>`)
        .join("");
      const grid = items.length
        ? `<div class="cpm-scroll" tabindex="0" role="region" aria-label="${w}-week lookahead, scroll sideways"><div class="cpm-grid" role="table" style="width:calc(var(--cpm-left) + ${m.width}px)"><div class="cpm-row cpm-head"><div class="cpm-l cpm-lh">${headCells}</div><div class="cpm-t">${axisSvg(m)}</div></div><div class="cpm-body">${backdropSvg(m)}${logicSvg(m, items, g, view)}${body}</div></div></div>`
        : `<p class="cpm-empty">No remaining work falls in these ${w} weeks.</p>`;
      const count = items.filter((it) => it.kind === "act").length;
      return `<div class="cpm-law" data-w="${w}" data-g="${gk}"><div class="cpmv" data-view="all" style="--cpm-w:${m.width}px">${grid}</div><p class="cpm-lasum">${esc(`${shortDay(dd)} to ${shortDay(t1 - DAY)} · ${count} ${count === 1 ? "activity" : "activities"} with remaining work`)}</p></div>`;
    }),
  ).join("");
  const weekPills = LOOKAHEAD_WEEKS.map(
    (w) =>
      `<input class="ath-sr" type="radio" name="cpml-w" id="cpml-w${w}"${w === defaultWeeks ? " checked" : ""}><label for="cpml-w${w}">${w} wk</label>`,
  ).join("");
  const groupPills = baseGroups
    .map(
      ([k, l], i: number) =>
        `<input class="ath-sr" type="radio" name="cpml-g" id="cpml-g${k}"${i === 0 ? " checked" : ""}><label for="cpml-g${k}">${l}</label>`,
    )
    .join("");
  const show = LOOKAHEAD_WEEKS.flatMap((w) =>
    groups.map(
      ([k]) => `.cpml:has(#cpml-w${w}:checked):has(#cpml-g${k}:checked) .cpm-law[data-w="${w}"][data-g="${k}"]`,
    ),
  ).join(",");
  // Code filters (Responsible party, Subcontractor, Area…) work the same under every grouping.
  const codes = input.control.activity_codes ?? [];
  const codeChips = codes
    .map(
      (c, ci) =>
        `<label class="ath-chip" for="cpml-code${ci}"><span>${esc(c.name)}</span><select id="cpml-code${ci}"><option value="">All</option>${c.values.map((v, vi) => `<option value="v${ci}_${vi}">${esc(v.name)}</option>`).join("")}</select>${ICONS.caret}</label>`,
    )
    .join("");
  const codeCss = codes
    .flatMap((c, ci) =>
      c.values.map(
        (_, vi) =>
          `.cpml:has(#cpml-code${ci} option[value="v${ci}_${vi}"]:checked) .cpm-body .cpm-row:not([data-code~="v${ci}_${vi}"])`,
      ),
    )
    .join(",");
  const anyCode = codes.map((_, ci) => `.cpml:has(#cpml-code${ci} option:not([value=""]):checked) .cpm-logic`).join(",");
  const filterCss = codes.length ? `${codeCss}{display:none}${anyCode}{display:none}` : "";
  const cols = ["rd", "st", "fi", "tf", ...(party ? [party.k] : [])];
  const widths = cols.map((k) => `--w-${k}:${full.columns.find((c) => c.k === k)!.w}px`).join(";");
  const groupOn = codeGroups
    .map(
      ([k]) =>
        `.cpml:has(#cpml-g${k}:checked) .cpml-grpm label[for="cpml-g${k}"]{background:${LINE2};box-shadow:inset 3px 0 0 ${INK}}.cpml:has(#cpml-g${k}:checked) .cpml-grpm>summary{border-color:${INK};box-shadow:inset 0 0 0 1px ${INK}}`,
    )
    .join("");
  const style = `<style>${athenaControlsCss(".cpml")}${filterCss}${groupOn}.cpml .cpm-lachips{display:flex;flex-wrap:wrap;gap:6px}.cpml{${widths}}.cpml .cpm-law{display:none}${show}{display:block}${cols.map((k) => `.cpmx.cpml .c-${k}`).join(",")}{display:block!important}.cpml .cpm-labar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:8px 10px;border-bottom:1px solid ${LINE};background:#FAFBFD;border-radius:12px 12px 0 0}.cpml .cpm-labar h2{margin:0 6px 0 2px;font-size:13px;letter-spacing:.04em;color:${INK}}.cpml .cpm-lasum{margin:0;padding:7px 12px;color:${MUTED};border-top:1px solid ${LINE2}}@media(max-width:559px){.cpml .cpm-labar .ath-seg{flex:1 1 100%}.cpmx.cpml .cpm-l .cpm-c:not(.c-id):not(.c-name){display:none!important}}</style>`;
  return `${style}<div class="cpmx cpml" id="cpm-lookahead-gantt"><div class="cpm-frame"><div class="cpm-labar"><h2>Lookahead</h2><div class="ath-seg" role="radiogroup" aria-label="Lookahead window">${weekPills}</div><div class="ath-seg" role="radiogroup" aria-label="Group lookahead">${groupPills}</div>${codeGroups.length ? `<details class="ath-menu cpml-grpm"><summary class="ath-menu-btn" aria-label="Group by code">${ICONS.layout}<span>Group</span>${ICONS.caret}</summary><div class="ath-menu-box"><div class="ath-menu-title">Group by code</div>${codeGroups.map(([k, l]) => `<input class="ath-sr" type="radio" name="cpml-g" id="cpml-g${k}"><label for="cpml-g${k}">${esc(l)}</label>`).join("")}</div></details>` : ""}${codeChips ? `<div class="cpm-lachips">${codeChips}</div>` : ""}</div>${windows}</div><p class="cpm-insp-hint">The blue line on the left is the data date, ${esc(shortDay(dd))}; the one on the right ends the lookahead period, and bars that reach it continue past it. Shaded days are non-working on the project calendar. Thin bars under each activity are the baseline.</p></div>`;
}

/**
 * One snapshot per modeled delay event: the fragnet and the work it pushed, on its own short Gantt, with the
 * completion before and after. For the Reports screen, so each claimed delay can be shown on its own.
 */
export function delaySnapshotsHtml(input: GanttInput): string {
  const full = ganttModel({ ...input, layout: null });
  const reg = [...(input.control.delay_register ?? [])].sort(
    (a, b) => a.data_date.localeCompare(b.data_date) || a.event_id.localeCompare(b.event_id),
  );
  if (!reg.length) return "";
  const cards = reg.map((d) => {
    const ids = [...new Set([...d.fragnet_ids, ...d.affected_activity_ids])];
    const kids = ids
      .map((id) => full.byId.get(id))
      .filter((r): r is GanttRow => !!r)
      .sort((a, b) => orderKey(a) - orderKey(b));
    const prior = day(d.prior_completion),
      updated = day(d.updated_completion),
      event = day(d.event_date);
    const times = [
      ...kids.flatMap((r) => [r.start, r.finish]),
      prior,
      updated,
      event,
    ].filter((t): t is number => t !== null);
    const head = `<div class="cpm-snap-h"><div><div class="cpm-lbl">Delay event ${esc(d.event_id)}</div><h3>${esc(d.description || "No description saved")}</h3></div><div class="cpm-snap-k"><strong${d.impact_project_work_days > 0 ? ' style="color:#9F243A"' : ""}>${esc(signedNum(d.impact_project_work_days))} WD</strong><span>${esc(signedNum(d.impact_calendar_days))} calendar days</span></div></div><p class="cpm-snap-sub">${esc(`Event ${d.event_date ? shortDay(event) : "date not established"} · modeled in the ${shortDay(day(d.data_date))} update · completion ${shortDay(prior)} → ${shortDay(updated)}`)}</p>`;
    if (!kids.length || !times.length)
      return `<article class="cpm-snap">${head}<p class="cpm-snap-sub">The fragnet activities are not in this version.</p></article>`;
    const t0 = Math.min(...times) - 7 * DAY,
      t1 = Math.max(...times) + 8 * DAY;
    const days = Math.round((t1 - t0) / DAY);
    const scale = Math.max(3, Math.min(16, Math.floor(760 / days)));
    const m: Model = { ...full, t0, t1, days, scale, width: days * scale };
    const g = geometry(m);
    const items: Item[] = kids.map((r) => ({ kind: "act", r }));
    const view = `snap-${d.event_id}`.replace(/[^\w-]/g, "") as GanttView;
    const delay = delayMark(m, g);
    const rows = items
      .map((it) => rowHtml(m, it, g, view, delay))
      .join("")
      .replace(/<a class="cpm-c c-name" href="[^"]*"([^>]*)>([^<]*)<\/a>/g, '<span class="cpm-c c-name"$1>$2</span>');
    const headCells = m.columns
      .map((c) => `<span class="cpm-c c-${c.k}">${esc(c.label)}</span>`)
      .join("");
    return `<article class="cpm-snap" data-delay-snapshot="${esc(d.event_id)}">${head}<div class="cpm-scroll" tabindex="0" role="region" aria-label="${esc(d.event_id)} snapshot, scroll sideways" style="--cpm-w:${m.width}px"><div class="cpm-grid" role="table" style="width:calc(var(--cpm-left) + ${m.width}px)"><div class="cpm-row cpm-head"><div class="cpm-l cpm-lh">${headCells}</div><div class="cpm-t">${axisSvg(m)}</div></div><div class="cpm-body">${backdropSvg(m)}${logicSvg(m, items, g, view)}${rows}</div></div></div></article>`;
  });
  const style = `<style>.cpms{--w-st:86px;--w-fi:86px;--w-tf:42px}.cpmx.cpms .c-st,.cpmx.cpms .c-fi,.cpmx.cpms .c-tf{display:block!important}.cpms h2{margin:0 0 10px;font-size:13px;letter-spacing:.06em}.cpms .cpm-snap{border:1px solid ${LINE};border-radius:12px;margin:0 0 12px;overflow:hidden}.cpms .cpm-snap-h{display:flex;justify-content:space-between;gap:12px;padding:12px 14px 0}.cpms .cpm-snap-h h3{margin:2px 0 0;font-size:15px}.cpms .cpm-snap-k{text-align:right;white-space:nowrap}.cpms .cpm-snap-k strong{display:block;font-size:20px}.cpms .cpm-snap-k span{color:${MUTED};font-size:11.5px}.cpms .cpm-snap-sub{margin:4px 0 10px;padding:0 14px;color:${MUTED}}.cpms .cpm-scroll{border:0;border-top:1px solid ${LINE};border-radius:0}@media(max-width:559px){.cpmx.cpms .cpm-l .cpm-c:not(.c-id):not(.c-name){display:none!important}}</style>`;
  return `${style}<div class="cpmx cpms" id="cpm-delay-snapshots"><h2>DELAY EVENT SNAPSHOTS</h2>${cards.join("")}<p class="cpm-insp-hint">Each snapshot shows the fragnet and the work it pushed, as modeled in the update it was inserted into. Modeled impacts don't decide responsibility, concurrency or entitlement.</p></div>`;
}
const signedNum = (n: number) => (n > 0 ? `+${n}` : String(n));

export type LogicChange = {
  activity: string;
  name: string;
  kind: "link added" | "link removed" | "link changed" | "activity added" | "activity deleted" | "duration changed";
  detail: string;
};
/** Logic and duration changes from an earlier plan to this version: what a reviewer checks between updates. */
export function logicChanges(current: Activity[], against: Activity[]): LogicChange[] {
  const then = new Map(against.map((a) => [a.id, a]));
  const now = new Map(current.map((a) => [a.id, a]));
  const out: LogicChange[] = [];
  const rel = (l: { id: string; type?: string; lag?: number }) =>
    `${l.id} ${l.type ?? "FS"}${l.lag ? ` ${l.lag > 0 ? "+" : ""}${l.lag}` : ""}`;
  for (const a of current) {
    const b = then.get(a.id);
    if (!b) {
      out.push({ activity: a.id, name: a.name, kind: "activity added", detail: `${(a.predecessors ?? []).map(rel).join(", ") || "No predecessors"}` });
      continue;
    }
    const was = new Map((b.predecessors ?? []).map((l) => [l.id, l]));
    const is = new Map((a.predecessors ?? []).map((l) => [l.id, l]));
    for (const [id, l] of is) {
      const o = was.get(id);
      if (!o) out.push({ activity: a.id, name: a.name, kind: "link added", detail: `Predecessor ${rel(l)}` });
      else if ((o.type ?? "FS") !== (l.type ?? "FS") || (o.lag ?? 0) !== (l.lag ?? 0))
        out.push({ activity: a.id, name: a.name, kind: "link changed", detail: `${rel(o)} → ${rel(l)}` });
    }
    for (const [id, l] of was)
      if (!is.has(id)) out.push({ activity: a.id, name: a.name, kind: "link removed", detail: `Predecessor ${rel(l)}` });
    if ((b.duration ?? null) !== (a.duration ?? null))
      out.push({ activity: a.id, name: a.name, kind: "duration changed", detail: `${b.duration ?? "?"} → ${a.duration ?? "?"} WD` });
  }
  for (const b of against)
    if (!now.has(b.id)) out.push({ activity: b.id, name: b.name, kind: "activity deleted", detail: "Not in this version" });
  return out;
}

export function logicChangesHtml(input: GanttInput): string {
  const m = ganttModel({ ...input, layout: null });
  const acts = input.data.activities ?? [];
  const sets: [string, string, Activity[]][] = [
    ...(m.prior ? [["p", `Since last update (${shortDay(day(m.prior.data_date))})`, m.prior.activities] as [string, string, Activity[]]] : []),
    ...(m.baseline ? [["b", `Since baseline (${m.baseline.name})`, m.baseline.activities] as [string, string, Activity[]]] : []),
  ];
  if (!sets.length) return "";
  const pills = sets
    .map(([k, l], i) => `<input class="ath-sr" type="radio" name="cpm-lc" id="cpm-lc-${k}"${i === 0 ? " checked" : ""}><label for="cpm-lc-${k}">${esc(l)}</label>`)
    .join("");
  const tables = sets
    .map(([k, , against]) => {
      const ch = logicChanges(acts, against);
      const body = ch.length
        ? `<div class="cpm-tbl"><table><thead><tr><th>Activity</th><th>Change</th><th>Detail</th></tr></thead><tbody>${ch.map((c) => `<tr data-logic-change="${esc(c.activity)}"><td><span class="cpm-mono">${esc(c.activity)}</span> ${esc(c.name)}</td><td>${esc(c.kind[0].toUpperCase() + c.kind.slice(1))}</td><td class="cpm-mono">${esc(c.detail)}</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="cpmc-sum">No logic, duration or activity changes.</p>`;
      return `<div class="cpm-lcset" data-against="${k}"><p class="cpmc-sum">${esc(`${ch.length} ${ch.length === 1 ? "change" : "changes"}: ${ch.filter((c) => c.kind.startsWith("link")).length} logic, ${ch.filter((c) => c.kind === "duration changed").length} duration, ${ch.filter((c) => c.kind.startsWith("activity")).length} added or deleted activities.`)}</p>${body}</div>`;
    })
    .join("");
  const show = sets.map(([k]) => `.cpmc:has(#cpm-lc-${k}:checked) .cpm-lcset[data-against="${k}"]`).join(",");
  return `${tableStyle}<style>${athenaControlsCss("#cpm-logic-changes")}#cpm-logic-changes .cpm-lcset{display:none}${show}{display:block}#cpm-logic-changes .ath-seg{margin:0 0 10px}@media print{#cpm-logic-changes .ath-seg{display:none}#cpm-logic-changes .cpm-lcset{display:block!important}}</style><div class="cpmc" id="cpm-logic-changes"><h2>LOGIC CHANGES</h2><div class="ath-seg" role="radiogroup" aria-label="Compare logic against">${pills}</div>${tables}<p class="cpmc-sum" style="margin-top:8px">Relationships listed by predecessor, type and lag. A reviewer checks these between updates before accepting the dates.</p></div>`;
}
