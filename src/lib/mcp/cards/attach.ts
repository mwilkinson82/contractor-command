import { htmlBlock, renderMarkdown } from "./markdown";
import { renderHtml } from "./html";
import { inferCard } from "./infer";
import { cardWidgetMeta } from "./widget";
import type { CardModel } from "./model";

type Block = { type: string; text?: string };
type Res = {
  content?: Block[];
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

/** Tools whose plain text is wrapped in a card. Flow tools set their own card. */
export const CARD_TOOLS = new Set([
  "next_question",
  "answer",
  "intake",
  "onboarding",
  "list_open_items",
  "resolve_item",
  "carry_forward",
  "contract_terms",
  "report",
  "email_confirm_send",
  "file_share",
  "file_share_revoke",
  "report_page_link",
  "report_page_share",
  "report_page_share_revoke",
  "pm_meeting",
  "pm_morning",
  "pm_evening",
  "superintendent_view",
  "field_board",
]);

function isCard(value: unknown): value is CardModel {
  return !!value && typeof value === "object" && "state" in value && "title" in value;
}

/**
 * Presentation pass only. Access checks have already run.
 * The original text stays so the facts and the exact lines stay put.
 * The widget script is not inserted here.
 */
export function attachAthenaCard<R>(tool: string, result: R): R {
  if (!CARD_TOOLS.has(tool)) return result;
  try {
    const res = result as unknown as Res;
    const first = res?.content?.find((c) => c.type === "text" && typeof c.text === "string");
    if (!first?.text) return result;
    const sc = { ...(res.structuredContent ?? {}) };
    const card = isCard(sc.card) ? sc.card : inferCard(tool, first.text, sc);
    const html = typeof sc.html === "string" ? sc.html : renderHtml(card);
    const markdown = renderMarkdown(card);
    const hasHtml = first.text.includes("REQUIRED VIEW: render this HTML card as-is.");
    const hasMarkdown = first.text.includes(`## `) && first.text.includes(card.title);
    const text = hasMarkdown
      ? hasHtml
        ? first.text
        : `${first.text}\n\n${htmlBlock(html)}`
      : `${markdown}\n\n${first.text}\n\n${htmlBlock(html)}`;
    const content = res.content!.map((c) => (c === first ? { ...c, text } : c));
    return {
      ...res,
      content,
      structuredContent: { ...sc, card, html },
      _meta: { ...(res._meta ?? {}), ...cardWidgetMeta },
    } as unknown as R;
  } catch {
    return result;
  }
}
