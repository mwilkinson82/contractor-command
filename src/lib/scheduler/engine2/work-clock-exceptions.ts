/**
 * WorkClock with calendar exceptions — Phase 2.1.
 *
 * Adds an alternative WorkClock factory that supports:
 *   - holidays (whole-day non-working, ISO YYYY-MM-DD).
 *   - explicit non-working exceptions (same as holidays, but typed).
 *   - explicit working exceptions on a normally non-working day.
 *   - per-exception shift windows ([startMin, endMin) within the UTC day)
 *     that override the base hours-per-day window for that day only.
 *
 * Design constraints:
 *   - Conforms to the same `WorkClock` interface used by Phase 1.x. No
 *     downstream engine code needs to change.
 *   - All math is on epoch ms in whole minutes, in UTC. DST never enters.
 *   - Neighboring days are NOT touched by a day's exception. The day
 *     resolver computes windows for *that* day-start only.
 *   - When an exception's windows overlap each other or fall outside
 *     [0, 24h), the factory pushes a `calendar_exception_conflict` info
 *     diagnostic and normalizes them (clamped, merged, sorted).
 *
 * Out of scope (still):
 *   - Per-resource calendar override of activity calendar in CPM.
 *   - Inheritance / "Base Calendar → Project Calendar" stacks (P6 supports
 *     chained inheritance; we accept a flat list of exceptions only).
 */

import type { EngineDiagnostic, Instant } from "./types";
import { MS_PER_DAY, MS_PER_MIN, type WorkClock } from "./work-clock";

/** Calendar-diagnostic codes emitted by the engine2 calendar subsystem. */
export const CALENDAR_DIAGNOSTIC_CODES = {
  UNSUPPORTED_SHIFT: "unsupported_calendar_shift",
  UNSUPPORTED_HOURS_PER_DAY: "unsupported_calendar_hours_per_day",
  EXCEPTION_APPLIED: "calendar_exception_applied",
  EXCEPTION_CONFLICT: "calendar_exception_conflict",
  REFERENCE_MISSING: "calendar_reference_missing",
  SHIFT_PRESERVED_ONLY: "calendar_shift_preserved_only",
} as const;

export interface WorkWindow {
  /** Minutes from UTC 00:00 of the day, inclusive. 0..1440. */
  startMinuteOfDay: number;
  /** Minutes from UTC 00:00 of the day, exclusive. 0..1440. */
  endMinuteOfDay: number;
}

export type CalendarExceptionKind = "non-working" | "working";

export interface CalendarException {
  /** ISO YYYY-MM-DD (UTC day). */
  date: string;
  kind: CalendarExceptionKind;
  /**
   * Only meaningful when kind === "working". When omitted, the engine uses a
   * single window of [0, hoursPerDay*60). Multiple windows model split
   * shifts (e.g. morning + afternoon with a lunch gap).
   */
  windows?: WorkWindow[];
}

export interface ExceptionWorkClockOptions {
  id: string;
  name: string;
  /** Bitmask: bit 0=Sun..bit 6=Sat. Default Mon-Fri = 0b0111110 = 62. */
  workDays?: number;
  /** ISO YYYY-MM-DD holidays (UTC). Equivalent to non-working exceptions. */
  holidays?: readonly string[];
  /** Per-date exceptions. Take precedence over holidays/workDays. */
  exceptions?: readonly CalendarException[];
  /** Base hours-per-day for non-exception workdays. Default 8. */
  hoursPerDay?: number;
  /** Optional sink for diagnostics emitted while normalizing exception data. */
  diagnostics?: EngineDiagnostic[];
}

interface NormalizedException {
  kind: CalendarExceptionKind;
  windows: WorkWindow[]; // for non-working this is []
}

function utcDow(instant: Instant): number {
  return ((Math.floor(instant / MS_PER_DAY) % 7) + 7 + 4) % 7;
}
function utcDayStart(instant: Instant): Instant {
  return Math.floor(instant / MS_PER_DAY) * MS_PER_DAY;
}
function isoUtcDay(instant: Instant): string {
  return new Date(utcDayStart(instant)).toISOString().slice(0, 10);
}

