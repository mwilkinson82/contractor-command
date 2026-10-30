import { calculateCpm, ENGINE2_VERSION } from "../scheduler/engine2/cpm";
import { createWholeDayWorkClock, type WorkClock } from "../scheduler/engine2/work-clock";
import type { EngineActivity, EngineRelationship } from "../scheduler/engine2/types";
import type { Activity, LivingData } from "./living";
import {
  scheduleRequest,
  type ScheduleRequest,
  type ScheduleSettings,
  type WbsNode,
} from "./schedule-schema";

export class ScheduleInputError extends Error {}
const fail = (s: string): never => {
  throw new ScheduleInputError(s);
};
const instant = (s: string) => Date.parse(`${s}T00:00:00Z`);
const iso = (n: number) => new Date(n).toISOString().slice(0, 10);
const clone = <T>(v: T): T => structuredClone(v);
const unique = (ids: string[], label: string) => {
  if (new Set(ids).size !== ids.length) fail(`${label} IDs repeat.`);
};

export type ScheduleBaseline = {
  id: string;
  name: string;
  status: "draft" | "accepted";
  source_version: number;
  data_date: string;
  settings?: ScheduleSettings;
  activities: Activity[];
};
export type ScheduleAnalysis = {
  event_id: string;
  description: string;
  event_date: string | null;
  source_refs: string[];
  assumptions: string[];
  base_version: number;
  data_date: string;
  fragnet_ids: string[];
  affected_activity_ids: string[];
  prior_completion: string;
  updated_completion: string;
  impact_calendar_days: number;
  impact_project_work_days: number;
  milestones: {
    activity_id: string;
    prior_finish: string;
    updated_finish: string;
    variance_calendar_days: number;
  }[];
  before_activities: Activity[];
  limitation: string;
};
export type ScheduleControl = {
  schema_version: 1;
  wbs: WbsNode[];
  settings?: ScheduleSettings;
  baselines: ScheduleBaseline[];
  active_baseline_id?: string;
  calculation: {
    status: "reported" | "calculated";
    engine?: string;
    data_date: string;
    warnings: string[];
  };
  analysis?: ScheduleAnalysis;
};
export const starterWbs = (): WbsNode[] => [
  { id: "general-requirements", name: "General Requirements", parent_id: null, order: 0 },
  { id: "submittals", name: "Submittals", parent_id: null, order: 1 },
  {
    id: "submittals-prepare-submit",
    name: "Prepare and Submit",
    parent_id: "submittals",
    order: 0,
  },
  {
    id: "submittals-review-approve",
    name: "Review and Approve",
    parent_id: "submittals",
    order: 1,
  },
  { id: "procurement", name: "Procurement", parent_id: null, order: 2 },
  { id: "construction", name: "Construction", parent_id: null, order: 3 },
  { id: "closeout", name: "Closeout", parent_id: null, order: 4 },
];

export function readScheduleControl(data: unknown): ScheduleControl | null {
  const raw = (data as { schedule_control?: ScheduleControl } | null)?.schedule_control;
  if (!raw) return null;
  if (raw.schema_version !== 1 || !Array.isArray(raw.wbs) || !Array.isArray(raw.baselines))
    fail("Unsupported saved schedule-control format; preserve it and request a compatible reader.");
  return clone(raw);
}
export function wbsPaths(nodes: WbsNode[]): Map<string, string> {
  unique(
    nodes.map((n) => n.id),
    "WBS",
  );
  const map = new Map(nodes.map((n) => [n.id, n]));
  const paths = new Map<string, string>();
  const visit = (id: string, seen: Set<string>): string => {
    if (seen.has(id)) return fail(`WBS cycle at ${id}.`);
    if (paths.has(id)) return paths.get(id)!;
    const n = map.get(id) ?? fail(`Unknown WBS parent ${id}.`);
    const path = n.parent_id ? `${visit(n.parent_id, new Set([...seen, id]))} / ${n.name}` : n.name;
    paths.set(id, path);
    return path;
  };
  nodes.forEach((n) => visit(n.id, new Set()));
  return paths;
}

