/** Cents to "USD 1,234.56"; unknown stays "Unknown". */
export function money(amount: number | null, code: string | null): string {
  if (amount === null) return "Unknown";
  const sign = amount < 0 ? "−" : "";
  const n = (Math.abs(amount) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return code ? `${sign}${code} ${n}` : `${sign}${n} (currency unknown)`;
}

/** "+USD 25.00", "−USD 50.00" or "USD 0.00". */
export function signed(amount: number | null, code: string | null): string {
  if (amount === null) return "Unknown";
  return `${amount > 0 ? "+" : ""}${money(amount, code)}`;
}

/** Basis points to "25.0%". */
export const percent = (bp: number | null) => (bp === null ? "Unknown" : `${(bp / 100).toFixed(1)}%`);

/** Customer-page price: "$1,234.56" for USD, "EUR 1,234.56" otherwise. */
export function displayPrice(amount: number, code: string): string {
  const n = (Math.abs(amount) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const body = code === "USD" ? `$${n}` : `${code} ${n}`;
  return amount < 0 ? `−${body}` : body;
}