function normalizeWindows(
  raw: readonly WorkWindow[],
  ctx: { calId: string; calName: string; date: string },
  diagnostics?: EngineDiagnostic[],
): WorkWindow[] {
  // Clamp, drop empties, sort, merge overlaps. Report conflicts once.
  let conflict = false;
  const clamped: WorkWindow[] = [];
  for (const w of raw) {
    let s = Math.max(0, Math.min(1440, Math.floor(w.startMinuteOfDay)));
    let e = Math.max(0, Math.min(1440, Math.floor(w.endMinuteOfDay)));
    if (e <= s) {
      conflict = true;
      continue;
    }
    if (s !== w.startMinuteOfDay || e !== w.endMinuteOfDay) conflict = true;
    clamped.push({ startMinuteOfDay: s, endMinuteOfDay: e });
  }
  clamped.sort((a, b) => a.startMinuteOfDay - b.startMinuteOfDay);
  const merged: WorkWindow[] = [];
  for (const w of clamped) {
    const last = merged[merged.length - 1];
    if (last && w.startMinuteOfDay < last.endMinuteOfDay) {
      conflict = true;
      last.endMinuteOfDay = Math.max(last.endMinuteOfDay, w.endMinuteOfDay);
    } else if (last && w.startMinuteOfDay === last.endMinuteOfDay) {
      // touching but not overlapping → merge silently (no conflict).
      last.endMinuteOfDay = w.endMinuteOfDay;
    } else {
      merged.push({ ...w });
    }
  }
  if (conflict && diagnostics) {
    diagnostics.push({
      severity: "info",
      code: CALENDAR_DIAGNOSTIC_CODES.EXCEPTION_CONFLICT,
      message: `Calendar "${ctx.calName}" (${ctx.calId}) exception on ${ctx.date}: windows were clamped/merged due to overlap or out-of-range values.`,
    });
  }
  return merged;
}

/**
 * Build a WorkClock that honors holiday + working/non-working exceptions and
 * per-day shift windows. Falls back to base hours-per-day for normal days.
 */
