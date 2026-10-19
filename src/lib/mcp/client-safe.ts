// Last line of defense for client-facing output: no dollar figures, margin, profit, cost or forecast lines.
// Upstream code already leaves financial data out; this catches anything that slips through in free text.

const MONEY = /(?:US\$|\$|USD\s?)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|mm|million|thousand|bn|billion)\b)?|\b\d[\d,]*(?:\.\d+)?\s?(?:k|m)?\s?(?:dollars|USD)\b/gi;
const FINANCIAL_LINE = /\b(?:margins?|markup|mark-up|profit|gross profit|net profit|overhead|forecast(?:ed|s)?|cost[- ]to[- ]complete|cost[- ]loaded|cost loading|EAC|ETC|budget(?:ed|s)?|contingency|savings[ _]split|fee)\b/i;

export const AMOUNT_WITHHELD = "[amount withheld]";

export function clientSafe(text: string): string {
  return text
    .split("\n")
    .filter((line) => !FINANCIAL_LINE.test(line))
    .map((line) => line.replace(MONEY, AMOUNT_WITHHELD))
    .join("\n");
}

/** True when text would leak money or margin into a client document. */
export function hasClientLeak(text: string): boolean {
  MONEY.lastIndex = 0;
  const m = MONEY.test(text);
  MONEY.lastIndex = 0;
  return m || text.split("\n").some((l) => FINANCIAL_LINE.test(l));
}
