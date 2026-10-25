import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openItemsBoardUrl, openItemRecordUrl, openItemsCard } from "./open-feed";
import { renderHtml } from "./cards/html";
import { renderMarkdown } from "./cards/markdown";
import { cardWidgetHtml } from "./cards/widget";
import { phoneOpenItemsText } from "./phone-reply";
import { renderReportBody } from "../report-pages";
import type { CardModel } from "./cards/model";

const state = vi.hoisted(() => ({
  scope: "full",
  empty: false,
  failLink: false,
  rpc: [] as string[],
}));
const job = "323a040a-7ed1-4726-8f6a-da13fdb5a0eb";
const company = "5300fd46-5185-45d9-a43d-f0964d34be08";
const rows = Array.from({ length: 32 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  action: `Fictional item #${i + 1}`,
  accountable: "QA PM (fictional)",
  status: "open",
  due_date: i < 4 ? "2026-10-20" : i < 24 ? "2026-10-28" : "2026-11-20",
}));
const sb = {
  from(table: string) {
    const data: unknown[] = table === "mcp_open_items" && !state.empty ? [...rows] : [];
    const q = {
      select: () => q,
      order: () => q,
      eq: () => q,
      limit: () => q,
      not: () => q,
      maybeSingle: async () => ({ data: data[0] ?? null, error: null }),
      then(resolve: (r: unknown) => unknown) {
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return q;
  },
  rpc: async (fn: string) => {
    state.rpc.push(fn);
    if (fn === "mcp_board_link_create")
      return { data: state.failLink ? null : { id: "link" }, error: null };
    throw Error(`Unexpected RPC ${fn}`);
  },
};
vi.mock("./guard", () => ({
  run: async (_t: unknown, _c: unknown, _o: unknown, fn: (sb: unknown) => unknown) => fn(sb),
  text: (text: string) => ({ content: [{ type: "text", text }] }),
  dbError: (e: { message: string }) => {
    throw Error(e.message);
  },
  isMissingFunction: () => false,
}));
vi.mock("./jobs", async (original) => ({
  ...(await original<typeof import("./jobs")>()),
  resolveJob: async () => ({
    job_id: job,
    company_id: company,
    job_number: "2701",
    name: "Fictional Job",
    scope: state.scope,
  }),
  jobTimeZone: async () => "America/Chicago",
  activeNa: async () => [],
  audit: async () => {},
}));
import { listOpenItems } from "./tools/workflow-tools";
type Output = {
  structuredContent: {
    board_url: string | null;
    counts: { open: number; overdue: number; due_in_7_days: number };
    card: CardModel;
    items: { item_id: string; href: string | null }[];
  };
};
const call = () =>
  (listOpenItems as unknown as { handler(a: unknown, c: unknown): Promise<Output> }).handler(
    { job_number: "2701" },
    {},
  );

beforeEach(() => {
  state.scope = "full";
  state.empty = false;
  state.failLink = false;
  state.rpc = [];
});

describe("open-items board and saved item links", () => {
  it("the actual tool retains 32/4/20 and supplies the board and every saved item in all three renderers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T14:00:00Z"));
    try {
      const out = await call(),
        sc = out.structuredContent;
      expect(sc.counts).toEqual({ open: 32, overdue: 4, due_in_7_days: 20 });
      const board = new URL(sc.board_url!);
      expect(board.pathname).toBe(`/r/job/${job}/items`);
      expect(board.searchParams.get("t")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const widget = { dataset: {}, innerHTML: "" };
      runInNewContext(cardWidgetHtml().match(/<script>([\s\S]*?)<\/script>/)![1], {
        window: { openai: { toolOutput: sc } },
        document: { getElementById: () => widget },
      });
      const html = renderHtml(sc.card),
        md = renderMarkdown(sc.card),
        phone = phoneOpenItemsText(sc)!;
      for (const rendered of [html, md, phone, widget.innerHTML]) {
        expect(rendered).toContain("Open live open items");
        expect(rendered).toContain(sc.board_url);
        for (const item of rows) expect(rendered).toContain(`${sc.board_url}#item-${item.id}`);
      }
      const page = renderReportBody({
        page: "items",
        job_number: "2701",
        items: rows.map((r) => ({
          id: r.id,
          action: r.action,
          owner: r.accountable,
          due: r.due_date,
        })),
      });
      for (const item of rows) {
        expect(page).toContain(`id="item-${item.id}"`);
        expect(sc.items.find((r) => r.item_id === item.id)?.href).toBe(
          `${sc.board_url}#item-${item.id}`,
        );
      }
      expect(state.rpc).toEqual(["mcp_board_link_create"]);
      expect(JSON.parse(JSON.stringify(sc)).board_url).toBe(sc.board_url);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a board link on an empty list", async () => {
    state.empty = true;
    const sc = (await call()).structuredContent;
    expect(sc.items).toEqual([]);
    expect(sc.counts.open).toBe(0);
    expect(renderHtml(sc.card)).toContain("Open live open items");
    expect(phoneOpenItemsText(sc)).toContain(sc.board_url);
  });

  it("does not mint broader access for contract-only readers, or fabricate a signed link on failure", async () => {
    state.scope = "contract";
    let sc = (await call()).structuredContent;
    expect(state.rpc).toEqual([]);
    expect(sc.board_url).toBeNull();
    expect(sc.card.sections?.some((s) => s.heading === "Live open items")).toBe(false);
    state.scope = "full";
    state.failLink = true;
    sc = (await call()).structuredContent;
    expect(sc.board_url).toBeNull();
    expect(sc.items).toHaveLength(32);
  });

  it.each([
    "https://example.com/r/job/" + job + "/items",
    "https://member@app.meetathena.io/r/job/" + job + "/items",
    "https://app.meetathena.io:444/r/job/" + job + "/items",
    "https://app.meetathena.io/r/job/%20/items",
    "https://app.meetathena.io/r/job/" + job + "/submittals",
    "javascript:alert(1)",
  ])("rejects an invalid items destination %s", (bad) => {
    expect(openItemsBoardUrl(bad)).toBeNull();
    expect(openItemRecordUrl(bad, rows[0].id)).toBeNull();
    expect(
      openItemsCard("2701", rows, { open: 32, overdue: 4, due_in_7_days: 20 }, "2026-10-25", bad)
        .sections,
    ).toHaveLength(1);
  });
});
