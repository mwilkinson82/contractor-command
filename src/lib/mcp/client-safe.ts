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

export const CONTACT_WITHHELD = "[contact withheld]";
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// North American phone numbers as people write them: (361) 555-0142, 361-555-0142, 361.555.0142, +1 361 555 0142.
const PHONE = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\b\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/g;

/** Client copy: contact emails and phone numbers (suppliers, staff, design team) are withheld. Names stay. */
export function withoutContactPii(text: string): string {
  return text
    .replace(/\s*[(<]\s*([^()<>]*?)\s*[)>]/g, (m, inner: string) => {
      // "(dana.whitfield@example.com)" / "<x@y.com>" / "(Superintendent, x@y.com)": drop the contact, keep any other words.
      if (!EMAIL.test(inner) && !new RegExp(PHONE.source).test(inner)) { EMAIL.lastIndex = 0; return m; }
      EMAIL.lastIndex = 0;
      const rest = inner.replace(EMAIL, "").replace(PHONE, "").replace(/\s*[,;/]\s*(?=[,;/]|$)/g, "").replace(/^[\s,;/]+|[\s,;/]+$/g, "");
      return rest ? ` (${rest})` : "";  // the name before it stays; the address is simply left out
    })
    .replace(EMAIL, CONTACT_WITHHELD)
    .replace(PHONE, CONTACT_WITHHELD);
}