export function orderedWbs(nodes: WbsNode[]): WbsNode[] {
  wbsPaths(nodes); // Validate parent references/cycles before walking.
  const result: WbsNode[] = [];
  const visit = (parent: string | null) => {
    for (const node of nodes
      .filter((n) => n.parent_id === parent)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
      result.push(node);
      visit(node.id);
    }
  };
  visit(null);
  return result;
}

export function controlledTiaResult(control: ScheduleControl | null) {
  const a = control?.analysis;
  if (!a) return null;
  const line = `Modeled completion movement: ${a.impact_project_work_days >= 0 ? "+" : ""}${a.impact_project_work_days} project WD (${a.impact_calendar_days} CD)`;
  return {
    fragnet: a.fragnet_ids[0],
    prior_completion: a.prior_completion,
    updated_completion: a.updated_completion,
    impact_cd: a.impact_calendar_days,
    impact_wd: a.impact_project_work_days,
    completion_delay: line,
    fragnet_only_cd: a.impact_calendar_days,
    math: `${a.updated_completion} minus ${a.prior_completion}; same data date ${a.data_date}, isolated fragnet against v${a.base_version}.`,
    statement: `${line}. ${a.limitation}`,
    basis: "calculated_isolated_fragnet",
  };
}

/** Network validation is strict: the engine's permissive missing-link recovery is never used for saved Athena plans. */
export function validateSchedule(
  activities: Activity[],
  control: ScheduleControl,
  dataDate: string,
  previous: Activity[] = [],
): void {
  unique(
    activities.map((a) => a.id),
    "Activity",
  );
  const ids = new Set(activities.map((a) => a.id));
  const paths = wbsPaths(control.wbs);
  const prev = new Map(previous.map((a) => [a.id, a]));
  const calendars = control.settings?.calendars ?? [];
  unique(
    calendars.map((c) => c.id),
    "Calendar",
  );
  const calIds = new Set(calendars.map((c) => c.id));
  if (control.settings && !calIds.has(control.settings.default_calendar_id))
    fail("Default calendar is not defined.");
  for (const a of activities) {
    if (a.wbs_id && !paths.has(a.wbs_id)) fail(`${a.id}: WBS ${a.wbs_id} is not defined.`);
    if (a.calendar_id && !calIds.has(a.calendar_id))
      fail(`${a.id}: calendar ${a.calendar_id} is not defined; no fallback was applied.`);
    if (a.start && a.finish && a.finish < a.start) fail(`${a.id}: finish precedes start.`);
    if (
      a.actual_finish &&
      !a.actual_start &&
      a.activity_type !== "milestone-finish" &&
      a.duration !== 0
    )
      fail(`${a.id}: actual finish needs an evidenced actual start.`);
    if (
      (a.actual_start && a.actual_start > dataDate) ||
      (a.actual_finish && a.actual_finish > dataDate)
    )
      fail(`${a.id}: actual dates cannot follow the data date.`);
    if (a.actual_start && a.actual_finish && a.actual_finish < a.actual_start)
      fail(`${a.id}: actual finish precedes actual start.`);
    if (
      a.actual_finish &&
      ((a.remaining_duration != null && a.remaining_duration !== 0) ||
        (a.pct_complete != null && a.pct_complete !== 100))
    )
      fail(`${a.id}: completed work must have zero remaining duration and 100% progress.`);
    if (a.duration === 0 && a.remaining_duration != null && a.remaining_duration !== 0)
      fail(`${a.id}: milestone cannot have remaining work.`);
    if (a.activity_type?.startsWith("milestone") && a.duration !== 0)
      fail(`${a.id}: milestone duration must be zero.`);
    const p = prev.get(a.id);
    if (
      (p?.actual_start && p.actual_start !== a.actual_start) ||
      (p?.actual_finish && p.actual_finish !== a.actual_finish)
    )
      fail(`${a.id}: saved actual history cannot be changed by a schedule revision.`);
    unique(
      a.predecessors.map((p) => `${p.id}:${p.type ?? "FS"}`),
      `${a.id} dependency`,
    );
    for (const p of a.predecessors) {
      if (!ids.has(p.id)) fail(`${a.id}: predecessor ${p.id} is not in this job's activity list.`);
      if (p.id === a.id) fail(`${a.id}: self dependency is invalid.`);
    }
  }
  const byId = new Map(activities.map((a) => [a.id, a]));
  const done = new Set<string>(),
    visiting = new Set<string>();
  const walk = (id: string) => {
    if (visiting.has(id)) fail(`Dependency cycle at ${id}.`);
    if (done.has(id)) return;
    visiting.add(id);
    byId.get(id)!.predecessors.forEach((p) => walk(p.id));
    visiting.delete(id);
    done.add(id);
  };
  activities.forEach((a) => walk(a.id));
  for (const p of previous)
    if (!ids.has(p.id)) fail(`Revision drops ${p.id}; retain its stable identity and history.`);
}

