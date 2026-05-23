import type {
  Dependency,
  DependencyType,
  ProjectCalendar,
  Schedule,
  ScheduledDependency,
  ScheduledTask,
  SchedulerOptions,
  ScheduleResult,
  Task,
  TaskId,
} from "./types";
import { DEFAULT_CALENDAR } from "./types";

interface NormalizedDependency {
  id: string;
  from: TaskId;
  to: TaskId;
  type: DependencyType;
  /** Lag expressed in project-default working days (as authored by the user). */
  lag: number;
}

interface WorkingTask extends Task {
  duration: number;
  /** Effective calendar for this task (per-task assignment or project default). */
  calendar: ProjectCalendar;
  /** Calendar-day offsets from projectStart. */
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  /** Floats expressed in calendar days. */
  totalFloat: number;
  freeFloat: number;
  isCritical: boolean;
}

/**
 * CPM engine. Internal time unit is CALENDAR-DAY OFFSET from projectStart.
 * - Task durations are stored as working days of the task's own calendar; the
 *   engine converts them to elapsed calendar days using that calendar.
 * - Dependency lags are interpreted as working days of the project default
 *   calendar and converted to elapsed calendar days at the predecessor's
 *   reference point.
 * - When `projectStartDate` is absent, the engine falls back to treating
 *   durations as raw integer offsets (so callers without dates still get a
 *   self-consistent topological schedule).
 */
export function calculateSchedule(
  schedule: Schedule,
  options: SchedulerOptions = {},
): ScheduleResult {
  const diagnostics: string[] = [];
  const tolerance = options.criticalFloatTolerance ?? 0;

  const defaultCalendar = schedule.calendar ?? DEFAULT_CALENDAR;
  const namedCalendars = schedule.calendars ?? [];
  const calendarLookup = new Map<string, ProjectCalendar>();
  for (const c of namedCalendars) {
    calendarLookup.set(c.id, { workDays: c.workDays, holidays: c.holidays });
  }

  const projectStart = schedule.projectStartDate;
  const tasks = normalizeTasks(schedule.tasks, defaultCalendar, calendarLookup, diagnostics);
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const dependencies = normalizeDependencies(schedule.dependencies, taskMap, diagnostics);
  const order = topologicalSort(tasks, dependencies);

  // Build per-task minimum start (calendar-day offset) from startNoEarlierThan.
  const minStart = new Map<TaskId, number>();
  if (projectStart) {
    for (const t of tasks) {
      if (t.startNoEarlierThan) {
        const off = calendarDayDelta(projectStart, t.startNoEarlierThan);
        if (off > 0) minStart.set(t.id, off);
      }
    }
  }

  runForwardPass(order, dependencies, taskMap, defaultCalendar, projectStart, minStart);
  const projectDuration = Math.max(0, ...tasks.map((task) => task.earlyFinish));
  runBackwardPass(
    [...order].reverse(),
    dependencies,
    taskMap,
    defaultCalendar,
    projectStart,
    projectDuration,
  );
  markFloat(tasks, dependencies, tolerance);

  const scheduledDependencies = dependencies.map((dependency) => ({
    ...dependency,
    isDriving:
      dependencySlack(dependency, taskMap, defaultCalendar, projectStart) <= tolerance,
  }));

  return {
    scheduleId: schedule.id,
    name: schedule.name,
    projectStartDate: projectStart,
    projectDuration,
    projectFinishDate: projectStart ? addCalendarDaysIso(projectStart, projectDuration) : undefined,
    tasks: tasks
      .map((task) => toScheduledTask(task, projectStart))
      .sort(
        (a, b) =>
          a.earlyStart - b.earlyStart || a.earlyFinish - b.earlyFinish || a.id.localeCompare(b.id),
      ),
    dependencies: scheduledDependencies,
    criticalPath: buildCriticalPath(tasks, scheduledDependencies),
    diagnostics,
  };
}

export function getTaskById(result: ScheduleResult, taskId: TaskId): ScheduledTask | undefined {
  return result.tasks.find((task) => task.id === taskId);
}

function normalizeTasks(
  tasks: Task[],
  defaultCalendar: ProjectCalendar,
  calendarLookup: Map<string, ProjectCalendar>,
  diagnostics: string[],
): WorkingTask[] {
  const seen = new Set<TaskId>();
  return tasks.map((task) => {
    if (seen.has(task.id)) {
      throw new Error(`Duplicate task id "${task.id}"`);
    }
    seen.add(task.id);

    const duration = Math.max(0, Math.round(Number.isFinite(task.duration) ? task.duration : 0));
    if (duration !== task.duration) {
      diagnostics.push(`Task "${task.id}" duration was normalized to ${duration}.`);
    }

    const cal =
      (task.calendarId && calendarLookup.get(task.calendarId)) || defaultCalendar;

    return {
      ...task,
      duration,
      calendar: cal,
      earlyStart: 0,
      earlyFinish: 0,
      lateStart: 0,
      lateFinish: 0,
      totalFloat: 0,
      freeFloat: 0,
      isCritical: false,
    };
  });
}

