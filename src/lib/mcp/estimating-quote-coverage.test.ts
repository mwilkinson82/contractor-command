import { describe, expect, it } from "vitest";
import {
  reconcileQuoteCoverage,
  type CoverageLine,
  type CoverageQuote,
} from "./estimating-quote-coverage";

const lines: CoverageLine[] = [
  {
    ref: "T-1",
    scopeKey: "version-1-accepted-geometry",
    directCents: 150000,
    directConfirmed: true,
  },
  { ref: "T-2", scopeKey: "version-1-detail", directCents: 50000, directConfirmed: true },
];
const quote: CoverageQuote = {
  id: "quote-a",
  ref: "T-1",
  amountCents: 140000,
  decision: "carry",
  confirmed: true,
  reviewedScopeKey: "version-1-accepted-geometry",
  reviewedAmountCents: 140000,
  reviewedQuoteId: "quote-a",
  reviewedRef: "T-1",
  quoteFingerprint: "source-and-terms-a",
  reviewedQuoteFingerprint: "source-and-terms-a",
};

describe("explicit whole-line quote coverage", () => {
  it("replaces the direct basis exactly once and preserves a competing comparison", () => {
    const result = reconcileQuoteCoverage(lines, [
      quote,
      { ...quote, id: "quote-b", amountCents: 160000, decision: "compare" },
    ]);
    expect(result).toMatchObject({ ready: true, totalCents: 190000 });
    expect(result.rows).toEqual([
      { ref: "T-1", basis: "quote", amountCents: 140000, quoteId: "quote-a" },
      { ref: "T-2", basis: "direct", amountCents: 50000, quoteId: null },
    ]);
  });
  it("holds empty scope and a changed quote amount", () => {
    expect(reconcileQuoteCoverage([], []).ready).toBe(false);
    expect(reconcileQuoteCoverage(lines, [{ ...quote, amountCents: 130000 }]).ready).toBe(false);
    expect(reconcileQuoteCoverage(lines, [{ ...quote, id: "quote-c" }]).ready).toBe(false);
    expect(
      reconcileQuoteCoverage(lines, [{ ...quote, quoteFingerprint: "changed-terms" }]).ready,
    ).toBe(false);
    expect(
      reconcileQuoteCoverage(lines, [
        { ...quote, ref: "T-2", reviewedScopeKey: "version-1-detail" },
      ]).ready,
    ).toBe(false);
  });
  it("holds competing carried quotes in either order", () => {
    const quotes = [quote, { ...quote, id: "quote-b" }];
    for (const order of [quotes, [...quotes].reverse()])
      expect(reconcileQuoteCoverage(lines, order)).toMatchObject({
        ready: false,
        totalCents: null,
      });
  });
  it("holds when takeoff source evidence has changed", () => {
    expect(reconcileQuoteCoverage([{ ...lines[0], scopeKey: "version-2" }], [quote])).toMatchObject(
      { ready: false, totalCents: null },
    );
  });
  it("never treats unpriced, unconfirmed, stale or unidentified coverage as selected", () => {
    for (const changed of [
      { ...quote, amountCents: null },
      { ...quote, confirmed: false },
      { ...quote, ref: "T-99" },
      { ...quote, decision: null },
    ])
      expect(reconcileQuoteCoverage(lines, [changed]).ready).toBe(false);
  });
  it("accepts explicit zero and ignores an unpriced comparison", () => {
    const selected = { ...quote, amountCents: 0, reviewedAmountCents: 0 };
    expect(
      reconcileQuoteCoverage(lines, [
        selected,
        { ...quote, id: "other", amountCents: null, decision: "compare" },
      ]),
    ).toMatchObject({ ready: true, totalCents: 50000 });
  });
  it("holds duplicate identity, duplicate line references and invalid money", () => {
    expect(reconcileQuoteCoverage(lines, [quote, { ...quote, decision: "compare" }]).ready).toBe(
      false,
    );
    expect(reconcileQuoteCoverage([lines[0], lines[0]], [quote]).ready).toBe(false);
    for (const amountCents of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(reconcileQuoteCoverage(lines, [{ ...quote, amountCents }]).ready).toBe(false);
  });
  it("requires direct costs for uncovered lines, without requiring them for a fully replaced line", () => {
    const unknown = lines.map((line) => ({ ...line, directCents: null, directConfirmed: false }));
    expect(reconcileQuoteCoverage([unknown[0]], [quote])).toMatchObject({
      ready: true,
      totalCents: 140000,
    });
    expect(reconcileQuoteCoverage(unknown, [quote])).toMatchObject({
      ready: false,
      totalCents: null,
    });
  });
});
