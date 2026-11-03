import { describe, expect, it } from "vitest";
import { prepareHandoffDraft } from "./estimating-handoff-draft";
import type { BidBreakdown } from "./estimating-bid";

const quote = { sub: "Trade", description: "Paint", amount: 100, ref: "T-1" };
const breakdown: BidBreakdown = {
  direct: [{ ref: "T-1", basis: "quote", amountCents: 10000, quoteId: "0" }],
  directCents: 10000,
  generalConditions: [],
  requirements: [],
  generalConditionsCents: 0,
  requirementsCents: 0,
  overheadCents: 1000,
  profitCents: 1100,
  totalCents: 12100,
};
const request = () => ({
  companyId: "company",
  jobId: "job",
  ready: true,
  breakdown: structuredClone(breakdown),
  snapshot: {
    version: 7,
    estimate: { lines: [1] },
    takeoff: { geometry: [] },
    bid: { pricing: { quotes: [quote] } },
    selection: {
      version: 7,
      current: true,
      decisions: [
        {
          quote_index: 0,
          decision: "carry",
          ref: "T-1",
          quote,
          replace_labor_and_material: true,
          exclusive_to_line: true,
        },
      ],
    },
  },
});
describe("internal handoff draft", () => {
  it("binds the exact source and balanced cents deterministically without posting", async () => {
    const a = await prepareHandoffDraft(request());
    const b = await prepareHandoffDraft(request());
    expect(a.status).toBe("draft");
    expect(a.sha256).toBe(b.sha256);
    expect(a.warnings.join(" ")).toContain("confirmation");
    const changed = request();
    changed.snapshot.estimate.lines.push(2);
    expect((await prepareHandoffDraft(changed)).sha256).not.toBe(a.sha256);
  });
  it("rejects held totals, stale reviews, changed quotes, and substituted costs", async () => {
    const held = request();
    held.ready = false;
    await expect(prepareHandoffDraft(held)).rejects.toThrow(/complete reconciled/i);
    const stale = request();
    stale.snapshot.selection.current = false;
    await expect(prepareHandoffDraft(stale)).rejects.toThrow(/not current/i);
    const changed = request();
    changed.snapshot.bid.pricing.quotes = [{ ...quote, amount: 200 }];
    await expect(prepareHandoffDraft(changed)).rejects.toThrow(/saved quote list/i);
    const missingAttestation = request();
    missingAttestation.snapshot.selection.decisions[0].exclusive_to_line = false;
    await expect(prepareHandoffDraft(missingAttestation)).rejects.toThrow(/saved quote list/i);
    const incorrect = request();
    incorrect.breakdown.direct[0].amountCents = 9900;
    await expect(prepareHandoffDraft(incorrect)).rejects.toThrow(/complete reconciled/i);
  });
});
