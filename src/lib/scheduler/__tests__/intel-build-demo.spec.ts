import { describe, it, expect } from "vitest";
import {
  buildDemoDraftSchedule,
  buildPreviewChangeSet,
  countChangeSet,
} from "../intel-build-demo";
import { isChangeSetCommittable, isEmptyDraft } from "../intel-build";

describe("intel-build demo fixture", () => {
  it("is a deterministic, non-empty draft", () => {
    const a = buildDemoDraftSchedule();
    const b = buildDemoDraftSchedule();
    expect(a).toEqual(b);
    expect(isEmptyDraft(a)).toBe(false);
    expect(a.status).toBe("draft");
    expect(a.name).toMatch(/DEMO/);
  });

  it("round-trips through JSON without loss", () => {
    const d = buildDemoDraftSchedule();
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  });

  it("has the expected WBS / activity / relationship counts", () => {
    const d = buildDemoDraftSchedule();
    expect(d.wbs.length).toBe(5);
    expect(d.activities.length).toBe(11);
    expect(d.relationships.length).toBe(10);
    expect(d.milestones.length).toBe(2);
    expect(d.assumptions.length).toBeGreaterThan(0);
    expect(d.questions.length).toBeGreaterThan(0);
    expect(d.warnings.length).toBeGreaterThan(0);
  });

  it("every relationship references an existing activity", () => {
    const d = buildDemoDraftSchedule();
    const ids = new Set(d.activities.map((a) => a.id));
    for (const r of d.relationships) {
      expect(ids.has(r.predecessorId)).toBe(true);
      expect(ids.has(r.successorId)).toBe(true);
    }
  });
});

describe("preview change set", () => {
  it("derives counts that match the draft", () => {
    const d = buildDemoDraftSchedule();
    const cs = buildPreviewChangeSet(d);
    const counts = countChangeSet(cs);
    const milestoneCount = d.activities.filter((a) => a.isMilestone).length;
    expect(counts.addMilestone).toBe(milestoneCount);
    expect(counts.addActivity).toBe(d.activities.length - milestoneCount);
    expect(counts.addRelationship).toBe(d.relationships.length);
    expect(counts.total).toBe(cs.changes.length);
  });

  it("is not committable from the preview alone", () => {
    const cs = buildPreviewChangeSet(buildDemoDraftSchedule());
    expect(cs.status).toBe("draft");
    expect(isChangeSetCommittable(cs)).toBe(false);
  });

  it("only becomes committable when approved AND non-empty", () => {
    const cs = buildPreviewChangeSet(buildDemoDraftSchedule());
    cs.status = "approved";
    expect(isChangeSetCommittable(cs)).toBe(true);
    cs.changes = [];
    expect(isChangeSetCommittable(cs)).toBe(false);
  });

  it("every change carries a human-readable rationale", () => {
    const cs = buildPreviewChangeSet(buildDemoDraftSchedule());
    for (const c of cs.changes) {
      expect(typeof c.rationale).toBe("string");
      expect(c.rationale.length).toBeGreaterThan(0);
    }
  });
});

describe("no mutation surface", () => {
  it("intel-build-demo module exports no commit/apply/write functions", async () => {
    const mod = await import("../intel-build-demo");
    const names = Object.keys(mod);
    for (const n of names) {
      expect(n).not.toMatch(/commit|apply|write|save|persist|mutate/i);
    }
  });

  it("intel-build module exports no commit/apply/write functions", async () => {
    const mod = await import("../intel-build");
    const names = Object.keys(mod);
    for (const n of names) {
      expect(n).not.toMatch(/commit|apply|write|save|persist|mutate/i);
    }
  });
});
