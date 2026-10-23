// One palette for every Athena card. Navy, brand blue, and one gray.
// Red is the alert color and is legal only for delays, risks, and overdue items.
import { ALERT_HEX } from "../alert-color";

export const NAVY = "#1E3A5F";
/** Brand blue. */
export const BLUE = "#1E5FED";
/** The one gray on this layer. */
export const GRAY = "#6B7280";
export const WHITE = "#FFFFFF";
export const ALERT = ALERT_HEX;

export const PALETTE = { navy: NAVY, blue: BLUE, gray: GRAY, white: WHITE, alert: ALERT } as const;

/** Markdown markers. Blue, white/gray, and red. Nothing else. */
export const MARK = { action: "🔵", neutral: "⚪", alert: "🔴" } as const;

const ALLOWED = new Set([NAVY, BLUE, GRAY, WHITE, ALERT].map((h) => h.toUpperCase()));

export type AlertLevel = "risk" | "delay" | "overdue";
export function isAlertLevel(value: unknown): value is AlertLevel {
  return value === "risk" || value === "delay" || value === "overdue";
}

/** Hex colors in a render, uppercased, including the leading #. */
export function hexesIn(text: string): string[] {
  return [...text.matchAll(/#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/g)].map((m) => {
    const h = m[0].toUpperCase();
    if (h.length === 4) return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
    return h;
  });
}

const OFF_MARKER = new RegExp([0x26a0, 0x1f69a, 0x1f4cb, 0x1f6a9, 0x1f7e1, 0x1f7e0].map((n) => String.fromCodePoint(n)).join("|"), "u");

/**
 * Off-palette colors and markers. Pass alertAllowed only when the card has a
 * delay, risk, or overdue alert or row. Red with alertAllowed false is a failure.
 */
export function paletteViolations(text: string, alertAllowed: boolean): string[] {
  const bad: string[] = [];
  for (const h of hexesIn(text)) {
    if (!ALLOWED.has(h)) bad.push(`off-palette ${h}`);
    else if (h === ALERT.toUpperCase() && !alertAllowed) bad.push(`red ${h} outside delay, risk, or overdue`);
  }
  if (OFF_MARKER.test(text) || /\bamber\b/i.test(text)) bad.push("off-palette marker");
  if (!alertAllowed && text.includes(MARK.alert)) bad.push("red marker outside delay, risk, or overdue");
  return bad;
}

/** A palette color, or the fallback when the value is missing or blank. */
export function cssColor(value: string | null | undefined, fallback: string): string {
  const color = (value ?? "").trim();
  return /^#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/.test(color) ? color : fallback;
}

/** CSS properties whose value is empty, such as `background: ;`. */
export function emptyCssValues(css: string): string[] {
  return [...css.matchAll(/([a-zA-Z-]+)\s*:\s*(?=;|})/g)].map((match) => match[1].toLowerCase());
}

/** Alert styling is only legal on an element that names delay, risk, or overdue. */
export function alertMarkupViolations(html: string): string[] {
  const bad: string[] = [];
  const tags = html.match(/<[^>]*class="[^"]*\balert\b[^"]*"[^>]*>/g) ?? [];
  for (const tag of tags) {
    if (!/data-alert="(?:risk|delay|overdue)"/.test(tag)) bad.push(tag);
  }
  return bad;
}