function calculate(activities: Activity[], control: ScheduleControl, dataDate: string) {
  const settings =
    control.settings ??
    fail(
      "Choose the project start and explicit whole-day calendars before recalculation. No calendar or start was guessed.",
    );
  if (dataDate < settings.project_start) fail("Data date precedes project start.");
  const clocks = new Map<string, WorkClock>(
    settings.calendars.map((c) => [
      c.id,
      createWholeDayWorkClock({
        id: c.id,
        name: c.name,
        workDays: c.work_days,
        holidays: c.holidays,
        hoursPerDay: c.hours_per_day,
      }),
    ]),
  );
  const calId = (a: Activity) => a.calendar_id ?? settings.default_calendar_id;
  const engineActivities: EngineActivity[] = activities.map((a) => {
    const id = calId(a),
      clock = clocks.get(id)!;
    if (a.duration == null) fail(`${a.id}: original working duration is required for calculation.`);
    // Physical progress is evidence, never a substitute for actual dates/remaining duration.
    if ((a.pct_complete ?? 0) > 0 && !a.actual_start && !a.actual_finish)
      fail(
        `${a.id}: reported progress needs actual-date evidence before calculation; existing reported dates remain unchanged.`,
      );
    if (a.pct_complete === 100 && !a.actual_finish)
      fail(`${a.id}: 100% progress needs actual finish evidence.`);
    if (a.actual_start && !a.actual_finish && a.remaining_duration == null)
      fail(`${a.id}: in-progress work needs an explicit remaining working duration.`);
    const minutes = (a.duration ?? 0) * clock.hoursPerDay * 60;
    const remain = a.actual_finish
      ? 0
      : (a.remaining_duration ?? a.duration ?? 0) * clock.hoursPerDay * 60;
    const finish = a.actual_finish
      ? instant(a.actual_finish) + (a.duration === 0 ? 0 : clock.hoursPerDay * 3600000)
      : undefined;
    return {
      id: a.id,
      name: a.name,
      type: a.activity_type ?? (a.duration === 0 ? "milestone-finish" : "task"),
      durationType: "fixed-dur-units",
      percentCompleteType: "physical",
      calendarId: id,
      originalDuration: { minutes, authoringCalendarId: id },
      remainingDuration: { minutes: remain, authoringCalendarId: id },
      actualStart: a.actual_start ? instant(a.actual_start) : finish,
      actualFinish: finish,
      physicalPercentComplete: a.pct_complete ?? undefined,
      constraints: [
        ...(a.start_no_earlier_than
          ? [{ type: "snet" as const, instant: instant(a.start_no_earlier_than), calendarId: id }]
          : []),
        ...(a.finish_no_later_than
          ? [
              {
                type: "fnlt" as const,
                instant:
                  instant(a.finish_no_later_than) +
                  (a.duration === 0 ? 0 : clock.hoursPerDay * 3600000),
                calendarId: id,
              },
            ]
          : []),
      ],
    };
  });
  const byId = new Map(activities.map((a) => [a.id, a]));
  const relationships: EngineRelationship[] = activities.flatMap((a) =>
    a.predecessors.map((p, i) => {
      const basis = p.lag_calendar_basis ?? "project";
      const id =
        basis === "predecessor"
          ? calId(byId.get(p.id)!)
          : basis === "successor"
            ? calId(a)
            : settings.default_calendar_id;
      const hours = basis === "24h" ? 24 : clocks.get(id)!.hoursPerDay;
      return {
        id: `${a.id}:${p.id}:${p.type ?? "FS"}:${i}`,
        from: p.id,
        to: a.id,
        type: p.type ?? "FS",
        lag: { minutes: (p.lag ?? 0) * hours * 60, authoringCalendarId: id },
        lagCalendarBasis: basis,
      };
    }),
  );
  const result = calculateCpm({
    activities: engineActivities,
    relationships,
    calendars: clocks,
    projectStart: instant(settings.project_start),
    dataDate: instant(dataDate),
    projectCalendarId: settings.default_calendar_id,
    progress: { outOfSequenceRule: "retained-logic" },
  });
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  if (errors.length) fail(errors.map((d) => d.message).join(" "));
  const outputs = new Map(result.activities.map((a) => [a.id, a]));
  const next = activities.map((a) => {
    const r = outputs.get(a.id) ?? fail(`Calculation omitted ${a.id}.`);
    const clock = clocks.get(calId(a))!;
    const hours = clock.hoursPerDay;
    // An actual start is history, not remaining start slack. Measuring from it
    // would make a driving in-progress activity look noncritical by elapsed days.
    const floatMinutes =
      a.actual_start && !a.actual_finish
        ? clock.diffWork(r.earlyFinish, r.lateFinish)
        : r.totalFloatMinutes;
    return {
      ...a,
      pct_complete: a.actual_finish ? 100 : a.pct_complete,
      start: a.actual_start ?? iso(r.earlyStart),
      finish: a.actual_finish ?? iso(r.earlyFinish),
      total_float: Math.round((floatMinutes / (hours * 60)) * 1e6) / 1e6,
      critical: floatMinutes <= 0,
    };
  });
  return {
    activities: next,
    warnings: result.diagnostics.filter((d) => d.severity !== "error").map((d) => d.message),
    critical_path: next
      .filter((a) => a.critical)
      .sort((a, b) => a.start!.localeCompare(b.start!) || a.id.localeCompare(b.id))
      .map((a) => a.id),
  };
}

