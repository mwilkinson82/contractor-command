import { describe, expect, it } from "vitest";
import { calculateEstimatePricing, type MaterialIn } from "./estimating-pricing";
import { gcLineAmount, type LaborIn, type RateChoice } from "./estimating-bid";

const line = {
  ref: "T-1",
  title: "Paint",
  kind: "line" as const,
  status: "settled" as const,
  qty: 100,
  unit: "SF",
};
const labor: LaborIn = {
  ref: "T-1",
  production_per_man_hour: 10,
  hourly_rate: 100,
  confirmed: true,
};
const material: MaterialIn = { ref: "T-1", unit_price: 5, confirmed: true };
const source: RateChoice = {
  source: "rsmeans",
  carry: true,
  location_factor: 1.2,
  work_factor: 1.1,
  confirmed: true,
};
const calculate = (lab = [labor], mat = [material], sources: RateChoice[] = []) =>
  calculateEstimatePricing([line], { labor: lab, material: mat, sources });

describe("canonical component pricing", () => {
  it("keeps confirmed zero costs valid while missing components block", () => {
    expect(
      calculate([{ ...labor, hourly_rate: 0 }], [{ ...material, unit_price: 0 }]),
    ).toMatchObject({ direct: 0, placeholder: false, blockers: [] });
    expect(calculate([labor], []).blockers.join(" ")).toContain("material price");
    expect(calculate([], [material]).blockers.join(" ")).toContain("labor rate");
    expect(calculate([{ ...labor, hourly_rate: null }]).blockers.join(" ")).toContain(
      "hourly rate",
    );
  });
  it("applies explicitly requested material factors as well as labor factors", () => {
    expect(
      calculate(
        [{ ...labor, apply_factor: true }],
        [{ ...material, apply_factor: true }],
        [source],
      ),
    ).toMatchObject({ direct: 1980, blockers: [] });
    expect(calculate([labor], [material], [source])).toMatchObject({ direct: 1500, blockers: [] });
  });
  it("chooses explicit sources by component and never substitutes a mismatched source", () => {
    const neca: RateChoice = { source: "neca", carry: true, location_factor: 2, confirmed: true };
    const chosen = calculate(
      [{ ...labor, source: "neca", apply_factor: true }],
      [{ ...material, source: "rsmeans", apply_factor: true }],
      [source, neca],
    );
    expect(chosen).toMatchObject({ direct: 2660, blockers: [] });
    const missing = calculate(
      [{ ...labor, source: "neca", apply_factor: true }],
      [material],
      [source],
    );
    expect(missing.rows[0].labor.amount).toBeNull();
    expect(missing.blockers.join(" ")).toContain("select one carried factor source");
  });
  it.each(
    [
      [],
      [source, { ...source, source: "neca" as const }],
      [{ ...source, carry: false }],
      [{ ...source, location_factor: null, work_factor: null }],
      [source, source],
    ].map((sources) => ({ sources })),
  )("holds missing or ambiguous factor choices %#", ({ sources }) => {
    const result = calculate([{ ...labor, apply_factor: true }], [material], sources);
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.rows[0].labor.amount).toBeNull();
  });
  it("requires factor confirmation even with confirmed base rates", () => {
    expect(
      calculate([{ ...labor, apply_factor: true }], [material], [{ ...source, confirmed: false }]),
    ).toMatchObject({ direct: 1820, placeholder: true });
    expect(calculate([{ ...labor, confirmed: false }]).blockers.join(" ")).toContain(
      "confirm the rate",
    );
  });
  it("preserves current sequential cent rounding and deterministic retries", () => {
    const calculateAgain = () =>
      calculate(
        [{ ...labor, man_hours: 0.333, hourly_rate: 0.05, apply_factor: true }],
        [{ ...material, unit_price: 0 }],
        [{ ...source, location_factor: 1.25, work_factor: 1.25 }],
      );
    expect(calculateAgain().direct).toBe(0.04);
    expect(calculateAgain()).toEqual(calculateAgain());
  });
  it("does not carry dropped lines or their historical rates", () => {
    const result = calculateEstimatePricing([{ ...line, status: "dropped" }], {
      labor: [labor],
      material: [material],
      sources: [],
    });
    expect(result).toEqual({ rows: [], direct: 0, placeholder: false, blockers: [] });
  });
  it("holds orphan references from an earlier line list", () => {
    expect(calculate([{ ...labor, ref: "T-99" }]).blockers.join(" ")).toContain(
      "no current line matches",
    );
  });
  it("rejects ambiguous legacy titles and duplicate ref/title rates", () => {
    const ambiguous = calculateEstimatePricing([line, { ...line, ref: "T-2" }], {
      labor: [{ ...labor, ref: "Paint" }],
      material: [],
      sources: [],
    });
    expect(ambiguous.direct).toBe(0);
    expect(ambiguous.blockers.join(" ")).toContain("ambiguous");
    expect(calculate([labor, { ...labor, ref: "Paint" }]).blockers.join(" ")).toContain(
      "ambiguous",
    );
  });
  it("does not interpret a stable reference as another line's title", () => {
    const result = calculateEstimatePricing(
      [
        { ...line, title: "T-2" },
        { ...line, ref: "T-2" },
      ],
      {
        labor: [labor, { ...labor, ref: "T-2" }],
        material: [material, { ...material, ref: "T-2" }],
        sources: [],
      },
    );
    expect(result).toMatchObject({ direct: 3000, blockers: [] });
  });
  it.each([-1, NaN, Infinity])("refuses invalid quantity %s", (qty) => {
    expect(() =>
      calculateEstimatePricing([{ ...line, qty }], {
        labor: [labor],
        material: [material],
        sources: [],
      }),
    ).toThrow();
  });
  it.each([-1, NaN, Infinity, 0])("refuses invalid applied factor %s", (factor) => {
    expect(() =>
      calculate(
        [{ ...labor, apply_factor: true }],
        [material],
        [{ ...source, location_factor: factor }],
      ),
    ).toThrow();
  });
  it("refuses negative, nonfinite and overflowing costs", () => {
    for (const hourly_rate of [-1, Infinity, NaN, Number.MAX_VALUE])
      expect(() => calculate([{ ...labor, hourly_rate }])).toThrow();
    expect(() => calculate([labor], [{ ...material, unit_price: -1 }])).toThrow();
  });
  it.each([undefined, 0, 10])(
    "supports confirmed supervision lump sums without a schedule (%s)",
    (duration) => {
      expect(
        gcLineAmount({ key: "supervision", amount: 0, duration, confirmed: true }),
      ).toMatchObject({ amount: 0, placeholder: false, missing: null });
      expect(
        gcLineAmount({ key: "supervision", amount: 1000, duration, confirmed: true }),
      ).toMatchObject({ amount: 1000, placeholder: false, missing: null });
    },
  );
});
