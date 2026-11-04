import { describe, expect, it } from "vitest";
import {
  contractorReview,
  customerProposal,
  customerProposalSchema,
  estimateCarry,
  packageTotals,
  proposalBlockers,
} from "./proposal";
import { willowCreekTypeE } from "./__fixtures__/willow-creek-type-e";

const PRIVATE_KEYS = [
  "cost_cents",
  "price_cents",
  "found_price_cents",
  "found_at",
  "found_on",
  "assumptions",
  "notes",
  "base_basis",
  "base_price_cents",
  "price_reviewed_on",
  "allowance_cents",
  "evidence",
  "recorded_by",
  "estimate_line_ref",
];
function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysOf(v, out);
    }
  return out;
}

describe("Good, Better, Best packages", () => {
  it("prices each package as the base plus the change from the base tier", () => {
    expect(packageTotals(willowCreekTypeE())).toEqual({
      good: { total_cents: 4_850_000, difference_cents: 0 },
      better: { total_cents: 4_883_600, difference_cents: 33_600 },
      best: { total_cents: 5_018_600, difference_cents: 168_600 },
    });
  });

  it("uses whichever tier the base price includes", () => {
    const b = willowCreekTypeE();
    b.proposal.base_tier = "better";
    expect(packageTotals(b).good).toEqual({ total_cents: 4_816_400, difference_cents: -33_600 });
    expect(packageTotals(b).better).toEqual({ total_cents: 4_850_000, difference_cents: 0 });
  });

  it("is unknown, not zero, when any price or the base is missing", () => {
    const b = willowCreekTypeE(false);
    b.selections[0].options.best.price_cents = null;
    expect(packageTotals(b).best).toEqual({ total_cents: null, difference_cents: null });
    expect(packageTotals(b).better.total_cents).toBe(4_883_600);
    b.proposal.base_price_cents = null;
    expect(packageTotals(b).good.total_cents).toBeNull();
  });

  it("blocks the customer view until every price and the base price are reviewed", () => {
    expect(proposalBlockers(willowCreekTypeE())).toEqual([]);
    const blockers = proposalBlockers(willowCreekTypeE(false));
    expect(blockers).toContain("Review the base proposal price.");
    expect(blockers).toContain(
      "Type E 2x4 lay-in LED fixtures (Better): review the customer price.",
    );
    expect(() => customerProposal(willowCreekTypeE(false), 1)).toThrow(/not ready/);
  });

  it("gives the customer products, inclusions and totals but no cost, margin or notes", () => {
    const view = customerProposal(willowCreekTypeE(), 3);
    expect(customerProposalSchema.parse(view)).toEqual(view);
    const keys = keysOf(view);
    for (const k of PRIVATE_KEYS) expect(keys.has(k)).toBe(false);
    const json = JSON.stringify(view);
    for (const secret of [
      "6997",
      "10999",
      "27133",
      "Retail list price",
      "Confirm count",
      "Illustrative test base",
    ])
      expect(json).not.toContain(secret);
    expect(view.packages.map((p) => p.total_cents)).toEqual([4_850_000, 4_883_600, 5_018_600]);
    expect(view.selections[0].options.better.model).toBe("CPANL 2X4 ALO6 SWW7 M2");
  });

  it("shows a recorded choice only on the board version it was recorded against", () => {
    const b = willowCreekTypeE();
    b.accepted = {
      tier: "better",
      board_version: 4,
      total_cents: 4_883_600,
      recorded_on: "2026-11-04",
      recorded_by: "00000000-0000-4000-8000-000000000901",
      evidence: "Customer email Nov 4",
    };
    expect(customerProposal(b, 4).accepted).toEqual({ tier: "better", recorded_on: "2026-11-04" });
    expect(customerProposal(b, 5).accepted).toBeNull();
  });

  it("gives the contractor cost, margin and markup per package", () => {
    const review = contractorReview(willowCreekTypeE());
    expect(review.packages.find((p) => p.tier === "better")!.selections).toEqual({
      price_cents: 92_400,
      cost_cents: 65_994,
      margin_cents: 26_406,
      margin_bp: 2858,
      markup_bp: 4001,
    });
    expect(review.warnings).toEqual([]);
    const b = willowCreekTypeE();
    b.selections[0].options.good.price_cents = 5000;
    expect(contractorReview(b).warnings).toContain(
      "Type E 2x4 lay-in LED fixtures (Good): price is below cost.",
    );
  });

  it("turns a chosen package into estimate pricing lines without writing them", () => {
    expect(estimateCarry(willowCreekTypeE(), "better")).toEqual({
      tier: "better",
      carry: [
        {
          ref: "T-1",
          unit_price: 109.99,
          item: "Type E 2x4 lay-in LED fixtures",
          product: "Lithonia Lighting CPANL 2X4 ALO6 SWW7 M2",
        },
      ],
      skipped: [],
    });
    const b = willowCreekTypeE();
    b.selections.push({
      ...structuredClone(b.selections[0]),
      id: "6f1d2c34-8b1a-4f0e-9c4d-2a7b5e9d1c02",
    });
    expect(estimateCarry(b, "good").carry).toEqual([]);
    expect(estimateCarry(b, "good").skipped).toHaveLength(2);
  });
});
