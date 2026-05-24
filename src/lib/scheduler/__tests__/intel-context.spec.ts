/**
 * AI-1 — Schedule Intelligence shell tests.
 *
 * Proves:
 *  - Mode reducer accepts the three documented modes and rejects others.
 *  - Starter prompts include the five required suggestions.
 *  - Context serializer is deterministic and read-only over a real sample.
 *  - Selected activity flows through to the serialized context.
 *  - The shell exposes no schedule-mutation API.
 */

import { describe, expect, it } from "vitest";
import {
  INTEL_DRAWER_MODES,
  INTEL_STARTER_PROMPTS,
  INTEL_ADVISORY_NOTE,
  buildIntelScheduleContext,
  isIntelDrawerMode,
  nextIntelDrawerMode,
} from "../intel-context";
import * as intelModule from "../intel-context";
import * as chatModule from "@/components/scheduler/IntelChatPanel";
import { calculateSchedule } from "../engine";
import { commercialFitOutSample } from "../sample";
import type { Schedule } from "../types";

function makeSchedule(): Schedule {
  const s = commercialFitOutSample();
  return {
    name: s.name,
    projectStartDate: s.projectStartDate,
    dataDate: s.dataDate,
    calendar: { workDays: s.workDays, holidays: s.holidays },
    tasks: s.tasks,
    dependencies: s.dependencies,
    annotations: s.annotations,
  };
}

describe("AI-1 — drawer mode switching", () => {
  it("exposes review, chat, and build", () => {
    expect([...INTEL_DRAWER_MODES]).toEqual(["review", "chat", "build"]);
  });

  it("accepts valid modes and rejects junk", () => {
    expect(isIntelDrawerMode("review")).toBe(true);
    expect(isIntelDrawerMode("chat")).toBe(true);
    expect(isIntelDrawerMode("build")).toBe(true);
    expect(isIntelDrawerMode("hack")).toBe(false);
    expect(isIntelDrawerMode(null)).toBe(false);
  });

  it("reducer switches between modes and ignores bad input", () => {
    expect(nextIntelDrawerMode("review", "chat")).toBe("chat");
    expect(nextIntelDrawerMode("chat", "build")).toBe("build");
    expect(nextIntelDrawerMode("build", "review")).toBe("review");
    expect(nextIntelDrawerMode("review", "nope")).toBe("review");
  });
});

describe("AI-1 — chat shell catalog", () => {
  it("ships the five required starter prompts", () => {
    expect(INTEL_STARTER_PROMPTS).toContain("Explain the critical path.");
    expect(INTEL_STARTER_PROMPTS).toContain("What should I review first?");
    expect(INTEL_STARTER_PROMPTS).toContain(
      "Why is this activity near-critical?",
    );
    expect(INTEL_STARTER_PROMPTS).toContain(
      "What looks risky in this schedule?",
    );
    expect(INTEL_STARTER_PROMPTS).toContain(
      "What would you fix before issuing this schedule?",
    );
    expect(INTEL_STARTER_PROMPTS.length).toBeGreaterThanOrEqual(5);
  });

  it("ships the advisory guardrail copy", () => {
    expect(INTEL_ADVISORY_NOTE).toMatch(/advisory/i);
    expect(INTEL_ADVISORY_NOTE).toMatch(/approval/i);
  });

  it("exports the chat shell and build placeholder components", () => {
    expect(typeof chatModule.IntelChatPanel).toBe("function");
    expect(typeof chatModule.IntelBuildPanel).toBe("function");
  });
});

describe("AI-1 — schedule context serializer", () => {
  it("handles empty input safely (no schedule yet)", () => {
    const ctx = buildIntelScheduleContext({
      draft: null,
      computed: null,
      now: () => "2026-01-01T00:00:00.000Z",
    });
    expect(ctx.version).toBe(1);
    expect(ctx.counts.activities).toBe(0);
    expect(ctx.nearCriticalActivities).toEqual([]);
    expect(ctx.selectedActivity).toBe(null);
    expect(ctx.generatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("serializes a real schedule and is deterministic", () => {
    const draft = makeSchedule();
    const computed = calculateSchedule(draft);
    const fixedNow = () => "2026-05-24T00:00:00.000Z";

    const ctx1 = buildIntelScheduleContext({
      draft,
      computed,
      nearCriticalFloor: 5,
      now: fixedNow,
    });
    const ctx2 = buildIntelScheduleContext({
      draft,
      computed,
      nearCriticalFloor: 5,
      now: fixedNow,
    });

    expect(ctx1).toEqual(ctx2);
    expect(ctx1.projectName).toBe(draft.name);
    expect(ctx1.projectFinishDate).toBe(computed.projectFinishDate ?? null);
    expect(ctx1.counts.activities).toBe(computed.tasks.length);
    expect(ctx1.counts.critical).toBe(
      computed.tasks.filter((t) => t.isCritical).length,
    );
    expect(ctx1.counts.nearCritical).toBeGreaterThanOrEqual(0);
  });

  it("does not mutate draft or computed inputs", () => {
    const draft = makeSchedule();
    const computed = calculateSchedule(draft);
    const draftBefore = JSON.stringify(draft);
    const computedBefore = JSON.stringify(computed);

    buildIntelScheduleContext({ draft, computed });
    buildIntelScheduleContext({
      draft,
      computed,
      selectedTask: computed.tasks[0],
    });

    expect(JSON.stringify(draft)).toBe(draftBefore);
    expect(JSON.stringify(computed)).toBe(computedBefore);
  });

  it("includes the selected activity when provided", () => {
    const draft = makeSchedule();
    const computed = calculateSchedule(draft);
    const sel = computed.tasks[3];

    const ctx = buildIntelScheduleContext({
      draft,
      computed,
      selectedTask: sel,
    });
    expect(ctx.selectedActivity).not.toBeNull();
    expect(ctx.selectedActivity?.id).toBe(sel.id);
    expect(ctx.selectedActivity?.name).toBe(sel.name);
    expect(ctx.selectedActivity?.isCritical).toBe(sel.isCritical);
  });
});

describe("AI-1 — no mutation surface", () => {
  it("intel-context module exports no write/commit/mutate APIs", () => {
    const forbidden = /^(commit|save|write|delete|update|mutate|apply)/i;
    const names = Object.keys(intelModule);
    const violators = names.filter((n) => forbidden.test(n));
    expect(violators).toEqual([]);
  });

  it("chat shell module exports no write/commit/mutate APIs", () => {
    const forbidden = /^(commit|save|write|delete|update|mutate|apply)/i;
    const names = Object.keys(chatModule);
    const violators = names.filter((n) => forbidden.test(n));
    expect(violators).toEqual([]);
  });
});
