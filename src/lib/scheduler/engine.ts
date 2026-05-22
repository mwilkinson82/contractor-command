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
  lag: number;
}

interface WorkingTask extends Task {
  duration: number;
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  totalFloat: number;
  freeFloat: number;
  isCritical: boolean;
}

export function calculateSchedule(
  schedule: Schedule,
  options: SchedulerOptions = {},
): ScheduleResult {
  const diagnostics: string[] = [];
  const tolerance = options.criticalFloatTolerance ?? 0;
  const tasks = normalizeTasks(schedule.tasks, diagnostics);
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const dependencies = normalizeDependencies(schedule.dependencies, taskMap, diagnostics);
  const order = topologicalSort(tasks, dependencies);
  const calendar = schedule.calendar ?? DEFAULT_CALENDAR;

  // Compute minimum-start working-day offset per task from startNoEarlierThan
  const minStart = new Map<TaskId, number>();
  if (schedule.projectStartDate) {
    for (const t of tasks) {
      if (t.startNoEarlierThan) {
        const off = workingDayDelta(schedule.projectStartDate, t.startNoEarlierThan, calendar);
        if (off > 0) minStart.set(t.id, off);
      }
    }
  }

  runForwardPass(order, dependencies, taskMap, minStart);
  const projectDuration = Math.max(0, ...tasks.map((task) => task.earlyFinish));
  runBackwardPass([...order].reverse(), dependencies, taskMap, projectDuration);
  markFloat(tasks, dependencies, tolerance);

  const scheduledDependencies = dependencies.map((dependency) => ({
    ...dependency,
    isDriving: dependencySlack(dependency, taskMap) <= tolerance,
  }));

  const calendar = schedule.calendar ?? DEFAULT_CALENDAR;
  return {
    scheduleId: schedule.id,
    name: schedule.name,
    projectStartDate: schedule.projectStartDate,
    projectDuration,
    projectFinishDate: schedule.projectStartDate
      ? addWorkingDaysIso(schedule.projectStartDate, projectDuration, calendar)
      : undefined,
    tasks: tasks
      .map((task) => toScheduledTask(task, schedule.projectStartDate, calendar))
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

function normalizeTasks(tasks: Task[], diagnostics: string[]): WorkingTask[] {
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

    return {
      ...task,
      duration,
      earlyStart: 0,
      earlyFinish: duration,
      lateStart: 0,
      lateFinish: duration,
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

function runForwardPass(
  orderedTasks: WorkingTask[],
  dependencies: NormalizedDependency[],
  taskMap: Map<TaskId, WorkingTask>,
) {
  const predecessors = groupBy(dependencies, "to");

  for (const task of orderedTasks) {
    let earlyStart = 0;

    for (const dependency of predecessors.get(task.id) ?? []) {
      const predecessor = taskMap.get(dependency.from)!;
      earlyStart = Math.max(
        earlyStart,
        successorEarlyStart(dependency, predecessor, task.duration),
      );
    }

    task.earlyStart = earlyStart;
    task.earlyFinish = earlyStart + task.duration;
  }
}

function runBackwardPass(
  reversedTasks: WorkingTask[],
  dependencies: NormalizedDependency[],
  taskMap: Map<TaskId, WorkingTask>,
  projectDuration: number,
) {
  const successors = groupBy(dependencies, "from");

  for (const task of taskMap.values()) {
    task.lateFinish = projectDuration;
    task.lateStart = projectDuration - task.duration;
  }

  for (const task of reversedTasks) {
    let lateFinish = task.lateFinish;

    for (const dependency of successors.get(task.id) ?? []) {
      const successor = taskMap.get(dependency.to)!;
      lateFinish = Math.min(
        lateFinish,
        predecessorLateFinish(dependency, task.duration, successor),
      );
    }

    task.lateFinish = lateFinish;
    task.lateStart = lateFinish - task.duration;
  }
}

function markFloat(tasks: WorkingTask[], dependencies: NormalizedDependency[], tolerance: number) {
  const successors = groupBy(dependencies, "from");
  const projectDuration = Math.max(0, ...tasks.map((task) => task.earlyFinish));
  const taskMap = new Map(tasks.map((task) => [task.id, task]));

  for (const task of tasks) {
    task.totalFloat = task.lateStart - task.earlyStart;
    const successorSlack = (successors.get(task.id) ?? []).map((dependency) =>
      dependencySlack(dependency, taskMap),
    );
    task.freeFloat =
      successorSlack.length > 0 ? Math.min(...successorSlack) : projectDuration - task.earlyFinish;
    task.isCritical = task.totalFloat <= tolerance;
  }
}

function successorEarlyStart(
  dependency: NormalizedDependency,
  predecessor: WorkingTask,
  successorDuration: number,
) {
  switch (dependency.type) {
    case "SS":
      return predecessor.earlyStart + dependency.lag;
    case "FF":
      return predecessor.earlyFinish + dependency.lag - successorDuration;
    case "SF":
      return predecessor.earlyStart + dependency.lag - successorDuration;
    case "FS":
    default:
      return predecessor.earlyFinish + dependency.lag;
  }
}

function predecessorLateFinish(
  dependency: NormalizedDependency,
  predecessorDuration: number,
  successor: WorkingTask,
) {
  switch (dependency.type) {
    case "SS":
      return successor.lateStart - dependency.lag + predecessorDuration;
    case "FF":
      return successor.lateFinish - dependency.lag;
    case "SF":
      return successor.lateFinish - dependency.lag + predecessorDuration;
    case "FS":
    default:
      return successor.lateStart - dependency.lag;
  }
}

function dependencySlack(dependency: NormalizedDependency, taskMap: Map<TaskId, WorkingTask>) {
  const predecessor = taskMap.get(dependency.from)!;
  const successor = taskMap.get(dependency.to)!;

  switch (dependency.type) {
    case "SS":
      return successor.earlyStart - (predecessor.earlyStart + dependency.lag);
    case "FF":
      return successor.earlyFinish - (predecessor.earlyFinish + dependency.lag);
    case "SF":
      return successor.earlyFinish - (predecessor.earlyStart + dependency.lag);
    case "FS":
    default:
      return successor.earlyStart - (predecessor.earlyFinish + dependency.lag);
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

function toScheduledTask(
  task: WorkingTask,
  projectStartDate?: string,
  calendar: ProjectCalendar = DEFAULT_CALENDAR,
): ScheduledTask {
  return {
    ...task,
    earlyStartDate: projectStartDate
      ? addWorkingDaysIso(projectStartDate, task.earlyStart, calendar)
      : undefined,
    earlyFinishDate: projectStartDate
      ? addWorkingDaysIso(projectStartDate, task.earlyFinish, calendar)
      : undefined,
    lateStartDate: projectStartDate
      ? addWorkingDaysIso(projectStartDate, task.lateStart, calendar)
      : undefined,
    lateFinishDate: projectStartDate
      ? addWorkingDaysIso(projectStartDate, task.lateFinish, calendar)
      : undefined,
  };
}

function isWorkingDay(d: Date, cal: ProjectCalendar): boolean {
  // JS getUTCDay(): 0=Sun..6=Sat. Bitmask: bit0=Mon..bit5=Sat,bit6=Sun.
  const dow = d.getUTCDay();
  const bitIdx = (dow + 6) % 7;
  if (!(cal.workDays & (1 << bitIdx))) return false;
  const iso = d.toISOString().slice(0, 10);
  return !cal.holidays.includes(iso);
}

function addWorkingDaysIso(date: string, offset: number, cal: ProjectCalendar): string {
  const base = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return date;
  if (offset <= 0) return base.toISOString().slice(0, 10);
  let remaining = offset;
  while (remaining > 0) {
    base.setUTCDate(base.getUTCDate() + 1);
    if (isWorkingDay(base, cal)) remaining--;
  }
  return base.toISOString().slice(0, 10);
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
