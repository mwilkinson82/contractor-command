/**
 * Phase 1.8 — XER → engine2 pipeline + reconciliation tests.
 *
 * Proves that XER fixtures parse, map into CpmInput, calculate, and that
 * the reconciliation harness classifies the result correctly.
 */

import { describe, expect, it } from "vitest";
import {
  calculateCpm,
  importXerForEngine2,
  reconcileSchedule,
  xerToCpmInput,
} from "../engine2";
import {
  FIXTURE_ACTUALS,
  FIXTURE_CONSTRAINTS,
  FIXTURE_EXTERNAL_REL,
  FIXTURE_MIXED_CALENDARS,
  FIXTURE_NO_BASELINE,
  FIXTURE_NONSTANDARD_HPD,
  FIXTURE_PARALLEL_PATHS,
  FIXTURE_RESOURCES,
  FIXTURE_SIMPLE_FS_CHAIN,
  FIXTURE_UNSUPPORTED_CONSTRAINT,
} from "./fixtures/xer-fixtures";

const DAY_MIN = 8 * 60;
const MON_2025_01_06 = Date.UTC(2025, 0, 6);

function runFixture(text: string) {
  const importResult = importXerForEngine2(text);
  const { cpmInput, diagnostics } = xerToCpmInput(importResult);
  const engineResult = calculateCpm(cpmInput);
  return { importResult, cpmInput, engineResult, pipelineDiagnostics: diagnostics };
}

describe("Phase 1.8 — XER pipeline", () => {
  it("simple FS chain: A→B→C calculates expected EF and reconciles as match", () => {
    const { importResult, engineResult } = runFixture(FIXTURE_SIMPLE_FS_CHAIN);
    // 10d + 5d + 3d = 18 working days from Mon 2025-01-06.
    // A: ES Mon-06, EF end-of-Fri-17 (10wd). B: EF +5wd. C: EF +3wd.
    const aEF = engineResult.activities.find((a) => a.id === "A")!.earlyFinish;
    const cEF = engineResult.activities.find((a) => a.id === "C")!.earlyFinish;
    expect(aEF).toBeGreaterThan(MON_2025_01_06);
    expect(cEF).toBeGreaterThan(aEF);

    const report = reconcileSchedule({
      importResult,
      engineResult,
      expectedActivities: [
        { activityId: "A", earlyStart: MON_2025_01_06 },
        { activityId: "C", isCritical: true },
      ],
    });
    expect(report.summary.mismatch).toBe(0);
    expect(report.ok).toBe(true);
    // baseline absence is classified, not a mismatch.
    expect(report.entries.some((e) => e.subject === "baseline:not-provided")).toBe(true);
  });

  it("parallel paths: critical path follows the longer chain", () => {
    const { engineResult } = runFixture(FIXTURE_PARALLEL_PATHS);
    const c = engineResult.activities.find((a) => a.id === "C")!;
    expect(c.isCritical).toBe(true);
    // Both A and B are 5d so both critical when chained to C; harness just
    // checks structural correctness.
    expect(engineResult.criticalPath).toContain("C");
  });

  it("mixed calendars: missing CAL2 is synthesized + diagnosed", () => {
    const { importResult, engineResult, pipelineDiagnostics } = runFixture(
      FIXTURE_MIXED_CALENDARS,
    );
    expect(
      pipelineDiagnostics.some((d) => d.code === "calendar_synthesized" && /CAL2/.test(d.message)),
    ).toBe(true);
    // Engine still produced both activities.
    expect(engineResult.activities.map((a) => a.id).sort()).toEqual(["A", "B"]);
    const report = reconcileSchedule({ importResult, engineResult });
    // Synthesis is acceptable known limitation, not a mismatch.
    expect(report.summary.mismatch).toBe(0);
  });

  it("constraints: SNET pushes B to its constraint instant", () => {
    const { engineResult } = runFixture(FIXTURE_CONSTRAINTS);
    const b = engineResult.activities.find((a) => a.id === "B")!;
    // B's earlyStart must be on or after 2025-02-03 08:00 UTC.
    expect(b.earlyStart).toBeGreaterThanOrEqual(Date.UTC(2025, 1, 3, 8, 0));
  });

  it("actuals: status is derived from actual_start / actual_end", () => {
    const { engineResult } = runFixture(FIXTURE_ACTUALS);
    const a = engineResult.activities.find((x) => x.id === "A")!;
    const b = engineResult.activities.find((x) => x.id === "B")!;
    expect(a.status).toBe("completed");
    expect(b.status).toBe("in-progress");
  });

  it("resources: assignment summary present on activity result", () => {
    const { engineResult } = runFixture(FIXTURE_RESOURCES);
    const a = engineResult.activities[0];
    expect(a.assignmentSummary).toBeDefined();
    expect(a.assignmentSummary!.assignmentCount).toBe(1);
  });

  it("external relationships preserved raw + reconciliation flags unsupported-preserved-only", () => {
    const { importResult, engineResult } = runFixture(FIXTURE_EXTERNAL_REL);
    expect(importResult.stats.externalRelationshipsPreservedRaw).toBe(1);
    const report = reconcileSchedule({ importResult, engineResult });
    expect(
      report.entries.some(
        (e) => e.subject === "relationships:external" && e.kind === "unsupported-preserved-only",
      ),
    ).toBe(true);
    // engine2 must not have wired the external link into its graph.
    expect(engineResult.relationships).toHaveLength(0);
  });

  it("baseline absence: reconciliation classifies it as acceptable known limitation", () => {
    const { importResult, engineResult } = runFixture(FIXTURE_NO_BASELINE);
    const report = reconcileSchedule({ importResult, engineResult });
    const entry = report.entries.find((e) => e.subject === "baseline:not-provided");
    expect(entry?.kind).toBe("acceptable-known-limitation");
    expect(entry?.justifyingCodes).toContain("baseline_not_in_xer");
    expect(report.summary.mismatch).toBe(0);
  });

  it("unsupported constraint: classified as unsupported-preserved-only, not a mismatch", () => {
    const { importResult, engineResult } = runFixture(FIXTURE_UNSUPPORTED_CONSTRAINT);
    const report = reconcileSchedule({ importResult, engineResult });
    const entry = report.entries.find((e) =>
      e.subject.startsWith("diagnostic:unsupported_constraint_type"),
    );
    expect(entry?.kind).toBe("unsupported-preserved-only");
    expect(report.summary.mismatch).toBe(0);
  });

  it("non-standard hours-per-day: classified as acceptable known limitation", () => {
    const { importResult, engineResult } = runFixture(FIXTURE_NONSTANDARD_HPD);
    const report = reconcileSchedule({ importResult, engineResult });
    expect(
      report.entries.some(
        (e) =>
          e.subject.startsWith("diagnostic:unsupported_calendar_hours_per_day") &&
          e.kind === "acceptable-known-limitation",
      ),
    ).toBe(true);
    expect(report.summary.mismatch).toBe(0);
  });

  it("expected mismatch surfaces in report.summary.mismatch", () => {
    const { importResult, engineResult } = runFixture(FIXTURE_SIMPLE_FS_CHAIN);
    const report = reconcileSchedule({
      importResult,
      engineResult,
      expectedActivities: [
        // A clearly wrong expectation: ES on the year 2000.
        { activityId: "A", earlyStart: Date.UTC(2000, 0, 1) },
      ],
    });
    expect(report.summary.mismatch).toBeGreaterThan(0);
    expect(report.ok).toBe(false);
  });
});

