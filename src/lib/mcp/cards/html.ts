import { plainLabel, rowPlain } from "../plain-label";
import { ALERT, BLUE, GRAY, NAVY, WHITE, cssColor, isAlertLevel } from "./palette";
import { STATE_LABEL, cardHasAlert, type CardModel, type CardRow } from "./model";
import { responsiveCardCss } from "./responsive";
import { onboardingCss } from "./onboarding-style";
import { reportLinkHtml } from "./report-link-card";

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Money, percents and line numbers: kept on one line. */
const NUMERIC = /^[$\d][\d.,]*%?$/;

function cellText(value: string): string {
  if (!value.trim()) return "";
  const shown = plainLabel(value);
  return shown.refId && shown.label === "Item" ? "" : shown.label;
}

function linked(row: CardRow, text: string): string {
  const view = rowPlain(row);
  const label = text || view.label;
  const body = view.href ? `<a href="${esc(view.href)}">${esc(label)}</a>` : esc(label);
  const id = view.refId ? ` data-id="${esc(view.refId)}"` : "";
  const secondary = view.secondary ? `<span class="ref">${esc(view.secondary)}</span>` : "";
  return `<span${id}>${body}${secondary}</span>`;
}

function flagHead(flag: CardRow["flag"]): string {
  if (flag === "delay") return "Delay";
  if (flag === "overdue") return "Overdue";
  return flag === "risk" ? "Risk" : "Callout";
}

function flagged(row: CardRow, inner: string): string {
  if (!isAlertLevel(row.flag) && row.flag !== "callout") return inner;
  return `<div class="flag-head">${flagHead(row.flag)}</div><div class="flag-body">${inner}</div>`;
}

function rowClass(row: CardRow): string {
  const parts = [];
  if (isAlertLevel(row.flag)) parts.push(`class="alert" data-alert="${row.flag}"`);
  else if (row.flag === "callout") parts.push('class="callout"');
  else if (row.tone) parts.push(`class="tone-${row.tone}"`);
  return parts.join(" ");
}

