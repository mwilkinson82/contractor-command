export type TaskId = string;

export type DependencyType = "FS" | "SS" | "FF" | "SF";

export interface Task {
  id: TaskId;
  name: string;
  duration: number;
  description?: string;
  wbs?: string;
  percentComplete?: number;
  /** Planned total cost for this activity (Budget at Completion contribution). */
  budgetCost?: number;
  /** Actual cost incurred to date (AC for EVM). */
  actualCost?: number;
  /** Optional resource / crew label (e.g. "Carpentry", "Crew A"). */
  resourceName?: string;
  /** Units of that resource consumed per working day across the activity duration. */
  resourceUnitsPerDay?: number;
}

export interface Dependency {
  id?: string;
  from: TaskId;
  to: TaskId;
  type?: DependencyType;
  lag?: number;
}

export interface ProjectCalendar {
  /** Bitmask: bit0=Mon, bit1=Tue, … bit5=Sat, bit6=Sun. Default 31 = Mon–Fri. */
  workDays: number;
  /** ISO YYYY-MM-DD holidays (non-working days). */
  holidays: string[];
}

export const DEFAULT_CALENDAR: ProjectCalendar = { workDays: 31, holidays: [] };

export type AnnotationKind = "milestone" | "callout";

export interface Annotation {
  id: string;
  kind: AnnotationKind;
  /** ISO YYYY-MM-DD anchor date. */
  date: string;
  label: string;
  /** Optional task association (for context only — date drives placement). */
  taskId?: string;
}

export interface Schedule {
  id?: string;
  name: string;
  projectStartDate?: string;
  /** As-of date for progress updates (status / data date). */
  dataDate?: string;
  calendar?: ProjectCalendar;
  tasks: Task[];
  dependencies: Dependency[];
  annotations?: Annotation[];
}

export interface ScheduledTask extends Task {
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  totalFloat: number;
  freeFloat: number;
  isCritical: boolean;
  earlyStartDate?: string;
  earlyFinishDate?: string;
  lateStartDate?: string;
  lateFinishDate?: string;
}

export interface ScheduledDependency extends Required<
  Pick<Dependency, "from" | "to" | "type" | "lag">
> {
  id: string;
  isDriving: boolean;
}

export interface ScheduleResult {
  scheduleId?: string;
  name: string;
  projectStartDate?: string;
  projectDuration: number;
  projectFinishDate?: string;
  tasks: ScheduledTask[];
  dependencies: ScheduledDependency[];
  criticalPath: TaskId[];
  diagnostics: string[];
}

export interface SchedulerOptions {
  criticalFloatTolerance?: number;
}
