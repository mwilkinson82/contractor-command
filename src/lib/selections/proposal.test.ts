import { describe, expect, it } from "vitest";
import { boardSchema } from "./model";
import { previewPackage, type PackagePlan } from "./proposal";

const id = "72087ad6-fc97-4938-97b3-802803bf49c5";
const option = (price_cents: number | null, cost_cents: number) => ({
  description: "Illustrative option",
  cost_cents,
  price_cents,
  specifications: "",
  source_url: null,
  photo_url: null,
});
const board = boardSchema.parse({
  currency: "USD",
  selections: [
    {
      id,
      title: "Fixture",
      decision_due: null,
      allowance_cents: null,
      selected: null,
      notes: "private",
      options: {
        good: option(20000, 10000),
        better: option(27500, 12000),
        best: option(null, 14000),
      },
    },
  ],
});
const plan: PackagePlan = {
  source_snapshot_id: "3ffef536-d855-4270-8551-9345697183bd",
  source_version: 2,
  source_sha256: "a".repeat(64),
  base_price_cents: 1_000_000,
  base_includes_listed_selections: true,
  base_choices: [{ selection_id: id, option: "good" }],
  choices: [{ selection_id: id, option: "better" }],
};
describe("whole-job package preview", () => {
  it("adds the selected customer price difference to the base once, never the internal cost", () => {
    expect(previewPackage(board, plan)).toEqual({ total_cents: 1_007_500, difference_cents: 7500 });
  });
  it("withholds totals for unknown prices or unconfirmed inclusion", () => {
    expect(
      previewPackage(board, { ...plan, choices: [{ selection_id: id, option: "best" }] })
        .total_cents,
    ).toBeNull();
    expect(
      previewPackage(board, { ...plan, base_includes_listed_selections: false }).total_cents,
    ).toBeNull();
    expect(previewPackage(board, { ...plan, base_price_cents: null }).total_cents).toBeNull();
    expect(previewPackage({ ...board, currency: null }, plan).total_cents).toBeNull();
  });
  it("withholds totals when selections are missing, duplicated or belong to another board", () => {
    expect(previewPackage(board, { ...plan, choices: [] }).total_cents).toBeNull();
    expect(
      previewPackage(board, {
        ...plan,
        choices: [{ selection_id: "65d6ebcb-b09e-4bb3-9661-3d3bc53e99d1", option: "good" }],
      }).total_cents,
    ).toBeNull();
    expect(
      previewPackage(board, { ...plan, choices: [...plan.choices, ...plan.choices] }).total_cents,
    ).toBeNull();
  });
});
