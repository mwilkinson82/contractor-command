/** Final, host-independent cleanup of legacy display orders. Card data and HTML stay opaque. */
import { EMAIL_CARD_RULE } from "../email-safety";
import {
  CHART_PALETTE_RULE,
  DATE_SWEEP_RULE,
  EMAIL_ATTACHMENT_RULE,
  EMAIL_TO_LABEL_REQUIRED,
  HOST_DISPLAY_BLOCK,
  MONEY_CENTS_RULE,
  RENDER_SILENT,
  SHARE_OPTIONS_REQUIRED,
  SOV_CHART_RULE,
  SOV_DELIVERY_BLOCK,
  SOV_DELIVERY_REQUIRED,
  SOV_PRESENTATION_LEAD,
  VISIBLE_STYLE_LINE,
  splitGuidance,
} from "../visible";
import {
  EMAIL_DRAFT_ARTIFACT_LINE,
  EMAIL_DRAFT_VIEW_SPEC,
  EMAIL_VIEW_SPEC,
  IOR_VIEW_SPEC,
  LOOKAHEAD_VIEW_SPEC,
  PAY_APP_VIEW_SPEC,
  PORTFOLIO_VIEW_SPEC,
  REMINDERS_VIEW_SPEC,
} from "../views";
import { outsideFencedBlocks } from "./verbatim";

const BLOCKS = [
  HOST_DISPLAY_BLOCK,
  SOV_DELIVERY_BLOCK,
  SOV_CHART_RULE,
  SOV_DELIVERY_REQUIRED,
  CHART_PALETTE_RULE,
  MONEY_CENTS_RULE,
  DATE_SWEEP_RULE,
  EMAIL_CARD_RULE,
  EMAIL_ATTACHMENT_RULE,
  EMAIL_TO_LABEL_REQUIRED,
  SHARE_OPTIONS_REQUIRED,
  RENDER_SILENT,
  VISIBLE_STYLE_LINE,
  EMAIL_DRAFT_ARTIFACT_LINE,
  ...EMAIL_DRAFT_VIEW_SPEC,
  ...EMAIL_VIEW_SPEC,
  ...LOOKAHEAD_VIEW_SPEC,
  ...PAY_APP_VIEW_SPEC,
  ...REMINDERS_VIEW_SPEC,
  ...IOR_VIEW_SPEC,
  ...PORTFOLIO_VIEW_SPEC,
];
const LINES = new Set(
  BLOCKS.flatMap((block) => [
    block,
    ...block.split("\n"),
    // finalizeVisible may already have split a display rule into individual sentences.
    ...splitGuidance(block).guidance,
  ]).map((line) => line.trim()),
);
const ORDER =
  /^(?:REQUIRED VIEW\b|Card shown\. Do not add text|REQUIRED: (?:Draw this bar chart now|Any email card|end the reply with the SOV delivery question|Always keep the heading From your inbox and calendar))/;
const DISPLAY_BLOCK =
  /^(?:HOUSE STYLE \(for the assistant|The morning card leads\.|To produce the SOV file, use structuredContent\.sov exactly)/;
const HTML_DOCUMENT = /(<!doctype\s+html\b[\s\S]*?<\/html\s*>)/gi;

function presentationBlock(text: string): boolean {
  return DISPLAY_BLOCK.test(text.trim()) || text.trim().startsWith(SOV_PRESENTATION_LEAD);
}

function cleanOutside(text: string): string {
  let out = text;
  for (const block of BLOCKS) if (block.includes("\n")) out = out.replaceAll(block, "");
  return out
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      const untagged = trimmed.replace(/ \(spec [A-HJ-NP-Z2-9]{6}\)$/, "");
      return !ORDER.test(trimmed) && !LINES.has(untagged) && !presentationBlock(trimmed);
    })
    .join("\n");
}

export function displayFactsText(text: string): string {
  return outsideFencedBlocks(text, (part) =>
    part
      .split(HTML_DOCUMENT)
      .map((piece, index) => (index % 2 ? piece : cleanOutside(piece)))
      .join(""),
  ).trim();
}

type Obj = Record<string, unknown>;

function factsGuidance(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.flatMap((entry) => {
    if (typeof entry !== "string") return [entry];
    if (presentationBlock(entry)) return [];
    const cleaned = displayFactsText(entry);
    return cleaned ? [cleaned] : [];
  });
}

/** Runs after every card/reminder/canary pass, before the SDK sees a successful result. */
export function displayFactsResult<R>(result: R): R {
  const res = result as Obj | null;
  if (!res || typeof res !== "object") return result;
  const content = Array.isArray(res.content)
    ? res.content.map((block) => {
        const row = block as Obj;
        return row?.type === "text" && typeof row.text === "string"
          ? { ...row, text: displayFactsText(row.text) }
          : block;
      })
    : res.content;
  const sc = res.structuredContent as Obj | undefined;
  const delivery = sc?.delivery as Obj | undefined;
  const attachments = delivery?.attachments as Obj | undefined;
  const attachmentRule = attachments?.rule;
  const structuredContent = sc && {
    ...sc,
    ...(Array.isArray(sc.assistant_guidance)
      ? { assistant_guidance: factsGuidance(sc.assistant_guidance) }
      : {}),
    ...(delivery && attachments && typeof attachmentRule === "string"
      ? {
          delivery: {
            ...delivery,
            attachments: { ...attachments, rule: displayFactsText(attachmentRule) },
          },
        }
      : {}),
  };
  return {
    ...res,
    ...(content ? { content } : {}),
    ...(structuredContent ? { structuredContent } : {}),
    ...(Array.isArray(res.guidance) ? { guidance: factsGuidance(res.guidance) } : {}),
  } as R;
}
