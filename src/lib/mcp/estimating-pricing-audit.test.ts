import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineSnapshot } from "./takeoff/state";

// Internal, isolated fixture. Real pricing handlers/calculators; no live client,
// credentials, membership calls, storage writes, or provider inference.
const fixture = vi.hoisted(() => ({
  estimate: {} as Record<string, unknown>,
  bid: {} as Record<string, unknown>,
  writes: [] as string[],
  measurement: null as EngineSnapshot | null,
  failSaveOnce: false,
  failAuditOnce: false,
}));
vi.mock("./guard", () => ({
  run: async (_name: string, _ctx: unknown, _opts: unknown, fn: (sb: unknown) => unknown) =>
    fn({
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === "mcp_estimate_get") return { data: fixture.estimate, error: null };
        if (name === "mcp_estimate_bid_get") return { data: fixture.bid, error: null };
        if (name === "mcp_estimate_pricing_save") {
          if (fixture.failSaveOnce) {
            fixture.failSaveOnce = false;
            return { data: null, error: { message: "Interrupted save" } };
          }
          fixture.writes.push(name);
          const prior = fixture.bid.pricing as Record<string, unknown>;
          fixture.bid.pricing = {
            ...prior,
            labor: structuredClone(args._labor),
            material: structuredClone(args._material),
            quotes: structuredClone(args._quotes),
          };
          return { data: {}, error: null };
        }
        if (name === "mcp_estimate_bid_save") {
          fixture.writes.push(name);
          return { data: {}, error: null };
        }
        throw new Error(`Unexpected RPC: ${name}`);
      },
    }),
  text: (text: string) => ({ content: [{ type: "text", text }] }),
  dbError: (error: { message: string }) => {
    throw new Error(error.message);
  },
  isMissingFunction: () => false,
}));
vi.mock("./jobs", () => ({
  resolveJob: async () => ({
    job_id: "audit-local",
    job_number: "AUDIT-LOCAL",
    company_id: "local",
  }),
  named: () => "AUDIT-LOCAL",
  audit: async () => {
    if (fixture.failAuditOnce) {
      fixture.failAuditOnce = false;
      throw new Error("Interrupted after save");
    }
  },
}));
vi.mock("./takeoff/state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./takeoff/state")>()),
  engineSnapshot: async () => fixture.measurement,
}));
vi.mock("./takeoff/service", () => ({
  viewEngine: async (
    _sb: unknown,
    _job: unknown,
    _state: unknown,
    _page: unknown,
    extra?: { bid_summary?: object },
  ) => ({ structuredContent: extra?.bid_summary ?? { measurement_pending: true }, content: [] }),
}));

import { estimateBidSummary, estimatePricing } from "./tools/estimate-bid-tools";
import { GC_ITEMS, gcLineAmount } from "./estimating-bid";
import { parseState, settle } from "./estimating";

type Result = {
  structuredContent: { ready?: boolean; direct: number; total?: number | null };
  content: { text: string }[];
};
const call = (tool: unknown, args: Record<string, unknown> = {}) =>
  (tool as { handler: (args: unknown, ctx: unknown) => Promise<Result> }).handler(
    { job_number: "AUDIT-LOCAL", ...args },
    {},
  );
const labor = { ref: "T-1", production_per_man_hour: 10, hourly_rate: 100, confirmed: true };
const material = { ref: "T-1", unit_price: 5, confirmed: true };

beforeEach(() => {
  fixture.writes = [];
  fixture.measurement = null;
  fixture.failSaveOnce = false;
  fixture.failAuditOnce = false;
  fixture.estimate = {
    setup: { role: "gc", trades: ["09 Finishes"], in_scope: ["Paint only"] },
    takeoff: {
      version: 1,
      lines: [
        { line_no: 1, item: "Paint", qty: 100, unit: "SF", sheet: "A1", trade: "09 Finishes" },
      ],
    },
    gaps: [],
    verdicts: [],
  };
  fixture.bid = {
    pricing: { labor: [labor], material: [material], quotes: [], rate_sources: [] },
    general_conditions: {
      duration_days: 1,
      lines: GC_ITEMS.map(({ key }) => ({ key, amount: 0, qty: 1, rate: 0, confirmed: true })),
    },
    requirements: [],
    bid: { overhead_pct: 10, profit_pct: 10 },
  };
});

