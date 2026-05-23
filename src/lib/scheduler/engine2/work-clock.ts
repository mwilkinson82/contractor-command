/**
 * WorkClock — calendar-aware working-time arithmetic over absolute UTC instants.
 *
 * Phase 1.0 scope (intentionally narrow but correctly designed):
 *   - Whole-day work calendars (workDays bitmask, Sun=bit 0 .. Sat=bit 6).
 *   - Whole-day holidays (ISO YYYY-MM-DD, UTC).
 *   - Fixed hours-per-day window starting at UTC 00:00.
 *   - NO shifts, NO partial-day exceptions, NO per-resource overrides.
 *
 * All math is on `number` (epoch ms). We never touch `Date` outside of the
 * thin ISO-day helper, so DST is irrelevant to engine arithmetic.
 *
 * Convention: a "working instant" is any moment inside the work window
 * `[dayStart, dayStart + hoursPerDay*60*MIN)` on a workday that is not a
 * holiday. Working math is done in whole minutes.
 */

import type { Instant } from "./types";

export const MS_PER_MIN = 60_000;
export const MS_PER_DAY = 86_400_000;

/** Day-of-week 0..6, Sunday = 0, using UTC. 1970-01-01 was a Thursday. */
function utcDow(instant: Instant): number {
  return ((Math.floor(instant / MS_PER_DAY) % 7) + 7 + 4) % 7;
}

function utcDayStart(instant: Instant): Instant {
  return Math.floor(instant / MS_PER_DAY) * MS_PER_DAY;
}

function isoUtcDay(instant: Instant): string {
  // Safe: we only ever pass day-aligned UTC instants here.
  return new Date(utcDayStart(instant)).toISOString().slice(0, 10);
}

export interface WorkClock {
  readonly id: string;
  readonly name: string;
  isWorking(instant: Instant): boolean;
  nextWorkInstant(instant: Instant): Instant;
  prevWorkInstant(instant: Instant): Instant;
  addWork(instant: Instant, minutes: number): Instant;
  diffWork(a: Instant, b: Instant): number;

  readonly hoursPerDay: number;
  readonly hoursPerWeek: number;
  readonly hoursPerMonth: number;
  readonly hoursPerYear: number;
}

export interface WholeDayWorkClockOptions {
  id: string;
  name: string;
  /** Bitmask: bit 0=Sun, 1=Mon, ..., 6=Sat. Default Mon-Fri = 0b0111110 = 62. */
  workDays?: number;
  /** ISO YYYY-MM-DD list (UTC). */
  holidays?: readonly string[];
  /** Default 8. */
  hoursPerDay?: number;
}

/**
 * Whole-day work calendar implementation. This is the migration target for
 * the data we already have (which is whole-day workdays + holidays).
 */
