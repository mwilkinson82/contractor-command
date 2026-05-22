export type TaskId = string;

export type DependencyType = "FS" | "SS" | "FF" | "SF";

export interface Task {
  id: TaskId;
  name: string;
  duration: number;
  description?: string;
  wbs?: string;
  percentComplete?: number;
}

export interface Dependency {
  id?: string;
  from: TaskId;
  to: TaskId;
  type?: DependencyType;
  lag?: number;
}

export interface Schedule {
  id?: string;
  name: string;
  projectStartDate?: string;
  tasks: Task[];
  dependencies: Dependency[];
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