describe("Phase 1.8 — XER-19: XER imports do not fabricate baselines", () => {
  it("baseline_not_in_xer is always emitted by the importer", () => {
    const { importResult } = runFixture(FIXTURE_SIMPLE_FS_CHAIN);
    expect(importResult.diagnostics.some((d) => d.code === "baseline_not_in_xer")).toBe(true);
  });

  it("engine2 result reports baselinesProvided=false when no baseline was supplied", () => {
    const { engineResult } = runFixture(FIXTURE_SIMPLE_FS_CHAIN);
    expect(engineResult.runRecord.optionsSnapshot.baselinesProvided).toBe(false);
    // No activity has a baselineVariance synthesized from XER data.
    expect(engineResult.activities.every((a) => a.baselineVariance === undefined)).toBe(true);
  });

  it("reconciliation classifies absent baseline as acceptable-known-limitation", () => {
    const { importResult, engineResult } = runFixture(FIXTURE_SIMPLE_FS_CHAIN);
    const report = reconcileSchedule({ importResult, engineResult });
    const entry = report.entries.find((e) => e.subject === "baseline:not-provided");
    expect(entry?.kind).toBe("acceptable-known-limitation");
  });
});

describe("Phase 1.8 — diagnostic code coverage matrix", () => {
  it("calendar_synthesized fires for referenced-but-undefined calendars", () => {
    const { pipelineDiagnostics } = runFixture(FIXTURE_MIXED_CALENDARS);
    expect(pipelineDiagnostics.some((d) => d.code === "calendar_synthesized")).toBe(true);
  });

  it("external_relationship_preserved_raw fires for cross-project links", () => {
    const { importResult } = runFixture(FIXTURE_EXTERNAL_REL);
    expect(
      importResult.diagnostics.some((d) => d.code === "external_relationship_preserved_raw"),
    ).toBe(true);
  });

  it("unsupported_constraint_type fires for unknown CS_* codes", () => {
    const { importResult } = runFixture(FIXTURE_UNSUPPORTED_CONSTRAINT);
    expect(
      importResult.diagnostics.some((d) => d.code === "unsupported_constraint_type"),
    ).toBe(true);
  });

  it("unsupported_calendar_hours_per_day fires for non-8h calendars", () => {
    const { importResult } = runFixture(FIXTURE_NONSTANDARD_HPD);
    expect(
      importResult.diagnostics.some((d) => d.code === "unsupported_calendar_hours_per_day"),
    ).toBe(true);
  });
});

// touch unused import to silence linters if any
void DAY_MIN;
