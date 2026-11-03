import { describe, expect, it } from "vitest";
import { assembleBid, type RateChoice } from "./estimating-bid";
import { calculateEstimatePricing, directBidRows } from "./estimating-pricing";
import { applyReviewedQuoteCoverage, type CoverageSnapshot } from "./estimating-quote-pricing";

const lines = [
  {
    kind: "line" as const,
    ref: "T-1",
    status: "settled" as const,
    title: "Paint",
    qty: 100,
    unit: "SF",
  },
  {
    kind: "line" as const,
    ref: "T-2",
    status: "settled" as const,
    title: "Floor",
    qty: 100,
    unit: "SF",
  },
];
const rates = {
  labor: [
    { ref: "T-1", man_hours: 10, hourly_rate: 100, confirmed: true },
    { ref: "T-2", man_hours: 0, hourly_rate: 100, confirmed: true },
  ],
  material: [
    { ref: "T-1", unit_price: 5, confirmed: true },
    { ref: "T-2", unit_price: 5, confirmed: true },
  ],
  sources: [],
};
const quotes = [
  { sub: "Contractor A", description: "Paint", ref: "T-1", amount: 1400 },
  { sub: "Contractor B", description: "Paint", ref: "T-1", amount: 1600 },
];
const snapshot = (): CoverageSnapshot => ({
  version: 7,
  selection: {
    version: 7,
    current: true,
    decisions: [
      {
        quote_index: 0,
        ref: "T-1",
        decision: "carry",
        quote: quotes[0],
        replace_labor_and_material: true,
        exclusive_to_line: true,
      },
      { quote_index: 1, ref: "T-1", decision: "compare", quote: quotes[1] },
    ],
  },
});
const pricing = () => calculateEstimatePricing(lines, rates);
const bid = (coverage: ReturnType<typeof applyReviewedQuoteCoverage>) =>
  assembleBid({
    direct: pricing().direct,
    directPlaceholder: false,
    directBlockers: pricing().blockers,
    quoteCoverage: coverage,
    quotes,
    gc: [{ label: "Office", amount: 200, placeholder: false, risk: false, note: "" }],
    requirements: [
      {
        ref: "R-1",
        kind: "permit",
        description: null,
        label: "Permit",
        sourceType: "sheet",
        sourceRef: "A-1",
        citation: "permit",
        placement: "own_line",
        amount: 500,
        confirmed: true,
        excluded: false,
      },
    ],
    overheadPct: 10,
    profitPct: 10,
    settled: true,
  });