const snapshot = (activities: Activity[]): Activity[] =>
  activities.map((a) => ({
    id: a.id,
    name: a.name,
    duration: a.duration,
    start: a.start,
    finish: a.finish,
    predecessors: clone(a.predecessors),
    total_float: a.total_float,
    critical: a.critical,
    pct_complete: a.pct_complete,
    value: null,
    sov_line: null,
    cost_code: null,
    wbs_id: a.wbs_id,
    calendar_id: a.calendar_id,
    activity_type: a.activity_type,
    actual_start: a.actual_start,
    actual_finish: a.actual_finish,
    remaining_duration: a.remaining_duration,
    start_no_earlier_than: a.start_no_earlier_than,
    finish_no_later_than: a.finish_no_later_than,
  }));
const completion = (a: Activity[]) =>
  a.reduce((last, a) => (a.finish && a.finish > last ? a.finish : last), "");
const variance = (before: string, after: string) =>
  Math.round((instant(after) - instant(before)) / 86400000);

export function prepareSchedule(
  previous: LivingData | null,
  baseVersion: number,
  raw: ScheduleRequest,
  previousDataDate?: string | null,
) {
  const request = scheduleRequest.parse(raw);
  const old = previous?.activities ?? [];
  if (
    !old.length &&
    request.initial_activities?.some((a) => a.start || a.finish) &&
    request.operation !== "organize"
  )
    fail(
      "Import the reported source dates with organize and save that reviewed version first. Recalculate in a later revision so the original imported dates and logic remain in history.",
    );
  if (old.length && request.initial_activities)
    fail(
      "An existing schedule must be revised by stable activity IDs; first-import replacement is not allowed.",
    );
  let activities = clone(old.length ? old : (request.initial_activities ?? []));
  if (!activities.length)
    fail("No saved activities. Supply an explicit first-import activity list.");
  const control = readScheduleControl(previous) ?? {
    schema_version: 1 as const,
    wbs: [],
    baselines: [],
    calculation: {
      status: "reported" as const,
      data_date: previousDataDate ?? request.data_date,
      warnings: [],
    },
  };
  if (request.data_date < control.calculation.data_date)
    fail(
      "A revision cannot move the data date backward; use the historical version for comparison.",
    );
  if (request.settings) control.settings = clone(request.settings);
  if (request.starter_wbs && control.wbs.length)
    fail("Starter WBS cannot replace an existing hierarchy; edit its nodes explicitly.");
  if (request.starter_wbs && request.wbs)
    fail("Choose starter WBS or an explicit hierarchy, not both.");
  if (request.starter_wbs) control.wbs = starterWbs();
  if (request.wbs) control.wbs = clone(request.wbs);
  if (request.add_activities?.length) {
    if (request.operation !== "recalculate")
      fail(
        "Ordinary activity additions require a recalculate revision; TIA uses its isolated delay activities.",
      );
    activities.push(...clone(request.add_activities));
    if (activities.length > 400)
      fail("Schedule exceeds the 400-activity limit; nothing was truncated.");
  }
  const map = new Map(activities.map((a) => [a.id, a]));
  unique(
    (request.assignments ?? []).map((a) => a.activity_id),
    "WBS assignment",
  );
  for (const a of request.assignments ?? []) {
    const activity = map.get(a.activity_id) ?? fail(`Unknown activity ${a.activity_id}.`);
    activity.wbs_id = a.wbs_id;
  }
  unique(
    (request.updates ?? []).map((a) => a.id),
    "Update",
  );
  if (
    request.operation === "organize" &&
    (request.updates?.length ||
      (old.length && request.settings) ||
      request.delay ||
      request.baseline)
  )
    fail("Organize changes WBS only; use recalculate to change schedule facts/settings.");
  if (request.operation !== "tia" && request.delay)
    fail("Delay insertion requires the tia operation.");
  if (request.operation !== "baseline" && request.baseline)
    fail("Baseline capture requires the baseline operation.");
  if (
    request.operation === "baseline" &&
    (request.updates?.length || request.settings || request.wbs || request.assignments?.length)
  )
    fail(
      "Capture the current saved plan first; revisions and baseline capture are separate operations.",
    );
  for (const patch of request.updates ?? []) {
    const activity = map.get(patch.id) ?? fail(`Unknown activity ${patch.id}.`);
    Object.assign(activity, patch);
  }
  validateSchedule(activities, control, request.data_date, old);
  let criticalPath: string[] = [];
  if (request.operation === "recalculate" || request.operation === "tia") {
    const before = calculate(activities, control, request.data_date);
    activities = before.activities;
    criticalPath = before.critical_path;
    control.calculation = {
      status: "calculated",
      engine: ENGINE2_VERSION,
      data_date: request.data_date,
      warnings: before.warnings,
    };
    delete control.analysis;
    if (request.operation === "tia") {
      const delay =
        request.delay ?? fail("TIA needs identified delay activities and exact replacement links.");
      if (
        request.updates?.length ||
        (request.settings &&
          readScheduleControl(previous)?.settings &&
          JSON.stringify(request.settings) !==
            JSON.stringify(readScheduleControl(previous)?.settings))
      )
        fail("TIA compares only the fragnet; save unrelated progress/settings revisions first.");
      const ids = new Set(activities.map((a) => a.id));
      for (const a of delay.add_activities)
        if (ids.has(a.id)) fail(`Delay ID ${a.id} already exists; do not duplicate or replace it.`);
      const scenario = [...clone(activities), ...clone(delay.add_activities)];
      if (scenario.length > 400)
        fail("Scenario exceeds the 400-activity limit; nothing was truncated.");
      const scenarioMap = new Map(scenario.map((a) => [a.id, a]));
      unique(
        delay.replace_predecessors.map((a) => a.activity_id),
        "Replacement",
      );
      for (const edit of delay.replace_predecessors) {
        const a =
          scenarioMap.get(edit.activity_id) ??
          fail(`Unknown affected activity ${edit.activity_id}.`);
        if (a.actual_finish) fail(`${a.id}: delay cannot rewrite completed logic.`);
        a.predecessors = clone(edit.predecessors);
      }
      validateSchedule(scenario, control, request.data_date, old);
      const insertedIds = new Set(delay.add_activities.map((a) => a.id));
      const sameLink = (a: Activity["predecessors"][number], b: Activity["predecessors"][number]) =>
        a.id === b.id &&
        (a.type ?? "FS") === (b.type ?? "FS") &&
        (a.lag ?? 0) === (b.lag ?? 0) &&
        (a.lag_calendar_basis ?? "project") === (b.lag_calendar_basis ?? "project");
      const plainFs = (link: Activity["predecessors"][number]) =>
        (link.type ?? "FS") === "FS" && (link.lag ?? 0) === 0;
      const routedThroughFragnet = (
        from: string,
        target: string,
        seen = new Set<string>(),
      ): boolean => {
        if (seen.has(from)) return false;
        seen.add(from);
        return scenario
          .filter((a) => a.predecessors.some((p) => p.id === from && plainFs(p)))
          .some(
            (a) =>
              a.id === target ||
              (insertedIds.has(a.id) && routedThroughFragnet(a.id, target, new Set(seen))),
          );
      };
      for (const edit of delay.replace_predecessors) {
        const original = activities.find((a) => a.id === edit.activity_id);
        if (!original) continue;
        for (const link of original.predecessors) {
          if (edit.predecessors.some((p) => sameLink(p, link))) continue;
          if (!plainFs(link) || !routedThroughFragnet(link.id, original.id))
            fail(
              `${original.id}: TIA must preserve existing constraints or route an unchanged zero-lag FS handoff through the fragnet. Save other logic revisions separately.`,
            );
        }
        for (const link of edit.predecessors)
          if (ids.has(link.id) && !original.predecessors.some((p) => sameLink(p, link)))
            fail(
              `${original.id}: an unrelated original-network link changed; this is not an isolated fragnet comparison.`,
            );
      }
      // Every inserted activity must lead to an original affected activity; unrelated additions are not a TIA.
      const descendants = (id: string, seen = new Set<string>()): boolean => {
        if (seen.has(id)) return false;
        seen.add(id);
        return scenario
          .filter((a) => a.predecessors.some((p) => p.id === id))
          .some((a) => ids.has(a.id) || descendants(a.id, seen));
      };
      for (const a of delay.add_activities)
        if (!descendants(a.id))
          fail(`${a.id}: delay fragnet is not connected to the original network.`);
      const after = calculate(scenario, control, request.data_date);
      const priorFinish = completion(activities),
        newFinish = completion(after.activities);
      const projectCalendar = control.settings!.calendars.find(
        (c) => c.id === control.settings!.default_calendar_id,
      )!;
      const projectClock = createWholeDayWorkClock({
        id: projectCalendar.id,
        name: projectCalendar.name,
        workDays: projectCalendar.work_days,
        holidays: projectCalendar.holidays,
        hoursPerDay: projectCalendar.hours_per_day,
      });
      control.analysis = {
        ...clone(delay),
        base_version: baseVersion,
        data_date: request.data_date,
        fragnet_ids: delay.add_activities.map((a) => a.id),
        affected_activity_ids: delay.replace_predecessors.map((a) => a.activity_id),
        prior_completion: priorFinish,
        updated_completion: newFinish,
        impact_calendar_days: variance(priorFinish, newFinish),
        impact_project_work_days:
          projectClock.diffWork(instant(priorFinish) + 86400000, instant(newFinish) + 86400000) /
          (projectCalendar.hours_per_day * 60),
        before_activities: snapshot(activities),
        milestones: activities
          .filter((a) => a.duration === 0)
          .map((a) => {
            const next = after.activities.find((n) => n.id === a.id)!;
            return {
              activity_id: a.id,
              prior_finish: a.finish!,
              updated_finish: next.finish!,
              variance_calendar_days: variance(a.finish!, next.finish!),
            };
          }),
        limitation:
          "Calculated comparison isolates this modeled fragnet at one data date. It does not determine responsibility, concurrency, compensability or entitlement. Durations and sources remain reported evidence; missing facts stay open.",
      };
      // Keep only audit facts, not duplicate mutation commands, in the stored analysis.
      delete (control.analysis as unknown as Record<string, unknown>).add_activities;
      delete (control.analysis as unknown as Record<string, unknown>).replace_predecessors;
      activities = after.activities;
      criticalPath = after.critical_path;
      control.calculation.warnings = after.warnings;
    }
  } else if (request.operation === "baseline") {
    const baseline =
      request.baseline ?? fail("Give the baseline a unique ID, name and draft/accepted status.");
    if (!baseVersion) fail("Save the imported plan before capturing a baseline.");
    if (control.baselines.some((b) => b.id === baseline.id))
      fail(`Baseline ${baseline.id} already exists and is immutable.`);
    if (activities.some((a) => !a.start || !a.finish)) fail("Baseline needs complete saved dates.");
    if (request.data_date !== control.calculation.data_date)
      fail("Baseline data date must match the saved plan.");
    control.baselines.push({
      ...baseline,
      source_version: baseVersion,
      data_date: request.data_date,
      settings: clone(control.settings!),
      activities: snapshot(activities),
    });
    control.active_baseline_id = baseline.id;
  } else {
    if (request.data_date !== control.calculation.data_date)
      fail("WBS-only organization must retain the saved data date.");
  }
  const next: LivingData = { ...clone(previous ?? {}), activities, schedule_control: control };
  if (request.operation === "recalculate") next.tia = null; // Historic version retains the prior analysis.
  if (control.analysis && request.operation === "tia")
    next.tia = {
      fragnet: control.analysis.fragnet_ids[0],
      prior_completion: control.analysis.prior_completion,
      updated_completion: control.analysis.updated_completion,
      holidays: control.settings?.calendars.find(
        (c) => c.id === control.settings!.default_calendar_id,
      )?.holidays,
    };
  return {
    data: next,
    control,
    critical_path: criticalPath,
    changes: activities.flatMap((a) => {
      const p = old.find((p) => p.id === a.id);
      return !p || JSON.stringify(p) !== JSON.stringify(a)
        ? [{ activity_id: a.id, before: p ?? null, after: a }]
        : [];
    }),
    missing: [
      ...(control.analysis && !control.analysis.event_date
        ? ["Reported event date not established; scenario is provisional."]
        : []),
      ...(control.analysis && !control.analysis.source_refs.length
        ? ["Event/duration source evidence not supplied; scenario is provisional."]
        : []),
      ...activities.filter((a) => !a.wbs_id).map((a) => `${a.id}: WBS unassigned`),
      ...(!control.settings
        ? [
            "Calculation settings/calendar not established; dates and TIA remain reported, not calculated.",
          ]
        : []),
    ],
  };
}

