import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ESTIMATE_SERVER_RULE } from "./estimating";
import {
  basisExplains,
  keepUnexplainedGaps,
  openQuestion,
  reviewEstimatorLine,
  reviewEstimatorLines,
  scopeCallout,
  splitScope,
} from "./estimating-method";

describe("estimating method", () => {
  it("does not fit an undefined drawing quantity to the estimator's number", () => {
    const dowels = openQuestion({
      item: "#4 dowels under S-100 note 10",
      sheet: "S-100",
      detail: "note 10",
      unit: "EA",
      reasoning: "Note 10 names the joints and corners but does not locate or count the dowels.",
      estimatorQty: 12,
    });
    expect(dowels.qty).toBeNull();
    expect(dowels.title.startsWith("OPEN QUESTION")).toBe(true);
    expect(dowels.reasoning).toContain("S-100");
    expect(dowels.reasoning).toContain("note 10");
    expect(dowels.reasoning).not.toMatch(/\b12\b/);

    const trench = reviewEstimatorLine({
      item: "Trench wall depth",
      qty: 36,
      unit: "in",
      sheet: "S-103",
      note: "Depth is drawn somewhere between the 27 in and 38 in sections.",
      drawingDefined: null,
      drawingLow: 27,
      drawingHigh: 38,
    });
    expect(trench.kind).toBe("open");
    if (trench.kind !== "open") return;
    expect(trench.question.qty).toBeNull();
    expect(trench.question.low).toBe(27);
    expect(trench.question.high).toBe(38);
    expect(trench.question.reasoning).toContain("S-103");
    expect(trench.question.reasoning).toContain("Low 27");
    expect(trench.question.reasoning).toContain("high 38");
    expect(trench.question.reasoning).not.toMatch(/\b36\b/);

    const rules = ESTIMATE_SERVER_RULE + readFileSync("src/lib/mcp/tools/estimate-tools.ts", "utf8");
    expect(rules).toMatch(/must not back-solve|Do not back-solve/);
    expect(rules).toMatch(/estimator's number/);
  });

  it("reads the 263 LF x 4 in note before calling a gap on 87 SFCA", () => {
    const note = '[Generated] Edge forms: est. 263 LF perimeter × 4" thick = 87 SFCA';
    const basis = basisExplains(note, 87, "SFCA");
    expect(basis.explained).toBe(true);
    expect(basis.formula).toContain("263 LF");
    expect(basis.computed).toBeCloseTo(87.67, 1);
    const review = reviewEstimatorLine({
      item: "Formwork for Fiber-Reinforced Slab-on-Grade Additive",
      qty: 87,
      unit: "SFCA",
      note,
      sheet: "S-100",
    });
    expect(review.kind).toBe("explained");
    const kept = keepUnexplainedGaps(
      [
        {
          title: "Formwork for Fiber-Reinforced Slab-on-Grade Additive",
          reasoning: "87 SFCA has no geometric basis.",
        },
      ],
      review.kind === "explained" ? [{ item: review.item, formula: review.formula }] : [],
    );
    expect(kept).toEqual([]);
    const missing = reviewEstimatorLine({
      item: "Formwork for Fiber-Reinforced Slab-on-Grade Additive",
      qty: 87,
      unit: "SFCA",
      note: "no geometric basis",
      sheet: "S-100",
    });
    expect(missing.kind).toBe("gap");
  });

  it("puts BY G.C. callouts in their own section before the compare", () => {
    expect(scopeCallout("12/S-101 TIRE SEAL DRAINAGE (BY G.C.)")).toMatch(/BY G\.C/i);
    expect(scopeCallout("work by others")).toMatch(/by others/i);
    expect(scopeCallout("NIC")).toMatch(/NIC/i);
    expect(scopeCallout("not in contract")).toMatch(/not in contract/i);
    const split = splitScope([
      { text: "12/S-101 TIRE SEAL DRAINAGE (BY G.C.)", sheet: "S-101" },
      { text: "Wall footing WF-1", sheet: "S-100" },
    ]);
    expect(split.inScope.map((row) => row.text)).toEqual(["Wall footing WF-1"]);
    expect(split.outOfScope).toEqual([
      expect.objectContaining({ sheet: "S-101", callout: expect.stringMatching(/BY G\.C/i) }),
    ]);
    const reviewed = reviewEstimatorLines([
      { item: "Tire seal drainage", qty: 1, unit: "EA", sheet: "S-101", callout: "BY G.C." },
      { item: "Wall footing", qty: 174, unit: "LF", sheet: "S-100", note: "Measured on the plan." },
    ]);
    expect(reviewed.outOfScope.map((row) => row.item)).toEqual(["Tire seal drainage"]);
    expect(reviewed.outOfScope[0].sheet).toBe("S-101");
    expect(reviewed.gaps.map((row) => row.item)).not.toContain("Tire seal drainage");
  });
});
