/**
 * Phase 2.1 — WorkClock exception model tests.
 *
 * Verifies that holiday + working/non-working exceptions + per-day shift
 * windows behave correctly under addWork (forward + backward), diffWork,
 * nextWorkInstant, prevWorkInstant, and that neighboring days are
 * untouched.
 */

import { describe, expect, it } from "vitest";
import {
  CALENDAR_DIAGNOSTIC_CODES,
  createExceptionWorkClock,
} from "../engine2/work-clock-exceptions";
import type { EngineDiagnostic } from "../engine2/types";
import { MS_PER_MIN } from "../engine2/work-clock";

const MON = Date.UTC(2025, 0, 6); // Mon
const TUE = Date.UTC(2025, 0, 7);
const WED = Date.UTC(2025, 0, 8);
const THU = Date.UTC(2025, 0, 9);
const FRI = Date.UTC(2025, 0, 10);
const SAT = Date.UTC(2025, 0, 11);
const NEXT_MON = Date.UTC(2025, 0, 13);

function baseClock(diagnostics?: EngineDiagnostic[]) {
  return createExceptionWorkClock({
    id: "cal-mf",
    name: "Mon-Fri 8h",
    workDays: 0b0111110,
    hoursPerDay: 8,
    holidays: ["2025-01-07"], // Tue holiday
    exceptions: [
      // Working exception on Saturday with two split shifts: 08:00-12:00, 13:00-17:00.
      {
        date: "2025-01-11",
        kind: "working",
        windows: [
          { startMinuteOfDay: 8 * 60, endMinuteOfDay: 12 * 60 },
          { startMinuteOfDay: 13 * 60, endMinuteOfDay: 17 * 60 },
        ],
      },
      // Explicit non-working exception on Wednesday (would otherwise be a workday).
      { date: "2025-01-08", kind: "non-working" },
    ],
    diagnostics,
  });
}

