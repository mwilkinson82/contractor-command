import { describe, expect, it, vi } from "vitest";
import {
  autoGaps,
  foundationGapPrompts,
  foundationScope,
  parseState,
  prepareLines,
  settle,
  type EstimateScope,
  type StoredVerdict,
} from "./estimating";
import { measuredSettlement } from "./takeoff/integration";
import { engineSnapshot, type EngineSnapshot, type GeometryRevision } from "./takeoff/state";
import type { Sb } from "./guard";

const scope: EstimateScope = {
  role: "self_performer",
  trades: ["26 Electrical"],
  in_scope: ["Electrical work including concrete equipment pads and pole bases"],
  out_scope: [],
};
const rows = (item = "Lighting devices", line_no = 1, extra = {}) =>
  prepareLines([
    { line_no, item, unit: "EA", basis: "measured", sheet: "E-1", value: 2, ...extra },
  ]);
const pad = () => rows("Equipment pads", 2);
const pole = () => rows("Pole bases", 3);
const namedGap = () =>
  parseState({
    gaps: [
      {
        ref: "G-1",
        title: "Pads",
        kind: "verify",
        category: "scope_seam",
        severity: "hard",
        holds_bid: true,
        sheet: "scope not measured",
        spec_section: "agreed scope",
        reasoning: "Included but not accounted for",
      },
    ],
  }).gaps;

