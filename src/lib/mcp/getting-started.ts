// First-chat card: say Hey Athena. @Athena is the backup.
// The flag is one row per user. A missing migration fails open (no card, no throw).
import { htmlBlock, renderMarkdown } from "./cards/markdown";
import { renderHtml } from "./cards/html";
import type { CardModel } from "./cards/model";
import { START_BACKUP, START_EXAMPLES, START_HEADLINE, START_HOSTS, START_POINTS } from "../athena-start-copy";

export const GETTING_STARTED_GUIDANCE =
  "Show the getting-started card first. It tells the member to say Hey Athena. @Athena is only the backup.";

export const GETTING_STARTED_RULE =
  " When the member asks how to start, how to use Athena, or for getting started, call getting_started and show that card. On a member's first tool call, show the getting-started card before the rest of the reply. The card says to open with Hey Athena. @Athena is only the backup.";

export function gettingStartedCard(): CardModel {
  return {
    state: "result",
    show_state: false,
    title: START_HEADLINE,
    job: START_HOSTS,
    sections: [
      { heading: "Your work", kind: "list", rows: START_POINTS.map((line) => ({ cells: [line] })) },
      { heading: "Try one", kind: "list", rows: START_EXAMPLES.map((ask) => ({ cells: [ask] })) },
      { heading: "Backup", kind: "list", rows: [{ cells: [START_BACKUP] }] },
    ],
  };
}

export function renderGettingStarted(card: CardModel = gettingStartedCard()): string {
  return `${renderMarkdown(card)}\n\n${htmlBlock(renderHtml(card))}`;
}

type TextBlock = { type: string; text?: string };
type TextRes = { content?: TextBlock[]; structuredContent?: Record<string, unknown> };
type Rpc = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/** True only when this call inserted the user's first-run row. */
export async function claimGettingStarted(sb: Rpc): Promise<boolean> {
  try {
    const { data, error } = await sb.rpc("mcp_getting_started_claim");
    if (error) return false;
    return !!data && typeof data === "object" && (data as { show?: boolean }).show === true;
  } catch {
    return false;
  }
}

/**
 * Puts the start card on the first tool result for this user.
 * Card-first tools keep their reply text and carry the card on structuredContent
 * so the widget paints it above the tool card.
 */
export async function attachGettingStarted<R>(sb: Rpc, result: R, opts?: { prepend?: boolean }): Promise<R> {
  const res = result as unknown as TextRes;
  const first = res?.content?.find((c) => c.type === "text" && typeof c.text === "string");
  if (!first?.text) return result;
  const sc = { ...(res.structuredContent ?? {}) };
  if ("getting_started" in sc) return result;
  const show = await claimGettingStarted(sb);
  if (!show) return result;
  const card = gettingStartedCard();
  const prior = Array.isArray(sc.assistant_guidance) ? (sc.assistant_guidance as string[]) : [];
  const structuredContent = {
    ...sc,
    getting_started: card,
    assistant_guidance: prior.includes(GETTING_STARTED_GUIDANCE) ? prior : [...prior, GETTING_STARTED_GUIDANCE],
  };
  const content =
    opts?.prepend === false
      ? res.content
      : res.content!.map((c) => (c === first ? { ...c, text: `${renderGettingStarted(card)}\n\n${first.text}` } : c));
  return { ...(res as object), content, structuredContent } as R;
}
