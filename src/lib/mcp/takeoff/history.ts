// Shared by the save guard and current-view history filter; stored history is never deleted.
export const EXAMPLE_LINE_RE = /(^|[\s(\-–—:])(example|sample|placeholder)(?=$|[\s)\-–—:,.])/i;
export function currentDroppedLines<T extends { item: string }>(lines: T[]) {
  // Hide explicit test tags, not genuine scope such as specification-required sample panels.
  const testTag = /\bexample\b|\(sample\)|^sample\s*:|[-–—:]\s*sample\s*$|^placeholder\b/i;
  return lines.filter((line) => !testTag.test(line.item));
}
