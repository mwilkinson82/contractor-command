/**
 * Phase 2.7 — internal-only debug viewer tests.
 *
 * Proves:
 *  - Visibility is hidden when either flag is off (default-off in prod).
 *  - The view-model is deterministic for the same report.
 *  - Engine2 / bridge errors surface on the view-model without breaking it.
 *  - Running the comparison through the dev path does not mutate the
 *    schedule or alter the legacy result.
 *  - The formatted-report export round-trips into the view-model.
 */

import { describe, expect, it } from "vitest";
import {
  buildComparisonViewModel,
  shouldShowEngine2DebugViewer,
  viewModelToJsonBlob,
} from "../engine2/debug-viewer";
import { compareEnginesOnSchedule, formatComparisonReport } from "../engine2";
import { commercialFitOutSample } from "../sample";
import { calculateScheduleWithEngine2Comparison } from "../compare";
import type { Schedule } from "../types";

function snap(s: Schedule): string {
  return JSON.stringify(s);
}

describe("Phase 2.7 — debug viewer visibility", () => {
  it("hidden when both flags off", () => {
    expect(
      shouldShowEngine2DebugViewer({ comparisonEnabled: false, devMode: false }),
    ).toBe(false);
  });
  it("hidden when only comparison is on (no dev mode)", () => {
    expect(
      shouldShowEngine2DebugViewer({ comparisonEnabled: true, devMode: false }),
    ).toBe(false);
  });
  it("hidden when only dev mode is on (no comparison)", () => {
    expect(
      shouldShowEngine2DebugViewer({ comparisonEnabled: false, devMode: true }),
    ).toBe(false);
  });
  it("shown only when both flags on", () => {
    expect(
      shouldShowEngine2DebugViewer({ comparisonEnabled: true, devMode: true }),
    ).toBe(true);
  });
  it("explicit override always hides", () => {
    expect(
      shouldShowEngine2DebugViewer({
        comparisonEnabled: true,
        devMode: true,
        explicitlyDisabled: true,
      }),
    ).toBe(false);
  });
});

describe("Phase 2.7 — comparison view-model", () => {
  it("is deterministic for the same input", () => {
    const sample = commercialFitOutSample();
    const before = snap(sample);
    const r1 = compareEnginesOnSchedule(sample, { treatFloatAsLimitation: true }).report;
    const r2 = compareEnginesOnSchedule(sample, { treatFloatAsLimitation: true }).report;
    expect(snap(sample)).toBe(before); // no mutation

    const vm1 = buildComparisonViewModel(r1);
    const vm2 = buildComparisonViewModel(r2);

    expect(vm2.scheduleName).toBe(vm1.scheduleName);
    expect(vm2.verdict).toBe(vm1.verdict);
    expect(vm2.activityCount).toEqual(vm1.activityCount);
    expect(vm2.relationshipCount).toEqual(vm1.relationshipCount);
    expect(vm2.exactDateMatches).toBe(vm1.exactDateMatches);
    expect(vm2.mismatchCount).toBe(vm1.mismatchCount);
    expect(vm2.classificationSummary).toEqual(vm1.classificationSummary);
    expect(vm2.categorySummary).toEqual(vm1.categorySummary);
    expect(vm2.topDifferences.length).toBe(vm1.topDifferences.length);
    expect(vm2.allDifferences.length).toBe(vm1.allDifferences.length);
  });

  it("renders required fields and a formatted report", () => {
    const r = compareEnginesOnSchedule(commercialFitOutSample(), {
      treatFloatAsLimitation: true,
    }).report;
    const vm = buildComparisonViewModel(r);

    expect(vm.scheduleName.length).toBeGreaterThan(0);
    expect(vm.legacyEngineVersion).toBe("legacy-1.x");
    expect(vm.engine2Version.length).toBeGreaterThan(0);
    expect(["clean", "expected-differences", "investigate"]).toContain(vm.verdict);
    expect(vm.activityCount.legacy).toBeGreaterThan(0);
    expect(vm.formattedReport).toBe(formatComparisonReport(r));

    for (const row of vm.allDifferences) {
      expect(typeof row.id).toBe("string");
      expect(typeof row.legacyValue).toBe("string");
      expect(typeof row.engine2Value).toBe("string");
      expect(["high", "medium", "low"]).toContain(row.severity);
    }

    const blob = viewModelToJsonBlob(vm);
    expect(blob.length).toBeGreaterThan(0);
    const parsed = JSON.parse(blob);
    expect(parsed.verdict).toBe(vm.verdict);
  });

  it("surfaces engine2 errors on the view-model without breaking it", () => {
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
    const vm = buildComparisonViewModel(run.report);

    expect(vm.engine2Error).toBeDefined();
    // Legacy still produced activities — the report and viewer keep working.
    expect(vm.activityCount.legacy).toBe(ok.tasks.length);
    expect(vm.formattedReport).toContain("engine2 ERROR");
  });
});

describe("Phase 2.7 — dev path preserves legacy authority", () => {
  it("calculateScheduleWithEngine2Comparison returns legacy result; flag-off returns no report", () => {
    const sample = commercialFitOutSample();
    const before = snap(sample);
    const offRun = calculateScheduleWithEngine2Comparison(sample);
    expect(offRun.engine2Comparison).toBeUndefined();
    expect(snap(sample)).toBe(before);

    const captured: string[] = [];
    const onRun = calculateScheduleWithEngine2Comparison(sample, {
      forceComparison: true,
      devReportSink: (text) => captured.push(text),
    });
    expect(onRun.engine2Comparison).toBeDefined();
    expect(captured.length).toBe(1);
    // Legacy results match between the two calls.
    expect(onRun.result.projectFinishDate).toBe(offRun.result.projectFinishDate);
    expect(onRun.result.tasks.length).toBe(offRun.result.tasks.length);
    for (let i = 0; i < offRun.result.tasks.length; i++) {
      expect(onRun.result.tasks[i].earlyStartDate).toBe(
        offRun.result.tasks[i].earlyStartDate,
      );
      expect(onRun.result.tasks[i].isCritical).toBe(
        offRun.result.tasks[i].isCritical,
      );
    }
    expect(snap(sample)).toBe(before);
  });
});
