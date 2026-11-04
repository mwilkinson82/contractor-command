import { beforeEach, describe, expect, it, vi } from "vitest";
import { TYPE_E_ID, willowCreekTypeE } from "../selections/__fixtures__/willow-creek-type-e";
import { emptyBoard, type Board } from "../selections/model";
import { estimateLineOptions, lineOptionsFlag } from "../selections/estimate-options";
import { withEstimateOptions } from "./estimate-options";
import { looksLikeOptionsComparison } from "./file-share";
import { customerProposal } from "../selections/proposal";

const fixture = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  board: null as unknown,
  version: 0,
  lines: [] as unknown[],
}));
vi.mock("./guard", () => ({
  run: async (_n: string, _c: unknown, _o: unknown, fn: (sb: unknown) => unknown) =>
    fn({
      rpc: async (name: string, args: Record<string, unknown>) => {
        fixture.calls.push({ name, args });
        if (name === "mcp_estimate_get")
          return { data: { takeoff: { lines: fixture.lines } }, error: null };
        if (name === "mcp_residential_selections_save")
          return {
            data: {
              version: (args._expected_version as number) + 1,
              board: args._board,
              scope: "full",
            },
            error: null,
          };
        return {
          data: { version: fixture.version, board: fixture.board, scope: "full" },
          error: null,
        };
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
import { selectionBoard } from "./tools/selection-board-tool";

type Response = { content: { text: string }[]; structuredContent: Record<string, unknown> };
const callBoard = (args: Record<string, unknown>) =>
  (selectionBoard as unknown as { handler: (a: unknown, c: unknown) => Promise<Response> }).handler(
    { job_number: "2810", ...args },
    {},
  );
const saves = () => fixture.calls.filter((c) => c.name === "mcp_residential_selections_save");
const lastSaved = () => saves().at(-1)!.args._board as Board;

const juno = (model: string, cents: number, description: string) => ({
  description,
  manufacturer: "Juno",
  model,
  specifications: "3000K · 90 CRI",
  product_url: `https://www.acuitybrands.com/products/detail/${model}`,
  source_url: `https://www.example-supply.com/${model}`,
  found_price_cents: cents,
  found_at: "Example Supply",
  found_on: "2026-11-04",
});
const trackOptions = {
  good: juno("R600L G2", 6351, "Economical cone-style track head"),
  better: juno("R606L", 7777, "Cylinder track head, closest to the E1 schedule"),
  best: juno("T254L G2", 21986, "Premium architectural cylinder"),
};
const comparison = [
  { estimate_line_ref: "T-3", options: trackOptions },
  { estimate_line_ref: "T-4", options: trackOptions },
];

beforeEach(() => {
  fixture.calls = [];
  fixture.board = emptyBoard();
  fixture.version = 0;
  fixture.lines = [
    { line_no: 3, item: "Type A black track heads", qty: 9, unit: "ea", sheet: "E1" },
    { line_no: 4, item: "Type A1 white track heads", qty: 18, unit: "ea", sheet: "E1" },
  ];
});

describe("saving a Good, Better, Best comparison to the estimate", () => {
  it("asks for the member's yes before saving anything", async () => {
    await expect(callBoard({ action: "save_comparison", comparison })).rejects.toThrow(
      /ask the member whether to save/i,
    );
    expect(saves()).toHaveLength(0);
  });

  it("links one selection per takeoff line with the takeoff quantity, keeping found prices as leads", async () => {
    const r = await callBoard({
      action: "save_comparison",
      comparison,
      confirmed: true,
      base_tier: "better",
      currency: "USD",
    });
    expect(saves()).toHaveLength(1);
    // Nothing but the board is written: no estimate or pricing call.
    expect(fixture.calls.map((c) => c.name)).toEqual([
      "mcp_residential_selections_get",
      "mcp_estimate_get",
      "mcp_residential_selections_save",
    ]);
    const board = lastSaved();
    expect(board.currency).toBe("USD");
    expect(board.proposal.base_tier).toBe("better");
    expect(board.selections.map((s) => [s.estimate_line_ref, s.quantity, s.unit, s.title])).toEqual(
      [
        ["T-3", 9, "ea", "Type A black track heads"],
        ["T-4", 18, "ea", "Type A1 white track heads"],
      ],
    );
    const good = board.selections[0].options.good;
    expect(good).toMatchObject({ model: "R600L G2", found_price_cents: 6351, cost_cents: null });
    expect(good.price_cents).toBeNull();
    expect(good.price_reviewed_on).toBeNull();
    expect(r.content[0].text).toContain("saved");
  });

  it("refuses a line that is not on the saved takeoff", async () => {
    await expect(
      callBoard({
        action: "save_comparison",
        confirmed: true,
        comparison: [{ estimate_line_ref: "T-77", options: trackOptions }],
      }),
    ).rejects.toThrow(/T-77 was not found/);
    expect(saves()).toHaveLength(0);
  });

  it("keeps a reviewed price when the same product is saved again and clears it for a new product", async () => {
    const board = willowCreekTypeE();
    fixture.board = board;
    fixture.version = 3;
    fixture.lines = [{ line_no: 1, item: "Type E", qty: 6, unit: "ea" }];
    const s = board.selections[0];
    const same = (tier: "good" | "better" | "best") => ({
      description: s.options[tier].description,
      manufacturer: s.options[tier].manufacturer,
      model: s.options[tier].model,
      specifications: s.options[tier].specifications,
      included: s.options[tier].included,
      product_url: s.options[tier].product_url,
      source_url: s.options[tier].source_url,
      photo_url: s.options[tier].photo_url,
      found_price_cents: s.options[tier].found_price_cents,
      found_at: s.options[tier].found_at,
      found_on: s.options[tier].found_on,
    });
    await callBoard({
      action: "save_comparison",
      confirmed: true,
      comparison: [
        {
          estimate_line_ref: "T-1",
          options: {
            good: same("good"),
            better: same("better"),
            best: { description: "Other panel" },
          },
        },
      ],
    });
    const saved = lastSaved().selections[0];
    expect(saved.id).toBe(TYPE_E_ID);
    expect(saved.options.good.price_cents).toBe(s.options.good.price_cents);
    expect(saved.options.good.price_reviewed_on).toBe("2026-11-04");
    expect(saved.options.best).toMatchObject({ description: "Other panel", price_cents: null });
  });
});

describe("pricing options with a markup", () => {
  beforeEach(async () => {
    await callBoard({ action: "save_comparison", comparison, confirmed: true, currency: "USD" });
    fixture.board = lastSaved();
    fixture.version = 1;
    fixture.calls = [];
  });

  it("needs a yes, then prices every option from the found price as cost", async () => {
    await expect(
      callBoard({
        action: "apply_markup",
        expected_version: 1,
        markup_pct: 30,
        cost_basis: "found",
      }),
    ).rejects.toThrow(/ask them to confirm/i);
    expect(saves()).toHaveLength(0);
    await callBoard({
      action: "apply_markup",
      expected_version: 1,
      markup_pct: 30,
      cost_basis: "found",
      confirmed: true,
    });
    const board = lastSaved();
    const better = board.selections[0].options.better;
    expect(better).toMatchObject({ cost_cents: 7777, price_cents: 10110 });
    expect(better.price_reviewed_on).not.toBeNull();
    expect(board.selections.every((s) => s.options.best.price_reviewed_on !== null)).toBe(true);
  });

  it("without the found basis, skips options that have no entered cost", async () => {
    await expect(
      callBoard({ action: "apply_markup", expected_version: 1, markup_pct: 30, confirmed: true }),
    ).rejects.toThrow(/No option could be priced/);
  });

  it("review_price takes a markup on cost for one option", async () => {
    const id = (fixture.board as Board).selections[0].id;
    await callBoard({
      action: "review_price",
      expected_version: 1,
      selection_id: id,
      tier: "good",
      cost_cents: 5000,
      markup_pct: 40,
      confirmed: true,
    });
    expect(lastSaved().selections[0].options.good).toMatchObject({
      cost_cents: 5000,
      price_cents: 7000,
    });
  });

  it("the customer view shows only sell prices once priced, never the found price or cost", async () => {
    await callBoard({
      action: "apply_markup",
      expected_version: 1,
      markup_pct: 30,
      cost_basis: "found",
      confirmed: true,
    });
    const board = lastSaved();
    board.proposal = {
      ...board.proposal,
      title: "Track lighting options",
      base_price_cents: 100_000,
      base_reviewed_on: "2026-11-04",
    };
    const view = JSON.stringify(customerProposal(board, 2));
    expect(view).not.toContain("found");
    expect(view).not.toContain("cost");
    expect(view).not.toContain("example-supply");
  });
});

describe("showing a line's options", () => {
  it("reads only and compares cost, sell and margin per tier", async () => {
    const board = willowCreekTypeE();
    fixture.board = board;
    fixture.version = 3;
    const r = await callBoard({ action: "options", estimate_line_ref: "T-1" });
    expect(saves()).toHaveLength(0);
    const text = r.content[0].text;
    expect(text).toContain("T-1 Type E 2x4 lay-in LED fixtures · 6 ea");
    expect(text).toContain("INTERNAL, not for the customer");
    expect(text).toMatch(/Margin USD [\d,.]+ \(\d+\.\d%\) · markup \d+\.\d%/);
    expect(text).toContain("Saved options do not change the estimate total.");
    expect((r.structuredContent.line_options as unknown[]).length).toBe(1);
  });

  it("says when a line has no options yet", async () => {
    const r = await callBoard({ action: "options", estimate_line_ref: "T-9" });
    expect(r.content[0].text).toContain("Estimate line T-9 has no Good, Better, Best options");
  });
});

describe("estimate flags", () => {
  it("flags each linked line once and leaves unlinked selections out", () => {
    const board = willowCreekTypeE();
    board.selections.push({
      ...structuredClone(board.selections[0]),
      id: crypto.randomUUID(),
      estimate_line_ref: null,
    });
    const lines = estimateLineOptions(board);
    expect([...lines.keys()]).toEqual(["T-1"]);
    expect(lineOptionsFlag(lines.get("T-1")!)).toBe("Good/Better/Best options");
  });

  it("adds the options section and payload to a legacy takeoff view", () => {
    const view = withEstimateOptions(
      {
        text: "Report: Takeoff",
        structured: { lines: [{ ref: "T-1" }, { ref: "T-2" }] } as Record<string, unknown>,
        guidance: [],
      },
      estimateLineOptions(willowCreekTypeE()),
    );
    expect(view.text).toContain(
      "- T-1 Type E 2x4 lay-in LED fixtures: Good/Better/Best options · 3 of 3 priced",
    );
    expect(view.structured.lines).toEqual([
      { ref: "T-1", options: "Good/Better/Best options" },
      { ref: "T-2" },
    ]);
    expect(view.structured.estimate_options).toHaveLength(1);
    expect(view.guidance.join(" ")).toContain("selection_board action options");
  });

  it("leaves a view untouched when no line has options", () => {
    const view = { text: "x", structured: {}, guidance: [] };
    expect(withEstimateOptions(view, new Map())).toBe(view);
  });
});

describe("hand-made customer comparisons are not shared", () => {
  it("recognises a Good, Better, Best comparison by name or plain PDF text", () => {
    expect(looksLikeOptionsComparison("Track Lighting — Customer Comparison.pdf")).toBe(true);
    expect(looksLikeOptionsComparison("2810 good-better-best.pdf")).toBe(true);
    expect(looksLikeOptionsComparison("value_engineering_track.pdf")).toBe(true);
    expect(
      looksLikeOptionsComparison(
        "track.pdf",
        new TextEncoder().encode("%PDF-1.4 /Title (Track Lighting Good / Better / Best)"),
      ),
    ).toBe(true);
    expect(looksLikeOptionsComparison("2810 lookahead.pdf")).toBe(false);
    expect(looksLikeOptionsComparison("SOV draft.xlsx", new TextEncoder().encode("PK"))).toBe(
      false,
    );
  });
});
