import type { ProjectCalendar, Task } from "./types";
import { DEFAULT_CALENDAR } from "./types";

/**
 * Count working days between two ISO dates (exclusive of `from`, inclusive of `to`),
 * honoring the calendar's workDays bitmask and holidays. Negative if `to` < `from`.
 */
export function workingDayOffset(
  fromIso: string,
  toIso: string,
  cal: ProjectCalendar = DEFAULT_CALENDAR,
): number {
  const from = new Date(`${fromIso}T00:00:00.000Z`);
  const to = new Date(`${toIso}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  if (from.getTime() === to.getTime()) return 0;
  const forward = to.getTime() > from.getTime();
  const step = forward ? 1 : -1;
  let count = 0;
  const cursor = new Date(from);
  while (cursor.getTime() !== to.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + step);
    if (isWorkingDay(cursor, cal)) count += step;
  }
  return count;
}

/** Add N working days to an ISO date and return the resulting ISO date. N may be negative. */
export function addWorkingDaysIso(
  fromIso: string,
  offset: number,
  cal: ProjectCalendar = DEFAULT_CALENDAR,
): string {
  const base = new Date(`${fromIso}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return fromIso;
  if (offset === 0) return base.toISOString().slice(0, 10);
  const step = offset > 0 ? 1 : -1;
  let remaining = Math.abs(offset);
  while (remaining > 0) {
    base.setUTCDate(base.getUTCDate() + step);
    if (isWorkingDay(base, cal)) remaining--;
  }
  return base.toISOString().slice(0, 10);
}



function isWorkingDay(d: Date, cal: ProjectCalendar): boolean {
  const dow = d.getUTCDay();
  const bitIdx = (dow + 6) % 7;
  if (!(cal.workDays & (1 << bitIdx))) return false;
  const iso = d.toISOString().slice(0, 10);
  return !cal.holidays.includes(iso);
}

export interface RescheduleResult {
  tasks: Task[];
  projectStartDate: string;
  /** Net days shifted forward (>=0). */
  shiftDays: number;
  summary: { completed: number; inProgress: number; notStarted: number };
}

/**
 * "Reschedule from data date" — standard monthly-update workflow.
 *
 * - Completed activities (percentComplete >= 100): duration → 0 (kept as zero-duration milestones).
 * - In-progress (0 < pc < 100): duration → ceil(orig * (1 - pc/100)); percentComplete reset to 0.
 * - Not-started (pc undefined or 0): unchanged.
 *
 * The project start date is moved to the data date so remaining work begins there.
 * Sequence (predecessor logic) is preserved.
 */
export function rescheduleFromDataDate(
  tasks: Task[],
  dataDateIso: string,
): RescheduleResult {
  let completed = 0;
  let inProgress = 0;
  let notStarted = 0;
  const next: Task[] = tasks.map((t) => {
    const pc = t.percentComplete ?? 0;
    if (pc >= 100) {
      completed++;
      return { ...t, duration: 0, percentComplete: 100 };
    }
    if (pc > 0) {
      inProgress++;
      const remaining = Math.max(1, Math.ceil(t.duration * (1 - pc / 100)));
      return { ...t, duration: remaining, percentComplete: 0 };
    }
    notStarted++;
    return { ...t };
  });
  return {
    tasks: next,
    projectStartDate: dataDateIso,
    shiftDays: 0,
    summary: { completed, inProgress, notStarted },
  };
}
