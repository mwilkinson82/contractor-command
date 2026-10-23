/** Claude reply for a tool with the native card. The card view draws structuredContent.html, so the
 *  model only needs the facts: the markdown rows stay, display orders and the dumped HTML go.
 *  Claude reads orders inside a tool result as untrusted text, so they never helped it render. */
import {
  HOST_DISPLAY_BLOCK,
  SOV_CHART_RULE,
  SOV_PRESENTATION_LEAD,
  VISIBLE_STYLE_LINE,
} from "../visible";
import { CARD_SHOWN, CARD_SHOWN_PICK } from "./silence";
import { EMAIL_CARD_RULE } from "../email-safety";
import { EMAIL_DRAFT_ARTIFACT_LINE, EMAIL_DRAFT_VIEW_SPEC } from "../views";
import { outsideFencedBlocks } from "./verbatim";

type Obj = Record<string, unknown>;
const HOUSE_STYLE_RE = /^HOUSE STYLE \(for the assistant/;
/** House style, card-shown orders, and the SOV table/chart styling the card replaces. */
const DISPLAY_GUIDANCE = new Set<string>([
  HOST_DISPLAY_BLOCK,
  CARD_SHOWN,
  CARD_SHOWN_PICK,
  SOV_CHART_RULE,
  EMAIL_CARD_RULE,
]);
/** The email artifact spec lines: the email card draws the draft, so Claude builds no artifact. */
const EMAIL_VIEW_LINES = new Set<string>([EMAIL_DRAFT_ARTIFACT_LINE, ...EMAIL_DRAFT_VIEW_SPEC]);

function isDisplayGuidance(g: unknown): boolean {
  return (
    typeof g === "string" &&
    (DISPLAY_GUIDANCE.has(g) || HOUSE_STYLE_RE.test(g) || g.startsWith(SOV_PRESENTATION_LEAD))
  );
}

/** Text the model reads: every markdown row, no HTML document and no render orders. */
export function claudeCardText(text: string): string {
  return outsideFencedBlocks(text, (part) =>
    part
      .replace(/^REQUIRED VIEW[^\n]*$/gm, "")
      .replace(/<!doctype html[\s\S]*?<\/html>/gi, "")
      .replace(/<!doctype html[\s\S]*$/gi, "")
      .replace(/^Card shown\. Do not add text(?:; wait for the user's pick)?\.?$/gm, "")
      .split("\n")
      .filter((line) => line.trim() !== VISIBLE_STYLE_LINE && !EMAIL_VIEW_LINES.has(line.trim()))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n"),
  ).trim();
}

/** Returns null when nothing in the result needed to change. Workflow guidance (which question to ask next,
 *  the SOV delivery options) stays; house style, card-shown orders and SOV table/chart styling go. */
export function claudeCardReply(result: Obj): Obj | null {
  if (!Array.isArray(result.content)) return null;
  let changed = false;
  // No line claims the card is on screen: the host draws it only after the resource loads, and
  // when that load fails the model would otherwise tell the member to look at a card that is not there.
  const content = result.content.map((block) => {
    const row = block as Obj;
    if (row?.type !== "text" || typeof row.text !== "string") return block;
    const next = claudeCardText(row.text);
    if (next === row.text) return block;
    changed = true;
    return { ...row, text: next };
  });
  const sc = result.structuredContent as Obj | undefined;
  let structuredContent = sc;
  if (sc && Array.isArray(sc.assistant_guidance)) {
    const kept = (sc.assistant_guidance as unknown[]).filter((g) => !isDisplayGuidance(g));
    if (kept.length !== sc.assistant_guidance.length) {
      changed = true;
      const { assistant_guidance: _drop, ...rest } = sc;
      structuredContent = kept.length ? { ...rest, assistant_guidance: kept } : rest;
    }
  }
  if (!changed) return null;
  return { ...result, content, ...(structuredContent ? { structuredContent } : {}) };
}
