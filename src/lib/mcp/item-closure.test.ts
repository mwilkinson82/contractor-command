import { describe, expect, it } from "vitest";
import { itemClosureKey, itemClosurePreview, type ClosureItem } from "./item-closure";

const item: ClosureItem = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  action: "2701 – Confirm supplier delivery",
  accountable: "Fictional PM",
  needed_by: "2026-10-23",
  updated_at: "2026-10-23T12:00:00Z",
};
const proposal = {
  kind: "verified",
  evidence: "Supplier confirmation dated 2026-10-23, reference QA-1.",
};

describe("item closure review", () => {
  it("shows the selected item and evidence while explicitly leaving it open", async () => {
    const key = await itemClosureKey("job-2701", "pm", item, proposal);
    const result = itemClosurePreview("2701", item, "#AAAAAA", proposal, key);
    expect(result.closed).toBe(false);
    expect(result.confirmation_required).toBe(true);
    expect(result.confirmation_key).toBe(key);
    expect(result.selected_items).toEqual([
      {
        item_id: item.id,
        item_ref: "#AAAAAA",
        action: "Confirm supplier delivery",
        owner: "Fictional PM",
        due: "2026-10-23",
      },
    ]);
    expect(result.question).toContain("Yes or no?");
    expect(JSON.stringify(result.card)).toContain(proposal.evidence);
  });

  it("does not offer a confirmation key when evidence is missing", () => {
    const result = itemClosurePreview(
      "2701",
      item,
      "#AAAAAA",
      { kind: "verified" },
      null,
      "What dated evidence supports closing this item?",
    );
    expect(result.evidence_required).toBe(true);
    expect(result.confirmation_key).toBeNull();
    expect(result.closed).toBe(false);
    expect(result.question).toContain("evidence");
  });

  it("binds confirmation to the actor, job, item snapshot and exact proposed resolution", async () => {
    const original = await itemClosureKey("job-2701", "pm", item, proposal);
    const variants = await Promise.all([
      itemClosureKey("other-job", "pm", item, proposal),
      itemClosureKey("job-2701", "other-member", item, proposal),
      itemClosureKey("job-2701", "pm", { ...item, id: "other-item" }, proposal),
      itemClosureKey("job-2701", "pm", { ...item, action: "Confirm another supplier" }, proposal),
      itemClosureKey("job-2701", "pm", { ...item, accountable: "Other fictional PM" }, proposal),
      itemClosureKey("job-2701", "pm", { ...item, needed_by: "2026-10-24" }, proposal),
      itemClosureKey("job-2701", "pm", { ...item, updated_at: "2026-10-23T13:00:00Z" }, proposal),
      itemClosureKey("job-2701", "pm", item, { ...proposal, evidence: "Different evidence" }),
      itemClosureKey("job-2701", "pm", item, {
        ...proposal,
        kind: "waive",
        reason: "Fictional waiver",
      }),
    ]);
    expect(original).toMatch(/^[a-f0-9]{64}$/);
    for (const key of variants) expect(key).not.toBe(original);
  });

  it("keeps submitted evidence literal and missing fields factual", () => {
    const evidence = "Keep the signed document wording exactly as provided.";
    const result = itemClosurePreview(
      "2701",
      { id: item.id, action: "Confirm supplier" },
      "#AAAAAA",
      { kind: "verified", evidence },
      "review-key",
    );
    expect(result.card.sections?.[0].rows?.[0].cells).toContain("Due: Due date needed");
    expect(
      result.card.sections?.[1].rows?.some(
        (r) => r.tone === "literal" && r.cells?.includes(`Evidence:\n${evidence}`),
      ),
    ).toBe(true);
    expect(result.closed).toBe(false);
  });
});
