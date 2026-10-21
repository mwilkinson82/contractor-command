// Accounting phase 1: money as exact integer cents, never floating point. Rates as basis points (10% = 1000 bp).
// Rounding: half up (away from zero for negatives), to the cent.

/** $ amount (number with at most 2 decimals, or "1,418,500.00") -> integer cents. Throws on more than 2 decimals. */
export function toCents(v: number | string): number {
  const s = (typeof v === "number" ? v.toFixed(6) : v).replace(/[$,\s]/g, "");
  const m = s.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error(`Not a money amount: ${v}`);
  const frac = (m[3] ?? "").replace(/0+$/, "");
  if (frac.length > 2) throw new Error(`More than two decimals: ${v}`);
  const c = Number(m[2]) * 100 + Number((frac + "00").slice(0, 2));
  return m[1] ? -c : c;
}

/** Percent (10, 7.5, "50%") -> basis points. At most two decimals of a percent. */
export function toBp(pct: number | string): number {
  const s = String(typeof pct === "number" ? pct.toFixed(6) : pct).replace(/[%\s]/g, "");
  const m = s.match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error(`Not a percent: ${pct}`);
  const frac = (m[2] ?? "").replace(/0+$/, "");
  if (frac.length > 2) throw new Error(`More than two decimals of a percent: ${pct}`);
  return Number(m[1]) * 100 + Number((frac + "00").slice(0, 2));
}

/** Integer division of a by b (b > 0), rounded half up (half away from zero). */
export function divHalfUp(a: number, b: number): number {
  if (b <= 0) throw new Error("divisor must be positive");
  const q = Math.floor(Math.abs(a) / b);
  const r = Math.abs(a) - q * b;
  const v = r * 2 >= b ? q + 1 : q;
  return a < 0 ? -v : v;
}

/** cents × basis points, rounded half up to the cent. */
export const applyBp = (cents: number, bp: number) => divHalfUp(cents * bp, 10000);

/** 1418500.5 -> "$1,418,500.50"; always cents. Negative -> "-$10.00". */
export function fmt(cents: number): string {
  const neg = cents < 0;
  const a = Math.abs(cents);
  const d = Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${d}.${String(a % 100).padStart(2, "0")}`;
}

/** 1000 -> "10%", 750 -> "7.5%". */
export function fmtBp(bp: number): string {
  const s = (bp / 100).toFixed(2).replace(/\.?0+$/, "");
  return `${s}%`;
}

/** Two-place percent of a over b (65.44%). "Needed" when b is 0. */
export function pct2(a: number, b: number): string {
  if (!b) return "Needed";
  return `${(divHalfUp(a * 10000, b) / 100).toFixed(2)}%`;
}

export const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
