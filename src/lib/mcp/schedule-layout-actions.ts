/**
 * The AI's side of saved schedule layouts and activity codes: list them, open one, run a one-off
 * sort and filter, and scope a delay or TIA result to a layout. Read-only; saving a code or layout
 * is an organize revision through living_report_save like any other schedule change.
 */
import type { LivingData } from "./living";
import type { ScheduleControl, ScheduleAnalysis } from "./schedule-control";
import type { ScheduleLayout } from "./schedule-schema";
import {
  COLUMN_LABELS,
  columnValue,
  describeFilter,
  layoutActivities,
  layoutFilter,
  type LayoutSpec,
} from "../schedule-layouts";

export const scheduleLayoutUrl = (jobId: string, layoutId: string | null) =>
  `https://app.meetathena.io/r/job/${jobId}/schedule${layoutId ? `?layout=${encodeURIComponent(layoutId)}` : ""}`;

const DEFAULT_COLUMNS = ["od", "st", "fi", "tf"] as const;
/** Rows printed in the text answer; structured content carries up to 400. */
const TEXT_ROWS = 60;

function columnLabel(control: ScheduleControl, key: string): string {
  if (key.startsWith("code:"))
    return control.activity_codes?.find((c) => c.id === key.slice(5))?.name ?? key.slice(5);
  return COLUMN_LABELS[key] ?? key;
}

/** Plain columns or code columns the spec names that the schedule doesn't have. */
export function unknownRefs(control: ScheduleControl, spec: LayoutSpec): string[] {
  const codes = new Set((control.activity_codes ?? []).map((c) => c.id));
  const wbs = new Set(control.wbs.map((n) => n.id));
  const bad: string[] = [];
  for (const c of [...spec.columns, ...(spec.sort ? [spec.sort.key] : [])])
    if (c.startsWith("code:") && !codes.has(c.slice(5))) bad.push(`activity code ${c.slice(5)}`);
  for (const f of spec.filter?.codes ?? []) {
    const code = control.activity_codes?.find((c) => c.id === f.code_id);
    if (!code) bad.push(`activity code ${f.code_id}`);
    else
      for (const v of f.value_ids)
        if (!code.values.some((x) => x.id === v)) bad.push(`${code.name} value ${v}`);
  }
  for (const w of spec.filter?.wbs_ids ?? []) if (!wbs.has(w)) bad.push(`WBS ${w}`);
  return [...new Set(bad)];
}

/** Rows of a layout or one-off view, with the columns it shows. */
export function layoutRows(data: LivingData, control: ScheduleControl, spec: LayoutSpec) {
  const columns = ["id", "name", ...(spec.columns.length ? spec.columns : DEFAULT_COLUMNS)];
  const acts = layoutActivities(data, control, spec);
  const rows = acts.slice(0, 400).map((a) =>
    Object.fromEntries(
      columns.map((k) => {
        const v = columnValue(control, a, k);
        const actual =
          (k === "st" && a.actual_start) ||
          (k === "fi" && (a.actual_finish || (a.pct_complete === 100 && a.actual_start)));
        return [k, v === null ? null : actual ? `${v} A` : v];
      }),
    ),
  );
  const head = columns.map((k) => columnLabel(control, k));
  const lines = rows
    .slice(0, TEXT_ROWS)
    .map((r) => `| ${columns.map((k) => String(r[k] ?? "")).join(" | ")} |`);
  const table = [
    `| ${head.join(" | ")} |`,
    `|${columns.map(() => "---").join("|")}|`,
    ...lines,
  ].join("\n");
  return {
    columns,
    rows,
    count: acts.length,
    filter: describeFilter(control, spec),
    table:
      acts.length > TEXT_ROWS
        ? `${table}\n(${acts.length - TEXT_ROWS} more rows in the page)`
        : table,
  };
}

/** Codes and layouts saved on this schedule, each layout with the link that opens it. */
export function layoutCatalog(control: ScheduleControl | null, jobId: string) {
  const codes = (control?.activity_codes ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    values: c.values.map((v) => ({
      id: v.id,
      name: v.name,
      activities: Object.values(control?.code_values ?? {}).filter((x) => x[c.id] === v.id).length,
    })),
  }));
  const layouts = (control?.layouts ?? []).map((l: ScheduleLayout) => ({
    id: l.id,
    name: l.name,
    group: l.group,
    columns: l.columns,
    sort: l.sort ?? null,
    filter: describeFilter(control!, l),
    timescale: l.timescale ?? null,
    url: scheduleLayoutUrl(jobId, l.id),
  }));
  return { codes, layouts };
}

/**
 * A delay result limited to a layout's activities: the activities that moved, the delay events that
 * touch them, and the modeled analysis's milestones inside the scope.
 */
export function scopedDelay(
  data: LivingData,
  control: ScheduleControl,
  spec: LayoutSpec,
  changes: { activity_id: string; before: unknown; after: unknown }[] = [],
) {
  const keep = layoutFilter(control, spec);
  const ids = new Set((data.activities ?? []).filter(keep).map((a) => a.id));
  const analysis: ScheduleAnalysis | undefined = control.analysis;
  const inScope = (list: string[]) => list.some((id) => ids.has(id));
  return {
    filter: describeFilter(control, spec),
    activity_count: ids.size,
    changed_activity_ids: changes.map((c) => c.activity_id).filter((id) => ids.has(id)),
    delay_events: (control.delay_register ?? [])
      .filter((d) => inScope([...d.fragnet_ids, ...d.affected_activity_ids]))
      .map((d) => ({
        event_id: d.event_id,
        description: d.description,
        data_date: d.data_date,
        impact_project_work_days: d.impact_project_work_days,
        impact_calendar_days: d.impact_calendar_days,
      })),
    analysis: analysis
      ? {
          event_id: analysis.event_id,
          touches_scope: inScope([...analysis.fragnet_ids, ...analysis.affected_activity_ids]),
          milestones_in_scope: analysis.milestones.filter((m) => ids.has(m.activity_id)),
          // Activities in scope whose finish the fragnet moved.
          moved: analysis.before_activities
            .filter((b) => ids.has(b.id))
            .flatMap((b) => {
              const now = (data.activities ?? []).find((a) => a.id === b.id);
              return now && now.finish !== b.finish
                ? [{ activity_id: b.id, before: b.finish, after: now.finish }]
                : [];
            }),
        }
      : null,
  };
}
