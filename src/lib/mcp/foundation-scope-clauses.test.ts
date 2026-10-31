import { describe, expect, it } from "vitest";
import { autoGaps, foundationScope, prepareLines, settle, type EstimateScope } from "./estimating";

const lines = prepareLines([
  {
    line_no: 1,
    item: "Concrete sidewalks",
    unit: "SF",
    value: 40,
    basis: "measured",
    sheet: "C-1",
  },
  { line_no: 2, item: "Equipment pads", unit: "EA", value: 2, basis: "measured", sheet: "S-1" },
]);
const scope = (in_scope: string[]): EstimateScope => ({
  role: "self_performer",
  trades: ["03 Concrete"],
  in_scope,
  out_scope: [],
});
const permutations = <T>(items: T[]): T[][] =>
  items.length === 0
    ? [[]]
    : items.flatMap((item, index) =>
        permutations(items.filter((_, i) => i !== index)).map((rest) => [item, ...rest]),
      );

describe("independent applicability of agreed scope clauses", () => {
  it.each([
    ["Concrete sidewalks", "Other concrete work"],
    ["Suspended concrete slabs", "Concrete work"],
    ["Equipment pads", "Cast-in-place concrete"],
    ["Pole bases", "Unspecified concrete work"],
  ])("keeps unresolved %s plus %s explicit", (known, unknown) => {
    const state = settle(lines, [], [], scope([known, unknown]));
    expect(state.settled).toBe(false);
    expect(state.foundationScope.state).toBe("unknown");
    expect(state.foundationScope.unresolvedClauses).toEqual([unknown]);
    expect(state.foundationScope.clarification).toContain(`"${unknown}"`);
    expect(state.foundation).toEqual([]);
    expect(state.blockers.some((blocker) => blocker.includes(unknown))).toBe(true);
    expect(
      autoGaps(lines, [], scope([known, unknown])).some(
        (gap) => gap.title === "Confirm foundation scope" && gap.holds_bid,
      ),
    ).toBe(true);
  });
  it("is order-invariant with mixed known, limited and unknown clauses", () => {
    const clauses = ["Concrete sidewalks", "Other concrete work", "Equipment pads"];
    const expected = foundationScope(lines, scope(clauses));
    for (const order of permutations(clauses)) {
      expect(foundationScope(lines, scope(order))).toEqual(expected);
      const state = settle(lines, [], [], scope(order));
      expect(state.settled).toBe(false);
      expect(state.blockers).toEqual([expected.clarification]);
    }
  });
  it.each([
    "Concrete sidewalks and Other concrete work",
    "Concrete sidewalks; Other concrete work",
    "Concrete sidewalks with Other concrete work",
    "Equipment pads including Cast-in-place concrete",
  ])("does not hide unresolved work joined in one entry: %s", (entry) => {
    const state = settle(lines, [], [], scope([entry]));
    expect(state.foundationScope.unresolvedClauses).toHaveLength(1);
    expect(state.foundationScope.clarification).toContain(
      state.foundationScope.unresolvedClauses[0],
    );
    expect(state.foundationScope.wholeFoundation).toBe(false);
    expect(state.settled).toBe(false);
  });
  it("preserves independent unresolved work even alongside explicit foundation exclusions", () => {
    const actual = {
      ...scope(["Concrete sidewalks", "Other concrete work"]),
      out_scope: ["Concrete foundations"],
    };
    expect(settle([lines[0]], [], [], actual).settled).toBe(false);
    expect(foundationScope([lines[0]], actual).clarification).toContain("Other concrete work");
  });
  it("keeps an unresolved clause visible when another clause also conflicts", () => {
    const actual = {
      ...scope(["Concrete foundations", "Other concrete work"]),
      out_scope: ["Concrete foundations"],
    };
    const result = foundationScope(lines, actual);
    expect(result.state).toBe("conflicting");
    expect(result.clarification).toContain("Other concrete work");
  });
  it("retains known whole-foundation requirements while asking about another unresolved clause", () => {
    const state = settle(lines, [], [], scope(["Concrete foundations", "Other concrete work"]));
    expect(state.foundationScope.wholeFoundation).toBe(true);
    expect(state.foundation).toHaveLength(8);
    expect(state.foundationScope.clarification).toContain("Other concrete work");
  });
  it("keeps fully recognized bounded/limited clauses resolved without mutating inputs", () => {
    const actual = scope(["Concrete sidewalks", "Equipment pads"]);
    const before = JSON.stringify({ lines, actual });
    const state = settle(lines, [], [], actual);
    expect(state.foundationScope.unresolvedClauses).toEqual([]);
    expect(state.foundationScope.clarification).toBeNull();
    expect(state.settled).toBe(true);
    expect(JSON.stringify({ lines, actual })).toBe(before);
  });
});
