import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPageFetch } from "../selections/product-page";
import { willowCreekTypeE } from "../selections/__fixtures__/willow-creek-type-e";

const fixture = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  data: {} as unknown,
  byName: {} as Record<string, unknown>,
  error: null as null | { code: string; message: string },
}));
vi.mock("./guard", () => ({
  run: async (_n: string, _c: unknown, _o: unknown, fn: (sb: unknown) => unknown) =>
    fn({
      rpc: async (name: string, args: Record<string, unknown>) => {
        fixture.calls.push({ name, args });
        if (name in fixture.byName) return { data: fixture.byName[name], error: null };
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
  setPageFetch(async () => new Response("", { status: 404 }));
  fixture.calls = [];
  fixture.data = { version: 3, board: willowCreekTypeE(), scope: "full" };
  fixture.byName = {};
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
      candidate: {
        description: "Another panel",
        source_url: "https://example.com/p",
        photo_url: "https://example.com/p.jpg",
        found_price_cents: 9900,
      },
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
    // Reads only: the board, and who is on the client page for the next steps.
    expect(
      fixture.calls.every((c) =>
        ["mcp_residential_selections_get", "mcp_portal_list"].includes(c.name),
      ),
    ).toBe(true);
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

  it("ends a preview with the next steps, leading to the client page", async () => {
    // No customer on the client page yet: invite first, then send, then the view-only link.
    fixture.byName.mcp_portal_list = { customers: [], items: [] };
    let r = await callProposal({ action: "preview" });
    let steps = (r.structuredContent.next_steps as { id: string; label: string }[]).map(
      (s) => s.id,
    );
    expect(steps).toEqual([
      "set_change_terms",
      "invite_customer",
      "send_to_client_page",
      "view_only_link",
    ]);
    expect(r.content[0].text).toContain("Next steps:");
    expect(r.content[0].text).toContain("Invite the customer to their client page");

    // A customer has access: send it to them by name; nothing is invited.
    fixture.byName.mcp_portal_list = {
      customers: [{ name: "Dana Park", email: "dana@example.com", revoked_at: null }],
      items: [],
    };
    r = await callProposal({ action: "preview" });
    const list = r.structuredContent.next_steps as { id: string; label: string; how: string }[];
    expect(list.map((s) => s.id)).not.toContain("invite_customer");
    const send = list.find((s) => s.id === "send_to_client_page")!;
    expect(send.label).toBe("Send it to Dana Park's client page");
    expect(send.how).toContain("share_selection with expected_version 3");

    // The client page can't be read: still lead there, checking access first.
    fixture.byName.mcp_portal_list = null;
    r = await callProposal({ action: "preview" });
    steps = (r.structuredContent.next_steps as { id: string }[]).map((s) => s.id);
    expect(steps).toContain("send_to_client_page");
    expect(steps).not.toContain("invite_customer");
  });

  it("shows the time and added cost card before saving, then saves only on confirm", async () => {
    let r = await callBoard({
      action: "set_change_terms",
      change_terms: {
        best: { schedule_days: 2, added_cents: 15000, added_note: "Extra install labor" },
      },
    });
    expect(r.structuredContent.saved).toBe(false);
    expect(fixture.calls.map((c) => c.name)).toEqual(["mcp_residential_selections_get"]);
    const card = r.structuredContent.card as {
      title: string;
      sections: { rows: { cells: string[] }[] }[];
    };
    expect(card.title).toBe("Time and cost for each upgrade");
    expect(card.sections[1].rows.map((x) => x.cells[0])).toEqual([
      "Better: No additional time is necessary for this change.",
      "Best: The additional time necessary for this change is 2 days.",
    ]);

    r = await callBoard({
      action: "set_change_terms",
      expected_version: 3,
      confirmed: true,
      change_terms: {
        best: { schedule_days: 2, added_cents: 15000, added_note: "Extra install labor" },
      },
    });
    const save = fixture.calls.find((c) => c.name === "mcp_residential_selections_save")!;
    const body = save.args._board as { proposal: { change_terms: Record<string, unknown> } };
    expect(body.proposal.change_terms.best).toEqual({
      schedule_days: 2,
      added_cents: 15000,
      added_note: "Extra install labor",
    });
    expect(body.proposal.change_terms.better).toEqual({
      schedule_days: 0,
      added_cents: 0,
      added_note: "",
    });
    expect(body.proposal.change_terms.reviewed_on as string).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("refuses time or added cost on the base package", async () => {
    await expect(
      callBoard({ action: "set_change_terms", change_terms: { good: { schedule_days: 1 } } }),
    ).rejects.toThrow(/base package/i);
  });

  it("suggests the customer-visible estimate lines and leaves out rough-in and code items", async () => {
    const lines = [
      { line_no: 1, item: "Type E 24x48 lay-in LED fixtures", qty: 6, unit: "ea" },
      { line_no: 3, item: "Type A black track heads", qty: 9, unit: "ea" },
      { line_no: 5, item: "Type G mono-point pendant", qty: 6, unit: "ea" },
      { line_no: 9, item: "Black track rail installed length", qty: 9, unit: "ft" },
      { line_no: 12, item: "Wall occupancy sensors", qty: 3, unit: "ea" },
      { line_no: 20, item: "Self-powered LED exit sign", qty: 1, unit: "ea" },
      { line_no: 27, item: "20A single-pole panel breakers", qty: 23, unit: "ea" },
      { line_no: 76, item: "Branch-circuit wire and conduit by circuit", qty: null, unit: "ft" },
    ];
    fixture.byName.mcp_estimate_get = { takeoff: { lines } };
    const board = willowCreekTypeE();
    board.selections[0].estimate_line_ref = "T-1";
    fixture.byName.mcp_residential_selections_get = { version: 3, board, scope: "full" };
    const r = await callBoard({ action: "suggest" });
    const sc = r.structuredContent as {
      suggested: { estimate_line_ref: string }[];
      on_board: { estimate_line_ref: string }[];
    };
    expect(sc.suggested.map((c) => c.estimate_line_ref)).toEqual(["T-3", "T-5", "T-12"]);
    expect(sc.on_board.map((c) => c.estimate_line_ref)).toEqual(["T-1"]);
    const text = r.content[0].text;
    expect(text).toContain("T-5 Type G mono-point pendant, 6 ea: Decorative lighting");
    expect(text).toContain("Already on the selections board:");
    expect(text).toMatch(/Left out: 1 code-required life-safety items; 2 rough-in/);
    expect(text).toContain("Nothing was saved.");
    // Read only: nothing is written.
    expect(
      fixture.calls.every((c) =>
        ["mcp_estimate_get", "mcp_residential_selections_get"].includes(c.name),
      ),
    ).toBe(true);
  });
});
