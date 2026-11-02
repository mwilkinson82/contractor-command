import { beforeEach, describe, expect, it, vi } from "vitest";

// Internal, isolated fixture. Real pricing handlers/calculators; no live client,
// credentials, membership calls, storage writes, or provider inference.
const fixture = vi.hoisted(() => ({
  estimate: {} as Record<string, unknown>,
  bid: {} as Record<string, unknown>,
  writes: [] as string[],
}));
vi.mock("./guard", () => ({
  run: async (_name: string, _ctx: unknown, _opts: unknown, fn: (sb: unknown) => unknown) =>
    fn({
      rpc: async (name: string) => {
        if (name === "mcp_estimate_get") return { data: fixture.estimate, error: null };
        if (name === "mcp_estimate_bid_get") return { data: fixture.bid, error: null };
        if (name === "mcp_estimate_pricing_save") {
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
  audit: async () => {},
}));
vi.mock("./takeoff/state", () => ({ engineSnapshot: async () => null }));
vi.mock("./takeoff/service", () => ({
  viewEngine: async () => {
    throw new Error("Unexpected measurement view");
  },
}));

import { estimateBidSummary, estimatePricing } from "./tools/estimate-bid-tools";
import { GC_ITEMS, gcLineAmount } from "./estimating-bid";
import { parseState, settle } from "./estimating";

type Result = {
  structuredContent: { ready?: boolean; direct: number; total?: number };
  content: { text: string }[];
};
const call = (tool: unknown) =>
  (tool as { handler: (args: unknown, ctx: unknown) => Promise<Result> }).handler(
    { job_number: "AUDIT-LOCAL" },
    {},
  );
const labor = { ref: "T-1", production_per_man_hour: 10, hourly_rate: 100, confirmed: true };
const material = { ref: "T-1", unit_price: 5, confirmed: true };

beforeEach(() => {
  fixture.writes = [];
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

describe("isolated pricing audit at d57f7ec6 (observed behavior, not live acceptance)", () => {
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

  it("reproduces a ready zero bid with no direct rates", async () => {
    fixture.bid.pricing = { labor: [], material: [], quotes: [], rate_sources: [] };
    expect((await call(estimatePricing)).structuredContent).toMatchObject({ priced: false });
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: true,
      direct: 0,
      total: 0,
    });
  });

  it("reproduces readiness with a second quantity-bearing line entirely unpriced", async () => {
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
      ready: true,
      direct: 1500,
      total: 1815,
    });
  });

  it("reproduces readiness with a labor row whose hourly rate is absent", async () => {
    fixture.bid.pricing = {
      labor: [{ ref: "T-1", production_per_man_hour: 10, confirmed: true }],
      material: [material],
    };
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: true,
      direct: 500,
      total: 605,
    });
  });

  it("reproduces a confirmed labor factor disappearing from the bid summary", async () => {
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
      direct: 1500,
      total: 1815,
    });
    // One canonical calculation should carry 1,320 labor + 500 material;
    // compounded 10% overhead then 10% profit gives 2,202.20.
  });

  it("reproduces an unconfirmed factor without a placeholder readiness hold", async () => {
    fixture.bid.pricing = {
      labor: [{ ...labor, apply_factor: true, source: "rsmeans" }],
      material: [material],
      quotes: [],
      rate_sources: [{ source: "rsmeans", carry: true, location_factor: 1.2, confirmed: false }],
    };
    expect((await call(estimatePricing)).structuredContent).toMatchObject({
      direct: 1700,
      placeholder: false,
    });
    expect((await call(estimateBidSummary)).structuredContent.ready).toBe(true);
  });

  it("reproduces title-matched pricing dropping from the ref-only summary", async () => {
    fixture.bid.pricing = {
      labor: [{ ...labor, ref: "Paint" }],
      material: [{ ...material, ref: "Paint" }],
    };
    expect((await call(estimatePricing)).structuredContent.direct).toBe(1500);
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: true,
      direct: 0,
      total: 0,
    });
  });

  it("reproduces both direct basis and competing quotes on the same ref being carried", async () => {
    fixture.bid.pricing = {
      labor: [labor],
      material: [material],
      quotes: [
        { sub: "Painter A", description: "Paint", ref: "T-1", amount: 1400 },
        { sub: "Painter B", description: "Paint", ref: "T-1", amount: 1600 },
      ],
    };
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: true,
      direct: 1500,
      total: 5445,
    });
    // Arithmetic proves 1,500 + 1,400 + 1,600 are carried. It does not prove
    // any real quote overlaps: real coverage needs explicit estimator selection.
  });

  it("reproduces a supervision lump-sum crash when no unit rate was supplied", () => {
    expect(() =>
      gcLineAmount({ key: "supervision", amount: 1000, duration: 10, confirmed: true }),
    ).toThrow(TypeError);
  });
});
