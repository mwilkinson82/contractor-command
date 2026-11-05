import type { Activity, LivingData } from "./mcp/living";
import type { ScheduleControl } from "./mcp/schedule-control";
import type { ScheduleLayout } from "./mcp/schedule-schema";

/** A layout's filter, sort and grouping without a saved name, for one-off queries. */
export type LayoutSpec = Omit<ScheduleLayout, "id" | "name"> & { id?: string; name?: string };

const done = (a: Activity) => !!a.actual_finish || (a.pct_complete === 100 && !!a.actual_start);

/** WBS node IDs under each given node, the node included. */
function wbsUnder(control: ScheduleControl, ids: string[]): Set<string> {
  const kids = new Map<string, string[]>();
  for (const n of control.wbs)
    if (n.parent_id)
      (kids.get(n.parent_id) ?? kids.set(n.parent_id, []).get(n.parent_id)!).push(n.id);
  const out = new Set<string>();
  const visit = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    (kids.get(id) ?? []).forEach(visit);
  };
  ids.forEach(visit);
  return out;
}

/** Whether each activity passes the layout's filter. No filter keeps everything. */
export function layoutFilter(
  control: ScheduleControl,
  spec: Pick<LayoutSpec, "filter"> | null | undefined,
): (a: Activity) => boolean {
  const f = spec?.filter;
  if (!f) return () => true;
  const wbs = f.wbs_ids?.length ? wbsUnder(control, f.wbs_ids) : null;
  const cost = f.cost_codes?.length ? new Set(f.cost_codes.map((c) => c.trim())) : null;
  const ids = f.activity_ids?.length ? new Set(f.activity_ids) : null;
  const codes = (f.codes ?? []).map((c) => ({ id: c.code_id, values: new Set(c.value_ids) }));
  const longest = new Set(control.calculation.longest_path ?? []);
  const values = control.code_values ?? {};
  return (a) => {
    if (wbs && !(a.wbs_id && wbs.has(a.wbs_id))) return false;
    if (cost && !(a.cost_code && cost.has(a.cost_code.trim()))) return false;
    if (ids && !ids.has(a.id)) return false;
    for (const c of codes) if (!c.values.has(values[a.id]?.[c.id] ?? "")) return false;
    if (f.remaining_only && done(a)) return false;
    if (
      f.critical_only &&
      (done(a) || !(longest.has(a.id) || a.critical === true || (a.total_float ?? Infinity) <= 0))
    )
      return false;
    return true;
  };
}

/** The value name an activity carries for a code, or "" when none is assigned. */
export function codeValueName(
  control: ScheduleControl,
  activityId: string,
  codeId: string,
): string {
  const v = control.code_values?.[activityId]?.[codeId];
  if (!v) return "";
  return (
    control.activity_codes?.find((c) => c.id === codeId)?.values.find((x) => x.id === v)?.name ?? ""
  );
}

export const COLUMN_LABELS: Record<string, string> = {
  id: "ID",
  name: "Activity",
  od: "OD",
  rd: "RD",
  pc: "%",
  st: "Start",
  fi: "Finish",
  tf: "TF",
  ff: "FF",
};

/** Plain value of a column for one activity, as the page shows it (A marks an actual date). */
export function columnValue(
  control: ScheduleControl,
  a: Activity,
  key: string,
): string | number | null {
  const isDone = done(a);
  if (key.startsWith("code:")) return codeValueName(control, a.id, key.slice(5)) || null;
  switch (key) {
    case "id":
      return a.id;
    case "name":
      return a.name;
    case "od":
      return a.duration ?? null;
    case "rd":
      return isDone ? 0 : (a.remaining_duration ?? a.duration ?? null);
    case "pc":
      return isDone ? 100 : (a.pct_complete ?? null);
    case "st":
      return a.start ?? null;
    case "fi":
      return a.finish ?? null;
    case "tf":
      return isDone ? null : (a.total_float ?? null);
    case "ff":
      return isDone ? null : (control.calculation.activity_results?.[a.id]?.free_float ?? null);
    default:
      return null;
  }
}

/** Activities a layout shows, in its order: WBS order or date order, then its sort. */
export function layoutActivities(
  data: LivingData,
  control: ScheduleControl,
  spec: LayoutSpec,
): Activity[] {
  const keep = layoutFilter(control, spec);
  const acts = (data.activities ?? []).map((a, i) => ({ a, i })).filter(({ a }) => keep(a));
  const wbsRank = new Map<string, number>();
  if (spec.group === "wbs") {
    // Parents before children, siblings by their order.
    const kids = new Map<string | null, typeof control.wbs>();
    for (const n of control.wbs)
      (kids.get(n.parent_id) ?? kids.set(n.parent_id, []).get(n.parent_id)!).push(n);
    const walk = (p: string | null) =>
      [...(kids.get(p) ?? [])]
        .sort((x, y) => x.order - y.order)
        .forEach((n) => {
          wbsRank.set(n.id, wbsRank.size);
          walk(n.id);
        });
    walk(null);
  }
  const date = (s: string | null | undefined) => (s ? Date.parse(`${s}T00:00:00Z`) : Infinity);
  acts.sort((x, y) =>
    spec.group === "wbs"
      ? (wbsRank.get(x.a.wbs_id ?? "") ?? 1e6) - (wbsRank.get(y.a.wbs_id ?? "") ?? 1e6) || x.i - y.i
      : date(x.a.start) - date(y.a.start) || date(x.a.finish) - date(y.a.finish) || x.i - y.i,
  );
  if (spec.sort) {
    const { key, dir } = spec.sort;
    const sign = dir === "desc" ? -1 : 1;
    acts.sort((x, y) => {
      const a = columnValue(control, x.a, key),
        b = columnValue(control, y.a, key);
      if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1; // Blanks last either way.
      const c =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a).localeCompare(String(b), undefined, { numeric: true });
      return sign * c;
    });
  }
  return acts.map(({ a }) => a);
}

/** One-line description of a layout's filter, for the page and the AI. */
export function describeFilter(control: ScheduleControl, spec: LayoutSpec): string {
  const f = spec.filter;
  const parts: string[] = [];
  const wbsName = new Map(control.wbs.map((n) => [n.id, n.name]));
  if (f?.wbs_ids?.length) parts.push(`WBS ${f.wbs_ids.map((w) => wbsName.get(w) ?? w).join(", ")}`);
  for (const c of f?.codes ?? []) {
    const code = control.activity_codes?.find((x) => x.id === c.code_id);
    const names = c.value_ids.map((v) => code?.values.find((x) => x.id === v)?.name ?? v);
    parts.push(`${code?.name ?? c.code_id} ${names.join(" or ")}`);
  }
  if (f?.cost_codes?.length) parts.push(`cost code ${f.cost_codes.join(", ")}`);
  if (f?.activity_ids?.length) parts.push(`${f.activity_ids.length} listed activities`);
  if (f?.critical_only) parts.push("critical only");
  if (f?.remaining_only) parts.push("remaining only");
  return parts.length ? parts.join(" · ") : "All activities";
}
