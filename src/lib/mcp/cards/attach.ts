import { htmlBlock, renderMarkdown } from "./markdown";
import { renderHtml } from "./html";
import { inferCard } from "./infer";
import { cardWidgetMeta } from "./widget";
import { CARD_SHOWN, CARD_SHOWN_PICK, applyCardClosing, cardClosing, stripSpokenPreview } from "./silence";
import { INBOX_HOST_LINE } from "../morning-brief";
import { isWhichJobText } from "../which-job";
import type { CardModel } from "./model";

type Block = { type: string; text?: string };
type Res = {
  content?: Block[];
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

/** These results open on the card. No sweep, style line, or footer is left outside it. */
export const CARD_FIRST_TOOLS = new Set(["contract_terms", "pm_meeting", "pm_morning", "pm_evening", "athena_morning_hitlist", "athena_hello", "morning_brief", "morning_brief_settings", "report_page_link", "list_open_items", "submittal_log", "submittals_list", "submittals_import", "project_record_search", "submittal_chase"]);

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
  "athena_morning_hitlist",
  "athena_hello",
  "morning_brief",
  "morning_brief_settings",
  "pm_evening",
  "superintendent_view",
  "field_board",
  "getting_started",
  "submittal_log",
  "submittals_list",
  "submittals_import",
  "project_record_search",
  "submittal_chase",
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
  const meeting = tool === "list_open_items" || tool === "pm_meeting" || tool === "pm_morning" || tool === "pm_evening" || tool === "athena_morning_hitlist" || tool === "submittal_log" || tool === "submittals_list" || tool === "submittals_import" || tool === "project_record_search" || tool === "submittal_chase" || tool === "daily_report_draft" || tool === "daily_report_save" || tool === "daily_report_get";
  return meeting && isWhichJobText(text);
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
    const source = stripSpokenPreview(stripChrome(first.text));
    const askJob = whichJob(tool, source);
    const card = isCard(sc.card) ? sc.card : inferCard(tool, source, sc);
    const html = typeof sc.html === "string" && !askJob && tool !== "contract_terms" ? sc.html : renderHtml(card);
    const markdown = renderMarkdown(card);
    const cardText = `${markdown}\n\n${htmlBlock(html)}`;
    const keepBody = !CARD_FIRST_TOOLS.has(tool) && !askJob;
    const hasHtml = source.includes("REQUIRED VIEW: render this HTML card as-is.");
    const hasMarkdown = source.startsWith("## ") && source.includes(card.title);
    const hasPlain = hasHtml && source.includes(card.title);
    // Card-first tools replace the body with the card. A pinned REQUIRED line would be dropped,
    // and the host skips the same line when it lives only in the tool description.
    const inboxLine = source.split("\n").some((line) => line.trim() === INBOX_HOST_LINE) ? `${INBOX_HOST_LINE}\n\n` : "";
    const text = !keepBody
      ? `${inboxLine}${cardText}`
      : hasMarkdown || hasPlain
        ? hasHtml
          ? first.text
          : `${source}\n\n${htmlBlock(html)}`
        : `${markdown}\n\n${first.text}\n\n${htmlBlock(html)}`;
    const closed = applyCardClosing(text, askJob);
    const closing = cardClosing(askJob);
    const priorGuidance = Array.isArray(sc.assistant_guidance) ? (sc.assistant_guidance as unknown[]) : [];
    const content = res.content!.map((c) => (c === first ? { ...c, text: closed, _meta: { ...(c as { _meta?: Record<string, unknown> })._meta, ...cardWidgetMeta } } : c));
    const structuredContent = {
      ...sc,
      card,
      html,
      ...(askJob ? { which_job: true } : {}),
      assistant_guidance: [...priorGuidance.filter((g) => g !== CARD_SHOWN && g !== CARD_SHOWN_PICK), closing],
    };
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
