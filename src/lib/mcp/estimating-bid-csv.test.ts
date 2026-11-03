import { describe, expect, it } from "vitest";
import { assembleBid } from "./estimating-bid";
import { canonicalBidCsv } from "./estimating-bid-csv";
import { calculateEstimatePricing } from "./estimating-pricing";
import { applyReviewedQuoteCoverage } from "./estimating-quote-pricing";

describe("canonical bid CSV", () => {
  it("exports the exact reviewed quote replacement and assembled bid once", () => {
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
    const pricing = calculateEstimatePricing(lines, {
      labor: [{ ref: "T-2", man_hours: 0, hourly_rate: 100, confirmed: true }],
      material: [{ ref: "T-2", unit_price: 5, confirmed: true }],
      sources: [],
    });
    const quotes = [
      { sub: "A", description: "Paint", ref: "T-1", amount: 1400 },
      { sub: "B", description: "Paint", ref: "T-1", amount: 1600 },
    ];
    const coverage = applyReviewedQuoteCoverage(pricing, quotes, {
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
    expect(coverage.blockers).toEqual([]);
    const bid = assembleBid({
      direct: pricing.direct,
      directPlaceholder: pricing.placeholder,
      directBlockers: pricing.blockers,
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
    const csv = canonicalBidCsv({
      job: "Project",
      version: 7,
      ready: bid.ready,
      breakdown: bid.breakdown,
    });
    expect(bid.total).toBe(3146);
    expect(csv).toContain('"scope","T-1","","quote","0",1400.00');
    expect(csv).toContain('"scope","T-2","","direct","",500.00');
    expect(csv).toContain('"general_conditions","","Office","gc","",200.00');
    expect(csv).toContain('"requirement","R-1","Permit","own_line","",500.00');
    expect(csv).toContain('"markup","","Overhead","","",260.00');
    expect(csv).toContain('"markup","","Profit","","",286.00');
    expect(csv).toContain('"total","","Bid total","","",3146.00');
    expect(csv).not.toContain("1600.00");
  });
  it("does not export held, incomplete, or inconsistent totals", () => {
    expect(
      canonicalBidCsv({ job: "Project", version: 7, ready: false, breakdown: null }),
    ).toBeNull();
    expect(
      canonicalBidCsv({ job: "Project", version: "unknown", ready: true, breakdown: null }),
    ).toBeNull();
    expect(
      canonicalBidCsv({
        job: "Project",
        version: 7,
        ready: true,
        breakdown: {
          direct: [{ ref: "T-1", basis: "quote", quoteId: "0", amountCents: 140000 }],
          generalConditions: [],
          requirements: [],
          directCents: 140000,
          generalConditionsCents: 0,
          requirementsCents: 0,
          overheadCents: 0,
          profitCents: 0,
          totalCents: 139999,
        },
      }),
    ).toBeNull();
  });
  it("escapes spreadsheet formulas in labels while preserving zero amounts", () => {
    const csv = canonicalBidCsv({
      job: "=1+1",
      version: 0,
      ready: true,
      breakdown: {
        direct: [{ ref: "T-1", basis: "quote", quoteId: "0", amountCents: 0 }],
        generalConditions: [{ label: "+2+2", ref: null, placement: "gc", amountCents: 0 }],
        requirements: [],
        directCents: 0,
        generalConditionsCents: 0,
        requirementsCents: 0,
        overheadCents: 0,
        profitCents: 0,
        totalCents: 0,
      },
    });
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"\'+2+2"');
    expect(csv).toContain('"total","","Bid total","","",0.00');
  });
});