/** Read-only contract for future portfolio consumers. Never interprets earned, billed or paid values. */
export function schedulePortfolio(
  data: LivingData | null,
  context: { company_id: string; job_id: string; version: number; data_date: string | null },
) {
  const control = readScheduleControl(data),
    activities = data?.activities ?? [];
  const baseline = control?.baselines.find((b) => b.id === control.active_baseline_id);
  return {
    schema_version: 1,
    ...context,
    status: !activities.length ? "missing" : (control?.calculation.status ?? "reported"),
    source: { tool: "cpm_activities", version: context.version },
    current_url: `/r/job/${context.job_id}/schedule`,
    baseline: baseline
      ? { id: baseline.id, status: baseline.status, source_version: baseline.source_version }
      : null,
    forecast_finish: activities.length ? completion(activities) || null : null,
    baseline_finish: baseline ? completion(baseline.activities) || null : null,
    variance_calendar_days:
      baseline && completion(activities) && completion(baseline.activities)
        ? variance(completion(baseline.activities), completion(activities))
        : null,
    calendar_ids: control?.settings?.calendars.map((c) => c.id) ?? [],
    wbs: control
      ? orderedWbs(control.wbs).map((n) => ({
          ...n,
          activity_count: activities.filter((a) => a.wbs_id === n.id).length,
        }))
      : [],
    milestones: activities
      .filter((a) => a.duration === 0)
      .map((a) => {
        const b = baseline?.activities.find((b) => b.id === a.id);
        return {
          activity_id: a.id,
          name: a.name,
          finish: a.finish,
          baseline_finish: b?.finish ?? null,
          variance_calendar_days: b?.finish && a.finish ? variance(b.finish, a.finish) : null,
          total_float_work_days: a.total_float,
          critical: a.critical,
        };
      }),
    critical_exposure: activities
      .filter(
        (a) =>
          !a.actual_finish && (a.critical === true || (a.total_float != null && a.total_float < 0)),
      )
      .map((a) => ({
        activity_id: a.id,
        finish: a.finish,
        total_float_work_days: a.total_float,
        calculated: control?.calculation.status === "calculated",
      })),
    missing: [
      ...(!control?.settings ? ["Calculation settings not established"] : []),
      ...(!baseline ? ["Baseline not captured"] : []),
      ...activities
        .filter((a) => !a.finish || a.total_float == null)
        .map((a) => `${a.id}: dates/float incomplete`),
    ],
  };
}
