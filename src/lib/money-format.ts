/**
 * One money format for every Athena accounting surface: "$6,400.00".
 * Cents stay exact (BigInt); US dollars show "$", any other currency shows its code ("CAD 650.00")
 * so a foreign amount is never mistaken for dollars.
 */
export type CentsInput = number | string | bigint | null | undefined;

function toBigInt(cents: CentsInput): bigint | null {
  if (cents === null || cents === undefined) return null;
  if (typeof cents === "bigint") return cents;
  if (typeof cents === "number") return Number.isSafeInteger(cents) ? BigInt(cents) : null;
  const s = cents.trim();
  return /^-?[0-9]{1,16}$/.test(s) ? BigInt(s) : null;
}

/** "$6,400.00", "-$200.00", "CAD 650.00"; `missing` when the amount was not recorded. */
export function formatMoney(
  cents: CentsInput,
  currency: string | null = "USD",
  missing = "Not recorded",
): string {
  const n = toBigInt(cents);
  if (n === null) return missing;
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = `${whole}.${(abs % 100n).toString().padStart(2, "0")}`;
  if (currency === null) return `${negative ? "-" : ""}${body} · currency not recorded`;
  if (currency === "USD") return `${negative ? "-" : ""}$${body}`;
  return `${currency} ${negative ? "-" : ""}${body}`;
}

/** Whole-number cents from anything the read layer returns; null when it is not an exact integer. */
export function centsValue(cents: CentsInput): bigint | null {
  return toBigInt(cents);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-03" or an ISO timestamp -> "Nov 3, 2026". Invalid input is returned unchanged. */
export function formatRecordDate(value: string | null | undefined, timeZone?: string): string {
  if (!value) return "Not recorded";
  if (timeZone && /T\d{2}:\d{2}/.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime()))
      try {
        return new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone,
        }).format(d);
      } catch {
        /* unknown zone: fall through to the recorded calendar date */
      }
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return value;
  return `${MONTHS[month - 1]} ${day}, ${m[1]}`;
}
