import { MARK } from "./palette";
import { STATE_LABEL, type CardModel, type CardRow, type CardSection } from "./model";

const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

function toneMark(row: CardRow): string {
  if (row.flag) return MARK.alert;
  if (row.tone === "unknown") return MARK.neutral;
  return MARK.action;
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
      const cells = Array.from({ length: width }, (_, i) => cell(row.cells[i] ?? ""));
      if (row.flag) cells[0] = `${MARK.alert} ${cells[0]}`.trim();
      lines.push(`| ${cells.join(" | ")} |`);
    }
    return lines;
  }
  if (s.kind === "chips") {
    lines.push(s.rows.map((r) => `${toneMark(r)} ${cell(r.cells[0] ?? "")}`).join(" · "));
    return lines;
  }
  for (const row of s.rows) {
    if (row.raw) {
      lines.push(row.cells.join("\n"));
      continue;
    }
    const text = row.cells.map(cell).filter(Boolean).join(" · ");
    lines.push(`- ${toneMark(row)} ${text}`);
  }
  return lines;
}

/** Server-built markdown card. Markers are only blue, neutral, and red. */
export function renderMarkdown(card: CardModel): string {
  const lines: string[] = [];
  lines.push(`## ${MARK.action} ${card.title}`);
  lines.push(`**${STATE_LABEL[card.state]}**${card.job ? ` · ${card.job}` : ""}`);
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

export function htmlBlock(html: string): string {
  return `REQUIRED VIEW: render this HTML card as-is.\n\n\`\`\`html\n${html}\n\`\`\``;
}
