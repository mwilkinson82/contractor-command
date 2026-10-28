import { rowPlain } from "../plain-label";
import type { CardModel } from "./model";

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export const reportLinkCss = `
.card[data-presentation="report-link"],#app>.card[data-presentation="report-link"]{box-sizing:border-box;max-width:640px;margin:0 auto;border:1px solid color-mix(in srgb,#6B7280 30%,#FFFFFF);border-radius:14px;background:#FFFFFF;color:#1E3A5F;overflow:hidden}
.card[data-presentation="report-link"] header{background:#FFFFFF;color:#1E3A5F;padding:22px 22px 0}
.card[data-presentation="report-link"] h1{font-size:22px;line-height:1.25;margin:0;overflow-wrap:anywhere}
.card[data-presentation="report-link"] .job{color:#6B7280;margin:7px 0 0;overflow-wrap:anywhere}
.card[data-presentation="report-link"] .report-body{padding:16px 22px;color:#6B7280;font-size:14px;overflow-wrap:anywhere}
.card[data-presentation="report-link"] .report-body p{margin:0 0 10px}
.card[data-presentation="report-link"] .report-kpis{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px}
.card[data-presentation="report-link"] .report-kpi{flex:1 1 125px;min-width:0;padding:10px;border:1px solid color-mix(in srgb,#6B7280 30%,#FFFFFF);border-radius:10px}
.card[data-presentation="report-link"] .report-kpi span{display:block;font-size:12px}
.card[data-presentation="report-link"] .report-kpi strong{color:#1E3A5F;font-size:17px;overflow-wrap:anywhere}
.card[data-presentation="report-link"] .report-actions{border-top:1px solid color-mix(in srgb,#6B7280 30%,#FFFFFF);padding:4px 22px 8px;display:flex;flex-wrap:wrap;gap:4px 20px}
.card[data-presentation="report-link"] .report-actions a{display:inline-flex;align-items:center;min-height:44px;color:#1E5FED;text-decoration:none;font-weight:650;overflow-wrap:anywhere}
.card[data-presentation="report-link"] .report-actions a:focus-visible{outline:2px solid #1E5FED;outline-offset:3px;border-radius:3px}
.card[data-presentation="report-link"] .report-actions a:first-child::after{content:"↗";margin-left:7px}
@media(max-width:520px){.card[data-presentation="report-link"] header{padding:18px 16px 0}.card[data-presentation="report-link"] .report-body{padding:14px 16px}.card[data-presentation="report-link"] .report-actions{padding:4px 16px 8px}}
`;

export function reportLinkHtml(card: CardModel): string {
  const rows = card.sections?.find((s) => s.heading === "Open")?.rows ?? [];
  const details = card.sections?.find((s) => s.heading === "Link")?.rows ?? [];
  const actions = rows
    .map(rowPlain)
    .filter((row) => row.href)
    .map((row) => `<a href="${esc(row.href!)}">${esc(row.label)}</a>`)
    .join("");
  const text = details.map((row) => `<p>${esc(row.cells.join(" "))}</p>`).join("");
  const kpis = (card.kpis ?? [])
    .map(
      (k) =>
        `<div class="report-kpi"><span>${esc(k.label)}</span><strong>${esc(k.value)}</strong></div>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(card.title)}</title><style>body{margin:0;font:15px/1.45 system-ui,sans-serif}${reportLinkCss}</style></head><body><article class="card" data-presentation="report-link"><header><h1>${esc(card.title)}</h1>${card.job ? `<p class="job">${esc(card.job)}</p>` : ""}</header><div class="report-body">${kpis ? `<div class="report-kpis">${kpis}</div>` : ""}${text}</div>${actions ? `<div class="report-actions">${actions}</div>` : ""}</article></body></html>`;
}