describe("pricing correctness regressions (isolated handlers)", () => {
  it("control: complete direct prices agree across both handlers", async () => {
    const loaded = parseState(fixture.estimate);
    expect(settle(loaded.lines, loaded.gaps, loaded.verdicts, loaded.setup).settled).toBe(true);
    expect((await call(estimatePricing)).structuredContent.direct).toBe(1500);
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: true,
      direct: 1500,
      total: 1815,
    });
  });

  it("holds a bid with no direct rates", async () => {
    fixture.bid.pricing = { labor: [], material: [], quotes: [], rate_sources: [] };
    expect((await call(estimatePricing)).structuredContent).toMatchObject({ priced: false });
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: false,
      direct: 0,
      total: null,
    });
  });

  it("holds a bid with a second quantity-bearing line entirely unpriced", async () => {
    const takeoff = fixture.estimate.takeoff as { lines: unknown[] };
    takeoff.lines.push({
      line_no: 2,
      item: "Ceiling",
      qty: 200,
      unit: "SF",
      sheet: "A1",
      trade: "09 Finishes",
    });
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: false,
      direct: 1500,
      total: null,
    });
  });

  it("holds a bid with an incomplete labor rate", async () => {
    fixture.bid.pricing = {
      labor: [{ ref: "T-1", production_per_man_hour: 10, confirmed: true }],
      material: [material],
    };
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: false,
      direct: 500,
      total: null,
    });
  });

  it("carries the same confirmed labor factors in the bid summary", async () => {
    fixture.bid.pricing = {
      labor: [{ ...labor, apply_factor: true, source: "rsmeans" }],
      material: [material],
      quotes: [],
      rate_sources: [
        { source: "rsmeans", carry: true, location_factor: 1.2, work_factor: 1.1, confirmed: true },
      ],
    };
    expect((await call(estimatePricing)).structuredContent.direct).toBe(1820);
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: true,
      direct: 1820,
      total: 2202.2,
    });
    // One canonical calculation should carry 1,320 labor + 500 material;
    // compounded 10% overhead then 10% profit gives 2,202.20.
  });

  it("holds readiness for an unconfirmed applied factor", async () => {
    fixture.bid.pricing = {
      labor: [{ ...labor, apply_factor: true, source: "rsmeans" }],
      material: [material],
      quotes: [],
      rate_sources: [{ source: "rsmeans", carry: true, location_factor: 1.2, confirmed: false }],
    };
    expect((await call(estimatePricing)).structuredContent).toMatchObject({
      direct: 1700,
      placeholder: true,
    });
    expect((await call(estimateBidSummary)).structuredContent.ready).toBe(false);
  });

  it("resolves unique legacy title rates consistently in both handlers", async () => {
    fixture.bid.pricing = {
      labor: [{ ...labor, ref: "Paint" }],
      material: [{ ...material, ref: "Paint" }],
    };
    expect((await call(estimatePricing)).structuredContent.direct).toBe(1500);
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: true,
      direct: 1500,
      total: 1815,
    });
  });

  it("holds ambiguous quote coverage without adding competing quotes", async () => {
    fixture.bid.pricing = {
      labor: [labor],
      material: [material],
      quotes: [
        { sub: "Painter A", description: "Paint", ref: "T-1", amount: 1400 },
        { sub: "Painter B", description: "Paint", ref: "T-1", amount: 1600 },
      ],
    };
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: false,
      direct: 1500,
      total: null,
    });
    // Coverage needs estimator selection; no vendor or carried quote is inferred.
  });

  it("accepts supervision lump sums without a unit rate", () => {
    expect(
      gcLineAmount({ key: "supervision", amount: 1000, duration: 10, confirmed: true }).amount,
    ).toBe(1000);
  });

  it("saves and retries raw rates without compounding already applied factors", async () => {
    fixture.bid.pricing = {
      labor: [{ ...labor, apply_factor: true }],
      material: [material],
      rate_sources: [{ source: "rsmeans", carry: true, location_factor: 1.2, confirmed: true }],
    };
    fixture.failAuditOnce = true;
    await expect(call(estimatePricing)).rejects.toThrow("Interrupted after save");
    expect((await call(estimatePricing)).structuredContent.direct).toBe(1700);
    expect((await call(estimatePricing)).structuredContent.direct).toBe(1700);
    expect((fixture.bid.pricing as { labor: { hourly_rate: number }[] }).labor[0].hourly_rate).toBe(
      100,
    );
    expect((await call(estimateBidSummary)).structuredContent.total).toBe(2057);
  });

  it("does not report success after a failed save, then recomputes on retry", async () => {
    fixture.failSaveOnce = true;
    await expect(
      call(estimatePricing, { labor: [{ ...labor, hourly_rate: 120 }] }),
    ).rejects.toThrow("Interrupted save");
    expect(fixture.writes).toEqual([]);
    expect((await call(estimateBidSummary)).structuredContent.direct).toBe(1500);
    expect(
      (await call(estimatePricing, { labor: [{ ...labor, hourly_rate: 120 }] })).structuredContent
        .direct,
    ).toBe(1700);
    expect((await call(estimateBidSummary)).structuredContent.total).toBe(2057);
  });

  it("validates invalid rates before saving any pricing", async () => {
    await expect(
      call(estimatePricing, { labor: [{ ...labor, hourly_rate: -1 }] }),
    ).rejects.toThrow();
    expect(fixture.writes).toEqual([]);
  });

  it("migrates a uniquely named legacy rate when the estimator updates its stable ref", async () => {
    fixture.bid.pricing = {
      labor: [{ ...labor, ref: "Paint" }],
      material: [{ ...material, ref: "Paint" }],
      rate_sources: [],
    };
    expect(
      (await call(estimatePricing, { labor: [{ ref: "T-1", hourly_rate: 120 }] })).structuredContent
        .direct,
    ).toBe(1700);
    expect((fixture.bid.pricing as { labor: { ref: string }[] }).labor).toHaveLength(1);
    expect((fixture.bid.pricing as { labor: { ref: string }[] }).labor[0].ref).toBe("T-1");
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: true,
      total: 2057,
    });
  });

  it("keeps explicitly confirmed zero prices ready in both reports", async () => {
    fixture.bid.pricing = {
      labor: [{ ...labor, hourly_rate: 0 }],
      material: [{ ...material, unit_price: 0 }],
    };
    expect((await call(estimatePricing)).structuredContent.direct).toBe(0);
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: true,
      direct: 0,
      total: 0,
    });
  });

  it("rechecks changed quantities and factor confirmation rather than reusing readiness", async () => {
    expect((await call(estimateBidSummary)).structuredContent.ready).toBe(true);
    (fixture.estimate.takeoff as { lines: { qty: number | null }[] }).lines[0].qty = null;
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: false,
      total: null,
    });
    (fixture.estimate.takeoff as { lines: { qty: number | null }[] }).lines[0].qty = 100;
    fixture.bid.pricing = {
      labor: [{ ...labor, apply_factor: true }],
      material: [material],
      rate_sources: [{ source: "rsmeans", carry: true, location_factor: 1.2, confirmed: false }],
    };
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: false,
      total: null,
    });
  });

  it("uses the canonical factored amounts for quote basis comparison", async () => {
    fixture.bid.pricing = {
      labor: [{ ...labor, apply_factor: true }],
      material: [material],
      quotes: [{ sub: "Painter", description: "Paint", ref: "T-1", amount: 1700 }],
      rate_sources: [
        { source: "rsmeans", carry: true, location_factor: 1.2, work_factor: 1.1, confirmed: true },
      ],
    };
    const result = await call(estimatePricing);
    expect(result.content[0].text).toContain("Low against the basis by $120.00");
    expect((await call(estimateBidSummary)).structuredContent.total).toBeNull();
  });

  it("uses accepted geometry quantities and ignores historical typed corrections", async () => {
    const loaded = parseState(fixture.estimate);
    fixture.estimate.verdicts = [
      { item_kind: "line", line_no: 1, item_text: "Paint", mark: "relevant", corrected_qty: 9999 },
    ];
    fixture.measurement = {
      available: true,
      takeoff_version: 1,
      lines: [{ ...loaded.lines[0], id: "line", takeoff_id: "takeoff" }],
      calibrations: [],
      passes: [],
      sources: [{ id: "source", stale: false }],
      geometry: [
        {
          id: "geom-rev",
          geometry_id: "geom",
          version: 1,
          line_id: "line",
          source_id: "source",
          page: 1,
          calibration_id: null,
          shape: {
            kind: "rect",
            points: [
              { x: 0.1, y: 0.1 },
              { x: 0.5, y: 0.5 },
            ],
          },
          measured: 60,
          unit: "SF",
          status: "accepted",
          source: "estimator",
          reason: null,
          created_by: "actor",
          created_at: "2026-11-02",
          evidence: {},
        },
      ],
    };
    expect((await call(estimatePricing)).structuredContent.direct).toBe(900);
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: true,
      direct: 900,
      total: 1089,
    });
    fixture.measurement.sources![0].stale = true;
    const before = fixture.writes.length;
    expect((await call(estimateBidSummary, { overhead_pct: 20 })).structuredContent).toMatchObject({
      measurement_pending: true,
    });
    expect(fixture.writes.length).toBe(before);
    expect((await call(estimatePricing)).structuredContent.direct).toBe(0);
  });
});
