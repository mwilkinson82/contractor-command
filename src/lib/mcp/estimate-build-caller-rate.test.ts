import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ saved: null as unknown, measurement: false }));
vi.mock("./guard", () => ({
  run: async (_name: string, _ctx: unknown, _opts: unknown, fn: (sb: unknown) => unknown) =>
    fn({
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === "mcp_estimate_get")
          return {
            data: {
              setup: { role: "gc", trades: ["09 Finishes"], in_scope: ["Paint only"] },
              takeoff: {
                version: 1,
                lines: [
                  {
                    line_no: 1,
                    item: "Paint",
                    qty: 100,
                    unit: "SF",
                    sheet: "A1",
                    trade: "09 Finishes",
                  },
                ],
              },
              gaps: [],
              verdicts: [],
            },
            error: null,
          };
        if (name === "mcp_estimate_setup_save") {
          fixture.saved = args._patch;
          return { data: {}, error: null };
        }
        throw new Error(`Unexpected RPC: ${name}`);
      },
    }),
  text: (value: string) => ({ content: [{ type: "text", text: value }] }),
  dbError: (error: { message: string }) => {
    throw new Error(error.message);
  },
  isMissingFunction: () => false,
}));
vi.mock("./jobs", async (original) => ({
  ...(await original<typeof import("./jobs")>()),
  resolveJob: async () => ({ job_id: "estimate", job_number: "EST", company_id: "company" }),
  named: () => "EST",
  audit: async () => {},
}));
vi.mock("./takeoff/state", async (original) => ({
  ...(await original<typeof import("./takeoff/state")>()),
  engineSnapshot: async () => (fixture.measurement ? { available: true } : null),
  measurementStatus: () => ({ settled: true }),
}));
vi.mock("./takeoff/integration", async (original) => ({
  ...(await original<typeof import("./takeoff/integration")>()),
  measuredSettlement: () => ({ settled: false, items: [], blockers: [], counts: {} }),
  appendMeasuredSheets: async () => {},
}));
vi.mock("./takeoff/service", async (original) => ({
  ...(await original<typeof import("./takeoff/service")>()),
  viewEngine: async (
    _sb: unknown,
    _job: unknown,
    _measurement: unknown,
    _page: unknown,
    extra: unknown,
  ) => ({ structuredContent: extra }),
}));

import { estimateBuild } from "./tools/estimate-tools";
import { CALLER_RATE_NOTICE } from "./estimate-summary-pdf";

describe("estimate build output provenance", () => {
  it("labels the response, saved summary and PDF as a caller-rate worksheet", async () => {
    fixture.measurement = false;
    const result = await (
      estimateBuild as unknown as {
        handler: (
          args: unknown,
          ctx: unknown,
        ) => Promise<{
          content: { text: string }[];
          structuredContent: Record<string, unknown>;
        }>;
      }
    ).handler({ job_number: "EST", rates: [{ line_no: 1, rate: 10 }] }, {});
    expect(result.content.map((part) => part.text).join("\n")).toContain(CALLER_RATE_NOTICE);
    expect(result.structuredContent).toMatchObject({
      pricing_basis: "caller_unit_rates",
      reviewed_bid: false,
    });
    expect(fixture.saved).toMatchObject({
      summary: { pricing_basis: "caller_unit_rates", reviewed_bid: false },
    });
    expect(
      Buffer.from(String(result.structuredContent.pdf_base64), "base64").toString("latin1"),
    ).toContain(CALLER_RATE_NOTICE);
  });
  it("includes the same provenance in the measured response wrapper", async () => {
    fixture.measurement = true;
    const result = await (
      estimateBuild as unknown as {
        handler: (
          args: unknown,
          ctx: unknown,
        ) => Promise<{
          structuredContent: { report_rows: string[]; estimate_summary: Record<string, unknown> };
        }>;
      }
    ).handler({ job_number: "EST", rates: [{ line_no: 1, rate: 10 }] }, {});
    expect(result.structuredContent.report_rows).toContain(CALLER_RATE_NOTICE);
    expect(result.structuredContent.estimate_summary).toMatchObject({
      pricing_basis: "caller_unit_rates",
      reviewed_bid: false,
    });
  });
});
