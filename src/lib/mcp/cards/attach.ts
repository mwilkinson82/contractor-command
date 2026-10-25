import { TEXT_CARD_TOOLS } from "./native";
import { htmlBlock, renderMarkdown } from "./markdown";
import { renderHtml } from "./html";
import { inferCard } from "./infer";
import { cardWidgetMeta } from "./widget";
import {
  CARD_SHOWN,
  CARD_SHOWN_PICK,
  applyCardClosing,
  cardClosing,
  stripSpokenPreview,
} from "./silence";
import { INBOX_HOST_LINE } from "../morning-brief";
import { isWhichJobText } from "../which-job";
import { STATE_LABEL, type CardModel } from "./model";

type Block = { type: string; text?: string };
type Res = {
  content?: Block[];
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

/** These results open on the card. No sweep, style line, or footer is left outside it. */
export const CARD_FIRST_TOOLS = new Set([
  "change_order_log", "change_order_record", "rfi_log", "rfi_record", "rfc_log", "rfc_record",
  "jobs_list",
  "drawing_sets_list",
  "sheet_calibrate",
  "takeoff_geometry",
  "estimate_takeoff_get",
  "estimate_takeoff_save",
  "estimate_status",
  "estimate_item_mark",
  "estimate_build",
  "estimate_takeoff_export",
  "estimate_bid_summary",
  "contract_terms",
  "pm_meeting",
  "pm_morning",
  "pm_evening",
  "athena_morning_hitlist",
  "athena_hello",
  "morning_brief",
  "morning_brief_settings",
  "report_page_link",
  "list_open_items",
  "lookahead_get",
  "submittal_log",
  "submittals_list",
  "submittals_import",
  "project_record_search",
  "submittal_chase",
  "submittal_package",
  "submittal_delivery",
  "field_pay_app",
  "living_report_get",
  "drawing_set_import",
  "drawing_markup",
]);

/** Tools whose plain text is wrapped in a card. Flow tools set their own card. */
export const CARD_TOOLS = new Set([
  "change_order_log", "change_order_record", "rfi_log", "rfi_record", "rfc_log", "rfc_record",
  "jobs_list",
  "drawing_sets_list",
  "next_question",
  "answer",
  "intake",
  "onboarding",
  "list_open_items",
  "lookahead_get",
  "resolve_item",
  "carry_forward",
  "contract_terms",
  "report",
  "email_confirm_send",
  "drawing_set_import",
  "drawing_markup",
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
  "field_pay_app",
  "living_report_get",
  "getting_started",
  "submittal_log",
  "submittals_list",
  "submittals_import",
  "project_record_search",
  "submittal_chase",
  "submittal_package",
  "submittal_delivery",
]);

/** Other living report types retain their existing Gantt/IOR presentation. */
export function isCardFirstTool(tool: string, result: unknown): boolean {
  const sc = (result as Res)?.structuredContent;
  return (
    (tool === "resolve_item" && sc?.card !== undefined) ||
    (CARD_FIRST_TOOLS.has(tool) &&
      (tool !== "living_report_get" || sc?.report_type === "billing_forecast"))
  );
}

function isCard(value: unknown): value is CardModel {
  return !!value && typeof value === "object" && "state" in value && "title" in value;
}

function onboardingFacts(text: string): string[] {
  const body = text.split("\n---\n")[0].split("\nDisplay: blue (#")[0];
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("REQUIRED") && !line.startsWith("Display:") && !line.startsWith("---") && !line.startsWith("```") && !line.startsWith("<"));
}

/** The read view says "What I have so far" once and prints the profile once. The HTML card is the caller's. */
export function onboardingReadText(card: CardModel, firstText: string, html: string): string | null {
  if (card.state !== "progress" || card.title !== STATE_LABEL.progress) return null;
  const facts = onboardingFacts(firstText);
  const textCard: CardModel = {
    ...card,
    show_state: false,
    sections: [{
      heading: card.sections?.[0]?.heading ?? "Company",
      kind: "list",
      rows: facts.map((line) => ({ cells: [line], tone: "known" as const })),
    }],
  };
  const markdown = renderMarkdown(textCard);
  const cut = firstText.lastIndexOf("\n---\n");
  const footer = cut >= 0 ? firstText.slice(cut).trim() : "";
  return `${markdown}${footer ? `\n\n${footer}` : ""}\n\n${htmlBlock(html)}`;
}

