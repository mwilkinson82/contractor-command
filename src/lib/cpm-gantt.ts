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
  fragnet: boolean;
  base?: Activity;
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
    }
  | { kind: "act"; r: GanttRow };

export type GanttInput = {
  data: LivingData;
  control: ScheduleControl;
  dataDate: string | null | undefined;
  contractCompletion?: string | null;
};

/** Everything the page needs, derived once. Exported for tests and the PDF. */
export function ganttModel({ data, control, dataDate, contractCompletion }: GanttInput) {
  const acts = data.activities ?? [];
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
      fragnet: fragnetIds.has(a.id),
      base: baseById.get(a.id),
      prior: priorById.get(a.id),
      cal: cals.get(a.calendar_id),
    };
  });
  const byId = new Map(rows.map((r) => [r.a.id, r]));
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
  const scale = days <= 420 ? 4 : days <= 900 ? 3 : days <= 2200 ? 2 : 1;
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
    if (it.kind === "group")
      it.costs = [...new Set(it.kids.map((k) => k.costToken).filter((c): c is string => !!c))];
  return items;
}
function pathItems(m: Model): Item[] {
  const items: Item[] = [];
  for (const p of m.floatPaths) {
    const kids = p.activity_ids.map((id) => m.byId.get(id)).filter((r): r is GanttRow => !!r);
    if (!kids.length) continue;
    items.push({
      kind: "group",
      label: `Float path ${p.rank}${p.rank === 1 ? " · longest path" : ""} · total float ${String(p.total_float).replace("-", "−")} WD`,
      color: pathColor(p.rank),
      kids,
      tokens: [...new Set(kids.flatMap((k) => k.wbsTokens))],
      costs: [...new Set(kids.map((k) => k.costToken).filter((c): c is string => !!c))],
    });
    kids.forEach((r) => items.push({ kind: "act", r }));
  }
  return items;
}