describe("independent scope review regressions", () => {
  it("blocks both explicitly included pad/base requirements when no line exists", () => {
    const lines = rows();
    const before = JSON.stringify({ lines, scope });
    const result = settle(lines, [], [], scope);
    expect(result.settled).toBe(false);
    expect(result.foundation).toEqual([]);
    expect(result.blockers).toHaveLength(2);
    expect(foundationGapPrompts(lines, scope).map((gap) => gap.title)).toEqual([
      "Pads",
      "Pole bases",
    ]);
    expect(autoGaps(lines, [], scope).every((gap) => gap.holds_bid)).toBe(true);
    expect(JSON.stringify({ lines, scope })).toBe(before);
  });
  it("keeps an uncovered part of compound scope open even when the other part is quantified", () => {
    const lines = [...rows(), ...pad()];
    expect(foundationGapPrompts(lines, scope).map((gap) => gap.title)).toEqual(["Pole bases"]);
    expect(settle(lines, [], [], scope).settled).toBe(false);
  });
  it("does not count conduit quantities as coverage of the pole bases they serve", () => {
    const lines = [...rows(), ...pad(), ...rows("Conduits to pole bases", 3, { unit: "LF" })];
    expect(foundationGapPrompts(lines, scope).map((gap) => gap.title)).toEqual(["Pole bases"]);
    expect(settle(lines, [], [], scope).settled).toBe(false);
  });
  it("keeps broad concrete exclusions conflicting with included pad work", () => {
    const actual = { ...scope, out_scope: ["Concrete work"] };
    expect(foundationScope(rows(), actual).state).toBe("conflicting");
  });
  it("settles genuine quantified coverage without unrelated foundation items", () => {
    const lines = [...rows(), ...pad(), ...pole()];
    expect(foundationGapPrompts(lines, scope)).toEqual([]);
    expect(settle(lines, [], [], scope).settled).toBe(true);
  });
  it("retains an unquantified line's normal hold instead of creating a second coverage gap", () => {
    const lines = [
      ...rows(),
      ...pad(),
      ...rows("Pole bases", 3, { value: undefined, missing_input: "base dimensions" }),
    ];
    expect(autoGaps(lines, [], scope).map((gap) => gap.title)).toEqual(["Pole bases"]);
    expect(settle(lines, [], [], scope).settled).toBe(false);
  });
  it("accepts an explicit reasoned saved-gap disposition and preserves its evidence", () => {
    const lines = [...rows(), ...pole()];
    const gaps = namedGap();
    const verdicts = [
      {
        item_kind: "gap",
        gap_ref: "G-1",
        mark: "not_relevant",
        note: "Pads are carried in the vendor package; exclusion accepted",
        created_at: "2026-10-31",
      },
    ] as StoredVerdict[];
    const before = JSON.stringify({ gaps, verdicts });
    const result = settle(lines, gaps, verdicts, scope);
    expect(result.settled).toBe(true);
    expect(result.items.find((item) => item.ref === "G-1")?.status).toBe("dropped");
    expect(result.foundationGaps).toEqual([]);
    expect(JSON.stringify({ gaps, verdicts })).toBe(before);
    expect(settle(lines, gaps, [{ ...verdicts[0], note: "" }], scope).settled).toBe(false);
  });
  it("keeps an authored exclusion open until the line has an explicit reasoned review", () => {
    const lines = [
      ...rows(),
      ...rows("Equipment pads", 2, { value: undefined, exclusion: "Vendor package carries pads" }),
      ...pole(),
    ];
    expect(settle(lines, [], [], scope).settled).toBe(false);
    const verdicts = [
      {
        item_kind: "line",
        line_no: 2,
        item_text: "Equipment pads",
        mark: "not_relevant",
        note: "Accepted vendor package exclusion",
        created_at: "2026-10-31",
      },
    ] as StoredVerdict[];
    expect(settle(lines, [], verdicts, scope).settled).toBe(true);
  });
  it.each(["Concrete sidewalks only", "Suspended concrete slabs only"])(
    "does not expand %s into a foundation package",
    (text) => {
      const actual = {
        role: "self_performer" as const,
        trades: ["03 Concrete"],
        in_scope: [text],
        out_scope: [],
      };
      const lines = rows(text, 1, { unit: "SF" });
      const result = settle(lines, [], [], actual);
      expect(result.foundationScope.wholeFoundation).toBe(false);
      expect(result.foundation).toEqual([]);
      expect(result.blockers).toEqual([]);
      expect(result.settled).toBe(true);
      expect(autoGaps(lines, [], actual)).toEqual([]);
    },
  );
  it("keeps generic unspecified concrete scope unresolved", () => {
    const actual = { ...scope, trades: ["03 Concrete"], in_scope: ["Concrete work"] };
    const result = settle(rows(), [], [], actual);
    expect(result.foundationScope.state).toBe("unknown");
    expect(result.foundationScope.wholeFoundation).toBe(false);
    expect(result.blockers).toHaveLength(1);
  });
  it("preserves explicit slab-on-grade and foundation-plus-pad requirements", () => {
    for (const text of ["Slab on grade", "Foundations and equipment pads"]) {
      const actual = { ...scope, in_scope: [text] };
      expect(foundationScope(rows(), actual).wholeFoundation).toBe(true);
      expect(settle(rows(), [], [], actual).foundation).toHaveLength(8);
      if (text.includes("pads"))
        expect(foundationGapPrompts(rows(), actual).some((gap) => gap.title === "Pads")).toBe(true);
    }
  });
  it("retains unknown scope when the newer authorized read has no saved setup", async () => {
    const state = {
      available: true,
      takeoff_version: 1,
      lines: [],
      geometry: [],
      calibrations: [],
      passes: [],
    } as EngineSnapshot;
    const rpc = vi.fn(async (name: string) => ({
      data: name === "mcp_takeoff_get" ? state : { setup: null },
      error: null,
    }));
    const newer = await engineSnapshot({ rpc } as unknown as Sb, "synthetic-job", true);
    expect(newer?.estimate_scope).toMatchObject({
      role: null,
      trades: [],
      in_scope: [],
      out_scope: [],
    });
    expect(
      measuredSettlement(
        parseState({
          setup: {
            ...scope,
            in_scope: ["Electrical work only"],
            out_scope: ["Concrete foundations"],
          },
        }),
        newer!,
      ).foundationScope.state,
    ).toBe("unknown");
  });
  it("uses the newer engine scope when loaded scope was excluded", () => {
    const old = {
      ...scope,
      in_scope: ["Electrical work only"],
      out_scope: ["Concrete foundations"],
    };
    const current = { ...scope, in_scope: ["Concrete foundations"], out_scope: [] };
    const lines = rows();
    const loaded = parseState({ setup: old, takeoff: { version: 1, lines } });
    const snapshot = {
      available: true,
      takeoff_version: 1,
      estimate_scope: old,
      lines: lines.map((line) => ({ ...line, id: "line", takeoff_id: "takeoff" })),
      geometry: [
        {
          id: "g-rev",
          geometry_id: "g",
          version: 1,
          line_id: "line",
          source_id: "source",
          page: 1,
          calibration_id: null,
          shape: { kind: "pins", points: [{ x: 0.2, y: 0.2 }] },
          measured: 2,
          unit: "EA",
          status: "accepted",
          source: "estimator",
          reason: null,
          created_by: "actor",
          created_at: "2026-10-31",
          evidence: {},
        } as GeometryRevision,
      ],
      calibrations: [],
      passes: [],
    } as EngineSnapshot;
    expect(measuredSettlement(loaded, snapshot).settled).toBe(true);
    snapshot.estimate_scope = current;
    const result = measuredSettlement(loaded, snapshot);
    expect(result.foundationScope.wholeFoundation).toBe(true);
    expect(result.foundation).toHaveLength(8);
    expect(result.settled).toBe(false);
    expect(loaded.setup.in_scope).toEqual(old.in_scope);
  });
});
