/**
 * engine2 — Phase 2.4 legacy bridge.
 *
 * Converts a legacy `Schedule` (offset-from-anchor model used by the
 * production engine in `src/lib/scheduler/engine.ts`) into a engine2
 * `CpmInput` (absolute-working-time-instant model). The conversion is
 * intentionally lossy in well-understood places — see the limitation
 * notes inline and in §24 of `ARCHITECTURE.md`.
 *
 * This bridge is internal-only. It is used by the comparison harness and
 * by any internal/dev caller that opts into engine2 via the feature flag.
 * Calling it does NOT change legacy behavior.
 */

import type { Schedule } from "../types";
import type {
  CpmInput,
  EngineActivity,
  EngineRelationship,
  Instant,
} from "./types";
import { createWholeDayWorkClock, MS_PER_MIN, type WorkClock } from "./work-clock";

/** Convert legacy workDays bitmask (bit0=Mon..bit5=Sat,bit6=Sun) to engine2 bitmask (bit0=Sun..bit6=Sat). */
function convertWorkDaysMask(legacyMask: number): number {
  let out = 0;
  for (let i = 0; i < 7; i++) {
    if ((legacyMask & (1 << i)) === 0) continue;
    // legacy: 0=Mon..5=Sat,6=Sun → engine2: 1=Mon..6=Sat,0=Sun
    const engine2Bit = (i + 1) % 7;
    out |= 1 << engine2Bit;
  }
  return out;
}

function isoDateToInstant(iso: string): Instant {
  const t = Date.parse(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(t)) throw new Error(`legacy-bridge: invalid ISO date "${iso}"`);
  return t;
}

const HOURS_PER_DAY = 8;
const DEFAULT_CALENDAR_ID = "__legacy_default__";

export interface BridgeResult {
  input: CpmInput;
  /** Calendars created during conversion, keyed by id. */
  calendars: Map<string, WorkClock>;
  /** Conversion notes for the comparison report. */
  conversionNotes: string[];
}

/**
 * Build a engine2 CpmInput from a legacy schedule.
 *
 * Limitations (documented for the comparison report):
 *   - Whole-day calendar only (matches what the legacy engine actually uses).
 *   - All durations interpreted as working days × 8h, in minutes.
 *   - All lag values interpreted as project-default working days, in minutes,
 *     with `lagCalendarBasis = "project"`.
 *   - Per-activity calendars are passed through by name but use the same
 *     whole-day shape — exception calendars are not synthesized here.
 *   - Constraints: only `startNoEarlierThan` is mapped (→ SNET).
 *   - Actuals: legacy `percentComplete` is preserved on the activity but does
 *     NOT produce `actualStart` / `actualFinish` (legacy stores no actuals).
 *   - Resources / assignments / baselines are not bridged in this pass.
 */
export function bridgeLegacyScheduleToEngine2(
  schedule: Schedule,
): BridgeResult {
  const notes: string[] = [];
  const projectStartIso = schedule.projectStartDate;
  if (!projectStartIso) {
    throw new Error(
      "legacy-bridge: schedule has no projectStartDate; engine2 requires an absolute anchor",
    );
  }
  const projectStart = isoDateToInstant(projectStartIso);
  const dataDate = schedule.dataDate
    ? isoDateToInstant(schedule.dataDate)
    : projectStart;

  // ---- Calendars ----
  const calendars = new Map<string, WorkClock>();
  const defaultLegacy = schedule.calendar ?? { workDays: 31, holidays: [] };
  calendars.set(
    DEFAULT_CALENDAR_ID,
    createWholeDayWorkClock({
      id: DEFAULT_CALENDAR_ID,
      name: "Project Default (bridged)",
      workDays: convertWorkDaysMask(defaultLegacy.workDays),
      holidays: defaultLegacy.holidays,
      hoursPerDay: HOURS_PER_DAY,
    }),
  );

  for (const named of schedule.calendars ?? []) {
    if (calendars.has(named.id)) continue;
    calendars.set(
      named.id,
      createWholeDayWorkClock({
        id: named.id,
        name: named.name,
        workDays: convertWorkDaysMask(named.workDays),
        holidays: named.holidays,
        hoursPerDay: HOURS_PER_DAY,
      }),
    );
  }

  // ---- Activities ----
  const activities: EngineActivity[] = schedule.tasks.map((t) => {
    const calId =
      t.calendarId && calendars.has(t.calendarId) ? t.calendarId : DEFAULT_CALENDAR_ID;
    const durationMinutes = Math.max(0, Math.round(t.duration)) * HOURS_PER_DAY * 60;
    const isMilestone = t.duration === 0;
    const a: EngineActivity = {
      id: t.id,
      name: t.name,
      type: isMilestone ? "milestone-finish" : "task",
      durationType: "fixed-dur-units",
      percentCompleteType: "duration",
      calendarId: calId,
      originalDuration: { minutes: durationMinutes, authoringCalendarId: calId },
      remainingDuration: {
        minutes: Math.round(
          durationMinutes * (1 - Math.max(0, Math.min(100, t.percentComplete ?? 0)) / 100),
        ),
        authoringCalendarId: calId,
      },
      constraints: t.startNoEarlierThan
        ? [
            {
              type: "snet",
              instant: isoDateToInstant(t.startNoEarlierThan),
              calendarId: calId,
            },
          ]
        : [],
      percentComplete: t.percentComplete,
    };
    return a;
  });

  if (schedule.tasks.some((t) => t.percentComplete && t.percentComplete > 0)) {
    notes.push(
      "Legacy percentComplete preserved as a metadata field only; engine2 derives status from actualStart/actualFinish which legacy does not record.",
    );
  }

  // ---- Relationships ----
  const relationships: EngineRelationship[] = (schedule.dependencies ?? []).map(
    (d, i) => {
      const lagDays = Math.round(d.lag ?? 0);
      return {
        id: d.id ?? `${d.from}-${d.type ?? "FS"}-${d.to}-${i}`,
        from: d.from,
        to: d.to,
        type: d.type ?? "FS",
        lag: {
          minutes: lagDays * HOURS_PER_DAY * 60,
          authoringCalendarId: DEFAULT_CALENDAR_ID,
        },
        lagCalendarBasis: "project",
      };
    },
  );

  notes.push(
    "All durations and lags interpreted as 8-hour working days against a whole-day calendar.",
  );
  notes.push(
    "Per-activity calendars use legacy whole-day shape; XER-style exception windows are not synthesized in this bridge.",
  );

  const input: CpmInput = {
    dataDate,
    projectStart,
    projectCalendarId: DEFAULT_CALENDAR_ID,
    calendars,
    activities,
    relationships,
  };

  return { input, calendars, conversionNotes: notes };
}

/** Format a engine2 Instant as ISO YYYY-MM-DD for cross-engine comparison. */
export function instantToIsoDate(instant: Instant): string {
  return new Date(instant).toISOString().slice(0, 10);
}

export const ENGINE2_BRIDGE_HOURS_PER_DAY = HOURS_PER_DAY;