export type GanttView = "all" | "longest" | "paths" | "tf0";
export const GANTT_VIEWS: [GanttView, string][] = [
  ["all", "All activities"],
  ["longest", "Longest path"],
  ["paths", "Float paths"],
  ["tf0", "Total float ≤ 0"],
];
export function viewItems(m: Model, view: GanttView): Item[] {
  if (view === "paths") return pathItems(m);
  if (view === "longest") {
    const ids = m.floatPaths[0]?.activity_ids ?? m.longest;
    return ids
      .map((id) => m.byId.get(id))
      .filter((r): r is GanttRow => !!r)
      .map((r) => ({ kind: "act", r }) as Item);
  }
  if (view === "tf0")
    return wbsItems(
      m,
      m.rows
        .filter((r) => !r.done && r.tf !== null && r.tf <= 0)
        .sort((a, b) => orderKey(a) - orderKey(b)),
    );
  return wbsItems(m, m.rows);
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

function axisSvg(m: Model): string {
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
    for (let w = t; w < next; w += DAY)
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
  if (m.dd !== null) {
    const x = g.X(m.dd);
    out.push(
      `<rect x="${x - 31}" y="17" width="62" height="13" rx="3" fill="${BLUE}"/><text x="${x}" y="27" font-size="9" font-weight="700" fill="#fff" text-anchor="middle">DD ${esc(shortDay(m.dd))}</text>`,
    );
  }
  return `<svg width="${m.width}" height="${HEAD}" viewBox="0 0 ${m.width} ${HEAD}" role="img" aria-label="Timeline by month">${out.join("")}</svg>`;
}

/** Month bands, data date and contract lines behind the bars. Stretches with the visible rows. */
function backdropSvg(m: Model): string {
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
    return `<div class="cpm-row cpm-grp" data-wbs="${it.tokens.join(" ")}" data-cc="${it.costs.join(" ")}" role="row"><div class="cpm-l"><span class="cpm-gl" style="color:${it.color ?? INK}" title="${esc(it.label)}">${esc(it.label)}</span></div><div class="cpm-t">${bar}</div></div>`;
  }
  const r = it.r;
  const tf = r.tf === null ? "" : String(r.tf);
  const rd = r.done ? 0 : (r.a.remaining_duration ?? r.a.duration ?? "");
  const name = `<a class="cpm-c c-name" href="#cpm-a-${r.idx}" title="${esc(r.a.name)}"${r.critical ? ' style="font-weight:600"' : ""}>${esc(r.a.name)}</a>`;
  const left =
    cell("c-id", r.a.id) +
    name +
    cell("c-od", r.a.duration ?? "") +
    cell("c-rd", rd) +
    cell("c-st", r.start === null ? "" : `${shortDay(r.start)}${r.started ? " A" : ""}`) +
    cell("c-fi", r.finish === null ? "" : `${shortDay(r.finish)}${r.done ? " A" : ""}`) +
    cell("c-tf", tf, r.tf !== null && r.tf < 0 ? ' style="color:#B42318;font-weight:700"' : "") +
    cell("c-ff", r.ff === null ? "" : r.ff);
  const status = r.done
    ? "complete"
    : r.critical
      ? "critical"
      : r.tf !== null && r.tf < 0
        ? "negative float"
        : "float";
  const extra = delay && delay.row === r.a.id ? delay.html : "";
  return `<div class="cpm-row cpm-act" data-activity="${esc(r.a.id)}" data-path="${r.path ?? ""}" data-wbs="${r.wbsTokens.join(" ")}" data-cc="${r.costToken ?? ""}" role="row" aria-label="${esc(`${r.a.id} ${r.a.name}, ${status}`)}"><div class="cpm-l">${left}</div><div class="cpm-t">${barsHtml(m, r, g, view !== "all")}${extra}</div></div>`;
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
  const m = view === "all" ? full : windowFor(full, items);
  const g = geometry(m);
  if (!items.length)
    return `<div class="cpmv" data-view="${view}"><p class="cpm-empty">${view === "all" ? "No activities saved yet." : m.calculated ? (view === "tf0" ? "No remaining activity has total float of zero or less." : "No float paths were saved with this version.") : "Paths show once Athena calculates this schedule."}</p></div>`;
  const delay = delayMark(m, g);
  const rows = items.map((it) => rowHtml(m, it, g, view, delay)).join("");
  const head = `<div class="cpm-row cpm-head"><div class="cpm-l cpm-lh"><span class="cpm-c c-id">ID</span><span class="cpm-c c-name">Activity</span><span class="cpm-c c-od" title="Original duration, working days">OD</span><span class="cpm-c c-rd" title="Remaining duration, working days">RD</span><span class="cpm-c c-st">Start</span><span class="cpm-c c-fi">Finish</span><span class="cpm-c c-tf" title="Total float, working days">TF</span><span class="cpm-c c-ff" title="Free float, working days">FF</span></div><div class="cpm-t">${axisSvg(m)}</div></div>`;
  return `<div class="cpmv" data-view="${view}" style="--cpm-w:${m.width}px"><div class="cpm-scroll" tabindex="0" role="region" aria-label="${esc(GANTT_VIEWS.find((v) => v[0] === view)![1])} schedule, scroll sideways"><div class="cpm-grid cpm-fit" role="table" style="width:calc(var(--cpm-left) + ${m.width}px)">${head}<div class="cpm-body">${backdropSvg(m)}${logicSvg(m, items, g, view)}${rows}</div></div></div></div>`;
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

const DESKTOP_COLS = "64px 230px 36px 36px 78px 78px 40px 36px";
const LEFT_DESKTOP = 598,
  LEFT_TABLET = 344,
  LEFT_PHONE = 176;

function css(m: Model): string {
  const rule = (input: string, sel: string) => `.cpmx:has(${input}) ${sel}`;
  const views = GANTT_VIEWS.filter(([v]) => v !== "all")
    .map(
      ([v]) =>
        `${rule(`#cpm-v-${v}:checked`, `.cpmv[data-view="${v}"]`)}{display:block}${rule(`#cpm-v-${v}:checked`, `.cpmv[data-view="all"]`)}{display:none}`,
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
  const filtered = `${rule(`#cpm-wbs option:not([value=""]):checked`, `.cpm-logic`)},${rule(`#cpm-cc option:not([value=""]):checked`, `.cpm-logic`)}{display:none}${rule(`#cpm-wbs option:not([value=""]):checked`, `.cpm-fnote`)},${rule(`#cpm-cc option:not([value=""]):checked`, `.cpm-fnote`)}{display:block}`;
  const fit = Math.min(1, 1540 / (LEFT_DESKTOP + m.width));
  return `<style>
.cpmx{--cpm-left:${LEFT_DESKTOP}px;color:${INK};font-size:12px}
.cpmx .cpm-controls{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin:0 0 10px}
.cpmx .cpm-sr{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.cpmx .cpm-pills{display:inline-flex;flex-wrap:wrap;border:1px solid ${LINE};border-radius:8px;overflow:hidden}
.cpmx .cpm-pills label{padding:6px 10px;cursor:pointer;color:${INK2};font-weight:600;border-right:1px solid ${LINE};white-space:nowrap}
.cpmx .cpm-pills label:last-of-type{border-right:0}
.cpmx .cpm-sr:checked+label{background:${BLUE};color:#fff}
.cpmx .cpm-sr:focus-visible+label{outline:2px solid ${BLUE};outline-offset:-2px}
.cpmx .cpm-field{display:inline-flex;gap:6px;align-items:center;color:${MUTED};font-weight:600}
.cpmx select{font:inherit;color:${INK};border:1px solid ${LINE};border-radius:6px;padding:5px 6px;background:#fff;max-width:220px}
.cpmx .cpm-tog{display:inline-flex;gap:5px;align-items:center;color:${INK2};font-weight:600;cursor:pointer}
.cpmx .cpm-tog input{accent-color:${BLUE};margin:0}
.cpmx .cpmv[data-view]:not([data-view="all"]){display:none}
${views}
.cpmx .cpm-scroll{overflow-x:auto;overscroll-behavior-x:contain;border:1px solid ${LINE};border-radius:10px;background:#fff;-webkit-overflow-scrolling:touch}
.cpmx .cpm-scroll:focus-visible{outline:2px solid ${BLUE};outline-offset:3px}
.cpmx .cpm-grid{position:relative}
.cpmx .cpm-row{display:flex;height:${CPM_ROW_PX}px;border-bottom:1px solid ${LINE2}}
.cpmx .cpm-head{height:${HEAD}px;border-bottom:1px solid ${LINE}}
.cpmx .cpm-l{position:sticky;left:0;z-index:4;flex:0 0 var(--cpm-left);width:var(--cpm-left);display:grid;grid-template-columns:${DESKTOP_COLS};align-items:center;background:#fff;box-shadow:1px 0 0 ${LINE};overflow:hidden}
.cpmx .cpm-lh{color:${MUTED};font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;align-items:end;padding-bottom:7px}
.cpmx .cpm-c{padding:0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.cpmx .c-id{color:${INK2};font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:11px;padding-left:8px}
.cpmx a.c-name{color:${INK};text-decoration:none}
.cpmx a.c-name:hover,.cpmx a.c-name:focus-visible{color:${BLUE};text-decoration:underline}
.cpmx .c-od,.cpmx .c-rd,.cpmx .c-tf,.cpmx .c-ff{text-align:right}
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
${wbs}${cc}${filtered}
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
@media(max-width:899px){.cpmx{--cpm-left:${LEFT_TABLET}px}.cpmx .cpm-l{grid-template-columns:58px 168px 78px 40px}.cpmx .c-od,.cpmx .c-rd,.cpmx .c-st,.cpmx .c-ff{display:none}}
@media(max-width:559px){.cpmx{--cpm-left:${LEFT_PHONE}px}.cpmx .cpm-l{grid-template-columns:60px 116px}.cpmx .c-fi,.cpmx .c-tf{display:none}.cpmx .cpm-pills label{padding:6px 8px}}
@media print{@page{size:17in 11in;margin:.35in}.cpmx{--cpm-left:${LEFT_DESKTOP}px}.cpmx .cpm-l{grid-template-columns:${DESKTOP_COLS}}.cpmx .cpm-c{display:block!important}.cpmx .cpm-controls,.cpmx .cpm-insp,.cpmx .cpm-insp-hint{display:none!important}.cpmx .cpm-scroll{overflow:visible;border:0}.cpmx .cpm-fit{zoom:${fit.toFixed(3)}}.cpmx .cpm-l{position:static}.cpmx .cpm-row{break-inside:avoid}.cpmx *{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>`;
}

function legendHtml(m: Model): string {
  const sw = (bg: string, extra = "") => `<i class="cpm-sw" style="background:${bg};${extra}"></i>`;
  return `<div class="cpm-legend" aria-label="Legend"><span>${sw(ACT)}Actual</span><span>${sw(CRIT)}${m.definition === "longest-path" ? "Remaining, longest path" : "Remaining, critical (TF ≤ 0)"}</span><span>${sw(NEG)}Remaining, negative float</span><span>${sw(POS)}Remaining, positive float</span><span>${sw(`repeating-linear-gradient(45deg,${CRIT} 0 3px,#F6C2BF 3px 6px)`)}Delay fragnet</span><span>${sw(BL, "height:4px")}Baseline</span>${m.prior ? `<span>${sw("#8FB0DD", "height:4px")}Last update</span>` : ""}<span>${sw(FLT, "height:2px")}Total float</span><span><svg width="11" height="11" aria-hidden="true"><path d="M5.5 0l5.5 5.5-5.5 5.5L0 5.5z" fill="${INK}"/></svg>Milestone</span><span><svg width="22" height="8" aria-hidden="true"><path d="M0 4h15" stroke="${INK}" stroke-width="1.4"/><path d="M15 1l6 3-6 3z" fill="${INK}"/></svg>Driving tie</span><span><svg width="22" height="8" aria-hidden="true"><path d="M0 4h15" stroke="${FLT}" stroke-dasharray="3 2"/><path d="M15 1l6 3-6 3z" fill="${FLT}"/></svg>Non-driving tie</span><span>${sw(BLUE, "width:2px;height:12px")}Data date</span>${m.cc !== null ? `<span>${sw(`repeating-linear-gradient(${INK} 0 3px,transparent 3px 5px)`, "width:2px;height:12px")}Contract completion</span>` : ""}</div>`;
}

/** Headline numbers for the top of the page. */
export function ganttSummary(m: Model) {
  const driver = m.longest.map((id) => m.byId.get(id)).find((r) => r && !r.done && !r.milestone);
  const versusBaseline =
    m.baselineFinish !== null && m.forecast !== null
      ? workDaysBetween(m.baselineFinish, m.forecast, m.projectCal)
      : null;
  const versusContract =
    m.cc !== null && m.forecast !== null ? workDaysBetween(m.cc, m.forecast, m.projectCal) : null;
  return {
    forecast: m.forecast,
    baselineFinish: m.baselineFinish,
    versusBaseline,
    versusContract,
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
  const wbsSelect = m.nodes.length
    ? `<label class="cpm-field" for="cpm-wbs">WBS <select id="cpm-wbs">${opt("", "All WBS")}${m.nodes.map((n, i) => opt(`w${i}`, m.paths.get(n.id)!)).join("")}</select></label>`
    : `<label class="cpm-field" for="cpm-wbs">WBS <select id="cpm-wbs" disabled>${opt("", "No WBS saved")}</select></label>`;
  const ccSelect = m.costs.length
    ? `<label class="cpm-field" for="cpm-cc">Cost code <select id="cpm-cc">${opt("", "All cost codes")}${m.costs.map((c, i) => opt(`c${i}`, c)).join("")}</select></label>`
    : `<label class="cpm-field" for="cpm-cc">Cost code <select id="cpm-cc" disabled>${opt("", "No cost codes saved")}</select></label>`;
  const pills = GANTT_VIEWS.map(
    ([v, l], i) =>
      `<input class="cpm-sr" type="radio" name="cpm-view" id="cpm-v-${v}"${i === 0 ? " checked" : ""}><label for="cpm-v-${v}">${esc(l)}</label>`,
  ).join("");
  const compare = [
    ...(m.baseline ? [opt("b", `Baseline: ${m.baseline.name}`)] : []),
    ...(m.prior ? [opt("p", `Last update: ${shortDay(day(m.prior.data_date))}`)] : []),
    opt("none", "No comparison bars"),
  ];
  const cmpSelect = `<label class="cpm-field" for="cpm-cmp">Compare <select id="cpm-cmp">${compare.join("")}</select></label>`;
  const toggles = [
    ["cpm-lg", "Logic"],
    ["cpm-fl", "Float"],
  ]
    .map(
      ([id, l]) =>
        `<label class="cpm-tog" for="${id}"><input type="checkbox" id="${id}" checked> ${l}</label>`,
    )
    .join("");
  const controls = `<div class="cpm-controls"><div class="cpm-pills" role="radiogroup" aria-label="Show">${pills}</div>${wbsSelect}${ccSelect}${cmpSelect}${toggles}</div>`;
  const views = GANTT_VIEWS.map(([v]) => viewHtml(m, v)).join("");
  const inspectors = m.rows.map((r) => inspectorHtml(m, r)).join("");
  return `${css(m)}<div class="cpmx" id="cpm-gantt">${controls}${views}<p class="cpm-fnote">Logic lines hide while a WBS or cost code filter is on, so no line points at a hidden activity.</p>${legendHtml(m)}<p class="cpm-insp-hint">Tap an activity name for its dates, float, logic and what drives it. Print this page on tabloid landscape for the full schedule.</p>${inspectors}</div>`;
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

const signed = (n: number | null) => (n === null ? "" : n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

function compareTable(
  m: Model,
  against: Activity[],
  label: string,
  dataDate: string | null,
  key: string,
): string {
  const changes = compareActivities(m, against);
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
        `<input class="cpm-sr" type="radio" name="cpmc" id="cpmc-${k}"${i === 0 ? " checked" : ""}><label for="cpmc-${k}">${esc(pill)}</label>`,
    )
    .join("");
  const rules = sets
    .slice(1)
    .map(
      ([k]) =>
        `.cpmc:has(#cpmc-${k}:checked) .cpmc-set[data-against="${k}"]{display:block}.cpmc:has(#cpmc-${k}:checked) .cpmc-set[data-against="${sets[0][0]}"]{display:none}`,
    )
    .join("");
  const style = `<style>.cpmc{color:${INK};font-size:12px}.cpmc h2{margin:0 0 10px;font-size:13px;letter-spacing:.06em}.cpmc .cpm-sr{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}.cpmc .cpm-pills{display:inline-flex;flex-wrap:wrap;border:1px solid ${LINE};border-radius:8px;overflow:hidden;margin:0 0 10px}.cpmc .cpm-pills label{padding:6px 10px;cursor:pointer;color:${INK2};font-weight:600;border-right:1px solid ${LINE};white-space:nowrap}.cpmc .cpm-pills label:last-of-type{border-right:0}.cpmc .cpm-sr:checked+label{background:${BLUE};color:#fff}.cpmc .cpm-sr:focus-visible+label{outline:2px solid ${BLUE};outline-offset:-2px}.cpmc .cpmc-set{display:none}.cpmc .cpmc-set[data-against="${sets[0][0]}"]{display:block}${rules}.cpmc .cpmc-sum{margin:0 0 8px;font-size:13px}.cpmc .cpmc-none{color:${MUTED};margin:0}.cpmc .cpm-tbl{overflow-x:auto}.cpmc table{border-collapse:collapse;width:100%;min-width:640px}.cpmc th{text-align:left;color:${MUTED};font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;padding:5px 6px;white-space:nowrap}.cpmc td{padding:5px 6px;border-top:1px solid ${LINE2};vertical-align:top}.cpmc td:first-child,.cpmc th:first-child{position:sticky;left:0;background:#fff;z-index:1}.cpmc .cpm-n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.cpmc .cpm-mono{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:11px;white-space:nowrap}@media print{.cpmc .cpm-pills{display:none}.cpmc .cpmc-set{display:block!important;break-inside:auto}}</style>`;
  return `${style}<div class="cpmc" id="cpm-compare"><h2>UPDATE COMPARISON</h2><div class="cpm-pills" role="radiogroup" aria-label="Compare against">${pills}</div>${sets.map(([k, label, , acts, dd]) => compareTable(m, acts, label, dd, k)).join("")}<p class="cpmc-none" style="margin-top:8px">Variances are working days on each activity's calendar. Positive means later.</p></div>`;
}

/** Milestones against the baseline and the last update, with float and any finish-by date. */
export function milestoneHtml(input: GanttInput): string {
  const m = ganttModel(input);
  const ms = m.rows.filter((r) => r.milestone);
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
  return `${style}<div class="cpmc" id="cpm-milestones"><h2>MILESTONES</h2><div class="cpm-tbl"><table><thead><tr><th>ID</th><th>Milestone</th><th class="cpm-n">Baseline</th>${m.prior ? `<th class="cpm-n">Last update</th>` : ""}<th class="cpm-n">Forecast / actual</th><th class="cpm-n" title="Working days">vs baseline</th>${m.prior ? `<th class="cpm-n" title="Working days">vs last update</th>` : ""}<th class="cpm-n">Total float</th><th class="cpm-n">Finish by</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
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
  const reg = input.control.delay_register ?? [];
  if (!reg.length) return "";
  const rows = [...reg]
    .sort((a, b) => a.data_date.localeCompare(b.data_date) || a.event_id.localeCompare(b.event_id))
    .map(
      (d) =>
        `<tr data-delay-event="${esc(d.event_id)}"><td class="cpm-mono">${esc(d.event_id)}</td><td style="min-width:200px">${esc(d.description ?? "")}</td><td class="cpm-n">${esc(d.event_date ? shortDay(day(d.event_date)) : "Not established")}</td><td class="cpm-n">${esc(shortDay(day(d.data_date)))}</td><td class="cpm-mono">${esc(d.fragnet_ids.join(", "))}</td><td class="cpm-n">${esc(shortDay(day(d.prior_completion)))} → ${esc(shortDay(day(d.updated_completion)))}</td><td class="cpm-n"${lateStyle(d.impact_project_work_days)}>${esc(signed(d.impact_project_work_days))} WD · ${esc(signed(d.impact_calendar_days))} CD</td></tr>`,
    )
    .join("");
  const cd = reg.reduce((s, d) => s + Math.max(0, d.impact_calendar_days), 0);
  return `${tableStyle}<div class="cpmc" id="cpm-delays"><h2>DELAY EVENTS</h2><p class="cpmc-sum">${esc(`${reg.length} modeled ${reg.length === 1 ? "event" : "events"} · ${cd} calendar days of modeled completion movement, each measured alone against the update it was inserted into.`)}</p><div class="cpm-tbl"><table><thead><tr><th>Event</th><th>Description</th><th class="cpm-n">Event date</th><th class="cpm-n">Data date</th><th>Fragnet</th><th class="cpm-n">Completion</th><th class="cpm-n">Modeled impact</th></tr></thead><tbody>${rows}</tbody></table></div><p class="cpmc-sum" style="margin-top:8px">Modeled impacts are not additive when events overlap, and they do not decide responsibility, concurrency or entitlement.</p></div>`;
}
