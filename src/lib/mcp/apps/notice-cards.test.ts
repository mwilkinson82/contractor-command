import { describe, expect, it } from "vitest";
import clauses from "../__fixtures__/job-2701-clauses.json";
import type { ClauseRow } from "../contract-clauses";
import { DEFAULT_NOTICE_THEME, NOTICE_CARDS_URI, THEMES, noticeCards, noticeCardsHtml, noticeCardsPayload, readNoticeCardsResource } from "./notice-cards";
import { appsRequests, rewritePayload } from "./rpc";
import { HOST_DISPLAY_BLOCK, finalizeVisible } from "../visible";

const cl = clauses as unknown as ClauseRow[];

describe("notice cards (job 2701)", () => {
  const cards = noticeCards(cl);
  it("carries the three notice clauses word for word with section, days and recipient", () => {
    for (const s of ["3.3", "6.2", "7.3"]) {
      const c = cards.find((x) => x.section === s)!;
      expect(c.verbatim_text).toBe(cl.find((x) => x.section === s)!.verbatim_text);
      expect(c.recipient).toBe("Contractor's Project Manager");
      expect(c.days).toBeGreaterThan(0);
    }
  });
  it("highlights only short deadlines you have to send", () => {
    expect(cards.filter((c) => c.urgent).map((c) => c.section).sort()).toEqual(["6.2", "7.2"]);
    expect(cards.find((c) => c.section === "10.1")!.urgent).toBe(false);
  });
  it("payload defaults to a theme that exists and offers the plain-English summary", () => {
    const p = noticeCardsPayload({ job_number: "2701" }, cl);
    expect(THEMES[p.theme]).toBeDefined();
    expect(p.theme).toBe(DEFAULT_NOTICE_THEME);
    expect(p.summary_offer).toMatch(/plain English/);
  });
  it("the template is self-contained and member text never names the build platform", () => {
    const html = noticeCardsHtml();
    expect(html).toContain("Summarize in plain English?");
    expect(html).not.toMatch(/lovable/i);
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/i);
    expect(readNoticeCardsResource(NOTICE_CARDS_URI)!.contents[0].mimeType).toBe("text/html;profile=mcp-app");
  });
});

describe("MCP Apps wiring", () => {
  it("adds the card view to contract_terms on tools/list and answers resources/read", () => {
    const reqs = appsRequests(JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "tools/list" }, { jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: NOTICE_CARDS_URI } }]));
    const { value } = rewritePayload(
      [
        { jsonrpc: "2.0", id: 1, result: { tools: [{ name: "contract_terms" }, { name: "report" }] } },
        { jsonrpc: "2.0", id: 2, error: { code: -32601, message: "Method not found" } },
      ],
      reqs,
    );
    const [tl, rr] = value as { result: Record<string, unknown> }[];
    const tools = tl.result.tools as { name: string; _meta?: Record<string, unknown> }[];
    expect(tools[0]._meta!["openai/outputTemplate"]).toMatch(/^ui:\/\//);
    expect((tools[0]._meta!.ui as { resourceUri: string }).resourceUri).toBe(NOTICE_CARDS_URI);
    expect(tools[1]._meta).toBeUndefined();
    expect((rr.result.contents as { text: string }[])[0].text).toContain("<!doctype html>");
  });
  it("the host-display block goes to hidden guidance and says styled is the default", () => {
    const r = finalizeVisible({ content: [{ type: "text", text: "Hello" }] }, [HOST_DISPLAY_BLOCK]) as { content: { text: string }[]; structuredContent: { assistant_guidance: string[] } };
    expect(r.content[0].text).toBe("Hello");
    expect(r.structuredContent.assistant_guidance.join("\n")).toMatch(/default for every answer/);
  });
});
