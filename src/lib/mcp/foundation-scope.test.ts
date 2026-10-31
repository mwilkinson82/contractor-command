import { describe, expect, it, vi } from "vitest";
import {
  FOUNDATION_CHECKLIST,
  autoGaps,
  foundationGapPrompts,
  foundationScope,
  parseState,
  prepareLines,
  preserveGapList,
  renderSummary,
  renderTakeoff,
  settle,
  type EstimateScope,
  type StoredGap,
} from "./estimating";
import { engineSnapshot, type EngineSnapshot } from "./takeoff/state";
import { viewEngine } from "./takeoff/service";
import { measuredSettlement } from "./takeoff/integration";
import type { Sb } from "./guard";

const electrical: EstimateScope = {
  role: "self_performer",
  trades: ["26 Electrical"],
  in_scope: ["Electrical work only"],
  out_scope: ["Concrete foundations"],
};
const foundations: EstimateScope = {
  role: "self_performer",
  trades: ["26 Electrical"],
  in_scope: ["Concrete foundations"],
  out_scope: [],
};
const line = (item = "Lighting devices", extra = {}) =>
  prepareLines([
    { line_no: 1, item, sheet: "E-1", unit: "EA", basis: "measured", value: 12, ...extra },
  ]);

describe("agreed foundation scope across gap, settlement and display paths", () => {
  it("settles an electrical-only package without eight invented foundation tasks", () => {
    const lines = line();
    const before = JSON.stringify({ lines, electrical });
    const state = settle(lines, [], [], electrical);
    expect(state.settled).toBe(true);
    expect(state.foundation).toEqual([]);
    expect(foundationGapPrompts(lines, electrical)).toEqual([]);
    expect(autoGaps(lines, [], electrical)).toEqual([]);
    expect(renderTakeoff("Synthetic job", lines, state, "r1").structured.checklist_gaps).toEqual(
      [],
    );
    expect(renderSummary("Synthetic job", state, [], "r1").structured.draft).not.toBe(true);
    expect(JSON.stringify({ lines, electrical })).toBe(before);
  });
  it.each([
    foundations,
    { ...foundations, in_scope: ["Electrical and concrete foundations"] },
    { ...foundations, in_scope: ["Electrical, foundations and equipment pads"] },
    { ...foundations, trades: ["03 Concrete", "26 Electrical"] },
  ])("retains the complete agreed foundation package regardless of trade labels: %j", (scope) => {
    const state = settle(line(), [], [], scope);
    expect(state.foundation).toHaveLength(8);
    expect(state.settled).toBe(false);
    expect(foundationGapPrompts(line(), scope).map((g) => g.title)).toEqual(
      FOUNDATION_CHECKLIST.map((c) => c.label),
    );
    expect(autoGaps(line(), [], scope)).toHaveLength(8);
  });
  it("retains limited electrical pole-base/pad work without requiring unrelated slab items", () => {
    const scope = {
      ...electrical,
      in_scope: ["Electrical work only", "Concrete equipment pads and pole bases"],
      out_scope: [],
    };
    const lines = line("Equipment pads", { value: undefined, missing_input: "pad dimensions" });
    const state = settle(lines, [], [], scope);
    expect(state.foundationScope.state).toBe("included");
    expect(state.foundation).toEqual([]);
    expect(state.settled).toBe(false);
    expect(state.blockers.some((b) => b.includes("Equipment pads"))).toBe(true);
    expect(autoGaps(lines, [], scope).map((g) => g.title)).toEqual(["Equipment pads"]);
  });
  it("does not expand one included electrical footing into the full concrete checklist", () => {
    const scope = {
      ...electrical,
      in_scope: ["Electrical work including pole foundations"],
      out_scope: [],
    };
    const lines = line("Pole foundation footing", { checklist_key: "if" });
    const state = settle(lines, [], [], scope);
    expect(state.settled).toBe(true);
    expect(state.checklist.filter((c) => c.state === "not on the takeoff")).toEqual([]);
  });
  it("does not generate excluded checklist items within an included foundation package", () => {
    const scope = { ...foundations, out_scope: ["Termite treatment"] };
    expect(foundationGapPrompts([], scope).map((g) => g.title)).not.toContain("Termite treatment");
    expect(settle(line(), [], [], scope).foundation).toHaveLength(7);
  });
  it.each([
    undefined,
    { role: "self_performer" as const, trades: ["03 Concrete"] },
    { ...electrical, in_scope: ["Electrical work"], out_scope: [] },
    { ...foundations, in_scope: ["Foundations if required"] },
    { ...foundations, in_scope: ["No foundation work"] },
  ])("keeps missing/ambiguous scope explicit instead of assuming applicability: %j", (scope) => {
    const opts = scope ?? { role: null, trades: [] };
    expect(foundationScope(line(), scope).state).toBe("unknown");
    const prompts = foundationGapPrompts(line(), scope);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].title).toBe("Confirm foundation scope");
    expect(settle(line(), [], [], opts).settled).toBe(false);
    expect(settle(line(), [], [], opts).blockers).toHaveLength(1);
  });
  it.each([
    { ...foundations, out_scope: ["Concrete foundations"] },
    { ...electrical, in_scope: ["Dowels"], out_scope: ["Dowels"] },
  ])("requires clarification for conflicting included and excluded scope: %j", (scope) => {
    expect(foundationScope(line(), scope).state).toBe("conflicting");
    expect(foundationGapPrompts(line(), scope)[0].reasoning).toContain("conflicts");
    expect(settle(line(), [], [], scope).settled).toBe(false);
  });
  it("does not hide saved foundation rows when electrical-only scope excludes them", () => {
    const lines = line("Concrete foundations");
    const state = settle(lines, [], [], electrical);
    expect(state.foundationScope.state).toBe("conflicting");
    expect(state.items[0].title).toBe("Concrete foundations");
    expect(state.settled).toBe(false);
  });
  it("preserves explicit source requirements conflicting with an exclusion", () => {
    const scope = {
      ...electrical,
      doc_review: { pairs: [{ requirement: "Keyway", spec_section: "03", sheet: "S-1" }] },
    } as EstimateScope;
    expect(foundationScope(line(), scope).state).toBe("conflicting");
    expect(foundationGapPrompts(line(), scope).some((g) => g.title === "Keyway")).toBe(true);
  });
  it("honors quantified and reasoned N/A rows only for their actual included requirements", () => {
    const lines = FOUNDATION_CHECKLIST.flatMap((c, i) =>
      line(c.label, {
        line_no: i + 1,
        checklist_key: c.key,
        unit: c.unit,
        ...(i % 2 ? { value: undefined, exclusion: "Not required by this foundation design" } : {}),
      }),
    );
    const state = settle(lines, [], [], foundations);
    expect(state.settled).toBe(true);
    expect(foundationGapPrompts(lines, foundations)).toEqual([]);
    expect(state.foundation.every((c) => ["quantity", "N/A"].includes(c.state))).toBe(true);
  });
  it("preserves prior gaps and verdict review obligations after scope is excluded", () => {
    const prior = [
      {
        ref: "G-1",
        title: "Keyway",
        kind: "verify",
        category: "scope_seam",
        severity: "hard",
        reasoning: "Previously generated requirement",
        sheet: "S-1",
        spec_section: "03",
        holds_bid: true,
        qty: null,
      },
    ] as StoredGap[];
    const before = JSON.stringify(prior);
    expect(preserveGapList(prior, autoGaps(line(), [], electrical)).map((g) => g.ref)).toContain(
      "G-1",
    );
    const state = settle(line(), prior, [], electrical);
    expect(state.items.find((i) => i.ref === "G-1")?.status).toBe("open");
    expect(state.settled).toBe(false);
    expect(JSON.stringify(prior)).toBe(before);
  });
  it("still holds a genuine unquantified electrical line", () => {
    const state = settle(
      line("Circuit lengths", { value: undefined, missing_input: "circuit routing" }),
      [],
      [],
      electrical,
    );
    expect(state.settled).toBe(false);
    expect(state.counts.open).toBe(1);
    expect(state.foundation).toEqual([]);
  });
  it("does not mistake agreed electrical penetrations through foundations for foundation installation", () => {
    const scope = { ...electrical, in_scope: ["Electrical conduits through slabs and foundation walls"] };
    expect(foundationGapPrompts(line(), scope)).toEqual([]);
    expect(settle(line(), [], [], scope).settled).toBe(true);
  });
  it("does not reinterpret electrical penetrations as concrete installation scope", () => {
    const lines = line("Conduits through slabs and foundation walls");
    expect(foundationScope(lines, electrical).state).toBe("excluded");
    expect(settle(lines, [], [], electrical).settled).toBe(true);
  });
  it.each([
    [electrical, "excluded", 0],
    [foundations, "included", 8],
    [{ role: null, trades: [] }, "unknown", 1],
    [{ ...foundations, out_scope: ["Concrete foundations"] }, "conflicting", 1],
  ] as const)(
    "uses the same scope decision in the actual drawing card: %s",
    async (scope, expected, gaps) => {
      const snapshot = {
        available: true,
        takeoff_version: 1,
        estimate_scope: scope,
        lines: [],
        geometry: [],
        calibrations: [],
        passes: [],
      } as unknown as EngineSnapshot;
      const sb = {
        rpc: vi.fn(async (name: string) => {
          if (name !== "mcp_drawing_records") throw new Error(`Unexpected read: ${name}`);
          return { data: [], error: null };
        }),
      };
      const result = await viewEngine(
        sb as unknown as Sb,
        {
          job_id: "synthetic-job",
          job_number: "SYN-1",
          company_id: "synthetic-company",
          name: "Fictional job",
        },
        snapshot,
      );
      const content = result.structuredContent as unknown as {
        foundation_scope: { state: string };
        checklist_gaps: unknown[];
        card: unknown;
      };
      expect(content.foundation_scope.state).toBe(expected);
      expect(content.checklist_gaps).toHaveLength(gaps);
      if (expected === "excluded")
        expect(JSON.stringify(content.card)).not.toContain("Under-slab insulation");
      if (expected === "unknown" || expected === "conflicting")
        expect(JSON.stringify(content.card)).toContain("Foundation scope needs clarification");
    },
  );
  it("loads saved scope through the existing scoped estimate read for measurement cards", async () => {
    const snapshot = {
      available: true,
      takeoff_version: 1,
      role: "gc",
      trades: ["03 Concrete"],
      lines: [],
      geometry: [],
      calibrations: [],
      passes: [],
    } as EngineSnapshot;
    const rpc = vi.fn(async (name: string) => ({
      data: name === "mcp_takeoff_get" ? snapshot : { setup: electrical },
      error: null,
    }));
    const state = await engineSnapshot({ rpc } as unknown as Sb, "synthetic-job", true);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["mcp_takeoff_get", "mcp_estimate_get"]);
    expect(state?.estimate_scope).toMatchObject(electrical);
    const loaded = parseState({ setup: state!.estimate_scope, takeoff: { lines: [] } });
    expect(measuredSettlement(loaded, state!).foundation).toEqual([]);
  });
});
