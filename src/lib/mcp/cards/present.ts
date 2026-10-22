import { guide } from "../visible";
import { renderHtml } from "./html";
import { htmlBlock, renderMarkdown } from "./markdown";
import type { CardModel } from "./model";
import { applyCardClosing } from "./silence";
import { cardWidgetMeta } from "./widget";

/**
 * Same shape as the morning brief: the card, its HTML, and the widget meta on the result.
 * tools/list stays plain. The widget bridge puts this meta back after the SDK drops it.
 */
export function presentStyledCard<E extends Record<string, unknown>>(
  card: CardModel,
  extra: E = {} as E,
  guidance: string[] = [],
  preface = "",
) {
  const shown: CardModel = { ...card, show_state: false };
  const html = renderHtml(shown);
  const lead = preface.trim() ? `${preface.trim()}\n\n` : "";
  const body = applyCardClosing(`${lead}${renderMarkdown(shown)}\n\n${htmlBlock(html)}`, false);
  return guide(
    {
      structuredContent: { ...extra, card: shown, html },
      _meta: { ...cardWidgetMeta },
      content: [{ type: "text" as const, text: body, _meta: { ...cardWidgetMeta } }],
    },
    ...guidance,
  );
}