describe("reviewed quote pricing against one saved snapshot", () => {
  it("replaces one entire direct line, retains comparison, and assembles exact totals", () => {
    const covered = applyReviewedQuoteCoverage(pricing(), quotes, snapshot());
    expect(covered).toMatchObject({ accepted: true, direct: 1900, blockers: [] });
    const result = bid(covered);
    expect(result).toMatchObject({
      ready: true,
      total: 3146,
      breakdown: {
        direct: [
          { ref: "T-1", basis: "quote", amountCents: 140000, quoteId: "0" },
          { ref: "T-2", basis: "direct", amountCents: 50000, quoteId: null },
        ],
        generalConditionsCents: 20000,
        directCents: 190000,
        requirementsCents: 50000,
        overheadCents: 26000,
        profitCents: 28600,
        totalCents: 314600,
      },
    });
    expect(result.lines.join("\n")).toContain("Contractor B");
    expect(result.lines.join("\n")).toContain("Carried for T-1");
    expect(result.lines.join("\n")).toContain("Comparison only");
  });
  it("holds old, missing, duplicate or altered quote decisions", () => {
    const stale = snapshot();
    stale.version = 8;
    const duplicate = snapshot();
    duplicate.selection!.decisions[1].quote_index = 0;
    const changed = snapshot();
    changed.selection!.decisions[0].quote = { ...quotes[0], amount: 1300 };
    const missing = snapshot();
    missing.selection!.decisions.pop();
    const overlap = snapshot();
    overlap.selection!.decisions[0].exclusive_to_line = false;
    for (const entry of [null, stale, duplicate, changed, missing, overlap]) {
      const covered = applyReviewedQuoteCoverage(pricing(), quotes, entry);
      expect(covered.accepted).toBe(false);
      expect(bid(covered)).toMatchObject({ ready: false, total: null, breakdown: null });
    }
  });
  it("accepts an explicitly free carried quote and an unpriced comparison", () => {
    const free = [
      { ...quotes[0], amount: 0 },
      { ...quotes[1], amount: null },
    ];
    const s = snapshot();
    s.selection!.decisions[0].quote = free[0];
    s.selection!.decisions[1].quote = free[1];
    expect(applyReviewedQuoteCoverage(pricing(), free, s)).toMatchObject({
      direct: 500,
      blockers: [],
    });
  });
  it("requires uncovered direct prices but does not require replaced direct prices", () => {
    const withoutCarried = calculateEstimatePricing(lines, {
      labor: rates.labor.filter((r) => r.ref === "T-2"),
      material: rates.material.filter((r) => r.ref === "T-2"),
      sources: [],
    });
    expect(applyReviewedQuoteCoverage(withoutCarried, quotes, snapshot())).toMatchObject({
      direct: 1900,
      blockers: [],
    });
    const withoutOther = calculateEstimatePricing(lines, {
      labor: rates.labor.filter((r) => r.ref === "T-1"),
      material: rates.material.filter((r) => r.ref === "T-1"),
      sources: [],
    });
    expect(
      applyReviewedQuoteCoverage(withoutOther, quotes, snapshot()).blockers.join(" "),
    ).toContain("T-2");
  });
  it("retains global orphan-rate blockers and rejects duplicate carried lines", () => {
    const orphan = calculateEstimatePricing(lines, {
      ...rates,
      labor: [...rates.labor, { ...rates.labor[0], ref: "T-99" }],
    });
    expect(applyReviewedQuoteCoverage(orphan, quotes, snapshot()).blockers.join(" ")).toContain(
      "T-99",
    );
    const competing = snapshot();
    competing.selection!.decisions[1].decision = "carry";
    competing.selection!.decisions[1].replace_labor_and_material = true;
    competing.selection!.decisions[1].exclusive_to_line = true;
    const result = applyReviewedQuoteCoverage(pricing(), quotes, competing);
    expect(result.blockers.join(" ")).toContain("more than one quote");
    expect(result.direct).toBeNull();
    expect(bid(result).ready).toBe(false);
    expect(bid(result).lines.join(" ")).toContain("Unresolved pending review");
  });

  it("keeps an active gap as a global blocker when a quote replaces another line", () => {
    const gap = {
      ref: "G-1",
      kind: "gap" as const,
      status: "settled" as const,
      title: "Additional work",
      qty: 15,
      unit: "SF",
    };
    const withGap = calculateEstimatePricing([...lines, gap], rates);
    const result = applyReviewedQuoteCoverage(withGap, quotes, snapshot());
    expect(result.blockers.join(" ")).toContain("G-1");
    expect(bid(result)).toMatchObject({ ready: false, total: null });
    const dropped = calculateEstimatePricing([...lines, { ...gap, status: "dropped" }], rates);
    expect(applyReviewedQuoteCoverage(dropped, quotes, snapshot()).blockers).toEqual([]);
  });

  it("keeps conflicting factor-source decisions as a global blocker after quote selection", () => {
    const withDuplicates = calculateEstimatePricing(lines, {
      ...rates,
      sources: [
        { source: "rsmeans", carry: true, location_factor: 1.2, confirmed: true },
        { source: "rsmeans", carry: false, location_factor: 1.4, confirmed: true },
      ],
    });
    const result = applyReviewedQuoteCoverage(withDuplicates, quotes, snapshot());
    expect(result.blockers.join(" ")).toContain("Rate source rsmeans");
    expect(bid(result)).toMatchObject({ ready: false, total: null });
  });
  it("holds malformed saved carry decisions even when a quote replaces the affected direct line", () => {
    const invalid = calculateEstimatePricing(lines, {
      ...rates,
      sources: [
        {
          source: "rsmeans",
          carry: "false",
          location_factor: 2,
          confirmed: true,
        } as unknown as RateChoice,
      ],
    });
    const result = applyReviewedQuoteCoverage(invalid, quotes, snapshot());
    expect(result.blockers.join(" ")).toMatch(/rate source.*invalid/i);
    expect(bid(result)).toMatchObject({ ready: false, total: null });
  });

  it("emits exact direct rows for a quote-less bid without recomputing prices", () => {
    const p = pricing();
    expect(directBidRows(p)).toEqual([
      { ref: "T-1", basis: "direct", amountCents: 150000, quoteId: null },
      { ref: "T-2", basis: "direct", amountCents: 50000, quoteId: null },
    ]);
    const result = assembleBid({
      direct: p.direct,
      directPlaceholder: p.placeholder,
      directBlockers: p.blockers,
      directRows: directBidRows(p),
      gc: [],
      requirements: [],
      overheadPct: 10,
      profitPct: 10,
      settled: true,
    });
    expect(result.breakdown).toMatchObject({ directCents: 200000, totalCents: 242000 });
    expect(
      directBidRows({
        ...p,
        rows: [{ ...p.rows[0], labor: { ...p.rows[0].labor, amount: null } }],
      }),
    ).toBeNull();
  });

  it("holds overflow in compounded totals instead of returning an unsafe amount", () => {
    const result = assembleBid({
      direct: 45035996273704,
      directPlaceholder: false,
      gc: [],
      requirements: [],
      overheadPct: 100,
      profitPct: 100,
      settled: true,
    });
    expect(result).toMatchObject({ ready: false, total: null, breakdown: null });
    expect(result.blockers.join(" ")).toContain("cent range");
  });
  it("holds fractional cents, nonfinite or overflowing carried quote amounts", () => {
    for (const amount of [0.001, Infinity, Number.MAX_SAFE_INTEGER]) {
      const invalid = [{ ...quotes[0], amount }, quotes[1]];
      const s = snapshot();
      s.selection!.decisions[0].quote = invalid[0];
      const result = applyReviewedQuoteCoverage(pricing(), invalid, s);
      expect(result.blockers.length).toBeGreaterThan(0);
      expect(
        assembleBid({
          direct: pricing().direct,
          directPlaceholder: false,
          quoteCoverage: result,
          quotes: invalid,
          gc: [],
          requirements: [],
          overheadPct: 0,
          profitPct: 0,
          settled: true,
        }).ready,
      ).toBe(false);
    }
  });
});
