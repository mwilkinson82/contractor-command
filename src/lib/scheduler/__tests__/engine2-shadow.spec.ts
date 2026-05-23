/**
 * Phase 2.8 — Engine2 shadow-mode tests.
 *
 * Proves:
 *   - shadow mode is flag-gated (default off → no-op)
 *   - normal users never see reports (shadow returns `ran: false`)
 *   - legacy output remains unchanged even when shadow runs
 *   - evidence logs/export do not mutate schedules
 *   - dual-clock (whole-day + exception-aware) is opt-in
 *   - boring-report detector is centralized and honest
 */

import { describe, expect, it } from "vitest";
import { commercialFitOutSample } from "../sample";
import { calculateSchedule } from "../engine";
import type { Schedule } from "../types";
import { COMPARISON_FIXTURES } from "./fixtures/comparison-fixtures";
import {
  exportEvidenceLogToCsv,
  exportEvidenceLogToJson,
  isBoringReport,
  isEngine2ShadowEnabled,
  runDualCalendarShadow,
  runShadowComparisons,
  summarizeBoringness,
  type ShadowScheduleInput,
} from "../engine2";

function buildScheduleFromSample(): Schedule {
  const s = commercialFitOutSample();
  return {
    name: s.name,
    projectStartDate: s.projectStartDate,
    dataDate: s.dataDate,
    calendar: { workDays: s.workDays, holidays: s.holidays },
    tasks: s.tasks,
    dependencies: s.dependencies,
  };
}

function shadowBatch(): ShadowScheduleInput[] {
  const inputs: ShadowScheduleInput[] = [
    {
      id: "commercial-fit-out",
      label: "Commercial Fit-Out",
      schedule: buildScheduleFromSample(),
      intent: "demo",
    },
  ];
  for (const f of COMPARISON_FIXTURES) {
    inputs.push({
      id: `fixture:${f.name}`,
      label: f.name,
      schedule: f.schedule,
      intent: f.intent,
    });
  }
  return inputs;
}

const fixedClock = { now: () => "2026-05-23T00:00:00.000Z" };

describe("engine2 shadow mode — flag gating (Phase 2.8)", () => {
  it("is off by default", () => {
    expect(isEngine2ShadowEnabled()).toBe(false);
  });

  it("returns an inert result when flag is off and not forced", () => {
    const result = runShadowComparisons(shadowBatch());
    expect(result.ran).toBe(false);
    expect(result.log.entries).toHaveLength(0);
    expect(result.totals.entries).toBe(0);
  });

  it("runs only when explicitly forced", () => {
    const result = runShadowComparisons(shadowBatch(), {
      force: true,
      clock: fixedClock,
    });
    expect(result.ran).toBe(true);
    expect(result.log.entries.length).toBeGreaterThan(0);
    expect(result.log.createdAt).toBe(fixedClock.now());
  });
});

describe("engine2 shadow mode — legacy safety (Phase 2.8)", () => {
  it("does not mutate the source schedule", () => {
    const schedule = buildScheduleFromSample();
    const snapshot = JSON.stringify(schedule);
    runShadowComparisons(
      [{ id: "s1", label: schedule.name, schedule }],
      { force: true, clock: fixedClock },
    );
    expect(JSON.stringify(schedule)).toBe(snapshot);
  });

  it("does not change legacy calculateSchedule output", () => {
    const schedule = buildScheduleFromSample();
    const before = calculateSchedule(schedule);
    runShadowComparisons(
      [{ id: "s1", label: schedule.name, schedule }],
      { force: true, clock: fixedClock },
    );
    const after = calculateSchedule(schedule);
    expect(after.projectFinishDate).toBe(before.projectFinishDate);
    expect(after.tasks.length).toBe(before.tasks.length);
    expect(after.criticalPath).toEqual(before.criticalPath);
  });
});

