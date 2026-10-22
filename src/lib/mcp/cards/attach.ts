import { htmlBlock, renderMarkdown } from "./markdown";
import { renderHtml } from "./html";
import { inferCard } from "./infer";
import { CARD_WIDGET_URI, cardWidgetMeta } from "./widget";
import type { CardModel } from "./model";

type Block = { type: string; text?: string };
type Res = {
  content?: Block[];
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

/** These results open on the card. No sweep, style line, or footer is left outside it. */
export const CARD_FIRST_TOOLS = new Set(["contract_terms", "pm_meeting", "pm_morning", "pm_evening"]);

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
]);

function isCard(value: unknown): value is CardModel {
  return !!value && typeof value === "object" && "state" in value && "title" in value;
}

function stripChrome(text: string): string {
  const styleAt = text.lastIndexOf("\nDisplay: blue (");
  const cut = styleAt >= 0 ? text.slice(0, styleAt) : text;
  return cut.replace(/\n---\nAthena powered by ALP[\s\S]*$/, "").trim();
}

function whichJob(tool: string, text: string): boolean {
  return tool === "list_open_items" && /No job named|Which job should I list open items for\?/i.test(text);
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
    const source = stripChrome(first.text);
    const askJob = whichJob(tool, source);
    const card = isCard(sc.card) ? sc.card : inferCard(tool, source, sc);
    const html = typeof sc.html === "string" && !askJob && tool !== "contract_terms" ? sc.html : renderHtml(card);
    const markdown = renderMarkdown(card);
    const cardText = `${markdown}\n\n${htmlBlock(html)}`;
    const keepBody = !CARD_FIRST_TOOLS.has(tool) && !askJob;
    const hasHtml = source.includes("REQUIRED VIEW: render this HTML card as-is.");
    const hasMarkdown = source.startsWith("## ") && source.includes(card.title);
    const text = !keepBody
      ? cardText
      : hasMarkdown
        ? hasHtml
          ? first.text
          : `${source}\n\n${htmlBlock(html)}`
        : `${markdown}\n\n${first.text}\n\n${htmlBlock(html)}`;
    const content = res.content!.map((c) => (c === first ? { ...c, text, _meta: { ...(c as { _meta?: Record<string, unknown> })._meta, ...cardWidgetMeta } } : c));
    const structuredContent = { ...sc, card, html, ...(askJob ? { which_job: true } : {}), "openai/outputTemplate": CARD_WIDGET_URI };
    const meta = { ...(res._meta ?? {}), ...cardWidgetMeta };
    const out: Record<string, unknown> = { structuredContent, _meta: meta };
    for (const [key, value] of Object.entries(res)) if (!(key in out)) out[key] = value;
    out.content = content;
    out.structuredContent = structuredContent;
    out._meta = meta;
    return out as unknown as R;
  } catch {
    return result;
  }
}
