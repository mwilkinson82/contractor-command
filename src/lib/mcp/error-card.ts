// A failed tool returns this card. Hosts treat a thrown tool error as "Couldn't use Athena".
import { renderHtml } from "./cards/html";
import { htmlBlock, renderMarkdown } from "./cards/markdown";
import type { CardModel } from "./cards/model";
import { CARD_WIDGET_URI, cardWidgetMeta } from "./cards/widget";
import { guide } from "./visible";

export function errorCard(title: string, message: string) {
  const card: CardModel = {
    state: "ask",
    show_state: false,
    title,
    sections: [{ heading: "What happened", kind: "list", rows: [{ cells: [message] }] }],
    next_move: "Nothing was changed.",
  };
  const html = renderHtml(card);
  const body = `${renderMarkdown(card)}\n\n${htmlBlock(html)}`;
  return guide(
    {
      content: [{ type: "text" as const, text: body, _meta: { ...cardWidgetMeta } }],
      structuredContent: { card, html, "openai/outputTemplate": CARD_WIDGET_URI },
      _meta: { ...cardWidgetMeta },
    },
    "Show this card. Do not say the tool could not be used.",
  );
}

export function errorMessage(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : fallback;
  return raw.replace(/^MCP_BAD:/, "").trim() || fallback;
}
