/** Opaque member-authored text must bypass display-note and HTML cleanup. */
export function verbatimBlock(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}

/** Transform presentation text outside fenced blocks, preserving their bytes unchanged. */
export function outsideFencedBlocks(text: string, transform: (text: string) => string): string {
  let outside = "";
  let fence: { char: string; length: number } | null = null;
  let htmlDocument = false;
  const parts: string[] = [];
  for (const line of text.match(/[^\n]*(?:\n|$)/g) ?? []) {
    const bare = line.replace(/\r?\n$/, "");
    if (fence) {
      parts.push(line);
      const close = /^ {0,3}(`+|~+)[ \t]*$/.exec(bare);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
    } else {
      // Backticks inside the dumped card document are HTML text, not Markdown fences.
      const documentStart = /<!doctype\s+html\b/i.exec(line);
      if (htmlDocument || documentStart) {
        outside += line;
        htmlDocument = !/<\/html\s*>/i.test(line.slice(documentStart?.index ?? 0));
        continue;
      }
      const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(bare);
      if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
        parts.push(transform(outside), line);
        outside = "";
        fence = { char: open[1][0], length: open[1].length };
      } else outside += line;
    }
  }
  parts.push(transform(outside));
  return parts.join("");
}