/** Finished HTML document. Claude shows it as-is. Colors come only from the palette. */
export function renderHtml(card: CardModel): string {
  if (card.presentation === "report-link") return reportLinkHtml(card);
  const alert = cardHasAlert(card);
  const navy = cssColor(NAVY, "#1E3A5F");
  const blue = cssColor(BLUE, "#1E5FED");
  const gray = cssColor(GRAY, "#6B7280");
  const white = cssColor(WHITE, "#FFFFFF");
  const alertColor = cssColor(ALERT, "#DC2626");
  const css = [
    `body{margin:0;background:${white};color:${navy};font:15px/1.45 system-ui,sans-serif}`,
    `.card{box-sizing:border-box;overflow-wrap:anywhere;max-width:640px;margin:16px auto;border:1px solid ${gray};border-radius:14px;overflow:hidden;background:${white}}`,
    `header{background:${navy};color:${white};padding:16px 18px}`,
    `.mark{margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${white}}`,
    `h1{margin:0;font-size:22px}`,
    `.job{margin:6px 0 0;color:${white};opacity:.9}`,
    `.body{padding:16px 18px}`,
    `.eyebrow{display:inline-block;margin:0 0 10px;padding:3px 8px;border-radius:999px;background:${blue};color:${white};font-size:12px;font-weight:700}`,
    `.track{height:8px;border-radius:999px;background:${white};border:1px solid ${gray};overflow:hidden;margin:0 0 14px}`,
    `.fill{height:100%;background:${blue}}`,
    `.kpis{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}`,
    `.kpi{min-width:0;flex:1 1 14rem;border:1px solid ${gray};border-radius:10px;padding:8px 10px}`,
    `.kpi span{display:block;color:${gray};font-size:12px}`,
    `.kpi strong{font-size:16px}`,
    `h2{margin:16px 0 8px;font-size:14px;color:${navy}}`,
    `table{width:100%;border-collapse:collapse}`,
    `.table-scroll{overflow-x:auto}.table-scroll table{min-width:960px}`,
    `th{background:${blue};color:${white};text-align:left;padding:6px 8px;font-size:12px}`,
    `td{padding:6px 8px;border-bottom:1px solid ${gray};vertical-align:top}`,
    `.table-wrap{overflow-x:auto}.card td{overflow-wrap:anywhere}.card th{overflow-wrap:normal;white-space:nowrap}td.num{white-space:nowrap;text-align:right}`,
    `a{color:${blue};text-decoration:none}`,
    `.ref{display:block;margin-top:2px;font-size:11px;font-weight:400;color:${gray}}`,
    `.chip{display:inline-block;margin:0 6px 6px 0;padding:4px 8px;border-radius:999px;border:1px solid ${gray};color:${navy}}`,
    `.tone-known{border-color:${blue};color:${blue}}`,
    `.tone-unknown{color:${gray}}`,
    `.tone-action{background:${blue};color:${white};border-color:${blue}}`,
    `.chip.tone-action a{color:inherit}`,
    `.ask{margin:12px 0;padding:12px;border-left:4px solid ${blue};background:${white}}`,
    `.placeholder{margin:12px 0;padding:12px;border:1px solid ${gray};border-left:4px solid ${blue};border-radius:10px;background:${white}}`,
    `.placeholder h2{margin-top:0;color:${navy}}`,
    `.placeholder li,.placeholder p{color:${gray}}`,
    `.next{margin:14px 0 0;font-weight:700}`,
    card.sections?.some((section) => section.rows.some((row) => row.tone === "literal")) ? `.tone-literal{display:block;padding:8px 12px;border-left:3px solid ${gray};white-space:pre-wrap;overflow-wrap:anywhere}` : "",
    `.framed{margin:10px 0;border:1px solid ${gray};border-radius:12px;overflow:hidden}`,
    `.framed h2{margin:0;padding:8px 12px;border-bottom:1px solid ${gray}}`,
    `.framed ul{list-style:none;margin:0;padding:8px 12px}`,
    `.framed li{margin:0 0 6px}`,
    `.tone-quote{display:block;padding:8px 12px;border-left:3px solid ${gray};white-space:pre-wrap}`,
    alert ? `.alert,li.alert,p.alert,tr.alert{color:${alertColor}}` : "",
    alert ? `li.alert,p.alert{display:block;margin:8px 0;padding:0;border:2px solid ${alertColor};border-radius:12px;background:${white};overflow:hidden}` : "",
    alert ? `.flag-head{display:block;margin:0;padding:6px 10px;background:${alertColor};color:${white};font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}` : "",
    `.callout{color:${navy};border-left:4px solid ${blue}}`,
    `li.callout{display:block;margin:8px 0;background:${white}}`,
    `.callout .flag-head{background:${white};color:${navy};padding:6px 10px;font-size:12px;font-weight:700}`,
    `.flag-body{padding:10px 12px}`,

    alert ? `tr.alert td{border:2px solid ${alertColor}}` : "",
    alert ? `.framed.alert{border:2px solid ${alertColor};color:${navy}}` : "",
    alert ? `.framed.alert h2{background:${alertColor};color:${white};border-bottom:0}` : "",
    responsiveCardCss(alert),
    card.presentation === "onboarding" ? onboardingCss : "",
  ]
    .filter(Boolean)
    .join("");

  const progress =
    card.progress && card.progress.total > 0
      ? `<div class="track" aria-label="${card.progress.done} of ${card.progress.total}"><div class="fill" style="width:${Math.round((Math.max(0, Math.min(card.progress.done, card.progress.total)) / card.progress.total) * 100)}%"></div></div>`
      : "";
  const kpis = (card.kpis ?? [])
    .map((k) => {
      const attr = isAlertLevel(k.flag) ? ` class="kpi alert" data-alert="${k.flag}"` : ` class="kpi"`;
      return `<div${attr}><span>${esc(k.label)}</span><strong>${esc(k.value)}</strong></div>`;
    })
    .join("");
  const sections = (card.sections ?? [])
    .map((s) => {
      const heading = `<h2>${esc(s.heading)}</h2>`;
      let inner: string;
      if (!s.rows.length) inner = `${heading}<p class="tone-unknown">Nothing on this card yet.</p>`;
      else if (s.kind === "chips") {
        inner = `${heading}<p>${s.rows
          .map((r) => `<span class="chip${r.tone ? ` tone-${r.tone}` : ""}${isAlertLevel(r.flag) ? " alert" : r.flag === "callout" ? " callout" : ""}"${isAlertLevel(r.flag) ? ` data-alert="${r.flag}"` : ""}>${linked(r, rowPlain(r).label)}</span>`)
          .join("")}</p>`;
      } else if (s.kind === "table") {
        const width = Math.max(s.columns?.length ?? 0, ...s.rows.map((r) => r.cells.length), 1);
        const labels = Array.from({ length: width }, (_, i) => `<th>${esc(s.columns?.[i] ?? "")}</th>`).join("");
        const body = s.rows
          .map((r) => {
            const attr = rowClass(r);
            const cells = Array.from({ length: width }, (_, i) => {
              const text = cellText(r.cells[i] ?? "");
              const body = i === (r.linkCell ?? 0) ? linked(r, text) : esc(text);
              const cls = !text && i > 0 ? ' class="blank"' : NUMERIC.test(text) ? ' class="num"' : "";
              const label = s.columns?.[i] ? ` data-label="${esc(s.columns[i])}"` : "";
              return `<td${cls}${label}>${i === 0 ? flagged(r, body) : body}</td>`;
            }).join("");
            return `<tr ${attr}>${cells}</tr>`;
          })
          .join("");
        inner = `${heading}${s.scroll ? '<div class="table-scroll" tabindex="0" role="region" aria-label="Continuation table">' : '<div class="table-wrap" tabindex="0" role="region" aria-label="Report table">'}<table><thead><tr>${labels}</tr></thead><tbody>${body}</tbody></table></div>`;
      } else {
        const items = s.rows
          .map((r) => {
            const attr = rowClass(r);
            const row = r.tone === "literal" ? esc(r.cells.join("\n")) : r.raw ? esc(r.cells.filter(Boolean).join(" · ")) : linked(r, "");
            return `<li ${attr}>${flagged(r, row)}</li>`;
          })
          .join("");
        inner = `${heading}<ul>${items}</ul>`;
      }
      if (s.framed) {
        const flag = isAlertLevel(s.flag) ? ` alert" data-alert="${s.flag}` : "";
        return `<section class="framed${flag}">${inner}</section>`;
      }
      return s.placeholder ? `<section class="placeholder">${inner}</section>` : inner;
    })
    .join("");
  const alerts = (card.alerts ?? [])
    .filter((a) => isAlertLevel(a.level))
    .map((a) => `<p class="alert" data-alert="${a.level}"><div class="flag-head">${flagHead(a.level)}</div><div class="flag-body">${esc(a.level)}: ${esc(a.text)}</div></p>`)
    .join("");
  const ask = card.ask?.prompt ? `<div class="ask"><strong>This question</strong><p>${esc(card.ask.prompt)}</p></div>` : "";
  const next = card.next_move ? `<p class="next">Next move: ${esc(card.next_move)}</p>` : "";
  const eyebrow = card.show_state === false ? "" : `<p class="eyebrow">${esc(STATE_LABEL[card.state])}</p>`;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(card.title)}</title><style>${css}</style></head><body><article class="card"${card.presentation === "onboarding" ? ' data-presentation="onboarding"' : ""} data-state="${card.state}"><header><p class="mark">Athena</p><h1>${esc(card.title)}</h1>${card.job ? `<p class="job">${esc(card.job)}</p>` : ""}</header><div class="body">${eyebrow}${progress}${kpis ? `<div class="kpis">${kpis}</div>` : ""}${ask}${sections}${alerts}${next}</div></article></body></html>`;
}
