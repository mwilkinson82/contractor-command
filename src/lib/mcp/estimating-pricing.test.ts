import { describe, expect, it } from "vitest";
import {
  calculateEstimatePricing,
  duplicateRateSourceIds,
  mergePricingRates,
  type MaterialIn,
} from "./estimating-pricing";
import { assembleBid, gcLineAmount, type LaborIn, type RateChoice } from "./estimating-bid";
import { parseState, settle } from "./estimating";

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
  it.each([
    { ...source, carry: "false" },
    { ...source, carry: "true" },
    { ...source, carry: 1 },
    { ...source, carry: null },
    { ...source, confirmed: "true" },
    { ...source, confirmed: null },
    { ...source, metro: "unknown" },
    { ...source, work_type: 3 },
  ])("holds malformed historical rate-source decisions rather than coercing them", (invalid) => {
    const priced = calculate(
      [{ ...labor, apply_factor: true }],
      [material],
      [invalid as unknown as RateChoice],
    );
    expect(priced.blockers.join(" ")).toMatch(/rate source.*invalid/i);
    expect(priced.rows[0].labor.amount).toBeNull();
    expect(
      assembleBid({
        direct: priced.direct,
        directPlaceholder: priced.placeholder,
        directBlockers: priced.blockers,
        gc: [],
        requirements: [],
        overheadPct: 10,
        profitPct: 10,
        settled: true,
      }),
    ).toMatchObject({ ready: false, total: null });
  });
  it.each([
    { ...labor, confirmed: "false" },
    { ...labor, confirmed: "true" },
    { ...labor, apply_factor: "false" },
    { ...labor, apply_factor: "true" },
    { ...labor, apply_factor: null },
  ])(
    "holds invalid direct labor decisions instead of treating strings as confirmation",
    (invalid) => {
      const priced = calculate([invalid as unknown as LaborIn]);
      expect(priced.blockers.join(" ")).toMatch(/labor rate.*invalid/i);
      expect(priced.rows[0].labor.amount).toBeNull();
      expect(
        assembleBid({
          direct: priced.direct,
          directPlaceholder: priced.placeholder,
          directBlockers: priced.blockers,
          gc: [],
          requirements: [],
          overheadPct: 0,
          profitPct: 0,
          settled: true,
        }),
      ).toMatchObject({ ready: false, total: null });
    },
  );
  it.each([
    { ...material, confirmed: "true" },
    { ...material, apply_factor: "false" },
  ])("holds invalid direct material decisions", (invalid) => {
    const priced = calculate([labor], [invalid as unknown as MaterialIn]);
    expect(priced.blockers.join(" ")).toMatch(/material rate.*invalid/i);
    expect(priced.rows[0].material.amount).toBeNull();
  });
  it("accepts actual booleans and treats optional null factor values as absent", () => {
    expect(
      calculate(
        [labor],
        [material],
        [{ ...source, carry: false, location_factor: null, work_factor: null }],
      ).blockers,
    ).toEqual([]);
  });
  it.each([false, true])(
    "holds historically duplicated factor decisions even if only one carries and regardless of order (%s)",
    (reverse) => {
      const historical = [source, { ...source, carry: false }];
      if (reverse) historical.reverse();
      const priced = calculate([{ ...labor, apply_factor: true }], [material], historical);
      expect(duplicateRateSourceIds(historical)).toEqual(["rsmeans"]);
      expect(priced.blockers.join(" ")).toContain("Rate source rsmeans");
      const result = assembleBid({
        direct: priced.direct,
        directPlaceholder: priced.placeholder,
        directBlockers: priced.blockers,
        gc: [],
        requirements: [],
        overheadPct: 10,
        profitPct: 10,
        settled: true,
      });
      expect(result).toMatchObject({ ready: false, total: null });
    },
  );
  it("treats even identical or unused duplicate sources as unresolved and accepts distinct sources", () => {
    expect(calculate([labor], [material], [source, { ...source }]).blockers.join(" ")).toContain(
      "Rate source rsmeans",
    );
    expect(duplicateRateSourceIds([{ source: "RSMeans" }, { source: " rsmeans " }])).toEqual([
      "rsmeans",
    ]);
    expect(
      calculate([labor], [material], [source, { source: "neca", carry: false }]).blockers,
    ).toEqual([]);
  });
  it.each([null, { source: "unknown", carry: true, location_factor: 1.2, confirmed: true }])(
    "holds a malformed historical factor source rather than trusting it or crashing",
    (badSource) => {
      const priced = calculate(
        [{ ...labor, apply_factor: true }],
        [material],
        [badSource as RateChoice],
      );
      expect(priced.blockers.join(" ")).toContain("unknown or missing identity");
      expect(
        assembleBid({
          direct: priced.direct,
          directPlaceholder: priced.placeholder,
          directBlockers: priced.blockers,
          gc: [],
          requirements: [],
          overheadPct: 10,
          profitPct: 10,
          settled: true,
        }),
      ).toMatchObject({ ready: false, total: null });
    },
  );
  it.each([
    { kind: "verify", qty: 15, line_no: null, owner: null },
    { kind: "verify", qty: null, line_no: null, owner: "Estimator" },
    { kind: "seen", qty: null, line_no: 1, owner: null },
  ])("holds settled gap scope even with quantity, owner, or an apparent line link: %j", (gap) => {
    const raw = parseState({
      setup: { role: "gc", trades: ["09 Finishes"], in_scope: ["Paint only"] },
      takeoff: {
        version: 1,
        lines: [{ line_no: 1, item: "Paint", qty: 100, unit: "SF", sheet: "A1" }],
      },
      gaps: [
        {
          ref: "G-1",
          kind: gap.kind,
          title: "Additional work",
          qty: gap.qty,
          line_no: gap.line_no,
          sheet: "A1",
          spec_section: "09",
        },
      ],
      verdicts: gap.owner
        ? [
            {
              item_kind: "gap",
              gap_ref: "G-1",
              item_text: "Additional work",
              mark: "relevant",
              owner: gap.owner,
            },
          ]
        : [],
    });
    const state = settle(raw.lines, raw.gaps, raw.verdicts, raw.setup);
    expect(state.settled).toBe(true);
    const priced = calculateEstimatePricing(state.items, {
      labor: [labor],
      material: [material],
      sources: [],
    });
    expect(priced.blockers.join(" ")).toContain("G-1");
    const bid = assembleBid({
      direct: priced.direct,
      directPlaceholder: priced.placeholder,
      directBlockers: priced.blockers,
      gc: [],
      requirements: [],
      overheadPct: 10,
      profitPct: 10,
      settled: state.settled,
    });
    expect(bid).toMatchObject({ ready: false, total: null });
    const dropped = state.items.map((item) =>
      item.ref === "G-1" ? { ...item, status: "dropped" as const } : item,
    );
    expect(
      calculateEstimatePricing(dropped, { labor: [labor], material: [material], sources: [] })
        .blockers,
    ).toEqual([]);
  });
  it.each([
    {
      label: "confirmation",
      first: { ...labor, confirmed: true },
      second: { ...labor, ref: "Paint", confirmed: false },
    },
    {
      label: "factor application",
      first: { ...labor, apply_factor: true },
      second: { ...labor, ref: "Paint", apply_factor: false },
    },
    {
      label: "factor source",
      first: { ...labor, source: "rsmeans" as const },
      second: { ...labor, ref: "Paint", source: "neca" as const },
    },
    {
      label: "explicit clearing",
      first: labor,
      second: { ...labor, ref: "Paint", hourly_rate: null },
    },
  ])("rejects conflicting incoming $label in either order", ({ first, second }) => {
    for (const incoming of [
      [first, second],
      [second, first],
    ])
      expect(() => mergePricingRates([labor], incoming, [line])).toThrow(
        "Conflicting rate inputs for T-1",
      );
  });
  it("omits undefined fields while preserving compatible partial updates and original inputs", () => {
    const prior = [{ ...labor }];
    const incoming: LaborIn[] = [
      { ref: "Paint", hourly_rate: 120 },
      { ref: "T-1", production_per_man_hour: undefined, confirmed: true },
    ];
    const before = structuredClone({ prior, incoming });
    const forward = mergePricingRates(prior, incoming, [line]);
    expect(forward).toEqual([{ ...labor, hourly_rate: 120 }]);
    expect(mergePricingRates(prior, [...incoming].reverse(), [line])).toEqual(forward);
    expect({ prior, incoming }).toEqual(before);
  });
  it("coalesces equivalent zero duplicates and orders distinct updates consistently", () => {
    const lines = [line, { ...line, ref: "T-2", title: "Ceiling" }];
    const incoming = [
      { ...labor, hourly_rate: 0 },
      { ...labor, hourly_rate: -0 },
      { ...labor, ref: "T-2", hourly_rate: 120 },
    ];
    const forward = mergePricingRates([], incoming, lines);
    expect(forward).toHaveLength(2);
    // Signed zero has the same monetary meaning; compare calculated amounts.
    expect(forward.map((row) => [row.ref, row.hourly_rate! + 0])).toEqual(
      mergePricingRates([], [...incoming].reverse(), lines).map((row) => [
        row.ref,
        row.hourly_rate! + 0,
      ]),
    );
  });

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
