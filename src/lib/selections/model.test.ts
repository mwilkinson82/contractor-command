import { describe, expect, it } from "vitest";
import { boardSchema, boardSummary, differenceFromAllowance, emptyBoard, extended } from "./model";
import { willowCreekTypeE } from "./__fixtures__/willow-creek-type-e";

describe("selections model", () => {
  it("accepts the Willow Creek fixture and an empty board", () => {
    expect(boardSchema.parse(willowCreekTypeE())).toEqual(willowCreekTypeE());
    expect(boardSchema.parse(emptyBoard())).toEqual(emptyBoard());
  });

  it("rejects unknown fields so private data can't hide in extra keys", () => {
    const b = willowCreekTypeE() as unknown as { selections: { options: { good: Record<string, unknown> } }[] };
    b.selections[0].options.good.margin = 1;
    expect(boardSchema.safeParse(b).success).toBe(false);
    expect(boardSchema.safeParse({ ...willowCreekTypeE(), extra: true }).success).toBe(false);
  });

  it("rejects bad amounts, links, quantities, dates and duplicate IDs", () => {
    const cases: ((b: ReturnType<typeof willowCreekTypeE>) => void)[] = [
      (b) => (b.selections[0].options.good.price_cents = -1),
      (b) => (b.selections[0].options.good.price_cents = 1.5),
      (b) => (b.selections[0].options.good.source_url = "http://example.com/x"),
      (b) => (b.selections[0].options.good.photo_url = "javascript:alert(1)"),
      (b) => (b.selections[0].quantity = 0),
      (b) => (b.selections[0].quantity = 1.2345),
      (b) => (b.selections[0].decision_due = "2026-02-30"),
      (b) => (b.selections[0].estimate_line_ref = "L-1"),
      (b) => b.selections.push({ ...b.selections[0] }),
      (b) => {
        b.selections[0].options.good.price_cents = null;
      },
      (b) => {
        b.proposal.base_price_cents = null;
      },
    ];
    for (const mutate of cases) {
      const b = willowCreekTypeE();
      mutate(b);
      expect(boardSchema.safeParse(b).success).toBe(false);
    }
  });

  it("rounds extended totals half up to the cent with exact quantity math", () => {
    expect(extended(6, 9800)).toBe(58800);
    expect(extended(12.5, 333)).toBe(4163);
    expect(extended(0.1, 3)).toBe(0);
    expect(extended(0.167, 3)).toBe(1);
    expect(extended(1_000_000, 100_000_000_000)).toBeNull();
    expect(extended(2, null)).toBeNull();
  });

  it("compares the selection total with its allowance and counts pending choices", () => {
    const b = willowCreekTypeE();
    b.selections[0].allowance_cents = 60000;
    expect(differenceFromAllowance(b.selections[0], "good")).toBe(-1200);
    expect(differenceFromAllowance(b.selections[0], "best")).toBe(167400);
    expect(boardSummary(b, "2026-11-21")).toEqual({ total: 1, pending: 1, overdue: 1, missing_date: 0 });
  });
});
