import { beforeEach, describe, expect, it, vi } from "vitest";
import { TYPE_E_ID, willowCreekTypeE } from "../selections/__fixtures__/willow-creek-type-e";
import { emptyBoard, type Board } from "../selections/model";
import { estimateLineOptions, lineOptionsFlag } from "../selections/estimate-options";
import { withEstimateOptions } from "./estimate-options";
import { looksLikeOptionsComparison } from "./file-share";
import { customerProposal, proposalBlockers } from "../selections/proposal";
import { setPageFetch } from "../selections/product-page";

const fixture = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  board: null as unknown,
  version: 0,
  lines: [] as unknown[],
  gaps: [] as unknown[],
  verdicts: [] as unknown[],
  facts: [] as unknown[],
}));
vi.mock("./guard", () => ({
  run: async (_n: string, _c: unknown, _o: unknown, fn: (sb: unknown) => unknown) =>
    fn({
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            in: async () => {
              fixture.calls.push({ name: `from:${table}`, args: {} });
              return { data: fixture.facts, error: null };
            },
          }),
        }),
      }),
      rpc: async (name: string, args: Record<string, unknown>) => {
        fixture.calls.push({ name, args });
        if (name === "mcp_estimate_get")
          return {
            data: {
              takeoff: { lines: fixture.lines },
              gaps: fixture.gaps,
              verdicts: fixture.verdicts,
            },
            error: null,
          };
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
import { selectionBoard, selectionProposal } from "./tools/selection-board-tool";
import { splitGuidance } from "./visible";

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
  photo_url: `https://img.example.com/${model}.jpg`,
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
  setPageFetch(async () => new Response("", { status: 404 }));
  fixture.calls = [];
  fixture.board = emptyBoard();
  fixture.version = 0;
  fixture.gaps = [];
  fixture.verdicts = [];
  fixture.facts = [];
  fixture.lines = [
    { line_no: 1, item: "Type E 24x48 lay-in LED fixtures", qty: 6, unit: "ea", sheet: "E1" },
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
      "from:mcp_job_facts",
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

    // Every option's links are in the text, so a host that draws no card still shows them.
    const text = r.content[0].text;
    expect(text).toContain(
      "Good Juno R600L G2: Product page: https://www.acuitybrands.com/products/detail/R600L%20G2 · Photo: https://img.example.com/R600L%20G2.jpg",
    );
    expect(text).toContain("Price read on (internal): https://www.example-supply.com/R600L");
    expect(text).not.toContain("Missing links");
    expect(text).toContain(
      "Good: [Juno R600L G2](https://www.acuitybrands.com/products/detail/R600L%20G2)",
    );
    expect(JSON.stringify(r.structuredContent)).toContain(
      "put the option's product name as the markdown link",
    );
  });

  it("starts a contracted job's board from the contract value, so no base price is made up", async () => {
    fixture.facts = [{ module: "contract", key: "contract_value", value: 480000, status: "known" }];
    const r = await callBoard({ action: "save_comparison", comparison, confirmed: true });
    const board = lastSaved();
    expect(board.currency).toBe("USD");
    expect(board.proposal).toMatchObject({
      base_price_cents: 48_000_000,
      base_basis: "Current contract value",
    });
    expect(board.proposal.base_reviewed_on).not.toBeNull();
    expect(r.content[0].text).toContain("Base price set to the current contract value");
    expect(proposalBlockers(board)).not.toContain("Set the base proposal price.");
    expect(proposalBlockers(board)).not.toContain("Review the base proposal price.");

    // Pricing the base tier later keeps the contract base reviewed.
    fixture.board = board;
    fixture.version = 1;
    await callBoard({
      action: "apply_markup",
      expected_version: 1,
      markup_pct: 10,
      cost_basis: "found",
      confirmed: true,
    });
    expect(lastSaved().proposal.base_reviewed_on).not.toBeNull();
  });

  it("leaves the base price to the member when the job has no contract value", async () => {
    fixture.facts = [{ module: "contract", key: "contract_value", value: null, status: "unknown" }];
    await callBoard({ action: "save_comparison", comparison, confirmed: true });
    expect(lastSaved().proposal.base_price_cents).toBeNull();
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
            best: {
              description: "Other panel",
              photo_url: "https://img.example.com/other.jpg",
              found_price_cents: 29900,
            },
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
    // A customer view needs a photo on every option.
    for (const sel of board.selections)
      for (const o of Object.values(sel.options)) o.photo_url = "https://img.example.com/head.jpg";
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

  it("tells the host to offer the save after any comparison, even on an empty board", async () => {
    const r = await callBoard({ action: "read" });
    const guidance = (r.structuredContent.assistant_guidance as string[]).join(" ");
    expect(guidance).toContain("asking the member whether to save it to the estimate");
    expect(guidance).toContain("never end it as review only");
    expect(guidance).toContain("save_comparison");
    expect(guidance).toContain("apply_markup");
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

const g03 = {
  ref: "G-3",
  kind: "verify",
  category: "conflict",
  severity: "hard",
  title: "G03 Track colour, output and control discrepancies",
  reasoning:
    "E1 schedules 9 black Type A and 18 white Type A1 heads, 13W, 90 CRI. A4.1 schedules all 27 heads black, 10W, 80 CRI.",
  sheet: "E1",
  detail: null,
  spec_section: "E1 schedule; A4.1",
  holds_bid: true,
  qty: null,
  unit: null,
  element: null,
  line_no: 3,
};

describe("keeping options on the right takeoff line", () => {
  it("refuses a track lighting selection on the Type E lay-in line and names the track lines", async () => {
    await expect(
      callBoard({
        action: "start",
        expected_version: 0,
        estimate_line_ref: "T-1",
        title: "Type A / A1 Track Lighting",
      }),
    ).rejects.toThrow(
      /doesn't match estimate line T-1.*T-3 Type A black track heads.*T-4 Type A1/s,
    );
    expect(saves()).toHaveLength(0);
  });

  it("refuses the same mismatch in a saved comparison", async () => {
    await expect(
      callBoard({
        action: "save_comparison",
        confirmed: true,
        comparison: [
          { estimate_line_ref: "T-1", title: "Type A track heads", options: trackOptions },
        ],
      }),
    ).rejects.toThrow(/doesn't match estimate line T-1/);
    expect(saves()).toHaveLength(0);
  });

  it("says which line it linked to", async () => {
    const r = await callBoard({ action: "start", expected_version: 0, estimate_line_ref: "T-3" });
    expect(r.content[0].text).toContain("Linked to T-3 Type A black track heads, 9 ea.");
  });
});

describe("an open drawing conflict on the line", () => {
  beforeEach(() => {
    fixture.gaps = [g03];
  });

  it("stops before saving and offers provisional or hold", async () => {
    await expect(
      callBoard({ action: "save_comparison", confirmed: true, comparison }),
    ).rejects.toThrow(/open drawing conflict[\s\S]*G-3[\s\S]*provisional[\s\S]*hold/);
    expect(saves()).toHaveLength(0);
  });

  it("also covers the Type A1 line the conflict names in its text", async () => {
    await expect(
      callBoard({ action: "save_comparison", confirmed: true, comparison: [comparison[1]] }),
    ).rejects.toThrow(/T-4 has an open drawing conflict/);
  });

  it("saves on the member's basis, marked provisional, and keeps the customer view locked", async () => {
    const r = await callBoard({
      action: "save_comparison",
      confirmed: true,
      basis: "E1 schedule, pending RFI-001",
      comparison,
    });
    const board = lastSaved();
    for (const s of board.selections)
      expect(s.notes).toMatch(/^PROVISIONAL\. Basis: E1 schedule, pending RFI-001\. Open: G-3\./);
    expect(r.content[0].text).toContain("provisional on E1 schedule, pending RFI-001");
    expect(proposalBlockers(board).join(" ")).toMatch(
      /provisional until its open drawing conflict/,
    );
  });

  it("no longer asks once a verdict settles the conflict", async () => {
    fixture.verdicts = [
      {
        item_kind: "gap",
        line_no: null,
        gap_ref: "G-3",
        item_text: "G03",
        mark: "relevant",
        note: "RFI-001 answered: E1 governs",
        corrected_qty: null,
        owner: "PM",
        created_at: "2026-11-05T12:00:00Z",
      },
    ];
    await callBoard({ action: "save_comparison", confirmed: true, comparison });
    expect(lastSaved().selections.every((s) => s.notes === "")).toBe(true);
  });
});

const blank = () => ({
  description: "",
  manufacturer: "",
  model: "",
  specifications: "",
  included: [],
  product_url: null,
  source_url: null,
  photo_url: null,
  found_price_cents: null,
  found_at: "",
  found_on: null,
  cost_cents: null,
  price_cents: null,
  price_reviewed_on: null,
  assumptions: "",
});

describe("removing a selection", () => {
  const stray = () => ({
    ...emptyBoard(),
    selections: [
      {
        id: "7ea9043c-e4cc-4b2a-9363-04104c7c8e21",
        title: "Type A / A1 Track Lighting",
        decision_due: null,
        allowance_cents: null,
        quantity: 6,
        unit: "ea",
        estimate_line_ref: "T-1",
        options: { good: blank(), better: blank(), best: blank() },
        selected: null,
        notes: "",
      },
    ],
  });

  it("needs the member's yes, then removes only that selection", async () => {
    fixture.board = stray();
    fixture.version = 4;
    const args = {
      action: "remove_selection",
      expected_version: 4,
      selection_id: "7ea9043c-e4cc-4b2a-9363-04104c7c8e21",
    };
    await expect(callBoard(args)).rejects.toThrow(
      /remove "Type A \/ A1 Track Lighting" from estimate line T-1/,
    );
    expect(saves()).toHaveLength(0);
    const r = await callBoard({ ...args, confirmed: true });
    expect(lastSaved().selections).toHaveLength(0);
    expect(r.content[0].text).toContain('Removed "Type A / A1 Track Lighting" from T-1.');
  });
});

// A seller that answers like a Shopify store for one product and blocks everything else.
const shopify = (product: unknown) =>
  setPageFetch(async (url) =>
    url === "https://shop.example.com/products/th-24.json"
      ? new Response(JSON.stringify({ product }), { status: 200 })
      : new Response("Blocked", { status: 403 }),
  );
const th24 = {
  title: "TH-24 track head",
  variants: [
    { title: "Black", sku: "TH-24-BK", price: "341.95", image_id: 1 },
    { title: "White", sku: "TH-24-WT", price: "341.95", image_id: 2 },
  ],
  images: [
    { id: 1, src: "https://cdn.example.com/th-24-bk.jpg" },
    { id: 2, src: "https://cdn.example.com/th-24-wt.jpg" },
  ],
};

describe("every saved option gets a real photo and a web price", () => {
  const withGap = () => [
    {
      estimate_line_ref: "T-4",
      options: {
        ...trackOptions,
        best: {
          description: "TH-24 track head, white finish",
          manufacturer: "Example",
          model: "TH-24",
          product_url: "https://shop.example.com/products/th-24",
          source_url: "https://blocked.example.com/th-24",
        },
      },
    },
  ];

  it("reads a missing photo and price from the option's own seller page", async () => {
    shopify(th24);
    const r = await callBoard({
      action: "save_comparison",
      comparison: withGap(),
      confirmed: true,
    });
    expect(lastSaved().selections[0].options.best).toMatchObject({
      photo_url: "https://cdn.example.com/th-24-wt.jpg",
      found_price_cents: 34195,
      found_at: "shop.example.com",
      source_url: "https://shop.example.com/products/th-24",
      price_cents: null,
    });
    expect(r.content[0].text).toContain(
      "Type A1 white track heads (Best): product photo and web price read from its seller page.",
    );
  });

  it("saves nothing when no page shows one, and sends the AI to a seller or product that does", async () => {
    shopify({ ...th24, variants: th24.variants.filter((v) => v.title === "Black") });
    await expect(
      callBoard({ action: "save_comparison", comparison: withGap(), confirmed: true }),
    ).rejects.toThrow(
      /Not saved: every option needs a real product photo and a web price.*TH-24: no product photo or web price.*next comparable product/,
    );
    expect(saves()).toHaveLength(0);
  });

  it("completes the missing option before the customer preview, at the member's found-price markup", async () => {
    await callBoard({ action: "save_comparison", comparison, confirmed: true, currency: "USD" });
    fixture.board = lastSaved();
    fixture.version = 1;
    await callBoard({
      action: "apply_markup",
      expected_version: 1,
      markup_pct: 10,
      cost_basis: "found",
      confirmed: true,
    });
    const b = lastSaved();
    b.proposal = {
      ...b.proposal,
      title: "Track lighting upgrade",
      base_price_cents: 48_000_000,
      base_reviewed_on: "2026-11-06",
      change_terms: {
        good: { schedule_days: 0, added_cents: 0, added_note: "" },
        better: { schedule_days: 0, added_cents: 0, added_note: "" },
        best: { schedule_days: 0, added_cents: 0, added_note: "" },
        reviewed_on: "2026-11-06",
      },
    };
    // The member's AI saved the white Best with no photo and no price.
    b.selections[1].options.best = {
      ...b.selections[1].options.best,
      description: "TH-24 track head, white finish",
      model: "TH-24",
      product_url: "https://shop.example.com/products/th-24",
      source_url: null,
      photo_url: null,
      found_price_cents: null,
      cost_cents: null,
      price_cents: null,
      price_reviewed_on: null,
      assumptions: "",
    };
    fixture.board = b;
    fixture.version = 5;
    fixture.calls = [];
    shopify(th24);
    const r = await (
      selectionProposal as unknown as { handler: (a: unknown, c: unknown) => Promise<Response> }
    ).handler({ job_number: "2810", action: "preview" }, {});
    expect(r.structuredContent).toMatchObject({ ready: true, version: 6 });
    const best = lastSaved().selections[1].options.best;
    expect(best).toMatchObject({
      photo_url: "https://cdn.example.com/th-24-wt.jpg",
      found_price_cents: 34195,
      cost_cents: 34195,
      price_cents: 37615,
      assumptions: "Cost is the found web price at shop.example.com; 10% markup.",
    });
    expect(best.price_reviewed_on).not.toBeNull();
    // The member's confirmed prices and no-added-time terms stand.
    expect(lastSaved().selections[0].options.good.price_reviewed_on).not.toBeNull();
    expect(lastSaved().proposal.change_terms?.reviewed_on).not.toBeNull();
    expect(r.content[0].text).toContain("priced at your 10% markup on the web price");
  });

  it("leaves a price it can't find for the AI to source, without asking the member", async () => {
    fixture.board = { ...emptyBoard(), currency: "USD" };
    const r = await (
      selectionProposal as unknown as { handler: (a: unknown, c: unknown) => Promise<Response> }
    ).handler({ job_number: "2810", action: "preview" }, {});
    expect(r.structuredContent.ready).toBe(false);
    expect(JSON.stringify(r.structuredContent)).toContain("Don't show this list to the member");
  });
});

it("won't place a proposed option with no photo or web price on any of its pages", async () => {
  fixture.board = willowCreekTypeE();
  fixture.version = 3;
  await expect(
    callBoard({
      action: "propose_option",
      expected_version: 3,
      selection_id: TYPE_E_ID,
      tier: "best",
      candidate: {
        description: "Panel from a blocked seller",
        model: "PX-9",
        source_url: "https://blocked.example.com/px-9",
      },
    }),
  ).rejects.toThrow(/Not saved: .*PX-9 has no product photo or web price.*next comparable product/);
  expect(saves()).toHaveLength(0);
});

describe("each step up costs more than the tier below it", () => {
  it("won't save a Better that sells for the same as Good, and sends the AI for a real step up", async () => {
    await expect(
      callBoard({
        action: "save_comparison",
        confirmed: true,
        comparison: [
          {
            estimate_line_ref: "T-3",
            options: {
              good: juno("H-7010-CS", 3695, "Bullet track head, black finish"),
              better: juno("H-8010-CS", 3695, "Charge track head, black finish"),
              best: juno("H-1023F-930", 34195, "Exterminator II track head, black finish"),
            },
          },
        ],
      }),
    ).rejects.toThrow(
      /Not saved: each step up has to cost more.*Better H-8010-CS is USD 36\.95 at Example Supply, the same as Good H-7010-CS at USD 36\.95 each\. Find a Better in this finish priced above USD 36\.95 and under Best's USD 341\.95 each.*save only after they say yes/,
    );
    expect(saves()).toHaveLength(0);
  });

  it("won't save a Best priced under Better", async () => {
    await expect(
      callBoard({
        action: "save_comparison",
        confirmed: true,
        comparison: [
          {
            estimate_line_ref: "T-3",
            options: {
              good: juno("A", 3000, "Good head"),
              better: juno("B", 9000, "Better head"),
              best: juno("C", 8000, "Best head"),
            },
          },
        ],
      }),
    ).rejects.toThrow(
      /Best C is USD 80\.00 at Example Supply, less than Better B at USD 90\.00 each/,
    );
    expect(saves()).toHaveLength(0);
  });

  it("saves a ladder that steps up, with each option's own web price and seller", async () => {
    await callBoard({
      action: "save_comparison",
      confirmed: true,
      comparison: [{ estimate_line_ref: "T-3", options: trackOptions }],
    });
    const s = lastSaved().selections[0];
    expect(
      [s.options.good, s.options.better, s.options.best].map((o) => [
        o.found_price_cents,
        o.found_at,
        o.source_url,
      ]),
    ).toEqual([
      [6351, "Example Supply", "https://www.example-supply.com/R600L%20G2"],
      [7777, "Example Supply", "https://www.example-supply.com/R606L"],
      [21986, "Example Supply", "https://www.example-supply.com/T254L%20G2"],
    ]);
  });

  it("won't swap in a single tier that flattens the ladder", async () => {
    await callBoard({
      action: "save_comparison",
      confirmed: true,
      comparison: [{ estimate_line_ref: "T-3", options: trackOptions }],
    });
    const board = lastSaved();
    fixture.board = board;
    fixture.version = 1;
    const s = board.selections[0];
    await expect(
      callBoard({
        action: "propose_option",
        expected_version: 1,
        selection_id: s.id,
        tier: "better",
        candidate: juno("R600L-X", 6351, "Same-price head"),
      }),
    ).rejects.toThrow(/Better R600L-X is USD 63\.51.*the same as Good R600L G2/);
    expect(saves()).toHaveLength(1);
  });

  it("drops the old product's pricing note when a new product takes the tier", async () => {
    await callBoard({
      action: "save_comparison",
      confirmed: true,
      comparison: [{ estimate_line_ref: "T-3", options: trackOptions }],
    });
    const board = lastSaved();
    fixture.board = board;
    board.selections[0].options.better.assumptions =
      "Cost is the found web price at Example Supply (R606L, $77.77); 10% markup.";
    fixture.version = 1;
    const s = board.selections[0];
    await callBoard({
      action: "propose_option",
      expected_version: 1,
      selection_id: s.id,
      tier: "better",
      candidate: juno("R610L", 10595, "Baffled cylinder head"),
    });
    expect(lastSaved().selections[0].options.better).toMatchObject({
      model: "R610L",
      found_price_cents: 10595,
      assumptions: "",
      price_cents: null,
    });
  });
});

it("keeps the customer view locked while a step up sells for the same as the tier below", async () => {
  const board = willowCreekTypeE();
  const s = board.selections[0];
  s.options.better.price_cents = s.options.good.price_cents;
  fixture.board = board;
  fixture.version = 3;
  const r = await (
    selectionProposal as unknown as { handler: (a: unknown, c: unknown) => Promise<Response> }
  ).handler({ job_number: "2810", action: "preview" }, {});
  expect(r.structuredContent.ready).toBe(false);
  expect(JSON.stringify(r.structuredContent)).toMatch(
    /\(Better\): sells for the same as Good .*so the customer sees no upgrade/,
  );
});

it("keeps the whole step-up refusal in what the member's AI reads", async () => {
  const err = await callBoard({
    action: "save_comparison",
    confirmed: true,
    comparison: [
      {
        estimate_line_ref: "T-3",
        options: {
          good: juno("H-7010-CS", 3695, "Bullet track head, black finish"),
          better: juno("H-8010-CS", 3695, "Charge track head, black finish"),
          best: juno("H-1023F-930", 34195, "Exterminator II track head, black finish"),
        },
      },
    ],
  }).catch((e: Error) => e);
  const { visible } = splitGuidance((err as Error).message);
  expect(visible).toContain("Better H-8010-CS is USD 36.95 at Example Supply");
  expect(visible).toContain("Find a Better in this finish priced above USD 36.95");
  expect(visible).toContain("Search the web for that product yourself");
});