function normalizeDependencies(
  dependencies: Dependency[],
  taskMap: Map<TaskId, WorkingTask>,
  diagnostics: string[],
): NormalizedDependency[] {
  const normalized: NormalizedDependency[] = [];

  dependencies.forEach((dependency, index) => {
    if (!taskMap.has(dependency.from)) {
      diagnostics.push(
        `Dependency ${index + 1} skipped: missing predecessor "${dependency.from}".`,
      );
      return;
    }
    if (!taskMap.has(dependency.to)) {
      diagnostics.push(`Dependency ${index + 1} skipped: missing successor "${dependency.to}".`);
      return;
    }

    normalized.push({
      id:
        dependency.id ?? `${dependency.from}-${dependency.type ?? "FS"}-${dependency.to}-${index}`,
      from: dependency.from,
      to: dependency.to,
      type: dependency.type ?? "FS",
      lag: Math.round(dependency.lag ?? 0),
    });
  });

  return normalized;
}

function topologicalSort(
  tasks: WorkingTask[],
  dependencies: NormalizedDependency[],
): WorkingTask[] {
  const inbound = new Map<TaskId, number>(tasks.map((task) => [task.id, 0]));
  const outbound = new Map<TaskId, NormalizedDependency[]>(tasks.map((task) => [task.id, []]));

  dependencies.forEach((dependency) => {
    inbound.set(dependency.to, (inbound.get(dependency.to) ?? 0) + 1);
    outbound.get(dependency.from)?.push(dependency);
  });

  const queue = tasks.filter((task) => inbound.get(task.id) === 0);
  const ordered: WorkingTask[] = [];

  while (queue.length > 0) {
    const task = queue.shift()!;
    ordered.push(task);

    for (const dependency of outbound.get(task.id) ?? []) {
      const nextInbound = (inbound.get(dependency.to) ?? 0) - 1;
      inbound.set(dependency.to, nextInbound);
      if (nextInbound === 0) {
        const successor = tasks.find((candidate) => candidate.id === dependency.to);
        if (successor) queue.push(successor);
      }
    }
  }

  if (ordered.length !== tasks.length) {
    throw new Error("Schedule contains a dependency cycle.");
  }

  return ordered;
}

