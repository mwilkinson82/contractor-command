// ChatGPT paints the Athena card from structuredContent / outputTemplate, then speaks
// whatever prose is left in the tool text. A which-job or picker card must end on the
// card. The last line is an instruction, not a preview of the next pull.

import { CARD_WIDGET_URI } from "./widget";

export const CARD_SHOWN = "Card shown. Do not add text.";
export const CARD_SHOWN_PICK = "Card shown. Do not add text; wait for the user's pick.";

/** Selection cards. Which-job is detected from structuredContent.which_job. */
export const PICKER_TOOLS = new Set(["team_list"]);

const HTML_MARKER = "REQUIRED VIEW: render this HTML card as-is.";

type Block = { type: string; text?: string; _meta?: Record<string, unknown> };
type Res = {
  content?: Block[];
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  guidance?: string[];
};

export function cardClosing(pick: boolean): string {
  return pick ? CARD_SHOWN_PICK : CARD_SHOWN;
}

function stripClosing(text: string): string {
  let t = text.trim();
  const closings = [CARD_SHOWN_PICK, CARD_SHOWN];
  let changed = true;
  while (changed) {
    changed = false;
    for (const closing of closings) {
      if (t.endsWith(closing)) {
        t = t.slice(0, -closing.length).trim();
        changed = true;
      }
    }
  }
  return t;
}

/** Preview lines the model would say under the card. The HTML card itself stays. */
export function stripSpokenPreview(text: string): string {
  const at = text.indexOf(HTML_MARKER);
  const head = at >= 0 ? text.slice(0, at) : text;
  const tail = at >= 0 ? text.slice(at) : "";
  const lines = head.split("\n").filter((line) => {
    const t = line.trim();
    if (/^(I['’]ll|I will) pull\b/i.test(t)) return false;
    if (/upcoming commitments/i.test(t) && /attention first/i.test(t)) return false;
    return true;
  });
  const joined = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!tail) return joined;
  return joined ? `${joined}\n\n${tail.trim()}` : tail.trim();
}

export function applyCardClosing(text: string, pick: boolean): string {
  const body = stripClosing(stripSpokenPreview(text));
  const closing = cardClosing(pick);
  return body ? `${body}\n\n${closing}` : closing;
}

function isCardModel(value: unknown): boolean {
  return !!value && typeof value === "object" && "title" in value && "state" in value;
}

export function isPickerReply(tool: string, res: Res): boolean {
  if (PICKER_TOOLS.has(tool)) return true;
  return res.structuredContent?.which_job === true;
}

export function isCardReply(tool: string, res: Res): boolean {
  if (isPickerReply(tool, res)) return true;
  const sc = res.structuredContent ?? {};
  if (isCardModel(sc.card) || isCardModel(sc.daily_reminder_card)) return true;
  const template = res._meta?.["openai/outputTemplate"];
  if (typeof template === "string" && template.startsWith("ui://athena/")) return true;
  const text = (res.content ?? [])
    .map((c) => (typeof c.text === "string" ? c.text : ""))
    .join("\n");
  return text.includes(HTML_MARKER);
}

function withGuidance(
  sc: Record<string, unknown> | undefined,
  closing: string,
): Record<string, unknown> {
  const prior = Array.isArray(sc?.assistant_guidance) ? (sc.assistant_guidance as unknown[]) : [];
  const guidance = prior.filter((g) => g !== CARD_SHOWN && g !== CARD_SHOWN_PICK);
  guidance.push(closing);
  return { ...(sc ?? {}), assistant_guidance: guidance };
}

/**
 * Last pass on a card or picker result. Keeps the card text, drops a spoken preview,
 * and ends on the no-trailing-prose line. Does not attach a widget resource.
 */
export function sealCardReply<R>(tool: string, result: R): R {
  const res = result as unknown as Res;
  if (!res?.content?.length || !isCardReply(tool, res)) return result;
  const pick = isPickerReply(tool, res);
  const closing = cardClosing(pick);
  let last = -1;
  for (let i = 0; i < res.content.length; i++) {
    const block = res.content[i];
    if (block?.type === "text" && typeof block.text === "string") last = i;
  }
  if (last < 0) return result;
  const content = res.content.map((block, i) =>
    i === last && typeof block.text === "string"
      ? { ...block, text: applyCardClosing(block.text, pick) }
      : block,
  );
  const structuredContent = withGuidance(res.structuredContent, closing);
  if (structuredContent["openai/outputTemplate"] === CARD_WIDGET_URI) delete structuredContent["openai/outputTemplate"];
  const template = res._meta?.["openai/outputTemplate"];
  if (
    typeof template === "string" &&
    template !== CARD_WIDGET_URI &&
    typeof structuredContent["openai/outputTemplate"] !== "string"
  ) {
    structuredContent["openai/outputTemplate"] = template;
  }
  const out: Record<string, unknown> = { ...res, content, structuredContent };
  if (Array.isArray(res.guidance)) {
    out.guidance = [
      ...res.guidance.filter((g) => g !== CARD_SHOWN && g !== CARD_SHOWN_PICK),
      closing,
    ];
  }
  return out as unknown as R;
}
