/** Claude reply for a tool with the native card. The card view draws structuredContent.html, so the
 *  model only needs the facts: the markdown rows stay, display orders and the dumped HTML go.
 *  Claude reads orders inside a tool result as untrusted text, so they never helped it render. */
import { HOST_DISPLAY_BLOCK, VISIBLE_STYLE_LINE } from "../visible";
import { CARD_SHOWN, CARD_SHOWN_PICK } from "./silence";

/** A plain statement for the model. Not an order. */
export const CLAUDE_CARD_NOTE = "The member sees this result as an Athena card.";

type Obj = Record<string, unknown>;
const HOUSE_STYLE_RE = /^HOUSE STYLE \(for the assistant/;
const DISPLAY_GUIDANCE = new Set<string>([HOST_DISPLAY_BLOCK, CARD_SHOWN, CARD_SHOWN_PICK]);

function isDisplayGuidance(g: unknown): boolean {
  return typeof g === "string" && (DISPLAY_GUIDANCE.has(g) || HOUSE_STYLE_RE.test(g));
}

/** Text the model reads: every markdown row, no HTML document and no render orders. */
export function claudeCardText(text: string): string {
  return text
    .replace(/^REQUIRED VIEW[^\n]*$/gm, "")
    .replace(/<!doctype html[\s\S]*?<\/html>/gi, "")
    .replace(/<!doctype html[\s\S]*$/gi, "")
    .replace(/^Card shown\. Do not add text(?:; wait for the user's pick)?\.?$/gm, "")
    .split("\n")
    .filter((line) => line.trim() !== VISIBLE_STYLE_LINE)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Returns null when nothing in the result needed to change. Workflow guidance (which question to ask next,
 *  the SOV delivery options) stays; only house-style and card-shown orders are removed. */
export function claudeCardReply(result: Obj): Obj | null {
  if (!Array.isArray(result.content)) return null;
  let changed = false;
  let noted = false;
  const content = result.content.map((block) => {
    const row = block as Obj;
    if (row?.type !== "text" || typeof row.text !== "string") return block;
    const text = claudeCardText(row.text);
    const next = noted || !text || text.includes(CLAUDE_CARD_NOTE) ? text : `${text}\n\n${CLAUDE_CARD_NOTE}`;
    noted ||= !!text;
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