/** Convert N working days (positive) starting at `startOffset` into elapsed calendar days using `cal`. */
function workingDaysToCalendarDays(
  startOffset: number,
  workDays: number,
  cal: ProjectCalendar,
  projectStart?: string,
): number {
  if (workDays <= 0) return 0;
  if (!projectStart) return workDays; // dateless mode: treat as raw offset
  const base = new Date(`${projectStart}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return workDays;
  let walked = 0;
  let counted = 0;
  while (counted < workDays) {
    walked++;
    const d = new Date(base.getTime());
    d.setUTCDate(d.getUTCDate() + startOffset + walked);
    if (isWorkingDay(d, cal)) counted++;
  }
  return walked;
}

function runForwardPass(
  orderedTasks: WorkingTask[],
  dependencies: NormalizedDependency[],
  taskMap: Map<TaskId, WorkingTask>,
  defaultCal: ProjectCalendar,
  projectStart: string | undefined,
  minStart: Map<TaskId, number>,
) {
  const predecessors = groupBy(dependencies, "to");

  for (const task of orderedTasks) {
    let earlyStart = minStart.get(task.id) ?? 0;

    for (const dependency of predecessors.get(task.id) ?? []) {
      const predecessor = taskMap.get(dependency.from)!;
      earlyStart = Math.max(
        earlyStart,
        successorEarlyStart(dependency, predecessor, task, defaultCal, projectStart),
      );
    }

    const dur = workingDaysToCalendarDays(earlyStart, task.duration, task.calendar, projectStart);
    task.earlyStart = earlyStart;
    task.earlyFinish = earlyStart + dur;
  }
}

function runBackwardPass(
  reversedTasks: WorkingTask[],
  dependencies: NormalizedDependency[],
  taskMap: Map<TaskId, WorkingTask>,
  defaultCal: ProjectCalendar,
  projectStart: string | undefined,
  projectDuration: number,
) {
  const successors = groupBy(dependencies, "from");

  for (const task of taskMap.values()) {
    const dur = task.earlyFinish - task.earlyStart;
    task.lateFinish = projectDuration;
    task.lateStart = projectDuration - dur;
  }

  for (const task of reversedTasks) {
    let lateFinish = task.lateFinish;

    for (const dependency of successors.get(task.id) ?? []) {
      const successor = taskMap.get(dependency.to)!;
      lateFinish = Math.min(
        lateFinish,
        predecessorLateFinish(dependency, task, successor, defaultCal, projectStart),
      );
    }

    const dur = task.earlyFinish - task.earlyStart;
    task.lateFinish = lateFinish;
    task.lateStart = lateFinish - dur;
  }
}

function markFloat(tasks: WorkingTask[], dependencies: NormalizedDependency[], tolerance: number) {
  const successors = groupBy(dependencies, "from");
  const projectDuration = Math.max(0, ...tasks.map((task) => task.earlyFinish));
  const taskMap = new Map(tasks.map((task) => [task.id, task]));

  for (const task of tasks) {
    task.totalFloat = task.lateStart - task.earlyStart;
    const successorSlack = (successors.get(task.id) ?? []).map((dependency) =>
      // Float calc uses defaultCal-derived slack (lag offset cancels in slack semantics enough for FF heuristic).
      dependencySlack(dependency, taskMap, task.calendar, undefined),
    );
    task.freeFloat =
      successorSlack.length > 0 ? Math.min(...successorSlack) : projectDuration - task.earlyFinish;
    task.isCritical = task.totalFloat <= tolerance;
  }
}

/** Resolve calendar-day offset to apply to predecessor for lag (positive or negative). */
function lagCalendarOffset(
  refOffset: number,
  lagWorkingDays: number,
  defaultCal: ProjectCalendar,
  projectStart?: string,
): number {
  if (lagWorkingDays === 0) return 0;
  if (lagWorkingDays > 0) {
    return workingDaysToCalendarDays(refOffset, lagWorkingDays, defaultCal, projectStart);
  }
  // Negative lag: walk backward.
  if (!projectStart) return lagWorkingDays;
  const base = new Date(`${projectStart}T00:00:00.000Z`);
  let walked = 0;
  let counted = 0;
  const target = -lagWorkingDays;
  while (counted < target) {
    walked++;
    const d = new Date(base.getTime());
    d.setUTCDate(d.getUTCDate() + refOffset - walked);
    if (isWorkingDay(d, defaultCal)) counted++;
  }
  return -walked;
}

function successorEarlyStart(
  dependency: NormalizedDependency,
  predecessor: WorkingTask,
  successor: WorkingTask,
  defaultCal: ProjectCalendar,
  projectStart: string | undefined,
) {
  switch (dependency.type) {
    case "SS": {
      const ref = predecessor.earlyStart;
      return ref + lagCalendarOffset(ref, dependency.lag, defaultCal, projectStart);
    }
    case "FF": {
      const ref = predecessor.earlyFinish;
      const lagOff = lagCalendarOffset(ref, dependency.lag, defaultCal, projectStart);
      const succFinish = ref + lagOff;
      // Need succ.earlyStart such that earlyStart + dur(succ from earlyStart) == succFinish.
      // Approximate by subtracting successor duration in its own calendar walking backward.
      return succFinish - workingDaysBackToCalendarDays(succFinish, successor.duration, successor.calendar, projectStart);
    }
    case "SF": {
      const ref = predecessor.earlyStart;
      const lagOff = lagCalendarOffset(ref, dependency.lag, defaultCal, projectStart);
      const succFinish = ref + lagOff;
      return succFinish - workingDaysBackToCalendarDays(succFinish, successor.duration, successor.calendar, projectStart);
    }
    case "FS":
    default: {
      const ref = predecessor.earlyFinish;
      return ref + lagCalendarOffset(ref, dependency.lag, defaultCal, projectStart);
    }
  }
}

function predecessorLateFinish(
  dependency: NormalizedDependency,
  predecessor: WorkingTask,
  successor: WorkingTask,
  defaultCal: ProjectCalendar,
  projectStart: string | undefined,
) {
  const predDur = predecessor.earlyFinish - predecessor.earlyStart;
  switch (dependency.type) {
    case "SS": {
      const ref = successor.lateStart;
      // pred.lateStart = ref - lag; pred.lateFinish = pred.lateStart + predDur
      const lagOff = lagCalendarOffset(ref, dependency.lag, defaultCal, projectStart);
      return ref - lagOff + predDur;
    }
    case "FF": {
      const ref = successor.lateFinish;
      const lagOff = lagCalendarOffset(ref, dependency.lag, defaultCal, projectStart);
      return ref - lagOff;
    }
    case "SF": {
      const ref = successor.lateFinish;
      const lagOff = lagCalendarOffset(ref, dependency.lag, defaultCal, projectStart);
      return ref - lagOff + predDur;
    }
    case "FS":
    default: {
      const ref = successor.lateStart;
      const lagOff = lagCalendarOffset(ref, dependency.lag, defaultCal, projectStart);
      return ref - lagOff;
    }
  }
}

/** Walk N working days backward from `endOffset` using `cal`; return elapsed calendar days. */
function workingDaysBackToCalendarDays(
  endOffset: number,
  workDays: number,
  cal: ProjectCalendar,
  projectStart?: string,
): number {
  if (workDays <= 0) return 0;
  if (!projectStart) return workDays;
  const base = new Date(`${projectStart}T00:00:00.000Z`);
  let walked = 0;
  let counted = 0;
  while (counted < workDays) {
    walked++;
    const d = new Date(base.getTime());
    d.setUTCDate(d.getUTCDate() + endOffset - walked);
    if (isWorkingDay(d, cal)) counted++;
  }
  return walked;
}

function dependencySlack(
  dependency: NormalizedDependency,
  taskMap: Map<TaskId, WorkingTask>,
  defaultCal: ProjectCalendar,
  projectStart: string | undefined,
) {
  const predecessor = taskMap.get(dependency.from)!;
  const successor = taskMap.get(dependency.to)!;

  switch (dependency.type) {
    case "SS": {
      const ref = predecessor.earlyStart;
      return successor.earlyStart - (ref + lagCalendarOffset(ref, dependency.lag, defaultCal, projectStart));
    }
    case "FF": {
      const ref = predecessor.earlyFinish;
      return successor.earlyFinish - (ref + lagCalendarOffset(ref, dependency.lag, defaultCal, projectStart));
    }
    case "SF": {
      const ref = predecessor.earlyStart;
      return successor.earlyFinish - (ref + lagCalendarOffset(ref, dependency.lag, defaultCal, projectStart));
    }
    case "FS":
    default: {
      const ref = predecessor.earlyFinish;
      return successor.earlyStart - (ref + lagCalendarOffset(ref, dependency.lag, defaultCal, projectStart));
    }
  }
}

function buildCriticalPath(tasks: WorkingTask[], dependencies: ScheduledDependency[]): TaskId[] {
  const criticalIds = new Set(tasks.filter((task) => task.isCritical).map((task) => task.id));
  const drivingIds = new Set(
    dependencies
      .filter(
        (dependency) =>
          dependency.isDriving &&
          criticalIds.has(dependency.from) &&
          criticalIds.has(dependency.to),
      )
      .map((dependency) => `${dependency.from}->${dependency.to}`),
  );

  return tasks
    .filter((task) => criticalIds.has(task.id))
    .sort((a, b) => a.earlyStart - b.earlyStart || Number(drivingIds.has(`${a.id}->${b.id}`)) * -1)
    .map((task) => task.id);
}

function toScheduledTask(task: WorkingTask, projectStartDate?: string): ScheduledTask {
  // Strip internal-only `calendar` field from the working task before returning.
  const { calendar: _omit, ...rest } = task;
  void _omit;
  return {
    ...rest,
    earlyStartDate: projectStartDate ? addCalendarDaysIso(projectStartDate, task.earlyStart) : undefined,
    earlyFinishDate: projectStartDate ? addCalendarDaysIso(projectStartDate, task.earlyFinish) : undefined,
    lateStartDate: projectStartDate ? addCalendarDaysIso(projectStartDate, task.lateStart) : undefined,
    lateFinishDate: projectStartDate ? addCalendarDaysIso(projectStartDate, task.lateFinish) : undefined,
  };
}

function isWorkingDay(d: Date, cal: ProjectCalendar): boolean {
  const dow = d.getUTCDay();
  const bitIdx = (dow + 6) % 7;
  if (!(cal.workDays & (1 << bitIdx))) return false;
  const iso = d.toISOString().slice(0, 10);
  return !cal.holidays.includes(iso);
}

function addCalendarDaysIso(date: string, offset: number): string {
  const base = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return date;
  base.setUTCDate(base.getUTCDate() + offset);
  return base.toISOString().slice(0, 10);
}

function calendarDayDelta(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00.000Z`);
  const b = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function groupBy<T extends Record<K, string>, K extends keyof T>(items: T[], key: K) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const value = item[key];
    const bucket = grouped.get(value) ?? [];
    bucket.push(item);
    grouped.set(value, bucket);
  }
  return grouped;
}
