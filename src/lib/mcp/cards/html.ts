import { plainLabel, rowPlain } from "../plain-label";
import { ALERT, BLUE, GRAY, NAVY, WHITE } from "./palette";
import { STATE_LABEL, cardHasAlert, type CardModel, type CardRow } from "./model";

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function cellText(value: string): string {
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

function rowClass(row: CardRow): string {
  const parts = [];
  if (row.flag) parts.push(`class="alert" data-alert="${row.flag}"`);
  else if (row.tone) parts.push(`class="tone-${row.tone}"`);
  return parts.join(" ");
}

/** Finished HTML document. Claude shows it as-is. Colors come only from the palette. */
export function renderHtml(card: CardModel): string {
  const alert = cardHasAlert(card);
  const css = [
    `body{margin:0;background:${WHITE};color:${NAVY};font:15px/1.45 system-ui,sans-serif}`,
    `.card{max-width:640px;margin:16px auto;border:1px solid ${GRAY};border-radius:14px;overflow:hidden;background:${WHITE}}`,
    `header{background:${NAVY};color:${WHITE};padding:16px 18px}`,
    `.mark{margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${WHITE}}`,
    `h1{margin:0;font-size:22px}`,
    `.job{margin:6px 0 0;color:${WHITE};opacity:.9}`,
    `.body{padding:16px 18px}`,
    `.eyebrow{display:inline-block;margin:0 0 10px;padding:3px 8px;border-radius:999px;background:${BLUE};color:${WHITE};font-size:12px;font-weight:700}`,
    `.track{height:8px;border-radius:999px;background:${WHITE};border:1px solid ${GRAY};overflow:hidden;margin:0 0 14px}`,
    `.fill{height:100%;background:${BLUE}}`,
    `.kpis{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}`,
    `.kpi{flex:1 1 120px;border:1px solid ${GRAY};border-radius:10px;padding:8px 10px}`,
    `.kpi span{display:block;color:${GRAY};font-size:12px}`,
    `.kpi strong{font-size:16px}`,
    `h2{margin:16px 0 8px;font-size:14px;color:${NAVY}}`,
    `table{width:100%;border-collapse:collapse}`,
    `th{background:${BLUE};color:${WHITE};text-align:left;padding:6px 8px;font-size:12px}`,
    `td{padding:6px 8px;border-bottom:1px solid ${GRAY};vertical-align:top}`,
    `a{color:${BLUE};text-decoration:none}`,
    `.ref{display:block;margin-top:2px;font-size:11px;font-weight:400;color:${GRAY}}`,
    `.chip{display:inline-block;margin:0 6px 6px 0;padding:4px 8px;border-radius:999px;border:1px solid ${GRAY};color:${NAVY}}`,
    `.tone-known{border-color:${BLUE};color:${BLUE}}`,
    `.tone-unknown{color:${GRAY}}`,
    `.tone-action{background:${BLUE};color:${WHITE};border-color:${BLUE}}`,
    `.ask{margin:12px 0;padding:12px;border-left:4px solid ${BLUE};background:${WHITE}}`,
    `.next{margin:14px 0 0;font-weight:700}`,
    alert ? `.alert,li.alert,p.alert,tr.alert{color:${ALERT};border:1px solid ${ALERT};border-radius:10px}` : "",
    alert ? `li.alert{display:block;margin:8px 0;padding:10px 12px}` : "",
  ]
    .filter(Boolean)
    .join("");

  const progress =
    card.progress && card.progress.total > 0
      ? `<div class="track" aria-label="${card.progress.done} of ${card.progress.total}"><div class="fill" style="width:${Math.round((Math.max(0, Math.min(card.progress.done, card.progress.total)) / card.progress.total) * 100)}%"></div></div>`
      : "";
  const kpis = (card.kpis ?? [])
    .map((k) => {
      const attr = k.flag ? ` class="kpi alert" data-alert="${k.flag}"` : ` class="kpi"`;
      return `<div${attr}><span>${esc(k.label)}</span><strong>${esc(k.value)}</strong></div>`;
    })
    .join("");
  const sections = (card.sections ?? [])
    .map((s) => {
      const heading = `<h2>${esc(s.heading)}</h2>`;
      if (!s.rows.length) return `${heading}<p class="tone-unknown">Nothing on this card yet.</p>`;
      if (s.kind === "chips") {
        return `${heading}<p>${s.rows
          .map((r) => `<span class="chip${r.tone ? ` tone-${r.tone}` : ""}${r.flag ? " alert" : ""}"${r.flag ? ` data-alert="${r.flag}"` : ""}>${linked(r, rowPlain(r).label)}</span>`)
          .join("")}</p>`;
      }
      if (s.kind === "table") {
        const width = Math.max(s.columns?.length ?? 0, ...s.rows.map((r) => r.cells.length), 1);
        const labels = Array.from({ length: width }, (_, i) => `<th>${esc(s.columns?.[i] ?? "")}</th>`).join("");
        const body = s.rows
          .map((r) => {
            const attr = rowClass(r);
            const cells = Array.from({ length: width }, (_, i) => {
              const text = cellText(r.cells[i] ?? "");
              return `<td>${i === 0 ? linked(r, text) : esc(text)}</td>`;
            }).join("");
            return `<tr ${attr}>${cells}</tr>`;
          })
          .join("");
        return `${heading}<table><thead><tr>${labels}</tr></thead><tbody>${body}</tbody></table>`;
      }
      const items = s.rows
        .map((r) => {
          const attr = rowClass(r);
          if (r.raw) return `<li ${attr}>${esc(r.cells.filter(Boolean).join(" · "))}</li>`;
          return `<li ${attr}>${linked(r, "")}</li>`;
        })
        .join("");
      return `${heading}<ul>${items}</ul>`;
    })
    .join("");
  const alerts = (card.alerts ?? [])
    .map((a) => `<p class="alert" data-alert="${a.level}">${esc(a.level)}: ${esc(a.text)}</p>`)
    .join("");
  const ask = card.ask?.prompt ? `<div class="ask"><strong>This question</strong><p>${esc(card.ask.prompt)}</p></div>` : "";
  const next = card.next_move ? `<p class="next">Next move: ${esc(card.next_move)}</p>` : "";

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(card.title)}</title><style>${css}</style></head><body><article class="card" data-state="${card.state}"><header><p class="mark">Athena</p><h1>${esc(card.title)}</h1>${card.job ? `<p class="job">${esc(card.job)}</p>` : ""}</header><div class="body"><p class="eyebrow">${esc(STATE_LABEL[card.state])}</p>${progress}${kpis ? `<div class="kpis">${kpis}</div>` : ""}${ask}${sections}${alerts}${next}</div></article></body></html>`;
}
