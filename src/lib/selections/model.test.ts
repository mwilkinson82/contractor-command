import { describe, expect, it } from "vitest";
import { boardSchema, boardSummary, differenceFromAllowance, selectionSchema } from "./model";

const row = () => ({
  id: "72087ad6-fc97-4938-97b3-802803bf49c5",
  title: "Countertop",
  decision_due: "2026-11-04",
  allowance_cents: 500000,
  options: {
    good: {
      description: "Laminate",
      cost_cents: 300000,
      price_cents: 300000,
      specifications: "",
      source_url: null,
      photo_url: null,
    },
    better: {
      description: "Quartz",
      cost_cents: 550000,
      price_cents: 550000,
      specifications: "",
      source_url: null,
      photo_url: null,
    },
    best: {
      description: "Stone",
      cost_cents: null,
      price_cents: null,
      specifications: "",
      source_url: null,
      photo_url: null,
    },
  },
  selected: null,
  notes: "",
});

describe("residential selection model", () => {
  it("calculates exact differences while keeping unknown amounts unknown", () => {
    const selection = selectionSchema.parse(row());
    expect(differenceFromAllowance(selection, "good")).toBe(-200000);
    expect(differenceFromAllowance(selection, "better")).toBe(50000);
    expect(differenceFromAllowance(selection, "best")).toBeNull();
    expect(differenceFromAllowance({ ...selection, allowance_cents: null }, "good")).toBeNull();
    expect(differenceFromAllowance({ ...selection, allowance_cents: 0 }, "good")).toBe(300000);
    expect(
      differenceFromAllowance(
        {
          ...selection,
          options: {
            ...selection.options,
            good: {
              description: "Included",
              cost_cents: 0,
              price_cents: 0,
              specifications: "",
              source_url: null,
              photo_url: null,
            },
          },
        },
        "good",
      ),
    ).toBe(-500000);
  });

  it("counts only unselected items overdue before the supplied local date", () => {
    const first = row();
    const second = { ...row(), id: "65d6ebcb-b09e-4bb3-9661-3d3bc53e99d1", decision_due: null };
    const third = {
      ...row(),
      id: "97e499ac-3f8e-46d7-b683-0f60c8f010cb",
      decision_due: "2026-11-01",
      selected: "better",
    };
    const board = boardSchema.parse({ currency: "USD", selections: [first, second, third] });
    expect(boardSummary(board, "2026-11-04")).toEqual({
      total: 3,
      pending: 2,
      overdue: 0,
      missing_date: 1,
    });
    expect(boardSummary(board, "2026-11-05")).toEqual({
      total: 3,
      pending: 2,
      overdue: 1,
      missing_date: 1,
    });
  });

  it("rejects invalid dates, fractional or negative prices, duplicate IDs and unknown fields", () => {
    expect(selectionSchema.safeParse({ ...row(), decision_due: "2026-02-30" }).success).toBe(false);
    expect(selectionSchema.safeParse({ ...row(), allowance_cents: 0.1 }).success).toBe(false);
    expect(selectionSchema.safeParse({ ...row(), allowance_cents: -1 }).success).toBe(false);
    expect(selectionSchema.safeParse({ ...row(), extra: "unexpected" }).success).toBe(false);
    expect(boardSchema.safeParse({ currency: null, selections: [row(), row()] }).success).toBe(
      false,
    );
  });

  it("requires a description for a recorded choice without requiring an invented price", () => {
    const empty = row();
    empty.options.good.description = " ";
    expect(selectionSchema.safeParse({ ...empty, selected: "good" }).success).toBe(false);
    expect(selectionSchema.safeParse({ ...row(), selected: "best" }).success).toBe(true);
  });
});