function stripChrome(text: string): string {
  const styleAt = text.lastIndexOf("\nDisplay: blue (");
  const cut = styleAt >= 0 ? text.slice(0, styleAt) : text;
  return cut.replace(/\n---\nAthena powered by ALP[\s\S]*$/, "").trim();
}

function whichJob(tool: string, text: string): boolean {
  const meeting =
    tool === "list_open_items" ||
    tool === "pm_meeting" ||
    tool === "pm_morning" ||
    tool === "pm_evening" ||
    tool === "athena_morning_hitlist" ||
    tool === "submittal_log" ||
    tool === "submittals_list" ||
    tool === "submittals_import" ||
    tool === "project_record_search" ||
    tool === "submittal_chase" ||
    tool === "daily_report_draft" ||
    tool === "daily_report_save" ||
    tool === "daily_report_get";
  return meeting && isWhichJobText(text);
}

/**
 * Presentation pass only. Access checks have already run.
 * The original text stays so the facts and the exact lines stay put.
 * The widget script is not inserted here.
 */
export function attachAthenaCard<R>(tool: string, result: R): R {
  if (!CARD_TOOLS.has(tool)) return result;
  if (
    tool === "living_report_get" &&
    (result as Res)?.structuredContent?.report_type !== "billing_forecast"
  )
    return result;
  try {
    const res = result as unknown as Res;
    const first = res?.content?.find((c) => c.type === "text" && typeof c.text === "string");
    if (!first?.text) return result;
    const sc = { ...(res.structuredContent ?? {}) };
    const source = stripSpokenPreview(stripChrome(first.text));
    const askJob = whichJob(tool, source);
    const card = isCard(sc.card) ? sc.card : inferCard(tool, source, sc);
    const html =
      typeof sc.html === "string" && !askJob && tool !== "contract_terms"
        ? sc.html
        : renderHtml(card);
    const readText = tool === "onboarding" ? onboardingReadText(card, first.text, html) : null;
    const markdown = renderMarkdown(card);
    const cardText = `${markdown}\n\n${htmlBlock(html)}`;
    const keepBody = !isCardFirstTool(tool, result) && !askJob;
    const hasHtml = source.includes("REQUIRED VIEW: render this HTML card as-is.");
    const hasMarkdown = source.startsWith("## ") && source.includes(card.title);
    const hasPlain = hasHtml && source.includes(card.title);
    // Card-first tools replace the body with the card. A pinned REQUIRED line would be dropped,
    // and the host skips the same line when it lives only in the tool description.
    const inboxLine = source.split("\n").some((line) => line.trim() === INBOX_HOST_LINE)
      ? `${INBOX_HOST_LINE}\n\n`
      : "";
    const rowReply = TEXT_CARD_TOOLS.has(tool);
    const text = readText
      ? readText
      : rowReply
        ? `${inboxLine}${markdown}\n\n${html}`
        : !keepBody
          ? `${inboxLine}${cardText}`
          : hasMarkdown || hasPlain
            ? hasHtml
              ? first.text
              : `${source}\n\n${htmlBlock(html)}`
            : `${markdown}\n\n${first.text}\n\n${htmlBlock(html)}`;
    const closed = rowReply ? text.trim() : applyCardClosing(text, askJob);
    const closing = cardClosing(askJob);
    const priorGuidance = Array.isArray(sc.assistant_guidance)
      ? (sc.assistant_guidance as unknown[])
      : [];
    const content = res.content!.map((c) =>
      c === first
        ? {
            ...c,
            text: closed,
            _meta: { ...(c as { _meta?: Record<string, unknown> })._meta, ...cardWidgetMeta },
          }
        : c,
    );
    const structuredContent = {
      ...sc,
      card,
      html,
      ...(askJob ? { which_job: true } : {}),
      assistant_guidance: [
        ...priorGuidance.filter((g) => g !== CARD_SHOWN && g !== CARD_SHOWN_PICK),
        closing,
      ],
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
