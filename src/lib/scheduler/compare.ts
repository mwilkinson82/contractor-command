/**
 * Phase 2.4 — internal-only entry point that runs the legacy engine and,
 * when the comparison flag is on, ALSO runs engine2 and attaches a
 * structured comparison report.
 *
 * Phase 2.5 — when the comparison flag is on, the report is ALSO emitted
 * to a developer-only sink (default: `console.info`) so it shows up in
 * dev test logs without leaking into the production UI. Callers can
 * override the sink for tests or for an internal debug panel.
 *
 * This file is intentionally separate from `index.ts` so importing the
 * package does NOT pull in engine2 by default. It is opt-in: only callers
 * that explicitly import from `@/lib/scheduler/compare` are affected.
 *
 * Legacy `calculateSchedule` is never overwritten. The legacy result is
 * always authoritative; engine2 output is informational only.
 */

import { calculateSchedule } from "./engine";
import type { Schedule, ScheduleResult, SchedulerOptions } from "./types";
import {
  compareEnginesOnSchedule,
  formatComparisonReport,
  isEngine2ComparisonEnabled,
  isEngine2ExceptionClockEnabled,
  type ComparisonReport,
} from "./engine2";

export type DevReportSink = (text: string, report: ComparisonReport) => void;

export interface CalculateScheduleWithComparisonOptions extends SchedulerOptions {
  /**
   * Override the dev-only report sink. Default is `console.info`. Tests
   * pass a no-op or capturing sink; an internal debug panel can pass a
   * function that pushes into local state. The sink is NEVER called when
   * the comparison flag is off.
   */
  devReportSink?: DevReportSink;
  /**
   * Force the comparison on/off regardless of env flag. Used by tests
   * and by internal debug tooling. When omitted, the env flag decides.
   */
  forceComparison?: boolean;
  /**
   * Force exception-aware bridge routing on/off regardless of env flag.
   * Default: env flag.
   */
  forceExceptionAwareCalendars?: boolean;
}

export interface ScheduleResultWithComparison {
  result: ScheduleResult;
  /** Present only when the engine2 comparison flag (or `forceComparison`) is enabled. */
  engine2Comparison?: ComparisonReport;
  /** If engine2 threw during the comparison run, the legacy result is still returned and this carries the error message. */
  engine2Error?: string;
}

export function calculateScheduleWithEngine2Comparison(
  schedule: Schedule,
  options: CalculateScheduleWithComparisonOptions = {},
): ScheduleResultWithComparison {
  const enabled = options.forceComparison ?? isEngine2ComparisonEnabled();
  if (!enabled) {
    return { result: calculateSchedule(schedule, options) };
  }
  try {
    const useExceptions =
      options.forceExceptionAwareCalendars ?? isEngine2ExceptionClockEnabled();
    const run = compareEnginesOnSchedule(schedule, {
      treatFloatAsLimitation: true,
      useExceptionAwareCalendars: useExceptions,
    });
    // Dev-only emission. Never reachable in production unless the flag is
    // explicitly turned on at deploy time.
    const sink: DevReportSink =
      options.devReportSink ??
      ((text) => {
        // eslint-disable-next-line no-console
        console.info(text);
      });
    sink(formatComparisonReport(run.report), run.report);
    return {
      result: run.legacy,
      engine2Comparison: run.report,
      engine2Error: run.report.engine2Error,
    };
  } catch (err) {
    // Comparison must never destabilize the legacy path.
    return {
      result: calculateSchedule(schedule, options),
      engine2Error: err instanceof Error ? err.message : String(err),
    };
  }
}
