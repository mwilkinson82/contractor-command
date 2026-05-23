/**
 * Unit tests for the Phase 1.0 WorkClock primitives.
 *
 * Covers:
 *   - isWorking on workdays / weekends / holidays
 *   - nextWorkInstant / prevWorkInstant snapping over weekends and holidays
 *   - addWork forward and backward, including day rollover and holiday skip
 *   - diffWork over weekends
 *
 * These tests do NOT touch the existing scheduler engine and do NOT cover
 * the 20 P6 acceptance tests — those stay `.todo()` until Phase 1.1+.
 */

import { describe, expect, it } from "vitest";
import { createWholeDayWorkClock, MS_PER_MIN } from "../engine2/work-clock";

// 2025-01-06 is a Monday (UTC).
const MON_2025_01_06 = Date.UTC(2025, 0, 6, 0, 0, 0);
const TUE_2025_01_07 = Date.UTC(2025, 0, 7, 0, 0, 0);
const SAT_2025_01_11 = Date.UTC(2025, 0, 11, 0, 0, 0);
const MON_2025_01_13 = Date.UTC(2025, 0, 13, 0, 0, 0);

function basicClock() {
  return createWholeDayWorkClock({
    id: "cal-default",
    name: "Mon-Fri 8h",
    // Mon-Fri
    workDays: 0b0111110,
    holidays: ["2025-01-07"],
    hoursPerDay: 8,
  });
}

describe("WorkClock — whole-day", () => {
  it("isWorking: true at 09:00 Monday, false on Saturday, false on holiday", () => {
    const c = basicClock();
    expect(c.isWorking(MON_2025_01_06 + 9 * 60 * MS_PER_MIN)).toBe(true);
    expect(c.isWorking(SAT_2025_01_11 + 9 * 60 * MS_PER_MIN)).toBe(false);
    expect(c.isWorking(TUE_2025_01_07 + 9 * 60 * MS_PER_MIN)).toBe(false); // holiday
  });

  it("isWorking: false outside the 8h window on a workday", () => {
    const c = basicClock();
    // 08:00 == start of next-day window for hoursPerDay=8 (window is [00:00, 08:00))
    expect(c.isWorking(MON_2025_01_06 + 7 * 60 * MS_PER_MIN)).toBe(true);
    expect(c.isWorking(MON_2025_01_06 + 8 * 60 * MS_PER_MIN)).toBe(false);
  });

  it("nextWorkInstant: snaps Saturday → Monday start, Monday holiday → Tuesday", () => {
    const c = basicClock();
    expect(c.nextWorkInstant(SAT_2025_01_11)).toBe(MON_2025_01_13);
    // 2025-01-06 is a Monday workday → Tuesday is the holiday → next is Wed 2025-01-08
    expect(c.nextWorkInstant(TUE_2025_01_07)).toBe(Date.UTC(2025, 0, 8));
  });

  it("nextWorkInstant: returns instant unchanged when already working", () => {
    const c = basicClock();
    const inWork = MON_2025_01_06 + 3 * 60 * MS_PER_MIN;
    expect(c.nextWorkInstant(inWork)).toBe(inWork);
  });

  it("prevWorkInstant: snaps Sunday → Friday end-of-window", () => {
    const c = basicClock();
    const sun = Date.UTC(2025, 0, 12);
    const fri = Date.UTC(2025, 0, 10);
    expect(c.prevWorkInstant(sun)).toBe(fri + 8 * 60 * MS_PER_MIN - MS_PER_MIN);
  });

  it("addWork: 1 minute inside the window is a plain +60s", () => {
    const c = basicClock();
    const start = MON_2025_01_06 + 3 * 60 * MS_PER_MIN;
    expect(c.addWork(start, 1)).toBe(start + MS_PER_MIN);
  });

  it("addWork: rolls into next workday when window is exhausted", () => {
    const c = basicClock();
    // Start at Mon 07:00, window ends at 08:00 → 60 min left.
    // Adding 61 min should skip Tue (holiday) and land Wed 00:01.
    const start = MON_2025_01_06 + 7 * 60 * MS_PER_MIN;
    const out = c.addWork(start, 61);
    expect(out).toBe(Date.UTC(2025, 0, 8, 0, 1));
  });

  it("addWork: skipping a weekend lands on Monday", () => {
    const c = basicClock();
    // Fri 07:30 + 60 min → 30 min Fri, then 30 min Mon at 00:30.
    const fri = Date.UTC(2025, 0, 10, 7, 30);
    const out = c.addWork(fri, 60);
    expect(out).toBe(MON_2025_01_13 + 30 * MS_PER_MIN);
  });

  it("addWork: 8h * 5 = one work week → next Monday start", () => {
    const c = basicClock();
    // Start Mon 00:00, add 5 full workdays' worth of minutes.
    // Skips holiday Tuesday so we cross a 6th calendar day.
    const out = c.addWork(MON_2025_01_06, 5 * 8 * 60);
    // 5 workdays from Mon (skipping Tue holiday): Mon, Wed, Thu, Fri, Mon-13 → end of Mon-13 window
    // Result: start of next workday after consuming Mon-13's window = Tue 2025-01-14 00:00
    expect(out).toBe(Date.UTC(2025, 0, 14));
  });

  it("addWork: negative minutes walks backward across a weekend", () => {
    const c = basicClock();
    // Mon 00:30 minus 60 min → 30 min Mon, then 30 min back into Fri end = Fri 07:30
    const mon = MON_2025_01_13 + 30 * MS_PER_MIN;
    const out = c.addWork(mon, -60);
    expect(out).toBe(Date.UTC(2025, 0, 10, 7, 30));
  });

  it("diffWork: across a weekend equals two full workdays in minutes", () => {
    const c = basicClock();
    // Fri 00:00 to Tue 00:00 (skipping Sat, Sun) = 2 workdays = 2 * 8 * 60 = 960 min
    // But our holiday is Tue 2025-01-07; use a non-holiday week.
    const fri = Date.UTC(2025, 0, 10);
    const tue = Date.UTC(2025, 0, 14);
    expect(c.diffWork(fri, tue)).toBe(2 * 8 * 60);
  });

  it("diffWork: is signed", () => {
    const c = basicClock();
    const fri = Date.UTC(2025, 0, 10);
    const tue = Date.UTC(2025, 0, 14);
    expect(c.diffWork(tue, fri)).toBe(-2 * 8 * 60);
  });
});
