import { describe, it, expect } from "vitest";
import {
  BUILD_GUARDRAILS,
  createEmptyChangeSet,
  createEmptyDraft,
  isChangeSetCommittable,
  isEmptyDraft,
  type ProposedChange,
} from "../intel-build";

const fixedNow = () => "2026-01-01T00:00:00.000Z";

describe("intel-build draft model", () => {
  it("createEmptyDraft builds a serializable, empty, draft-status artifact", () => {
    const d = createEmptyDraft({
      id: "d1",
      name: "TI Project",
      source: "manual_prompt",
      inputText: "Tenant fit-out",
      now: fixedNow,
    });
    expect(d.version).toBe(1);
    expect(d.status).toBe("draft");
    expect(d.source).toBe("manual_prompt");
    expect(d.createdAt).toBe(d.updatedAt);
    expect(isEmptyDraft(d)).toBe(true);
    // JSON round-trip safety (server function boundary)
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  });

  it("isEmptyDraft returns false once any collection is populated", () => {
    const d = createEmptyDraft({
      id: "d2",
      name: "x",
      source: "activity_list",
      now: fixedNow,
    });
    d.activities.push({ id: "a1", name: "Mobilize", durationDays: 2 });
    expect(isEmptyDraft(d)).toBe(false);
  });
});

describe("intel-build change set model", () => {
  it("createEmptyChangeSet starts in draft status with no changes", () => {
    const cs = createEmptyChangeSet({
      id: "cs1",
      title: "Apply tenant fit-out draft",
      now: fixedNow,
    });
    expect(cs.status).toBe("draft");
    expect(cs.changes).toHaveLength(0);
    expect(isChangeSetCommittable(cs)).toBe(false);
  });

  it("isChangeSetCommittable requires approved status AND at least one change", () => {
    const cs = createEmptyChangeSet({ id: "cs2", title: "t", now: fixedNow });
    const change: ProposedChange = {
      id: "ch1",
      kind: "add_activity",
      rationale: "From draft activity #1",
      payload: { name: "Mobilize", durationDays: 2 },
    };
    cs.changes.push(change);
    expect(isChangeSetCommittable(cs)).toBe(false); // still draft
    cs.status = "approved";
    expect(isChangeSetCommittable(cs)).toBe(true);
    cs.changes = [];
    expect(isChangeSetCommittable(cs)).toBe(false); // approved but empty
  });

  it("ships explicit guardrail copy for Build Mode UI", () => {
    expect(BUILD_GUARDRAILS.length).toBeGreaterThan(0);
    expect(BUILD_GUARDRAILS.join(" ")).toMatch(/approval/i);
  });
});