describe("WorkClock exceptions — Phase 2.1", () => {
  it("emits calendar_exception_applied diagnostics for each exception", () => {
    const diags: EngineDiagnostic[] = [];
    baseClock(diags);
    const applied = diags.filter(
      (d) => d.code === CALENDAR_DIAGNOSTIC_CODES.EXCEPTION_APPLIED,
    );
    // Two exceptions: working Sat, non-working Wed.
    expect(applied.length).toBe(2);
  });

  it("isWorking honors holidays, non-working exceptions, and split shift windows", () => {
    const c = baseClock();
    expect(c.isWorking(MON + 3 * 60 * MS_PER_MIN)).toBe(true); // normal Mon
    expect(c.isWorking(TUE + 3 * 60 * MS_PER_MIN)).toBe(false); // holiday
    expect(c.isWorking(WED + 3 * 60 * MS_PER_MIN)).toBe(false); // non-working exception
    expect(c.isWorking(SAT + 9 * 60 * MS_PER_MIN)).toBe(true); // inside first shift
    expect(c.isWorking(SAT + 12 * 60 * MS_PER_MIN + 30 * MS_PER_MIN)).toBe(false); // lunch gap
    expect(c.isWorking(SAT + 14 * 60 * MS_PER_MIN)).toBe(true); // inside second shift
    expect(c.isWorking(SAT + 17 * 60 * MS_PER_MIN)).toBe(false); // after second shift
  });

  it("nextWorkInstant skips holiday and non-working exception", () => {
    const c = baseClock();
    // Tue 00:00 → next work is Thursday (Wed is non-working exception).
    expect(c.nextWorkInstant(TUE)).toBe(THU);
    // Mid-Wed → Thursday.
    expect(c.nextWorkInstant(WED + 5 * 60 * MS_PER_MIN)).toBe(THU);
    // Saturday 06:00 → Saturday 08:00 (working exception).
    expect(c.nextWorkInstant(SAT + 6 * 60 * MS_PER_MIN)).toBe(SAT + 8 * 60 * MS_PER_MIN);
    // Saturday 12:30 (lunch) → Saturday 13:00.
    expect(c.nextWorkInstant(SAT + 12 * 60 * MS_PER_MIN + 30 * MS_PER_MIN)).toBe(
      SAT + 13 * 60 * MS_PER_MIN,
    );
  });

  it("prevWorkInstant respects per-day shift windows", () => {
    const c = baseClock();
    // Sat 12:30 (lunch) → end of first shift = 11:59 Sat.
    expect(c.prevWorkInstant(SAT + 12 * 60 * MS_PER_MIN + 30 * MS_PER_MIN)).toBe(
      SAT + 12 * 60 * MS_PER_MIN - MS_PER_MIN,
    );
    // Wed 05:00 (non-working) → prev workday = Mon end-of-window 07:59.
    expect(c.prevWorkInstant(WED + 5 * 60 * MS_PER_MIN)).toBe(
      MON + 8 * 60 * MS_PER_MIN - MS_PER_MIN,
    );
  });

  it("addWork forward: skips holiday, uses Sat split shift, lands on next-week Mon", () => {
    const c = baseClock();
    // Plan: Mon 00:00 + 8h Mon, 8h Thu (skip Tue/Wed), 8h Fri, 8h Sat (split
    // shifts 4+4), then 1 more min into Mon (skip Sun).
    const minutes = 4 * 8 * 60 + 1;
    const out = c.addWork(MON, minutes);
    expect(out).toBe(NEXT_MON + MS_PER_MIN);
  });

  it("addWork forward: lunch gap on Sat does not count as working time", () => {
    const c = baseClock();
    // Sat 08:00 + 4h should land at 12:00 (end of first shift) and the next
    // minute should jump to 13:00.
    const sat0800 = SAT + 8 * 60 * MS_PER_MIN;
    expect(c.addWork(sat0800, 4 * 60)).toBe(SAT + 12 * 60 * MS_PER_MIN);
    expect(c.addWork(sat0800, 4 * 60 + 1)).toBe(SAT + 13 * 60 * MS_PER_MIN + MS_PER_MIN);
  });

  it("addWork backward: subtracts across holiday + non-working exception correctly", () => {
    const c = baseClock();
    // Start Fri 04:00; remove 12h = 4h Fri + 8h Thu (skip Wed) → Thu 00:00.
    const out = c.addWork(FRI + 4 * 60 * MS_PER_MIN, -12 * 60);
    expect(out).toBe(THU);
  });

  it("addWork: forward then backward is the inverse across exceptions", () => {
    const c = baseClock();
    const start = MON + 30 * MS_PER_MIN; // Mon 00:30 (inside the 8h window)
    const fwd = c.addWork(start, 11 * 60);
    expect(c.addWork(fwd, -11 * 60)).toBe(start);
  });

  it("diffWork counts only working minutes inside shift windows", () => {
    const c = baseClock();
    // Sat full 8h covered by two 4h shifts → 480 min.
    expect(c.diffWork(SAT, SAT + 24 * 60 * MS_PER_MIN)).toBe(480);
    // Tue → Thu spans 0 working minutes Tue (holiday) + 0 Wed (non-working) = 0.
    expect(c.diffWork(TUE, THU)).toBe(0);
  });

  it("does NOT corrupt neighboring days — Mon still has the base 8h window", () => {
    const c = baseClock();
    // Mon 07:59 must still be working; Mon 08:00 must not (hours-per-day=8).
    expect(c.isWorking(MON + 8 * 60 * MS_PER_MIN - MS_PER_MIN)).toBe(true);
    expect(c.isWorking(MON + 8 * 60 * MS_PER_MIN)).toBe(false);
    // Thursday (after Wed non-working) is a normal 8h workday.
    expect(c.diffWork(THU, FRI)).toBe(8 * 60);
  });

  it("normalizes overlapping windows and reports calendar_exception_conflict", () => {
    const diags: EngineDiagnostic[] = [];
    const c = createExceptionWorkClock({
      id: "cal-overlap",
      name: "overlap test",
      workDays: 0b0111110,
      hoursPerDay: 8,
      exceptions: [
        {
          date: "2025-01-11",
          kind: "working",
          windows: [
            { startMinuteOfDay: 8 * 60, endMinuteOfDay: 13 * 60 },
            { startMinuteOfDay: 12 * 60, endMinuteOfDay: 17 * 60 }, // overlaps
          ],
        },
      ],
      diagnostics: diags,
    });
    expect(
      diags.some((d) => d.code === CALENDAR_DIAGNOSTIC_CODES.EXCEPTION_CONFLICT),
    ).toBe(true);
    // Merged window covers full 08:00–17:00 (540 min).
    expect(c.diffWork(SAT, SAT + 24 * 60 * MS_PER_MIN)).toBe(9 * 60);
  });
});
