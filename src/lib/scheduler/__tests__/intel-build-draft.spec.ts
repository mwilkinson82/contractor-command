import { describe, it, expect } from "vitest";
import {
  AiDraftPayloadSchema,
  DraftScheduleSchema,
  assembleDraftFromActivityList,
  validateDraftSchedule,
} from "../intel-build-validate";
import { buildPreviewChangeSet, countChangeSet } from "../intel-build-demo";
import { isChangeSetCommittable } from "../intel-build";

const SAMPLE_PAYLOAD = {
  name: "Test fit-out",
  wbsSections: [
    { code: "1", name: "Sitework" },
    { code: "2", name: "Buildout" },
  ],
  activities: [
    { name: "Mobilize", durationDays: 2, wbsName: "Sitework" },
    { name: "Clearing", durationDays: 3, wbsName: "Sitework", dependsOn: ["Mobilize"] },
    { name: "Foundations", durationDays: 8, wbsName: "Buildout", dependsOn: ["Clearing"] },
    { name: "Final Inspection", isMilestone: true, wbsName: "Buildout", dependsOn: ["Foundations"] },
  ],
  assumptions: ["Single shift, Mon–Fri"],
  questions: ["Are inspections owner-scheduled?"],
};

describe("AI draft payload schema", () => {
  it("accepts a well-formed payload", () => {
    expect(() => AiDraftPayloadSchema.parse(SAMPLE_PAYLOAD)).not.toThrow();
  });

  it("rejects payloads with no activities", () => {
    expect(() =>
      AiDraftPayloadSchema.parse({ ...SAMPLE_PAYLOAD, activities: [] }),
    ).toThrow();
  });

  it("rejects payloads with junk types", () => {
    expect(() =>
      AiDraftPayloadSchema.parse({
        activities: [{ name: "X", durationDays: "five" }],
      }),
    ).toThrow();
  });
});

describe("assembleDraftFromActivityList", () => {
  it("produces a strict, validated DraftSchedule", () => {
    const draft = assembleDraftFromActivityList({
      payload: SAMPLE_PAYLOAD,
      inputText: "mobilize, clearing, foundations, final inspection",
      now: () => "2026-05-25T00:00:00.000Z",
      draftId: "draft-al-test",
    });
    expect(() => DraftScheduleSchema.parse(draft)).not.toThrow();
    expect(draft.source).toBe("activity_list");
    expect(draft.status).toBe("draft");
    expect(draft.activities.length).toBe(4);
    expect(draft.wbs.length).toBe(2);
    expect(draft.relationships.length).toBeGreaterThan(0);
  });

  it("pins source=activity_list and status=draft even if the payload tried to override", () => {
    const draft = assembleDraftFromActivityList({
      payload: SAMPLE_PAYLOAD,
      inputText: "anything",
    });
    expect(draft.source).toBe("activity_list");
    expect(draft.status).toBe("draft");
  });

  it("always includes the 'durations are assumptions' guardrail assumption", () => {
    const draft = assembleDraftFromActivityList({
      payload: { activities: [{ name: "Only Activity" }] },
      inputText: "only activity",
    });
    expect(
      draft.assumptions.some((a) => /planning assumption/i.test(a.label)),
    ).toBe(true);
  });

  it("always includes the 'review required' warning", () => {
    const draft = assembleDraftFromActivityList({
      payload: { activities: [{ name: "Only Activity" }] },
      inputText: "only activity",
    });
    expect(
      draft.warnings.some((w) => /reviewed by a scheduler/i.test(w.message)),
    ).toBe(true);
  });

  it("falls back to a linear FS chain when no dependsOn is given", () => {
    const draft = assembleDraftFromActivityList({
      payload: {
        activities: [
          { name: "A", durationDays: 1 },
          { name: "B", durationDays: 1 },
          { name: "C", durationDays: 1 },
        ],
      },
      inputText: "A, B, C",
    });
    expect(draft.relationships.length).toBe(2);
    expect(draft.relationships.every((r) => r.type === "FS")).toBe(true);
  });

  it("drops dependsOn entries that don't match any activity (does not crash)", () => {
    const draft = assembleDraftFromActivityList({
      payload: {
        activities: [
          { name: "Real", durationDays: 1 },
          { name: "Other", durationDays: 1, dependsOn: ["Ghost", "Real"] },
        ],
      },
      inputText: "Real, Other",
    });
    expect(draft.relationships.length).toBe(1);
    expect(draft.relationships[0].predecessorId).toBe(draft.activities[0].id);
  });

  it("rejects an empty payload", () => {
    expect(() =>
      assembleDraftFromActivityList({
        payload: { activities: [] } as never,
        inputText: "",
      }),
    ).toThrow();
  });
});

describe("draft preview gating", () => {
  it("change set derived from an AI-generated draft is not committable", () => {
    const draft = assembleDraftFromActivityList({
      payload: SAMPLE_PAYLOAD,
      inputText: "x",
    });
    const cs = buildPreviewChangeSet(draft);
    expect(isChangeSetCommittable(cs)).toBe(false);
    const counts = countChangeSet(cs);
    expect(counts.total).toBe(cs.changes.length);
  });
});

describe("validateDraftSchedule integrity checks", () => {
  it("rejects relationships referencing missing activities", () => {
    const draft = assembleDraftFromActivityList({
      payload: SAMPLE_PAYLOAD,
      inputText: "x",
    });
    draft.relationships.push({
      id: "bad",
      predecessorId: "ghost-1",
      successorId: draft.activities[0].id,
      type: "FS",
    });
    expect(() => validateDraftSchedule(draft)).toThrow(/missing predecessor/);
  });

  it("rejects self-loops", () => {
    const draft = assembleDraftFromActivityList({
      payload: SAMPLE_PAYLOAD,
      inputText: "x",
    });
    const a = draft.activities[0].id;
    draft.relationships.push({
      id: "loop",
      predecessorId: a,
      successorId: a,
      type: "FS",
    });
    expect(() => validateDraftSchedule(draft)).toThrow(/self-loop/);
  });
});

describe("no mutation surface — AI-4", () => {
  const MUTATION_VERB = /^(commit|apply|write|save|persist|mutate)/i;

  it("intel-build-validate exports no mutation verbs", async () => {
    const mod = await import("../intel-build-validate");
    for (const n of Object.keys(mod)) {
      expect(n).not.toMatch(MUTATION_VERB);
    }
  });

  it("intel-build-draft.functions exports no mutation verbs", async () => {
    const mod = await import("../intel-build-draft.functions");
    for (const n of Object.keys(mod)) {
      expect(n).not.toMatch(MUTATION_VERB);
    }
  });
});

describe("production engine guarantee", () => {
  it("scheduler routes still import the legacy calculateSchedule", async () => {
    const fs = await import("node:fs/promises");
    const [a, b] = await Promise.all([
      fs.readFile("src/routes/scheduler.tsx", "utf8"),
      fs.readFile("src/routes/scheduler.$projectId.tsx", "utf8"),
    ]);
    expect(a).toMatch(/from\s+["']@\/lib\/scheduler\/engine["']/);
    expect(b).toMatch(/from\s+["']@\/lib\/scheduler\/engine["']/);
    expect(a + b).toMatch(/calculateSchedule/);
  });
});
