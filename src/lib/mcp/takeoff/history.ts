// Shared by the save guard and current-view history filter; stored history is never deleted.
export const EXAMPLE_LINE_RE = /(^|[\s(\-–—:])(example|sample|placeholder)(?=$|[\s)\-–—:,.])/i;
export function currentDroppedLines<T extends { item: string }>(lines: T[]) {
  return lines.filter((line) => !EXAMPLE_LINE_RE.test(line.item));
}
