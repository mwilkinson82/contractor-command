import { describe, expect, it } from "vitest";
import { boardSchema, normalizeUrl } from "./model";
import { enforceReviews } from "./reviews";
import { TYPE_E_ID, willowCreekTypeE } from "./__fixtures__/willow-creek-type-e";

describe("price reviews", () => {
  it("keep a review when only notes or order change", () => {
    const prev = willowCreekTypeE();
    const next = structuredClone(prev);
    next.selections[0].options.best.assumptions = "Updated note";
    next.selections[0].notes = "Call the customer Friday";
    expect(enforceReviews(prev, next).cleared).toEqual([]);
  });

  it("clear a review whose price, cost or product changed, unless confirmed in this call", () => {
    const prev = willowCreekTypeE();
    const next = structuredClone(prev);
    next.selections[0].options.best.cost_cents = 1;
    next.selections[0].options.better.model = "Other";
    const out = enforceReviews(prev, next);
    expect(out.cleared).toEqual([
      "Type E 2x4 lay-in LED fixtures (Better) price",
      "Type E 2x4 lay-in LED fixtures (Best) price",
    ]);
    expect(out.board.selections[0].options.best.price_reviewed_on).toBeNull();
    const granted = enforceReviews(prev, next, { option: { id: TYPE_E_ID, tier: "best" } });
    expect(granted.cleared).toEqual(["Type E 2x4 lay-in LED fixtures (Better) price"]);
  });

  it("never let a save set a review date by itself", () => {
    const prev = willowCreekTypeE(false);
    const next = structuredClone(prev);
    next.selections[0].options.good.price_reviewed_on = "2026-11-04";
    next.proposal.base_reviewed_on = "2026-11-04";
    const out = enforceReviews(prev, next);
    expect(out.board.selections[0].options.good.price_reviewed_on).toBeNull();
    expect(out.board.proposal.base_reviewed_on).toBeNull();
  });

  it("clear the base review when what the base covers changes", () => {
    const prev = willowCreekTypeE();
    for (const change of [
      (b: ReturnType<typeof willowCreekTypeE>) => (b.selections[0].quantity = 7),
      (b: ReturnType<typeof willowCreekTypeE>) => (b.selections[0].options.good.price_cents = 1),
      (b: ReturnType<typeof willowCreekTypeE>) => (b.proposal.base_tier = "better"),
      (b: ReturnType<typeof willowCreekTypeE>) => b.selections.pop(),
    ]) {
      const next = structuredClone(prev);
      change(next);
      expect(enforceReviews(prev, next).board.proposal.base_reviewed_on).toBeNull();
    }
    // A Better-tier change does not touch a Good base.
    const next = structuredClone(prev);
    next.selections[0].options.better.price_cents = 1;
    expect(enforceReviews(prev, next).board.proposal.base_reviewed_on).toBe("2026-11-04");
  });

  it("clear every review when the currency changes, but not when it is first set", () => {
    const prev = willowCreekTypeE();
    const eur = structuredClone(prev);
    eur.currency = "EUR";
    expect(enforceReviews(prev, eur).cleared).toHaveLength(4);
    const unset = structuredClone(prev);
    unset.currency = null;
    expect(enforceReviews(unset, prev).cleared).toEqual([]);
  });
});

describe("links and quantities match the database rules", () => {
  const withUrl = (u: string) => {
    const b = willowCreekTypeE();
    b.selections[0].options.good.photo_url = u;
    return boardSchema.safeParse(b).success;
  };
  it("accept only full https links with no spaces", () => {
    expect(withUrl("https://img.example.com/a%20b.jpg")).toBe(true);
    for (const bad of ["https://a.com/x y", "https:a.com", "HTTPS://a.com", "http://a.com"])
      expect(withUrl(bad)).toBe(false);
    expect(normalizeUrl(" HTTPS://Img.Example.com/a b.jpg ")).toBe(
      "https://img.example.com/a%20b.jpg",
    );
  });
  it("accept quantities with at most three exact decimals", () => {
    const b = willowCreekTypeE();
    b.selections[0].quantity = 0.30000000000000004;
    expect(boardSchema.safeParse(b).success).toBe(false);
    b.selections[0].quantity = 12.125;
    expect(boardSchema.safeParse(b).success).toBe(true);
  });
});
