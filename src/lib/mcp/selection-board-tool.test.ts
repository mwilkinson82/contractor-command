import { beforeEach, describe, expect, it, vi } from "vitest";
import { willowCreekTypeE } from "../selections/__fixtures__/willow-creek-type-e";

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
  resolveJob: async () => ({ job_id: "job", job_number: "2810", company_id: "company" }),
  jobTimeZone: async () => "UTC",
  named: () => "2810",
}));
import { customerText, selectionBoard, selectionProposal } from "./tools/selection-board-tool";
import { customerProposal } from "../selections/proposal";

type Response = { content: { text: string }[]; structuredContent: Record<string, unknown> };
const callBoard = (args: Record<string, unknown>) =>
  (selectionBoard as unknown as { handler: (a: unknown, c: unknown) => Promise<Response> }).handler(
    { job_number: "2810", ...args },
    {},
  );
const callProposal = (args: Record<string, unknown>) =>
  (
    selectionProposal as unknown as { handler: (a: unknown, c: unknown) => Promise<Response> }
  ).handler({ job_number: "2810", ...args }, {});
beforeEach(() => {
  fixture.calls = [];
  fixture.data = { version: 3, board: willowCreekTypeE(), scope: "full" };
  fixture.error = null;
});

describe("selection tools", () => {
  it("reads the internal board with packages, cost and margin, marked not for the customer", async () => {
    const r = await callBoard({ action: "read" });
    expect(fixture.calls).toEqual([
      { name: "mcp_residential_selections_get", args: { _job: "job" } },
    ]);
    const text = r.content[0].text;
    expect(text).toContain("INTERNAL, not for the customer");
    expect(text).toContain("Better: proposal total USD 48,836.00 · +USD 336.00 vs base");
    expect(text).toContain(
      "Unit cost USD 109.99 · unit price USD 154.00 · price reviewed 2026-11-04",
    );
    expect(text).toContain("Ready for the customer preview.");
    expect(r.structuredContent.internal).toBe(true);
  });

  it("refuses writes without the version just read and reads that carry changes", async () => {
    await expect(callBoard({ action: "read", board: willowCreekTypeE() })).rejects.toThrow(
      /cannot include changes/i,
    );
    await expect(callBoard({ action: "save", board: willowCreekTypeE() })).rejects.toThrow(
      /version/i,
    );
    await expect(callBoard({ action: "start", estimate_line_ref: "T-1" })).rejects.toThrow(
      /version/i,
    );
    await expect(
      callBoard({ action: "start", estimate_line_ref: "T-1", expected_version: 2 }),
    ).rejects.toThrow(/changed/i);
    expect(fixture.calls.every((c) => c.name === "mcp_residential_selections_get")).toBe(true);
  });

  it("clears a reviewed price when the AI proposes a different product", async () => {
    await callBoard({
      action: "propose_option",
      expected_version: 3,
      selection_id: "6f1d2c34-8b1a-4f0e-9c4d-2a7b5e9d1c01",
      tier: "good",
      candidate: { description: "Another panel", source_url: "https://example.com/p" },
    });
    const save = fixture.calls.find((c) => c.name === "mcp_residential_selections_save")!;
    const saved = save.args._board as ReturnType<typeof willowCreekTypeE>;
    expect(saved.selections[0].options.good).toMatchObject({
      description: "Another panel",
      cost_cents: null,
      price_cents: null,
      price_reviewed_on: null,
      assumptions: "Retail list price; no distributor quote yet.",
    });
    expect(save.args._expected_version).toBe(3);
  });

  it("rejects candidate links that aren't https", async () => {
    await expect(
      callBoard({
        action: "propose_option",
        expected_version: 3,
        selection_id: "6f1d2c34-8b1a-4f0e-9c4d-2a7b5e9d1c01",
        tier: "good",
        candidate: { description: "x", photo_url: "http://example.com/x.jpg" },
      }),
    ).rejects.toThrow();
  });

  it("fails closed when storage is absent or returns data it can't verify", async () => {
    fixture.error = { code: "PGRST202", message: "missing" };
    await expect(callBoard({ action: "read" })).rejects.toThrow(/not installed/i);
    fixture.error = null;
    fixture.data = { version: 1, board: { selections: [] } };
    await expect(callBoard({ action: "read" })).rejects.toThrow(/could not be verified/i);
  });

  it("previews only the customer view and needs a yes before sharing or recording", async () => {
    const r = await callProposal({ action: "preview" });
    expect(r.content[0].text).not.toMatch(/109\.99|69\.97|Retail list|Confirm count/);
    expect(r.content[0].text).toContain("Best: USD 50,186.00 · +USD 1,686.00 vs base");
    await expect(callProposal({ action: "share", expected_version: 3 })).rejects.toThrow(
      /confirm/i,
    );
    await expect(
      callProposal({ action: "share", expected_version: 2, confirmed: true }),
    ).rejects.toThrow(/preview/i);
    await expect(
      callProposal({ action: "record_choice", expected_version: 3, tier: "best", evidence: "x" }),
    ).rejects.toThrow(/confirm/i);
    expect(fixture.calls.some((c) => c.name !== "mcp_residential_selections_get")).toBe(false);
  });

  it("hashes the share token and never sends it to storage in plain text", async () => {
    const realPush = fixture.calls.push.bind(fixture.calls);
    fixture.calls.push = (...items) => {
      for (const i of items)
        if (i.name === "mcp_selection_proposal_share_create")
          fixture.data = { board_version: 3, proposal: customerProposal(willowCreekTypeE(), 3) };
      return realPush(...items);
    };
    const r = await callProposal({ action: "share", expected_version: 3, confirmed: true });
    const token = (r.structuredContent.url as string).split("/").pop()!;
    const create = fixture.calls.find((c) => c.name === "mcp_selection_proposal_share_create")!;
    expect(create.args._token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(create.args)).not.toContain(token);
  });

  it("writes customer text with no private fields", () => {
    const lines = customerText(customerProposal(willowCreekTypeE(), 1)).join("\n");
    expect(lines).toContain("Lithonia Lighting CPANL 2X4 ALO6 SWW7 M2");
    expect(lines).not.toMatch(/6997|109\.99|Illustrative test base|Confirm count/);
  });
});
