// One key-aware number format for the IOR page and the other report pages.
// A margin stored as 0.16 is 16.0%, not $0.16. Dollar fields stay currency.
// Versions, counts, and schedule float stay plain numbers.
import { money } from "./mcp/sov";

export { money };

/** Margin, markup, ratio, and probability are fractions when they are 1 or under (0.16 = 16%). */
const RATIO_RE = /margin|markup|ratio|probability/i;
/** Already on a 0–100 scale, or a fraction when the value is not a whole number (0.125 = 12.5%). */
const PERCENT_RE = /pct|percent|percentage|(?:^|_)share(?:_|$)/i;
/** Dollars. Checked only after a percent key, so budgeted_margin is not currency. */
const MONEY_RE = /amount|cost|profit|budget|billing|exposure|allowance|contingency|contract|total|fee|price|revenue|paid|billed|retainage|variance|(?:^|_)gp(?:_|$)|(?:^|_)value(?:_|$)|(?:^|_)weighted(?:_|$)|(?:^|_)hold(?:_|$)|(?:^|_)(?:plan|realistic)(?:_|$)/i;
/** Not money, even when the name contains "total" (total_float) or "count" would false-match "account". */
const PLAIN_RE = /(?:^|_)(?:version|count|duration|qty|quantity|hours|hour|crew|man_days|float|line_no|seq|index)(?:_|$)/i;
/** A margin written as dollars (weighted margin of $4,200), not a ratio. */
const DOLLAR_MARGIN_RE = /amount|dollar|cost|profit|revenue|exposure|price|(?:^|_)value(?:_|$)/i;
/** Percents that are still financial, so a no-money view does not print them. */
const FINANCIAL_PERCENT_RE = /margin|markup|gp|fee|profit|overhead|billed|retainage|revenue|cost/i;

/** Identifiers are not amounts. Strings retain their exact source precision. */
export function isIdentifierKey(key: string): boolean {
  return /(?:^|_)(?:cost_codes?|sov_codes?|sov_lines?)(?:_|$)/i.test(key);
}

export function isPercentKey(key: string): boolean {
  if (isIdentifierKey(key)) return false;
  if (/^(?:profit|overhead)_markup$/i.test(key)) return true;
  if (RATIO_RE.test(key) && DOLLAR_MARGIN_RE.test(key) && !PERCENT_RE.test(key)) return false;
  return RATIO_RE.test(key) || PERCENT_RE.test(key);
}

export function isPlainKey(key: string): boolean {
  return isIdentifierKey(key) || (!isPercentKey(key) && PLAIN_RE.test(key));
}

export function isMoneyKey(key: string): boolean {
  return !isPercentKey(key) && !isPlainKey(key) && MONEY_RE.test(key);
}

/** Whole-number percents stay on the 0–100 scale, so 1% complete is not read as 100%. */
function percentPoints(key: string, value: number): number {
  const ratio = RATIO_RE.test(key) && !PERCENT_RE.test(key);
  if (ratio) return Math.abs(value) <= 1 ? value * 100 : value;
  if (Number.isInteger(value)) return value;
  if (Math.abs(value) <= 1) return value * 100;
  return value;
}

function formatPercentPoints(points: number): string {
  const rounded = Math.round((points + Number.EPSILON) * 10) / 10;
  return `${rounded.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** Drop binary noise (8.333333333 → 8.33). Whole numbers stay whole. */
export function formatPlainNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Format one report number from its field name.
 * moneyOk false hides dollars and financial percents. Schedule percents still show.
 */
export function formatReportNumber(key: string, value: number, moneyOk = true): string {
  if (!Number.isFinite(value)) return "";
  if (isIdentifierKey(key)) return String(value);
  if (isPercentKey(key)) {
    // Four figures on a margin key are dollars (a ratio is never 1,000).
    if (Math.abs(value) >= 1000 && RATIO_RE.test(key) && !PERCENT_RE.test(key)) return moneyOk ? money(value) : "—";
    if (!moneyOk && FINANCIAL_PERCENT_RE.test(key)) return "—";
    return formatPercentPoints(percentPoints(key, value));
  }
  if (isPlainKey(key)) return formatPlainNumber(value);
  if (isMoneyKey(key) || Math.abs(value) >= 1000) return moneyOk ? money(value) : "—";
  if (!moneyOk && !Number.isInteger(value)) return "—";
  return formatPlainNumber(value);
}

/** A bare numeric string ("0.161", "1400000"). Leaves "12.5%" and "$10" alone. */
export function asReportNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** "10,000 / 8,000" and "10000" when the whole field is an amount. */
export function formatMoneyPhrase(text: string): string | null {
  const trimmed = text.trim();
  if (!/^\$?\d[\d,]*(?:\.\d+)?(?:\s*\/\s*\$?\d[\d,]*(?:\.\d+)?)?$/.test(trimmed)) return null;
  return trimmed
    .split("/")
    .map((part) => {
      const n = Number(part.replace(/[$,\s]/g, ""));
      return Number.isFinite(n) ? money(n) : part.trim();
    })
    .join(" / ");
}

/** Bare billing amounts inside a sentence. Leaves the words, adds the dollar sign and cents.
 *  YYYY-MM-DD (open items, deadlines) is a date, so its year is not an amount. */
export function formatBillingText(text: string): string {
  if (!/bill|plan|realistic/i.test(text)) return text;
  return text.replace(/(?<![\w$.])(?!\d{4}-\d{2}-\d{2}(?!\d))(\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?(?![\w])/g, (raw) => {
    const n = Number(raw.replace(/,/g, ""));
    return Number.isFinite(n) ? money(n) : raw;
  });
}
