/**
 * A job board opened from a link in a browser that isn't signed in (an AI's own browser) shows no money.
 * Money pages need a signed-in member; every other board page drops dollar figures before it renders.
 */

/** Board pages that are money through and through. Signed out, they ask for a sign-in instead. */
export const MONEY_BOARD_PAGES = ["ior", "payapp"] as const;

export function isMoneyBoardPage(page: string): boolean {
  return (MONEY_BOARD_PAGES as readonly string[]).includes(page);
}

const AMOUNT = String.raw`-?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM]\b)?`;
const BRACKETED = new RegExp(String.raw`\s*\([^()<>]*` + AMOUNT + String.raw`[^()<>]*\)`, "g");
const LOOSE = new RegExp(AMOUNT, "g");

/** Removes dollar amounts from text: "(… $20,000 held)" goes entirely, a loose "$9,500" becomes "an amount". */
export function hideAmounts(text: string): string {
  if (!text.includes("$")) return text;
  return text.replace(BRACKETED, "").replace(LOOSE, "an amount").trim();
}

// Money fields by name. Float, duration and count fields never match.
const MONEY_KEY =
  /^(?:contract_(?:total|value|amount|sum)|amount|.*_amount|.*_amounts|cost|.*_cost|cost_.*|price|.*_price|budget.*|.*_budget|billed.*|.*_billed|payments?|.*_payments?|retainage.*|.*_retainage|held|.*_held|margin.*|.*_margin|fee|.*_fee|fees|revenue.*|value_.*|.*_value|sell|.*_sell|.*_cents)$/i;

/** A copy of a board payload with every dollar figure removed, for a viewer who isn't signed in. */
export function redactMoney<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (typeof value === "string") return hideAmounts(value);
  if (Array.isArray(value)) return value.map(walk);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (
        MONEY_KEY.test(key) &&
        (typeof v === "number" || (typeof v === "string" && /^-?\$?[\d,.]+$/.test(v.trim())))
      )
        continue;
      out[key] = walk(v);
    }
    return out;
  }
  return value;
}
