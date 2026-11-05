import { CARD } from "./palette";

/**
 * The one stylesheet for Athena's chat cards: the Claude native card (server HTML) and the
 * ChatGPT widget (painted in the browser) both use it, so the two hosts look the same.
 *
 * The look follows the accounting workspace pages and the host's own clean answers: a white
 * surface, hairline borders, ink text, a plain title (no colored band), a quiet stat block and
 * tables whose header is bold text over a rule, not a filled bar.
 *
 * Words wrap only between words (overflow-wrap:break-word). `anywhere` let the browser shrink a
 * column to one letter, which split "Sent" into "Sen / t" in narrow cards.
 */
export function cardBaseCss(hasAlert: boolean): string {
  const c = CARD;
  return [
    `body{margin:0;background:${c.white};color:${c.ink};font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}`,
    `.card{box-sizing:border-box;max-width:760px;margin:12px auto;border:1px solid ${c.line};border-radius:14px;overflow:hidden;background:${c.white};color:${c.ink};overflow-wrap:break-word;word-break:normal}`,
    `.card *{box-sizing:border-box}`,
    `.card header{background:${c.white};color:${c.ink};padding:18px 20px 14px;border-bottom:1px solid ${c.rule}}`,
    `.card .mark{margin:0 0 6px;font-size:11px;font-weight:650;letter-spacing:.12em;text-transform:uppercase;color:${c.muted}}`,
    `.card h1{margin:0;font-size:21px;line-height:1.25;font-weight:700;letter-spacing:-.015em;color:${c.ink}}`,
    `.card .job{margin:6px 0 0;font-size:13px;color:${c.muted}}`,
    `.card .body{padding:16px 20px 18px;min-width:0}`,
    `.card .eyebrow{display:inline-block;margin:0 0 12px;font-size:11px;font-weight:650;letter-spacing:.08em;text-transform:uppercase;color:${c.muted}}`,
    `.card .track{height:6px;border-radius:999px;background:${c.rule};overflow:hidden;margin:0 0 16px}`,
    `.card .fill{height:100%;background:${c.strong}}`,
    `.card .kpis{display:flex;flex-wrap:wrap;gap:12px 18px;margin:0 0 18px;padding:14px 16px;border:1px solid ${c.line};border-radius:12px;background:${c.white}}`,
    `.card .kpi{flex:1 1 8rem;min-width:0}`,
    `.card .kpi span{display:block;color:${c.muted};font-size:12px;line-height:1.4}`,
    `.card .kpi strong{display:block;margin-top:2px;font-size:20px;line-height:1.3;font-weight:650;color:${c.strong};font-variant-numeric:tabular-nums}`,
    `.card h2{margin:20px 0 8px;font-size:15px;font-weight:650;color:${c.ink}}`,
    `.card .body>h2:first-child,.card .body>.eyebrow+h2{margin-top:4px}`,
    `.card ul{margin:0;padding:0 0 0 18px}`,
    `.card li{margin:0 0 6px}`,
    `.card .table-wrap,.card .table-scroll{overflow-x:auto;margin:0 0 4px}`,
    `.card table{width:100%;border-collapse:collapse;font-size:13px;line-height:1.45}`,
    `.card .table-scroll table{min-width:960px}`,
    `.card th{background:${c.white};color:${c.ink};text-align:left;font-size:12px;font-weight:650;padding:8px;border-bottom:1px solid ${c.line};white-space:nowrap;vertical-align:bottom}`,
    `.card td{padding:9px 8px;border-bottom:1px solid ${c.rule};vertical-align:top;color:${c.ink};overflow-wrap:break-word;word-break:normal;hyphens:manual}`,
    `.card tbody tr:last-child td{border-bottom:0}`,
    `.card td.num{white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}`,
    `.card td.short{white-space:nowrap}`,
    `.card td.long{min-width:10rem}`,
    // The first column names the record ("RFI-001 · Revision 0 · T-1"); give it room so it doesn't stack word by word.
    `.card td:first-child{min-width:7rem}`,
    `.card a{color:${c.strong};font-weight:600;text-decoration:underline;text-decoration-color:${c.underline};text-decoration-thickness:1px;text-underline-offset:3px}`,
    `.card a:hover{text-decoration-color:${c.strong}}`,
    `.card .ref{display:block;margin-top:2px;font-size:11px;font-weight:400;color:${c.muted}}`,
    `.card .chip{display:inline-block;margin:0 6px 6px 0;padding:4px 10px;border-radius:999px;border:1px solid ${c.line};background:${c.white};color:${c.ink};font-size:13px}`,
    `.card .tone-known{border-color:${c.strong};color:${c.strong}}`,
    `.card .tone-unknown{color:${c.muted}}`,
    `.card .chip.tone-action{border-radius:7px;padding:7px 14px;background:${c.action};color:${c.white};border-color:${c.action};font-weight:600}`,
    `.card .chip.tone-action a{color:inherit;text-decoration:none;font-weight:inherit}`,
    `.card .chip.tone-action a:hover{text-decoration:underline;text-decoration-color:${c.white}}`,
    `.card .ask{margin:14px 0;padding:12px 14px;border:1px solid ${c.line};border-radius:10px;background:${c.soft}}`,
    `.card .ask strong{display:block;font-size:12px;color:${c.muted};font-weight:650}`,
    `.card .ask p{margin:4px 0 0}`,
    `.card .placeholder{margin:12px 0;padding:12px 14px;border:1px dashed ${c.line};border-radius:10px;background:${c.soft}}`,
    `.card .placeholder h2{margin-top:0;color:${c.ink}}`,
    `.card .placeholder li,.card .placeholder p{color:${c.muted}}`,
    `.card .next{margin:16px 0 0;padding-top:12px;border-top:1px solid ${c.rule};font-weight:600;color:${c.ink}}`,
    `.card .tone-literal,.card .tone-quote{display:block;padding:8px 12px;border-left:3px solid ${c.line};white-space:pre-wrap;color:${c.body}}`,
    `.card .framed{margin:12px 0;border:1px solid ${c.line};border-radius:12px;overflow:hidden}`,
    `.card .framed h2{margin:0;padding:10px 14px;border-bottom:1px solid ${c.rule}}`,
    `.card .framed ul{list-style:none;margin:0;padding:10px 14px}`,
    `.card .framed li{margin:0 0 6px}`,
    `.card .callout{color:${c.ink};border-left:3px solid ${c.strong}}`,
    `.card li.callout{display:block;margin:8px 0;padding:0;background:${c.soft};border-radius:0 10px 10px 0}`,
    `.card .flag-head{display:block;margin:0;padding:8px 12px 0;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${c.muted}}`,
    `.card .flag-body{padding:4px 12px 10px}`,
    `.card td .flag-head{padding:0 0 2px}`,
    `.card td .flag-body{padding:0}`,
    hasAlert ? `.card .alert{color:${c.alertInk}}` : "",
    hasAlert
      ? `.card li.alert,.card p.alert,.card .body>div.alert{display:block;margin:8px 0;padding:0;border:1px solid ${c.alertLine};border-radius:10px;background:${c.alertSoft};overflow:hidden}`
      : "",
    hasAlert ? `.card .alert .flag-head{color:${c.alertInk}}` : "",
    hasAlert ? `.card .alert .flag-body{color:${c.ink}}` : "",
    hasAlert ? `.card tr.alert td{background:${c.alertSoft};color:${c.ink}}` : "",
    hasAlert ? `.card tr.alert td:first-child{box-shadow:inset 3px 0 0 ${c.alertInk}}` : "",
    hasAlert ? `.card .kpi.alert strong{color:${c.alertInk}}` : "",
    hasAlert
      ? `.card .chip.alert{border-color:${c.alertLine};background:${c.alertSoft};color:${c.alertInk}}`
      : "",
    hasAlert ? `.card .framed.alert{border-color:${c.alertLine};color:${c.ink}}` : "",
    hasAlert
      ? `.card .framed.alert h2{background:${c.alertSoft};color:${c.alertInk};border-bottom-color:${c.alertLine}}`
      : "",
  ]
    .filter(Boolean)
    .join("");
}

/** Short single-token values (states, dates, yes/no, amounts) stay on one line in a table. */
export const SHORT_CELL_MAX = 14;
/** Long prose cells (titles, sources) get room so they don't become one-word columns. */
export const LONG_CELL_MIN = 60;

/** Table cell class: `num` for money and counts, `short` for brief values, `long` for prose. */
export function cellClass(text: string): string {
  const value = text.trim();
  if (/^-?[$\d][\d.,]*%?$/.test(value)) return "num";
  if (value.length > 0 && value.length <= SHORT_CELL_MAX && !/\s/.test(value)) return "short";
  if (value.length >= LONG_CELL_MIN) return "long";
  return "";
}
