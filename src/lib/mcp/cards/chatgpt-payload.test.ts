import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { attachAthenaCard } from "./attach";
import { renderHtml } from "./html";
import { CLAUDE_CHAT_CARD_LINE } from "./markdown";
import type { CardModel } from "./model";
import { CARD_WIDGET_MIME, CARD_WIDGET_URI, cardWidgetHtml, cardWidgetMeta } from "./widget";

const card: CardModel = {
  state: "result",
  title: "Lookaheads",
  show_state: false,
  job: "2701 – Harbor Point",
  kpis: [{ label: "Visible", value: "1" }],
  sections: [
    {
      heading: "Lookaheads",
      kind: "table",
      columns: ["Ref", "Window", "Rev", "Items"],
      rows: [{ cells: ["LA-31BE8", "2026-11-09 to 2026-11-20", "Rev 0", "6"] }],
    },
  ],
};

describe("ChatGPT card payload stays byte-identical", () => {
  it("keeps outputTemplate, the card, the HTML document, and the skybridge widget", () => {
    const html = renderHtml(card);
    const widget = cardWidgetHtml();
    const out = attachAthenaCard("list_open_items", {
      content: [{ type: "text", text: "Job 2701 has 1 lookahead (1 with content, 0 empty)." }],
      structuredContent: { card, html, total_visible: 1 },
      _meta: { ...cardWidgetMeta },
    }) as {
      content: { text?: string }[];
      structuredContent: { card: CardModel; html: string; total_visible: number };
      _meta: Record<string, string>;
    };

    expect(out._meta).toEqual({ "openai/outputTemplate": CARD_WIDGET_URI });
    expect(out._meta["openai/outputTemplate"]).toBe("ui://athena/card.html");
    expect(out.structuredContent.card).toBe(card);
    expect(out.structuredContent.html).toBe(html);
    expect(out.structuredContent.html.startsWith("<!doctype html>")).toBe(true);
    expect(out.structuredContent.html).toContain("#1E3A5F");
    expect(out.structuredContent.html).toContain("#1E5FED");
    expect(out.structuredContent.html).toContain("#6B7280");
    expect(out.structuredContent.total_visible).toBe(1);
    expect(out.content[0].text).toContain(CLAUDE_CHAT_CARD_LINE);
    expect(out.content[0].text).not.toContain(html);
    expect(out.content[0].text).not.toContain("<!doctype");

    expect(CARD_WIDGET_MIME).toBe("text/html+skybridge");
    expect(cardWidgetMeta).toEqual({ "openai/outputTemplate": "ui://athena/card.html" });
    expect(widget).toContain("window.openai");
    expect(widget).toContain("toolOutput");
    expect(widget).toContain("#1E3A5F");
    expect(widget).toContain("#1E5FED");
    expect(widget).not.toContain(CLAUDE_CHAT_CARD_LINE);

    const widgetSource = readFileSync(new URL("./widget.ts", import.meta.url), "utf8");
    const htmlSource = readFileSync(new URL("./html.ts", import.meta.url), "utf8");
    expect(widgetSource).toContain('export const CARD_WIDGET_URI = "ui://athena/card.html"');
    expect(widgetSource).toContain('export const CARD_WIDGET_MIME = "text/html+skybridge"');
    expect(widgetSource).toContain('"openai/outputTemplate": CARD_WIDGET_URI');
    expect(widgetSource).not.toContain("paste the styled markdown card");
    expect(htmlSource).toContain("<!doctype html>");
    expect(htmlSource).not.toContain("paste the styled markdown card");
  });
});