export function createExceptionWorkClock(
  opts: ExceptionWorkClockOptions,
): WorkClock {
  const workDays = opts.workDays ?? 0b0111110;
  const hoursPerDay = opts.hoursPerDay ?? 8;
  const baseWindowEndMin = hoursPerDay * 60;
  const diagnostics = opts.diagnostics;

  const exceptions = new Map<string, NormalizedException>();

  // Holidays → non-working exceptions (only if not already overridden).
  for (const h of opts.holidays ?? []) {
    exceptions.set(h, { kind: "non-working", windows: [] });
  }

  for (const ex of opts.exceptions ?? []) {
    if (ex.kind === "non-working") {
      exceptions.set(ex.date, { kind: "non-working", windows: [] });
      if (diagnostics) {
        diagnostics.push({
          severity: "info",
          code: CALENDAR_DIAGNOSTIC_CODES.EXCEPTION_APPLIED,
          message: `Calendar "${opts.name}" (${opts.id}) marks ${ex.date} as non-working.`,
        });
      }
      continue;
    }
    // working exception
    const windows = ex.windows && ex.windows.length
      ? normalizeWindows(
          ex.windows,
          { calId: opts.id, calName: opts.name, date: ex.date },
          diagnostics,
        )
      : [{ startMinuteOfDay: 0, endMinuteOfDay: baseWindowEndMin }];
    if (windows.length === 0) {
      // All windows were invalid → fall back to a no-op exception (use base
      // pattern). Conflict already reported.
      continue;
    }
    exceptions.set(ex.date, { kind: "working", windows });
    if (diagnostics) {
      diagnostics.push({
        severity: "info",
        code: CALENDAR_DIAGNOSTIC_CODES.EXCEPTION_APPLIED,
        message: `Calendar "${opts.name}" (${opts.id}) applies ${windows.length} working window(s) on ${ex.date}.`,
      });
    }
  }

  const baseWindowsForDay = (dayStart: Instant): WorkWindow[] => {
    const dow = utcDow(dayStart);
    if ((workDays & (1 << dow)) === 0) return [];
    return [{ startMinuteOfDay: 0, endMinuteOfDay: baseWindowEndMin }];
  };

  const getDayWindows = (dayStart: Instant): WorkWindow[] => {
    const ex = exceptions.get(isoUtcDay(dayStart));
    if (!ex) return baseWindowsForDay(dayStart);
    return ex.windows;
  };

  const dayHasWork = (dayStart: Instant): boolean =>
    getDayWindows(dayStart).length > 0;

  const isWorking = (instant: Instant): boolean => {
    const ds = utcDayStart(instant);
    const offMin = (instant - ds) / MS_PER_MIN;
    for (const w of getDayWindows(ds)) {
      if (offMin >= w.startMinuteOfDay && offMin < w.endMinuteOfDay) return true;
    }
    return false;
  };

  const nextWorkInstant = (instant: Instant): Instant => {
    let ds = utcDayStart(instant);
    // Try the current day first.
    const off = instant - ds;
    for (const w of getDayWindows(ds)) {
      const wStart = ds + w.startMinuteOfDay * MS_PER_MIN;
      const wEnd = ds + w.endMinuteOfDay * MS_PER_MIN;
      if (instant < wStart) return wStart;
      if (instant >= wStart && off < w.endMinuteOfDay * MS_PER_MIN) {
        return instant; // already in a window
      }
      if (instant >= wEnd) continue;
    }
    ds += MS_PER_DAY;
    for (let i = 0; i < 366 * 8; i++) {
      const wins = getDayWindows(ds);
      if (wins.length > 0) return ds + wins[0].startMinuteOfDay * MS_PER_MIN;
      ds += MS_PER_DAY;
    }
    throw new Error("ExceptionWorkClock.nextWorkInstant: no working window found within ~8y");
  };

  const prevWorkInstant = (instant: Instant): Instant => {
    let ds = utcDayStart(instant);
    const off = instant - ds;
    const wins = getDayWindows(ds);
    for (let i = wins.length - 1; i >= 0; i--) {
      const w = wins[i];
      const wStartMs = w.startMinuteOfDay * MS_PER_MIN;
      const wEndMs = w.endMinuteOfDay * MS_PER_MIN;
      if (off >= wEndMs) return ds + wEndMs - MS_PER_MIN;
      if (off >= wStartMs && off < wEndMs) return instant;
    }
    ds -= MS_PER_DAY;
    for (let i = 0; i < 366 * 8; i++) {
      const w = getDayWindows(ds);
      if (w.length > 0) {
        const last = w[w.length - 1];
        return ds + last.endMinuteOfDay * MS_PER_MIN - MS_PER_MIN;
      }
      ds -= MS_PER_DAY;
    }
    throw new Error("ExceptionWorkClock.prevWorkInstant: no working window found within ~8y");
  };

  const addWork = (instant: Instant, minutes: number): Instant => {
    if (minutes === 0) return instant;
    if (!Number.isFinite(minutes) || !Number.isInteger(minutes)) {
      throw new Error("ExceptionWorkClock.addWork: minutes must be a finite integer");
    }

    if (minutes > 0) {
      let cur = nextWorkInstant(instant);
      let remaining = minutes;
      for (let iter = 0; iter < 366 * 50; iter++) {
        const ds = utcDayStart(cur);
        const wins = getDayWindows(ds);
        // Find current window (cur is guaranteed inside one after nextWorkInstant).
        let consumedFromCur = false;
        for (let i = 0; i < wins.length; i++) {
          const w = wins[i];
          const wStart = ds + w.startMinuteOfDay * MS_PER_MIN;
          const wEnd = ds + w.endMinuteOfDay * MS_PER_MIN;
          if (cur < wStart) {
            cur = wStart;
          }
          if (cur >= wStart && cur < wEnd) {
            const availMin = Math.floor((wEnd - cur) / MS_PER_MIN);
            if (remaining <= availMin) return cur + remaining * MS_PER_MIN;
            remaining -= availMin;
            // Jump to next window in this day, if any.
            if (i + 1 < wins.length) {
              cur = ds + wins[i + 1].startMinuteOfDay * MS_PER_MIN;
              consumedFromCur = true;
              break;
            }
            // No more windows today → next workday.
            cur = ds + MS_PER_DAY;
            const next = nextWorkInstant(cur);
            cur = next;
            consumedFromCur = true;
            break;
          }
        }
        if (!consumedFromCur) {
          // Defensive: should not happen, but advance to next day.
          cur = nextWorkInstant(ds + MS_PER_DAY);
        }
      }
      throw new Error("ExceptionWorkClock.addWork: iteration bound exceeded");
    }

    // Backward.
    let cur = instant;
    let remaining = -minutes;
    for (let iter = 0; iter < 366 * 50; iter++) {
      const ds = utcDayStart(cur);
      const wins = getDayWindows(ds);
      // Working minutes available strictly before `cur` within this day.
      let availableMin = 0;
      const perWinAvail: number[] = [];
      for (const w of wins) {
        const wStart = ds + w.startMinuteOfDay * MS_PER_MIN;
        const wEnd = ds + w.endMinuteOfDay * MS_PER_MIN;
        const effEnd = Math.min(cur, wEnd);
        const a = effEnd > wStart ? Math.floor((effEnd - wStart) / MS_PER_MIN) : 0;
        perWinAvail.push(a);
        availableMin += a;
      }
      if (remaining <= availableMin) {
        // Walk windows from last to first, consuming `remaining`.
        let need = remaining;
        for (let i = wins.length - 1; i >= 0; i--) {
          const a = perWinAvail[i];
          if (a <= 0) continue;
          const w = wins[i];
          const wStart = ds + w.startMinuteOfDay * MS_PER_MIN;
          const wEnd = ds + w.endMinuteOfDay * MS_PER_MIN;
          const effEnd = Math.min(cur, wEnd);
          if (need <= a) return effEnd - need * MS_PER_MIN;
          need -= a;
          cur = wStart; // exhaust this window, continue to earlier ones
        }
        // Should not reach here given the guard.
        return cur;
      }
      remaining -= availableMin;
      // Jump to end-of-day for previous workday.
      let prevDs = ds - MS_PER_DAY;
      let guard = 0;
      while (!dayHasWork(prevDs)) {
        prevDs -= MS_PER_DAY;
        if (++guard > 366 * 8) {
          throw new Error("ExceptionWorkClock.addWork: no prior workday within ~8y");
        }
      }
      const pWins = getDayWindows(prevDs);
      cur = prevDs + pWins[pWins.length - 1].endMinuteOfDay * MS_PER_MIN;
    }
    throw new Error("ExceptionWorkClock.addWork: iteration bound exceeded (backward)");
  };

  const diffWork = (a: Instant, b: Instant): number => {
    if (a === b) return 0;
    const sign = b > a ? 1 : -1;
    const lo = sign > 0 ? a : b;
    const hi = sign > 0 ? b : a;
    const start = nextWorkInstant(lo);
    if (start >= hi) return 0;
    let total = 0;
    let ds = utcDayStart(start);
    // First day partial
    for (const w of getDayWindows(ds)) {
      const wStart = ds + w.startMinuteOfDay * MS_PER_MIN;
      const wEnd = ds + w.endMinuteOfDay * MS_PER_MIN;
      const segStart = Math.max(start, wStart);
      const segEnd = Math.min(hi, wEnd);
      if (segEnd > segStart) total += Math.floor((segEnd - segStart) / MS_PER_MIN);
    }
    ds += MS_PER_DAY;
    for (let i = 0; i < 366 * 50 && ds < hi; i++) {
      for (const w of getDayWindows(ds)) {
        const wStart = ds + w.startMinuteOfDay * MS_PER_MIN;
        const wEnd = ds + w.endMinuteOfDay * MS_PER_MIN;
        const segEnd = Math.min(hi, wEnd);
        if (segEnd > wStart) total += Math.floor((segEnd - wStart) / MS_PER_MIN);
      }
      ds += MS_PER_DAY;
    }
    return sign * total;
  };

  return {
    id: opts.id,
    name: opts.name,
    isWorking,
    nextWorkInstant,
    prevWorkInstant,
    addWork,
    diffWork,
    hoursPerDay,
    hoursPerWeek: hoursPerDay * 5,
    hoursPerMonth: hoursPerDay * 20,
    hoursPerYear: hoursPerDay * 250,
  };
}
