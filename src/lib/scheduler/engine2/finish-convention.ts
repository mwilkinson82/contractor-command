/**
 * Phase 3.8 — finish-date convention normalization adapter.
 *
 * Reporting-only helper. Converts an engine2 finish ISO date (which uses
 * the "inclusive last worked instant" convention — i.e. the last worked
 * day itself) into the legacy "exclusive end" convention — the NEXT
 * working day after the last worked day.
 *
 * Why this exists:
 *   See ARCHITECTURE.md §38 (root cause) and §39 (normalization). The two
 *   engines agree on the underlying CPM math; they only disagree on how
 *   the finish moment is rendered as a calendar date. This adapter lets
 *   the dry-run comparison surface a convention-adjusted view alongside
 *   the raw values without changing either engine's internal date math.
 *
 * Strict scope:
 *   - Reporting / comparison only. NEVER mutate schedule state.
 *   - Engine2 internal CPM math is unchanged (`engine2.calculateCpm` still
 *     produces last-work-moment instants).
 *   - Legacy output is unchanged.
 *   - Not consumed by any production code path. Only the dry-run summary
 *     calls into this module.
 */

import type { ProjectCalendar, Schedule } from "../types";

const DEFAULT_WORKWEEK_BITMASK = 31; // Mon–Fri

function pickComparisonCalendar(schedule: Schedule): ProjectCalendar {
  const projectCal = schedule.calendar;
  if (projectCal && typeof projectCal.workDays === "number") {
    return {
      workDays: projectCal.workDays,
      holidays: Array.isArray(projectCal.holidays) ? projectCal.holidays : [],
    };
  }
  // Per Phase 3.1 eligibility we only normalize for schedules that have
  // exactly one calendar — fall back to the named default if present.
  const named = Array.isArray(schedule.calendars) ? schedule.calendars : [];
  const def = named.find((c) => c.isDefault) ?? named[0];
  if (def) {
    return {
      workDays: typeof def.workDays === "number" ? def.workDays : DEFAULT_WORKWEEK_BITMASK,
      holidays: Array.isArray(def.holidays) ? def.holidays : [],
    };
  }
  return { workDays: DEFAULT_WORKWEEK_BITMASK, holidays: [] };
}

/** Mirror of the legacy engine's private `isWorkingDay` helper. */
function isWorkingDay(d: Date, cal: ProjectCalendar): boolean {
  const dow = d.getUTCDay();
  const bitIdx = (dow + 6) % 7;
  if (!(cal.workDays & (1 << bitIdx))) return false;
  const iso = d.toISOString().slice(0, 10);
  return !cal.holidays.includes(iso);
}

/**
 * Step from an ISO date to the next working day in the supplied calendar.
 * If `iso` itself is a working day, the result is the FIRST working day
 * strictly after it — this is the legacy "exclusive end" convention.
 *
 * Capped at 365 calendar-day steps; calendars with no working days return
 * the input unchanged rather than looping forever.
 */
export function nextWorkingDayIso(iso: string, calendar: ProjectCalendar): string {
  const base = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return iso;
  for (let step = 1; step <= 365; step++) {
    const d = new Date(base.getTime());
    d.setUTCDate(d.getUTCDate() + step);
    if (isWorkingDay(d, calendar)) return d.toISOString().slice(0, 10);
  }
  return iso;
}

/**
 * Normalize an engine2 finish ISO date into the legacy exclusive-boundary
 * convention. Returns null when the input is not a usable ISO date.
 */
export function normalizeEngine2FinishIso(
  engine2Iso: string | null | undefined,
  schedule: Schedule,
): string | null {
  if (typeof engine2Iso !== "string" || engine2Iso.length === 0) return null;
  const cal = pickComparisonCalendar(schedule);
  return nextWorkingDayIso(engine2Iso, cal);
}

/**
 * Classify a finish-date pair as a convention-only mismatch (engine2's
 * last-work-moment maps to legacy's exclusive boundary) vs a true
 * mismatch (numbers disagree even after normalization). Pure helper.
 */
export function classifyFinishDateMismatch(
  legacyIso: string | null | undefined,
  engine2Iso: string | null | undefined,
  schedule: Schedule,
): "match" | "convention-only" | "true-mismatch" {
  if (typeof legacyIso !== "string" || typeof engine2Iso !== "string") {
    // Cannot judge — be conservative.
    return legacyIso === engine2Iso ? "match" : "true-mismatch";
  }
  if (legacyIso === engine2Iso) return "match";
  const normalized = normalizeEngine2FinishIso(engine2Iso, schedule);
  if (normalized && normalized === legacyIso) return "convention-only";
  return "true-mismatch";
}
