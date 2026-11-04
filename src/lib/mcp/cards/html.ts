import { plainLabel, rowPlain } from "../plain-label";
import { isAlertLevel } from "./palette";
import { cardBaseCss, cellClass } from "./card-style";
import { STATE_LABEL, cardHasAlert, type CardModel, type CardRow } from "./model";
import { responsiveCardCss } from "./responsive";
import { onboardingCss } from "./onboarding-style";
import { sovCss } from "./sov-style";
import { reportLinkHtml } from "./report-link-card";

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

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

/** Finished HTML document. Claude shows it as-is. Styling comes only from card-style.ts. */
export function renderHtml(card: CardModel): string {
  if (card.presentation === "report-link") return reportLinkHtml(card);
  const alert = cardHasAlert(card);
  const css = [
    cardBaseCss(alert),
    responsiveCardCss(alert),
    card.presentation === "onboarding" ? onboardingCss : "",
    card.presentation === "sov" ? sovCss : "",
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
              const kind = cellClass(text);
              const cls = !text && i > 0 ? ' class="blank"' : kind ? ` class="${kind}"` : "";
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
    .map((a) => `<div class="alert" data-alert="${a.level}"><div class="flag-head">${flagHead(a.level)}</div><div class="flag-body">${esc(a.text)}</div></div>`)
    .join("");
  const ask = card.ask?.prompt ? `<div class="ask"><strong>This question</strong><p>${esc(card.ask.prompt)}</p></div>` : "";
  const next = card.next_move ? `<p class="next">Next move: ${esc(card.next_move)}</p>` : "";
  const eyebrow = card.show_state === false ? "" : `<p class="eyebrow">${esc(STATE_LABEL[card.state])}</p>`;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(card.title)}</title><style>${css}</style></head><body><article class="card"${card.presentation === "onboarding" || card.presentation === "sov" ? ` data-presentation="${card.presentation}"` : ""} data-state="${card.state}"><header><p class="mark">Athena</p><h1>${esc(card.title)}</h1>${card.job ? `<p class="job">${esc(card.job)}</p>` : ""}</header><div class="body">${eyebrow}${progress}${kpis ? `<div class="kpis">${kpis}</div>` : ""}${ask}${sections}${alerts}${next}</div></article></body></html>`;
}
