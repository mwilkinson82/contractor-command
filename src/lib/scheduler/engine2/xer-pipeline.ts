/**
 * engine2 XER → CpmInput pipeline (Phase 1.8)
 *
 * Turns a `XerEngine2ImportResult` into a `CpmInput` so engine2 can
 * actually calculate the imported schedule. This is the second half of
 * the XER reconciliation harness — the first half (`xer-import.ts`)
 * preserves XER semantics, this half maps them into the engine.
 *
 * What this adapter does:
 *  - Builds a `WorkClock` per calendar (whole-day, using preserved
 *    work-day flags + holidays; falls back to Mon-Fri 8h).
 *  - Synthesizes a default project calendar when CALENDAR was empty.
 *  - Computes a sensible `projectStart` (data-date / earliest actual
 *    start / earliest constraint instant / now).
 *  - Forwards diagnostics from the import step so reconciliation can
 *    classify them consistently.
 *
 * What this adapter does NOT do (still deferred):
 *  - It does not execute calendar shifts / hours-per-day variations.
 *  - It does not run leveling automatically.
 *  - It does not fabricate baselines.
 *  - It does not implement Update / Replace / Add-Into behaviors.
 */

import type { EngineDiagnostic, Instant } from "./types";
import type { CpmInput } from "./cpm";
import { createWholeDayWorkClock, type WorkClock } from "./work-clock";
import type { XerCalendarRaw, XerEngine2ImportResult } from "./xer-import";

export interface XerPipelineOptions {
  /** Override project start. Default: data-date / earliest actualStart / earliest constraint / now. */
  projectStart?: Instant;
  /** Override project calendar id. Default: result.defaultCalendarId. */
  projectCalendarId?: string;
  /** Float-path analysis. Forwarded to CpmInput. */
  floatPathCount?: number;
  /** Pass-through extras. */
  criticalFloatToleranceMinutes?: number;
}

export interface XerPipelineResult {
  cpmInput: CpmInput;
  /** Calendars that had to be synthesized because no CALENDAR row defined them. */
  synthesizedCalendarIds: string[];
  /** Forwarded import diagnostics + any synthesis diagnostics. */
  diagnostics: EngineDiagnostic[];
}

/** WorkClock day bitmask: bit 0=Sun..bit 6=Sat. Matches XerCalendarRaw.workDays index. */
const MON_FRI = 0b0111110;

function calendarToWorkClock(c: XerCalendarRaw): WorkClock {
  let mask = 0;
  if (c.workDays) {
    for (let i = 0; i < 7; i++) if (c.workDays[i]) mask |= 1 << i;
  }
  if (mask === 0) mask = MON_FRI; // empty/parse-miss → assume Mon-Fri
  return createWholeDayWorkClock({
    id: c.id,
    name: c.name,
    workDays: mask,
    holidays: c.holidays ?? [],
    hoursPerDay: c.hoursPerDay && c.hoursPerDay > 0 ? c.hoursPerDay : 8,
  });
}

function deriveProjectStart(r: XerEngine2ImportResult): Instant {
  if (r.dataDate) return r.dataDate;
  let earliest: Instant | undefined;
  for (const a of r.activities) {
    const candidates: Array<Instant | undefined> = [
      a.actualStart,
      ...a.constraints.map((c) => c.instant),
    ];
    for (const c of candidates) {
      if (c !== undefined && (earliest === undefined || c < earliest)) earliest = c;
    }
  }
  return earliest ?? Date.UTC(2025, 0, 6); // deterministic fallback (Mon 2025-01-06)
}

export function xerToCpmInput(
  r: XerEngine2ImportResult,
  options: XerPipelineOptions = {},
): XerPipelineResult {
  const diagnostics: EngineDiagnostic[] = [...r.diagnostics];
  const calendars = new Map<string, WorkClock>();
  const synthesizedCalendarIds: string[] = [];

  for (const c of r.calendars) calendars.set(c.id, calendarToWorkClock(c));

  // Ensure every referenced calendar exists. Synthesize Mon-Fri 8h fallbacks.
  const ensureCal = (id: string) => {
    if (calendars.has(id)) return;
    synthesizedCalendarIds.push(id);
    calendars.set(
      id,
      createWholeDayWorkClock({ id, name: `synth:${id}`, workDays: MON_FRI, hoursPerDay: 8 }),
    );
    diagnostics.push({
      severity: "info",
      code: "calendar_synthesized",
      message: `Calendar "${id}" was referenced but absent from CALENDAR; synthesized whole-day Mon-Fri 8h fallback.`,
    });
  };

  ensureCal(r.defaultCalendarId);
  for (const a of r.activities) ensureCal(a.calendarId);
  for (const rel of r.relationships) ensureCal(rel.lag.authoringCalendarId);
  for (const res of r.resources) if (res.calendarId) ensureCal(res.calendarId);

  const projectCalendarId = options.projectCalendarId ?? r.defaultCalendarId;
  ensureCal(projectCalendarId);

  const projectStart = options.projectStart ?? deriveProjectStart(r);
  const dataDate = r.dataDate ?? projectStart;

  const cpmInput: CpmInput = {
    dataDate,
    projectStart,
    projectCalendarId,
    calendars,
    activities: r.activities,
    relationships: r.relationships,
    resources: r.resources.length ? r.resources : undefined,
    roles: r.roles.length ? r.roles : undefined,
    assignments: r.assignments.length ? r.assignments : undefined,
    criticalFloatToleranceMinutes: options.criticalFloatToleranceMinutes,
    floatPathCount: options.floatPathCount,
  };

  return { cpmInput, synthesizedCalendarIds, diagnostics };
}
