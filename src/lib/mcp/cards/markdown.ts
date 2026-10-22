import { rowPlain } from "../plain-label";
import { MARK } from "./palette";
import { STATE_LABEL, type CardModel, type CardRow, type CardSection } from "./model";

const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

function toneMark(row: CardRow): string {
  if (row.flag) return MARK.alert;
  if (row.tone === "unknown") return MARK.neutral;
  return MARK.action;
}

function linked(row: CardRow): string {
  const view = rowPlain(row);
  const text = cell(view.label);
  return view.href ? `[${text}](${view.href})` : text;
}

function section(s: CardSection): string[] {
  const lines = [`### ${s.heading}`];
  if (!s.rows.length) {
    lines.push(`${MARK.neutral} Nothing on this card yet.`);
    return lines;
  }
  if (s.kind === "table") {
    const width = Math.max(s.columns?.length ?? 0, ...s.rows.map((r) => r.cells.length), 1);
    const labels = Array.from({ length: width }, (_, i) => cell(s.columns?.[i] ?? ""));
    lines.push(`| ${labels.join(" | ")} |`);
    lines.push(`| ${Array.from({ length: width }, () => "---").join(" | ")} |`);
    for (const row of s.rows) {
      const view = rowPlain(row);
      const cells = Array.from({ length: width }, (_, i) => {
        const part = rowPlain({ cells: [row.cells[i] ?? ""] });
        const text = part.label === "Item" && part.refId ? "" : cell(part.label);
        return i === 0 ? (view.href ? `[${text || cell(view.label)}](${view.href})` : text || cell(view.label)) : text;
      });
      if (row.flag) cells[0] = `${MARK.alert} ${cells[0]}`.trim();
      lines.push(`| ${cells.join(" | ")} |`);
    }
    return lines;
  }
  if (s.kind === "chips") {
    lines.push(s.rows.map((r) => `${toneMark(r)} ${linked(r)}`).join(" · "));
    return lines;
  }
  for (const row of s.rows) {
    if (row.raw) {
      if (row.flag) lines.push(`- ${toneMark(row)} **${row.flag === "delay" ? "Delay" : row.flag === "overdue" ? "Overdue" : "Risk"}**`);
      lines.push(row.cells.join("\n"));
      continue;
    }
    lines.push(`- ${toneMark(row)} ${linked(row)}`);
  }
  return lines;
}

/** Server-built markdown card. Markers are only blue, neutral, and red. */
export function renderMarkdown(card: CardModel): string {
  const lines: string[] = [];
  lines.push(`## ${MARK.action} ${card.title}`);
  const stateLine = card.show_state === false ? (card.job ?? "") : `**${STATE_LABEL[card.state]}**${card.job ? ` · ${card.job}` : ""}`;
  if (stateLine) lines.push(stateLine);
  if (card.progress && card.progress.total > 0) {
    const done = Math.max(0, Math.min(card.progress.done, card.progress.total));
    const bar = MARK.action.repeat(done) + MARK.neutral.repeat(card.progress.total - done);
    lines.push(`**Progress:** ${done} of ${card.progress.total} ${bar}`);
  }
  if (card.kpis?.length) {
    lines.push("", "| | |", "| --- | --- |");
    for (const k of card.kpis) {
      const v = k.flag ? `${MARK.alert} ${cell(k.value)}` : cell(k.value);
      lines.push(`| ${cell(k.label)} | ${v} |`);
    }
  }
  for (const s of card.sections ?? []) lines.push("", ...section(s));
  if (card.ask?.prompt) {
    lines.push("", `### ${MARK.action} This question`, card.ask.prompt);
  }
  if (card.alerts?.length) {
    lines.push("", "### Alerts");
    for (const a of card.alerts) lines.push(`- ${MARK.alert} ${a.level}: ${a.text}`);
  }
  if (card.next_move) lines.push("", `**Next move:** ${card.next_move}`);
  return lines.join("\n");
}

/**
 * Claude treats a fenced HTML card as text, escapes it, and wraps it in a second card
 * whose CSS colors are blank. The document is the card. Colors are already written out.
 */
export function htmlBlock(html: string): string {
  return `REQUIRED VIEW: render this HTML card as-is. Do not escape it, do not wrap it in another card, and do not leave a CSS color blank.\n\n${html}`;
}

/**
 * First line of a card result. It has to lead the markdown. When the table comes first,
 * Claude draws that gray table and skips the HTML. ChatGPT's widget still paints the card.
 */
export const CARD_RENDER_LINE =
  "REQUIRED VIEW: render the HTML card in this result as the reply. In Claude, show that HTML as an artifact, as written, with no tool calls inside it. Never paste the markdown below as your answer, and never replace the card with a gray table or one sentence. In ChatGPT the widget paints this card.";

/** Artifact instruction, then any preface, then the markdown, then the HTML document. */
export function cardReply(markdown: string, html: string, preface = ""): string {
  const head = preface.trim() ? `${CARD_RENDER_LINE}\n\n${preface.trim()}` : CARD_RENDER_LINE;
  return `${head}\n\n${markdown}\n\n${htmlBlock(html)}`;
}
