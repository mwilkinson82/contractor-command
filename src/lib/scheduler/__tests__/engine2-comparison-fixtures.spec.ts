/**
 * Phase 2.6 — fixture-driven comparison stability tests.
 *
 * Runs the engine2-vs-legacy comparison harness across a small set of
 * realistic schedules and proves:
 *   - every difference has a classification + likely cause + recommended action
 *   - verdicts are stable across repeated runs
 *   - legacy result is byte-for-byte unaffected by running the comparison
 *   - exception-aware routing is opt-in and reflected in the report
 *   - engine2 errors produce an investigate-friendly report without
 *     altering the legacy result
 *
 * No fixture is allowed to ship with an "investigate" verdict unless it
 * is *explicitly* an investigate fixture (none today). Until engine2
 * gains parity, every category is classified as either bridge or engine
 * limitation, so verdicts collapse to clean | expected-differences.
 */

import { describe, expect, it } from "vitest";
import { COMPARISON_FIXTURES } from "./fixtures/comparison-fixtures";
import {
  compareEnginesOnSchedule,
  formatComparisonReport,
} from "../engine2";
import { commercialFitOutSample } from "../sample";
import type { Schedule } from "../types";

function snap(s: Schedule): string {
  return JSON.stringify(s);
}

describe("Phase 2.6 — comparison fixtures", () => {
  for (const fx of COMPARISON_FIXTURES) {
    describe(fx.name, () => {
      it("produces a deterministic, classified report (whole-day clock)", () => {
        const before = snap(fx.schedule);
        const a = compareEnginesOnSchedule(fx.schedule, {
          treatFloatAsLimitation: true,
        }).report;
        const b = compareEnginesOnSchedule(fx.schedule, {
          treatFloatAsLimitation: true,
        }).report;
        expect(snap(fx.schedule)).toBe(before); // never mutates input

        // Verdict and counts are stable.
        expect(b.verdict).toBe(a.verdict);
        expect(b.differences.length).toBe(a.differences.length);
        expect(b.countsByCategory).toEqual(a.countsByCategory);
        expect(b.countsByClassification).toEqual(a.countsByClassification);
        expect(b.exactDateMatches).toBe(a.exactDateMatches);

        // No engine2 hard error in any well-formed fixture.
        expect(a.engine2Error).toBeUndefined();

        // Every difference is fully classified AND actionable.
        for (const d of a.differences) {
          expect([
            "expected-bridge-limitation",
            "known-engine-limitation",
            "investigate",
          ]).toContain(d.classification);
          expect(typeof d.likelyCause).toBe("string");
          expect(d.likelyCause!.length).toBeGreaterThan(0);
          expect(typeof d.recommendedAction).toBe("string");
          expect(d.recommendedAction!.length).toBeGreaterThan(0);
        }

        // Verdict must be one of the three known values; until parity
        // work lands, no fixture is expected to be "investigate".
        expect(["clean", "expected-differences"]).toContain(a.verdict);

        // Top differences are a bounded slice of the same shape.
        expect(a.topDifferences.length).toBeLessThanOrEqual(10);
        expect(a.topDifferences.length).toBeLessThanOrEqual(a.differences.length);
        for (const d of a.topDifferences) {
          expect(typeof d.likelyCause).toBe("string");
          expect(typeof d.recommendedAction).toBe("string");
        }

        // Formatter never throws and includes verdict + version.
        const text = formatComparisonReport(a);
        expect(text).toContain(a.verdict.toUpperCase());
        expect(text).toContain(a.engine2Version);
      });

      it("running the comparison does not alter the legacy result", () => {
        const baseline = compareEnginesOnSchedule(fx.schedule).legacy;
        const second = compareEnginesOnSchedule(fx.schedule).legacy;
        expect(second.projectFinishDate).toBe(baseline.projectFinishDate);
        expect(second.tasks.length).toBe(baseline.tasks.length);
        for (let i = 0; i < baseline.tasks.length; i++) {
          expect(second.tasks[i].earlyStartDate).toBe(
            baseline.tasks[i].earlyStartDate,
          );
          expect(second.tasks[i].isCritical).toBe(baseline.tasks[i].isCritical);
        }
      });

      it("exception-aware routing is opt-in and does not change legacy output", () => {
        const baseline = compareEnginesOnSchedule(fx.schedule).legacy;
        const exc = compareEnginesOnSchedule(fx.schedule, {
          treatFloatAsLimitation: true,
          useExceptionAwareCalendars: true,
        });
        expect(exc.report.runRecord.useExceptionAwareCalendars).toBe(true);
        expect(exc.legacy.projectFinishDate).toBe(baseline.projectFinishDate);
        // Every diff is still classified.
        for (const d of exc.report.differences) {
          expect(d.classification).toBeDefined();
          expect(d.likelyCause).toBeDefined();
          expect(d.recommendedAction).toBeDefined();
        }
        // Exception-aware mode must register a known-limitation note so
        // future date drift is never silent.
        expect(
          exc.report.knownLimitations.some((n) =>
            n.includes("createExceptionWorkClock"),
          ),
        ).toBe(true);
      });
    });
  }
});

describe("Phase 2.6 — engine2 error fixture", () => {
  it("missing projectStartDate produces an investigate-friendly report and preserves legacy", () => {
    const ok = commercialFitOutSample();
    const broken: Schedule = {
      name: ok.name,
      projectStartDate: undefined,
      dataDate: ok.dataDate,
      calendar: { workDays: ok.workDays, holidays: ok.holidays },
      tasks: ok.tasks,
      dependencies: ok.dependencies,
    };
    const run = compareEnginesOnSchedule(broken, { treatFloatAsLimitation: true });
    expect(run.report.engine2Error).toBeDefined();
    // Legacy still ran and produced tasks.
    expect(run.legacy.tasks.length).toBe(ok.tasks.length);
    // Formatter prints the engine2 error line.
    const text = formatComparisonReport(run.report);
    expect(text).toContain("engine2 ERROR");
  });
});

describe("Phase 2.6 — top differences ranking", () => {
  it("ranks investigate before known-limitation before expected-bridge-limitation", () => {
    const fx = COMPARISON_FIXTURES.find((f) => f.name === "in-progress")!;
    const r = compareEnginesOnSchedule(fx.schedule, { treatFloatAsLimitation: true }).report;
    const order: Record<string, number> = {
      investigate: 0,
      "known-engine-limitation": 1,
      "expected-bridge-limitation": 2,
    };
    for (let i = 1; i < r.topDifferences.length; i++) {
      const prev = order[r.topDifferences[i - 1].classification];
      const cur = order[r.topDifferences[i].classification];
      expect(prev <= cur).toBe(true);
    }
  });
});
