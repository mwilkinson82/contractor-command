import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  data: {} as unknown,
  error: null as null | { code: string; message: string },
}));
vi.mock("./guard", () => ({
  run: async (_n: string, _c: unknown, _o: unknown, fn: (sb: unknown) => unknown) =>
    fn({
      rpc: async (name: string, args: Record<string, unknown>) => {
        fixture.calls.push({ name, args });
        return { data: fixture.data, error: fixture.error };
      },
    }),
  text: (value: string) => ({ content: [{ type: "text", text: value }] }),
  dbError: (error: { message: string }) => {
    throw new Error(error.message);
  },
  isMissingFunction: (error: { code?: string }) => error.code === "PGRST202",
}));
vi.mock("./jobs", () => ({
  resolveJob: async () => ({ job_id: "job", job_number: "LOCAL", company_id: "company" }),
  jobTimeZone: async () => "UTC",
  named: () => "LOCAL",
}));
import { selectionBoard } from "./tools/selection-board-tool";

type Response = { content: { text: string }[]; structuredContent: Record<string, unknown> };
const call = (args: Record<string, unknown>) =>
  (
    selectionBoard as unknown as { handler: (args: unknown, ctx: unknown) => Promise<Response> }
  ).handler({ job_number: "LOCAL", ...args }, {});
const board = {
  currency: "USD",
  selections: [
    {
      id: "72087ad6-fc97-4938-97b3-802803bf49c5",
      title: "Example fixture",
      decision_due: null,
      allowance_cents: 25000,
      options: {
        good: {
          description: "Standard",
          cost_cents: 20000,
          price_cents: 20000,
          specifications: "",
          source_url: null,
          photo_url: null,
        },
        better: {
          description: "Enhanced",
          cost_cents: 27500,
          price_cents: 27500,
          specifications: "",
          source_url: null,
          photo_url: null,
        },
        best: {
          description: "Premium",
          cost_cents: 35000,
          price_cents: 35000,
          specifications: "",
          source_url: null,
          photo_url: null,
        },
      },
      selected: null,
      notes: "Illustrative prices",
    },
  ],
};
beforeEach(() => {
  fixture.calls = [];
  fixture.data = { version: 1, board };
  fixture.error = null;
});

describe("selection board tool", () => {
  it("reads and shows exact choices, allowance differences, and unknown decision dates", async () => {
    const result = await call({ action: "read" });
    expect(fixture.calls).toEqual([
      { name: "mcp_residential_selections_get", args: { _job: "job" } },
    ]);
    expect(result.content[0].text).toContain(
      "Good: Standard · customer price USD 200.00 · difference −USD 50.00",
    );
    expect(result.content[0].text).toContain(
      "Better: Enhanced · customer price USD 275.00 · difference +USD 25.00",
    );
    expect(result.content[0].text).toContain(
      "Best: Premium · customer price USD 350.00 · difference +USD 100.00",
    );
    expect(result.content[0].text).toContain("decision due: Unknown");
    expect(result.content[0].text).toContain("not owner approval");
    expect(result.structuredContent.shared).toBe(false);
  });
  it("requires the board and version before a save and rejects write payload on a read", async () => {
    await expect(call({ action: "save", board })).rejects.toThrow(/version/i);
    await expect(call({ action: "read", board })).rejects.toThrow(/cannot include changes/i);
    expect(fixture.calls).toEqual([]);
    await call({ action: "save", board, expected_version: 0 });
    expect(fixture.calls).toEqual([
      {
        name: "mcp_residential_selections_save",
        args: { _job: "job", _expected_version: 0, _board: board },
      },
    ]);
  });
  it("fails closed when storage is absent or returns invalid data", async () => {
    fixture.error = { code: "PGRST202", message: "missing" };
    await expect(call({ action: "save", expected_version: 0, board })).rejects.toThrow(
      /not installed/i,
    );
    fixture.error = null;
    fixture.data = { version: 1, board: { selections: [] } };
    await expect(call({ action: "read" })).rejects.toThrow(/could not be verified/i);
  });
});