describe("engine2 shadow mode — evidence log shape (Phase 2.8)", () => {
  it("produces one entry per (schedule × calendar mode)", () => {
    const inputs = shadowBatch();
    const result = runShadowComparisons(inputs, {
      force: true,
      clock: fixedClock,
      calendarModes: ["whole-day"],
    });
    expect(result.log.entries.length).toBe(inputs.length);
    for (const e of result.log.entries) {
      expect(e.timestamp).toBe(fixedClock.now());
      expect(e.calendarMode).toBe("whole-day");
      expect(e.useExceptionAwareCalendars).toBe(false);
      expect(typeof e.boring).toBe("boolean");
      expect(typeof e.mismatchCount).toBe("number");
    }
  });

  it("dual-clock helper runs both whole-day and exception-aware", () => {
    const inputs = shadowBatch().slice(0, 3);
    const result = runDualCalendarShadow(inputs, {
      force: true,
      clock: fixedClock,
    });
    expect(result.log.entries.length).toBe(inputs.length * 2);
    const modes = new Set(result.log.entries.map((e) => e.calendarMode));
    expect(modes.has("whole-day")).toBe(true);
    expect(modes.has("exception-aware")).toBe(true);
  });

  it("exception-aware routing is opt-in (default mode is whole-day)", () => {
    const result = runShadowComparisons(shadowBatch().slice(0, 1), {
      force: true,
      clock: fixedClock,
    });
    expect(result.log.entries.every((e) => e.calendarMode === "whole-day")).toBe(true);
  });
});

describe("engine2 shadow mode — boring-report detector (Phase 2.8)", () => {
  it("flags reports with engine2 errors as not boring", () => {
    const fakeReport = {
      countsByClassification: { investigate: 0, "known-engine-limitation": 0, "expected-bridge-limitation": 0 },
      verdict: "clean",
      engine2Error: "boom",
    } as unknown as Parameters<typeof isBoringReport>[0];
    expect(isBoringReport(fakeReport)).toBe(false);
    expect(summarizeBoringness(fakeReport).reasons[0]).toContain("boom");
  });

  it("flags investigate verdicts as not boring", () => {
    const fakeReport = {
      countsByClassification: { investigate: 2, "known-engine-limitation": 0, "expected-bridge-limitation": 0 },
      verdict: "investigate",
    } as unknown as Parameters<typeof isBoringReport>[0];
    const summary = summarizeBoringness(fakeReport);
    expect(summary.boring).toBe(false);
    expect(summary.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("treats clean / expected-differences reports as boring", () => {
    const clean = {
      countsByClassification: { investigate: 0, "known-engine-limitation": 0, "expected-bridge-limitation": 0 },
      verdict: "clean",
    } as unknown as Parameters<typeof isBoringReport>[0];
    const expected = {
      countsByClassification: { investigate: 0, "known-engine-limitation": 3, "expected-bridge-limitation": 1 },
      verdict: "expected-differences",
    } as unknown as Parameters<typeof isBoringReport>[0];
    expect(isBoringReport(clean)).toBe(true);
    expect(isBoringReport(expected)).toBe(true);
  });
});

describe("engine2 shadow mode — exports (Phase 2.8)", () => {
  it("JSON export is deterministic and contains every entry", () => {
    const inputs = shadowBatch().slice(0, 2);
    const result = runShadowComparisons(inputs, {
      force: true,
      clock: fixedClock,
    });
    const json = exportEvidenceLogToJson(result.log);
    const parsed = JSON.parse(json);
    expect(parsed.entries.length).toBe(result.log.entries.length);
    expect(parsed.createdAt).toBe(fixedClock.now());
  });

  it("CSV export has stable headers and one row per entry", () => {
    const inputs = shadowBatch().slice(0, 2);
    const result = runShadowComparisons(inputs, {
      force: true,
      clock: fixedClock,
    });
    const csv = exportEvidenceLogToCsv(result.log);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("scheduleId,scheduleName,intent,timestamp");
    expect(lines.length).toBe(1 + result.log.entries.length);
  });

  it("export does not mutate the log or its entries", () => {
    const inputs = shadowBatch().slice(0, 1);
    const result = runShadowComparisons(inputs, {
      force: true,
      clock: fixedClock,
    });
    const before = JSON.stringify(result.log);
    exportEvidenceLogToJson(result.log);
    exportEvidenceLogToCsv(result.log);
    expect(JSON.stringify(result.log)).toBe(before);
  });
});

describe("engine2 shadow mode — Commercial Fit-Out shadow run (Phase 2.8)", () => {
  it("produces a non-investigate verdict on the demo schedule", () => {
    const schedule = buildScheduleFromSample();
    const result = runShadowComparisons(
      [{ id: "cfo", label: schedule.name, schedule, intent: "demo" }],
      { force: true, clock: fixedClock },
    );
    expect(result.ran).toBe(true);
    const entry = result.log.entries[0];
    expect(entry.engine2Error).toBeUndefined();
    expect(entry.verdict === "clean" || entry.verdict === "expected-differences").toBe(true);
  });
});
