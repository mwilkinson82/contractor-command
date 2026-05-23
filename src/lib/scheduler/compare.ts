/**
 * Phase 2.4 — internal-only entry point that runs the legacy engine and,
 * when the comparison flag is on, ALSO runs engine2 and attaches a
 * structured comparison report.
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
  isEngine2ComparisonEnabled,
  type ComparisonReport,
} from "./engine2";

export interface ScheduleResultWithComparison {
  result: ScheduleResult;
  /** Present only when the engine2 comparison flag is enabled AND the run succeeded. */
  engine2Comparison?: ComparisonReport;
  /** If engine2 threw during the comparison run, the legacy result is still returned and this carries the error message. */
  engine2Error?: string;
}

export function calculateScheduleWithEngine2Comparison(
  schedule: Schedule,
  options: SchedulerOptions = {},
): ScheduleResultWithComparison {
  if (!isEngine2ComparisonEnabled()) {
    return { result: calculateSchedule(schedule, options) };
  }
  try {
    const run = compareEnginesOnSchedule(schedule, { treatFloatAsLimitation: true });
    return { result: run.legacy, engine2Comparison: run.report };
  } catch (err) {
    // Comparison must never destabilize the legacy path.
    return {
      result: calculateSchedule(schedule, options),
      engine2Error: err instanceof Error ? err.message : String(err),
    };
  }
}
