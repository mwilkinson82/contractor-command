import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  result: {} as Record<string, unknown>,
  error: null as null | { code: string; message: string },
  snapshotVersionOverride: null as number | null,
}));
vi.mock("./guard", () => ({
  run: async (_name: string, _ctx: unknown, _opts: unknown, fn: (sb: unknown) => unknown) =>
    fn({
      rpc: async (name: string, args: Record<string, unknown>) => {
        fixture.calls.push({ name, args });
        return {
          data:
            name === "mcp_estimate_coverage_snapshot" && fixture.snapshotVersionOverride !== null
              ? { ...fixture.result, version: fixture.snapshotVersionOverride }
              : fixture.result,
          error: fixture.error,
        };
      },
    }),
  text: (value: string) => ({ content: [{ type: "text", text: value }] }),
  dbError: (error: { message: string }) => {
    throw new Error(error.message);
  },
  isMissingFunction: () => false,
}));
vi.mock("./jobs", () => ({
  resolveJob: async () => ({ job_id: "local-job", job_number: "LOCAL", company_id: "local" }),
  named: () => "LOCAL",
}));

import { estimateQuoteCoverage } from "./tools/estimate-coverage-tools";

type Response = { content: { text: string }[]; structuredContent: Record<string, unknown> };
const call = (args: Record<string, unknown>) =>
  (
    estimateQuoteCoverage as unknown as {
      handler: (args: unknown, ctx: unknown) => Promise<Response>;
    }
  ).handler({ job_number: "LOCAL", ...args }, {});
const quote = { sub: "Trade contractor", description: "Paint", amount: 1200, ref: "T-1" };
const decision = {
  quote_index: 0,
  decision: "carry",
  ref: "T-1",
  replace_labor_and_material: true,
  exclusive_to_line: true,
  source_note: "Quote dated July 1",
  scope_note: "Complete painting labor and material",
  exclusions_note: "No exclusions",
};

beforeEach(() => {
  fixture.calls = [];
  fixture.result = {};
  fixture.error = null;
  fixture.snapshotVersionOverride = null;
});

describe("quote coverage tool", () => {
  it("reads the coherent current state and never fabricates a selection", async () => {
    fixture.result = {
      version: 12,
      estimate: { takeoff: { lines: [{ line_no: 1, item: "Paint" }] } },
      bid: { pricing: { quotes: [quote] } },
      selection: null,
    };
    const response = await call({ step: "read" });
    expect(fixture.calls).toEqual([
      { name: "mcp_estimate_coverage_snapshot", args: { _job: "local-job" } },
    ]);
    expect(response.content[0].text).toContain("Trade contractor");
    expect(response.content[0].text).toContain("T-1 Paint");
    expect(response.content[0].text).toContain("no current saved coverage selection");
  });
  it("reviews the exact server-returned quote and scope before any save", async () => {
    fixture.result = {
      version: 12,
      status: "review",
      current: true,
      decisions: [{ ...decision, quote, line: { item: "Paint" } }],
    };
    const response = await call({
      step: "review",
      expected_version: 12,
      request_id: "00000000-0000-4000-8000-000000000001",
      decisions: [decision],
    });
    expect(fixture.calls[0].name).toBe("mcp_estimate_coverage_review");
    expect(response.content[0].text).toContain("replaces both direct labor and material");
    expect(response.content[0].text).toContain("No exclusions");
    expect(fixture.calls.map((call) => call.name)).toEqual([
      "mcp_estimate_coverage_review",
      "mcp_estimate_coverage_snapshot",
    ]);
    expect(response.content[0].text).toContain("quantity is not accepted or available");
  });
  it("requires explicit confirmation and the reviewed request before saving", async () => {
    await expect(call({ step: "save", confirmed: true })).rejects.toThrow(/review/i);
    await expect(
      call({ step: "save", request_id: "00000000-0000-4000-8000-000000000001" }),
    ).rejects.toThrow(/confirm/i);
    expect(fixture.calls).toEqual([]);
    fixture.result = { status: "saved", current: true, version: 13 };
    await call({
      step: "save",
      request_id: "00000000-0000-4000-8000-000000000001",
      confirmed: true,
    });
    expect(fixture.calls[0]).toMatchObject({
      name: "mcp_estimate_coverage_save",
      args: { _confirmed: true },
    });
  });
  it("does not present a review as confirmable when the scope changes during review", async () => {
    fixture.result = {
      version: 12,
      current: true,
      status: "review",
      decisions: [{ ...decision, quote }],
    };
    fixture.snapshotVersionOverride = 13;
    await expect(
      call({ step: "review", expected_version: 12, decisions: [decision] }),
    ).rejects.toThrow(/changed during review/i);
    expect(fixture.calls.map((call) => call.name)).not.toContain("mcp_estimate_coverage_save");
  });
  it("reports an idempotent but stale retry without claiming current coverage", async () => {
    fixture.result = { status: "saved", current: false, version: 13 };
    const response = await call({
      step: "save",
      request_id: "00000000-0000-4000-8000-000000000001",
      confirmed: true,
    });
    expect(response.content[0].text).toContain("since changed");
  });
  it.each(["40P01", "40001"])(
    "requires a fresh read after database concurrency error %s",
    async (code) => {
      fixture.error = { code, message: "transaction aborted" };
      await expect(call({ step: "read" })).rejects.toThrow(/read the latest state/i);
    },
  );
});