export function createWholeDayWorkClock(opts: WholeDayWorkClockOptions): WorkClock {
  const workDays = opts.workDays ?? 0b0111110;
  const holidaySet = new Set(opts.holidays ?? []);
  const hoursPerDay = opts.hoursPerDay ?? 8;
  const windowMs = hoursPerDay * 60 * MS_PER_MIN;

  const isWorkDayStart = (dayStart: Instant): boolean => {
    const dow = utcDow(dayStart);
    if ((workDays & (1 << dow)) === 0) return false;
    return !holidaySet.has(isoUtcDay(dayStart));
  };

  const isWorking = (instant: Instant): boolean => {
    const ds = utcDayStart(instant);
    if (!isWorkDayStart(ds)) return false;
    const off = instant - ds;
    return off >= 0 && off < windowMs;
  };

  const nextWorkInstant = (instant: Instant): Instant => {
    let ds = utcDayStart(instant);
    const off = instant - ds;
    if (isWorkDayStart(ds)) {
      if (off < windowMs) return Math.max(instant, ds); // off>=0 always here
    }
    // Move to next day start and walk forward (bounded loop).
    ds += MS_PER_DAY;
    for (let i = 0; i < 366 * 4; i++) {
      if (isWorkDayStart(ds)) return ds;
      ds += MS_PER_DAY;
    }
    throw new Error("WorkClock.nextWorkInstant: no working day found within ~4y");
  };

  const prevWorkInstant = (instant: Instant): Instant => {
    let ds = utcDayStart(instant);
    const off = instant - ds;
    if (isWorkDayStart(ds)) {
      if (off >= windowMs) return ds + windowMs - MS_PER_MIN;
      if (off >= 0) return instant;
    }
    ds -= MS_PER_DAY;
    for (let i = 0; i < 366 * 4; i++) {
      if (isWorkDayStart(ds)) return ds + windowMs - MS_PER_MIN;
      ds -= MS_PER_DAY;
    }
    throw new Error("WorkClock.prevWorkInstant: no working day found within ~4y");
  };

  const addWork = (instant: Instant, minutes: number): Instant => {
    if (minutes === 0) return instant;
    if (!Number.isFinite(minutes) || !Number.isInteger(minutes)) {
      throw new Error("WorkClock.addWork: minutes must be a finite integer");
    }

    if (minutes > 0) {
      let cur = nextWorkInstant(instant);
      let remaining = minutes;
      // Hard upper bound on iteration to avoid runaway in pathological calendars.
      for (let i = 0; i < 366 * 50; i++) {
        const ds = utcDayStart(cur);
        const dayEnd = ds + windowMs;
        const availableMs = dayEnd - cur;
        const availableMin = Math.floor(availableMs / MS_PER_MIN);
        if (remaining <= availableMin) {
          return cur + remaining * MS_PER_MIN;
        }
        remaining -= availableMin;
        cur = nextWorkInstant(ds + MS_PER_DAY);
      }
      throw new Error("WorkClock.addWork: exceeded iteration bound");
    }

    // minutes < 0: walk backward, treating `instant` as a *position* (so that
    // forward and backward are inverses across day-end boundaries, e.g.
    // `addWork(addWork(t, +D), -D) === t` for working-aligned `t`).
    let cur = instant;
    let remaining = -minutes;
    for (let i = 0; i < 366 * 50; i++) {
      const ds = utcDayStart(cur);
      const dayEnd = ds + windowMs;
      // Working minutes available in this day strictly before `cur` (clamped
      // to the day's work window).
      let availableMin = 0;
      if (isWorkDayStart(ds)) {
        const effectiveCur = Math.min(cur, dayEnd);
        availableMin = Math.max(0, Math.floor((effectiveCur - ds) / MS_PER_MIN));
      }
      if (remaining <= availableMin) {
        const effectiveCur = Math.min(cur, dayEnd);
        return effectiveCur - remaining * MS_PER_MIN;
      }
      remaining -= availableMin;
      // Jump to the day-end boundary of the previous workday.
      let prevDs = ds - MS_PER_DAY;
      let guard = 0;
      while (!isWorkDayStart(prevDs)) {
        prevDs -= MS_PER_DAY;
        if (++guard > 366 * 4) {
          throw new Error("WorkClock.addWork: no prior workday found within ~4y");
        }
      }
      cur = prevDs + windowMs;
    }
    throw new Error("WorkClock.addWork: exceeded iteration bound (backward)");

  };

  const diffWork = (a: Instant, b: Instant): number => {
    if (a === b) return 0;
    const sign = b > a ? 1 : -1;
    const lo = sign > 0 ? a : b;
    const hi = sign > 0 ? b : a;

    // Snap into working time at both ends.
    const start = nextWorkInstant(lo);
    if (start >= hi) return 0;
    const end = hi; // we count only working minutes strictly before `hi`.

    let total = 0;
    let ds = utcDayStart(start);
    // First (partial) day:
    if (isWorkDayStart(ds)) {
      const dayEnd = ds + windowMs;
      const segEnd = Math.min(dayEnd, end);
      const segStart = Math.max(start, ds);
      if (segEnd > segStart) total += Math.floor((segEnd - segStart) / MS_PER_MIN);
    }
    ds += MS_PER_DAY;
    for (let i = 0; i < 366 * 50 && ds < end; i++) {
      if (isWorkDayStart(ds)) {
        const dayEnd = ds + windowMs;
        const segEnd = Math.min(dayEnd, end);
        if (segEnd > ds) total += Math.floor((segEnd - ds) / MS_PER_MIN);
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
