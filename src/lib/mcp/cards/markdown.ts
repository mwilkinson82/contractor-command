import { verbatimBlock } from "./verbatim";
import { rowPlain } from "../plain-label";
import { isAlertLevel } from "./palette";
import { STATE_LABEL, type CardModel, type CardRow, type CardSection } from "./model";

const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

function statusText(text: string, flag: unknown, unknown = false): string {
  const label = isAlertLevel(flag)
    ? flag[0].toUpperCase() + flag.slice(1)
    : unknown
      ? "Unknown"
      : "";
  return label && !new RegExp(`^(?:\\*\\*)?${label}\\b`, "i").test(text)
    ? `${label}: ${text}`
    : text;
}

function linked(row: CardRow): string {
  const view = rowPlain(row);
  const text = cell(view.label);
  return view.href ? `[${text}](${view.href})` : text;
}

function section(s: CardSection): string[] {
  const lines = [`### ${statusText(s.heading, s.flag)}`];
  if (!s.rows.length) {
    lines.push("Nothing on this card yet.");
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
        if (!(row.cells[i] ?? "").trim()) return i === 0 ? cell(view.label) : "";
        const part = rowPlain({ cells: [row.cells[i] ?? ""] });
        const text = part.label === "Item" && part.refId ? "" : cell(part.label);
        return i === (row.linkCell ?? 0) ? (view.href ? `[${text || cell(view.label)}](${view.href})` : text || cell(view.label)) : text;
      });
      cells[0] = statusText(cells[0], row.flag, row.tone === "unknown");
      lines.push(`| ${cells.join(" | ")} |`);
    }
    return lines;
  }
  if (s.kind === "chips") {
    lines.push(s.rows.map((r) => statusText(linked(r), r.flag, r.tone === "unknown")).join(" · "));
    return lines;
  }
  for (const row of s.rows) {
    if (row.tone === "literal") {
      lines.push(verbatimBlock(row.cells.join("\n")));
      continue;
    }
    if (row.tone === "quote") {
      lines.push(...row.cells.join("\n").split("\n").map((l) => `> ${l}`));
      continue;
    }
    if (row.raw) {
      if (row.flag) lines.push(`- **${row.flag === "delay" ? "Delay" : row.flag === "overdue" ? "Overdue" : row.flag === "risk" ? "Risk" : "Callout"}**`);
      lines.push(row.cells.join("\n"));
      continue;
    }
    lines.push(`- ${statusText(linked(row), row.flag, row.tone === "unknown")}`);
  }
  return lines;
}

/** Server-built markdown card. Status words carry meaning without decorative circles. */
export function renderMarkdown(card: CardModel): string {
  const lines: string[] = [];
  lines.push(`## ${card.title}`);
  const stateLine = card.show_state === false ? (card.job ?? "") : `**${STATE_LABEL[card.state]}**${card.job ? ` · ${card.job}` : ""}`;
  if (stateLine) lines.push(stateLine);
  if (card.progress && card.progress.total > 0) {
    const done = Math.max(0, Math.min(card.progress.done, card.progress.total));
    lines.push(`**Progress:** ${done} of ${card.progress.total}`);
  }
  if (card.kpis?.length) {
    lines.push("", "| | |", "| --- | --- |");
    for (const k of card.kpis) {
      lines.push(`| ${statusText(cell(k.label), k.flag)} | ${cell(k.value)} |`);
    }
  }
  for (const s of card.sections ?? []) lines.push("", ...section(s));
  if (card.ask?.prompt) {
    lines.push("", "### This question", card.ask.prompt);
  }
  if (card.alerts?.length) {
    lines.push("", "### Alerts");
    for (const a of card.alerts) lines.push(`- ${statusText(a.text, a.level)}`);
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
