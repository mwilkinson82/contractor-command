// Drawing markup. A normal callout is brand blue. Red is only a flagged risk, delay, or overdue item.
// The result is a styled card with the drawing embedded. It is not a bare image.
import { ALERT, BLUE, GRAY, NAVY, WHITE } from "./cards/palette";
import type { AlertLevel } from "./cards/palette";

export type DrawingCallout = {
  label: string;
  flag?: AlertLevel | null;
};

const esc = (value: string) =>
  value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Navy-blue mark by default. Red only when the callout is flagged. */
export function drawingCalloutColor(flag: AlertLevel | null | undefined): string {
  if (flag === "risk" || flag === "delay" || flag === "overdue") return ALERT;
  return BLUE;
}

export function drawingMarkupSvg(callouts: DrawingCallout[], sheet = "Drawing"): string {
  const height = Math.max(180, 64 + callouts.length * 48);
  const bubbles = callouts
    .map((callout, index) => {
      const color = drawingCalloutColor(callout.flag);
      const y = 72 + index * 48;
      const alert = callout.flag ? ` data-alert="${callout.flag}"` : "";
      return `<g${alert}><circle cx="36" cy="${y}" r="14" fill="${color}"/><text x="58" y="${y + 5}" fill="${color}" font-size="14" font-family="system-ui,sans-serif">${esc(callout.label)}</text></g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 ${height}" role="img" aria-label="Drawing markup ${esc(sheet)}"><rect width="640" height="${height}" fill="${WHITE}" stroke="${GRAY}"/><text x="24" y="32" fill="${NAVY}" font-size="16" font-family="system-ui,sans-serif">${esc(sheet)}</text>${bubbles}</svg>`;
}

/** Styled card. The SVG sits inside the card, not as its own image. */
export function drawingMarkupCard(input: { sheet?: string | null; callouts: DrawingCallout[] }): { html: string; svg: string } {
  const sheet = input.sheet?.trim() || "Drawing";
  const svg = drawingMarkupSvg(input.callouts, sheet);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Drawing markup</title><style>body{margin:0;background:${WHITE};color:${NAVY};font:15px/1.45 system-ui,sans-serif}.card{max-width:720px;margin:16px auto;border:1px solid ${GRAY};border-radius:14px;overflow:hidden;background:${WHITE}}header{background:${NAVY};color:${WHITE};padding:16px 18px}.mark{margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase}h1{margin:0;font-size:22px}.body{padding:16px 18px}.sheet{margin:0 0 12px;color:${GRAY}}</style></head><body><article class="card" data-state="result"><header><p class="mark">Athena</p><h1>Drawing markup</h1></header><div class="body"><p class="sheet">${esc(sheet)}</p>${svg}</div></article></body></html>`;
  return { html, svg };
}
