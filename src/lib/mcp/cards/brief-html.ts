// HTML for the PM morning brief (Nov 5 redesign). Server-built, fixed palette, no inline styles
// (the Claude card strips style attributes), no url() and no scripts. Buttons carry a prompt in
// data-prompt; the card script sends it to the chat. Toggles carry data-set="key=value" and set
// that attribute on the closest [data-toggle-root], so the lookahead switches weeks and crews.
import { addDays, diffDays } from "../deadlines";
import { CARD } from "./palette";
import type { BriefBlock, BriefButton, BriefDoc, BriefRow, BriefSectionDoc, BriefTone, GanttAct } from "../morning-brief-pm";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (d: string) => `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`;
const pct = (n: number) => `${Math.max(0, Math.min(100, Math.round(n * 100) / 100))}%`;

function badAttr(tone: BriefTone | undefined): string {
  return tone === "bad" ? ' data-alert="risk"' : "";
}

function button(b: BriefButton, extra = ""): string {
  const kind = b.kind ?? "secondary";
  return `<button type="button" class="mb-btn mb-${kind}${extra}" data-prompt="${esc(b.prompt.slice(0, 500))}">${esc(b.label)}</button>`;
}

function actions(buttons: BriefButton[]): string {
  if (!buttons.length) return "";
  return `<div class="mb-actions">${buttons.map((b) => button(b)).join("")}</div>`;
}

function rowHtml(r: BriefRow): string {
  const title = r.href ? `<a href="${esc(r.href)}">${esc(r.title)}</a>` : esc(r.title);
  const detail = r.detail ? `<span class="mb-sub">${esc(r.detail)}</span>` : "";
  const right = [
    r.choices?.length ? `<div class="mb-choices" role="group">${r.choices.map((b) => button(b, " mb-choice")).join("")}</div>` : "",
    r.checks?.length ? `<div class="mb-checks" role="group">${r.checks.map((b) => button(b, " mb-check")).join("")}</div>` : "",
    r.buttons?.length ? `<div class="mb-row-actions">${r.buttons.map((b) => button(b)).join("")}</div>` : "",
  ].join("");
  return `<li class="mb-row${r.tone === "bad" ? " mb-bad" : r.tone === "note" ? " mb-note" : ""}"${badAttr(r.tone)}><div class="mb-main"><span class="mb-dot" aria-hidden="true"></span><div><strong>${title}</strong>${detail}</div></div>${right ? `<div class="mb-right">${right}</div>` : ""}</li>`;
}

/** Bar positions for every 1 to 4 week window, as classes. Inline styles would be stripped. */
function ganttCss(acts: GanttAct[], start: string): string {
  const rules: string[] = [];
  for (let w = 1; w <= 4; w += 1) {
    const days = w * 7;
    const end = addDays(start, days - 1);
    const scope = `.mb-g[data-weeks="${w}"]`;
    acts.forEach((a, i) => {
      if (a.start > end) {
        rules.push(`${scope} .gr-${i}{display:none}`);
        return;
      }
      const s = Math.max(0, diffDays(a.start, start));
      const f = Math.min(days - 1, diffDays(a.finish < start ? start : a.finish, start));
      rules.push(`${scope} .ga-${i}{left:${pct((s / days) * 100)};width:${pct((Math.max(1, f - s + 1) / days) * 100)}}`);
    });
    for (let d = 0; d < 28; d += 1) if (d >= days) rules.push(`${scope} .gd-${d}{display:none}`);
    rules.push(`${scope} .gw{grid-template-columns:repeat(${days},minmax(0,1fr))}`);
    rules.push(`${scope} .gt-${w}{display:inline}`);
  }
  return rules.join("");
}

function gantt(block: Extract<BriefBlock, { type: "gantt" }>): string {
  const days = Array.from({ length: 28 }, (_, d) => addDays(block.start, d));
  const head = days
    .map((d, i) => {
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      const label = i % 7 === 0 ? md(d) : "MTWTFSS"[(dow + 6) % 7];
      return `<span class="gd gd-${i}${dow === 0 ? " gsun" : ""}${i % 7 === 0 ? " gwk" : ""}">${esc(label)}</span>`;
    })
    .join("");
  const rows = block.acts
    .map(
      (a, i) =>
        `<div class="gr gr-${i} gp-${a.party ?? "self"}${a.critical ? " gcrit" : ""}"><div class="gl"><strong>${esc(a.name)}</strong><span>${esc(a.meta)}</span></div><div class="gbar-track"><span class="gbar ga-${i}"${a.critical ? ' data-alert="delay"' : ""}>${esc(a.tag)}</span></div></div>`,
    )
    .join("");
  const toggle = (key: string, value: string, label: string, on: boolean) =>
    `<button type="button" class="mb-tog" data-set="${key}=${value}" aria-pressed="${on}">${label}</button>`;
  return `<div class="mb-g" data-toggle-root data-weeks="2" data-party="all">
<div class="mb-gtools"><div class="mb-seg" role="group" aria-label="Lookahead window">${[1, 2, 3, 4].map((w) => toggle("weeks", String(w), `${w} wk`, w === 2)).join("")}</div><div class="mb-seg" role="group" aria-label="Crews">${toggle("party", "all", "Everyone", true)}${toggle("party", "sub", "Subs", false)}${toggle("party", "self", "Self-perform", false)}</div></div>
<p class="mb-gcap">${[1, 2, 3, 4].map((w) => `<span class="gt gt-${w}">${w}-week lookahead, ${md(block.start)} to ${md(addDays(block.start, w * 7 - 1))}</span>`).join("")}</p>
<div class="mb-gscroll"><div class="mb-gin"><div class="gr ghead"><div class="gl"><strong>Activity</strong></div><div class="gw">${head}</div></div>${rows}<p class="gend">End of lookahead period</p></div></div>
<p class="mb-legend"><span class="lg lg-crit"></span>Critical path<span class="lg lg-norm"></span>Has float</p></div>`;
}

function block(b: BriefBlock): string {
  switch (b.type) {
    case "rows":
      return `<ul class="mb-rows">${b.rows.map(rowHtml).join("")}</ul>`;
    case "table": {
      const right = new Set(b.right ?? []);
      const th = b.columns.map((c, i) => `<th${right.has(i) ? ' class="num"' : ""}>${esc(c)}</th>`).join("");
      const tr = b.rows
        .map((r) => {
          const cells = r.cells
            .map((c, i) => {
              const pill = r.pill && r.pill.col === i ? `<span class="mb-pill${r.pill.tone === "bad" ? " mb-pill-bad" : ""}"${badAttr(r.pill.tone)}>${esc(r.pill.text)}</span>` : "";
              const text = r.pill && r.pill.col === i && r.pill.text === c ? "" : esc(c);
              return `<td${right.has(i) ? ' class="num"' : ""}>${text}${pill ? `${text ? " " : ""}${pill}` : ""}</td>`;
            })
            .join("");
          return `<tr${r.tone === "bad" ? ' class="mb-bad" data-alert="risk"' : ""}>${cells}</tr>`;
        })
        .join("");
      return `<div class="mb-table"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
    }
    case "kpis":
      return `<div class="mb-kpis">${b.items.map((k) => `<div class="mb-kpi${k.unknown ? " mb-unknown" : ""}"><span>${esc(k.label)}</span><strong>${esc(k.value)}</strong>${k.note ? `<em>${esc(k.note)}</em>` : ""}</div>`).join("")}</div>`;
    case "bars":
      return `<div class="mb-bars">${b.items
        .map((x) => `<div class="mb-barrow"><span>${esc(x.label)}</span><div class="mb-bar"><span class="mb-fill mb-f${Math.max(0, Math.min(100, Math.round(x.pct)))}"></span></div><strong>${Math.round(x.pct)}%</strong></div>`)
        .join("")}</div>`;
    case "gantt":
      return gantt(b);
    case "callouts":
      return `<div class="mb-callouts">${b.items
        .map((c) => `<div class="mb-callout${c.tone === "bad" ? " mb-bad" : ""}"${badAttr(c.tone)}><strong>${esc(c.title)}</strong><p>${esc(c.text)}</p>${actions(c.buttons)}</div>`)
        .join("")}</div>`;
    case "inbox":
      return `<div class="mb-inbox"><h3>${esc(b.heading)}</h3><p>${esc(b.placeholder)}</p></div>`;
    case "text":
      return `<p class="mb-text${b.strong ? " mb-ask" : ""}">${esc(b.text)}</p>`;
    case "actions":
      return actions(b.buttons);
    case "jobs":
      return `<ul class="mb-jobs">${b.rows
        .map(
          (r) =>
            `<li${r.tone === "bad" ? ' class="mb-bad" data-alert="overdue"' : ""}><div><strong>${r.href ? `<a href="${esc(r.href)}">${esc(r.title)}</a>` : esc(r.title)}</strong>${r.sub ? `<span class="mb-sub">${esc(r.sub)}</span>` : ""}</div><span class="mb-pill${r.tone === "bad" ? " mb-pill-bad" : ""}">${esc(r.pill)}</span>${button({ label: "Brief", prompt: r.prompt, kind: "quiet" })}</li>`,
        )
        .join("")}</ul>`;
    case "tell":
      return `<div class="mb-tell"><p>${esc(b.text)}</p><div class="mb-chips">${b.chips.map((c) => button({ ...c, kind: "quiet" }, " mb-chip")).join("")}</div><p class="mb-or">Or just tell me in the chat.</p></div>`;
  }
}

function section(s: BriefSectionDoc): string {
  const isTell = s.blocks.length === 1 && s.blocks[0].type === "tell";
  const num = s.step ? `<span class="mb-step">${s.step}</span>` : "";
  return `<section class="mb-sec${isTell ? " mb-sec-tell" : ""}"><div class="mb-sechead">${num}<h2>${esc(s.heading)}</h2>${s.meta ? `<span class="mb-meta">${esc(s.meta)}</span>` : ""}</div>${s.blocks.map(block).join("")}</section>`;
}

function fillCss(): string {
  const rules: string[] = [];
  for (let i = 0; i <= 100; i += 1) rules.push(`.mb-f${i}{width:${i}%}`);
  return rules.join("");
}

export function briefCss(doc: BriefDoc): string {
  const c = CARD;
  const gantts = doc.sections.flatMap((s) => s.blocks).filter((b): b is Extract<BriefBlock, { type: "gantt" }> => b.type === "gantt");
  return [
    `body{margin:0;background:${c.white};color:${c.ink};font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}`,
    `.mb{box-sizing:border-box;max-width:820px;margin:12px auto;border:1px solid ${c.line};border-radius:14px;overflow:hidden;background:${c.white};color:${c.ink};overflow-wrap:break-word}`,
    `.mb *{box-sizing:border-box}`,
    `.mb a{color:${c.strong};text-decoration:underline;text-decoration-color:${c.underline};text-underline-offset:3px}`,
    `.mb header{padding:20px 22px 16px;border-bottom:1px solid ${c.rule}}`,
    `.mb .mb-mark{margin:0 0 6px;font-size:11px;font-weight:650;letter-spacing:.12em;text-transform:uppercase;color:${c.muted}}`,
    `.mb h1{margin:0;font-size:23px;line-height:1.25;font-weight:700;letter-spacing:-.015em;color:${c.ink}}`,
    `.mb .mb-when{margin:6px 0 0;font-size:14px;color:${c.body}}`,
    `.mb .mb-badge{display:inline-block;margin-top:10px;padding:3px 10px;border:1px solid ${c.line};border-radius:999px;font-size:12px;color:${c.muted};background:${c.soft}}`,
    `.mb .mb-finish{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;margin:16px 0 0;border:1px solid ${c.line};border-radius:12px;overflow:hidden}`,
    `.mb .mb-finish div{padding:10px 14px;border-right:1px solid ${c.rule}}.mb .mb-finish div:last-child{border-right:0}`,
    `.mb .mb-finish span{display:block;font-size:12px;color:${c.muted}}.mb .mb-finish strong{display:block;font-size:18px;font-weight:650;color:${c.strong};font-variant-numeric:tabular-nums}`,
    `.mb .mb-finish .mb-bad strong{color:${c.alertInk}}.mb .mb-finish .mb-bad{background:${c.alertSoft}}`,
    `.mb .mb-body{padding:6px 22px 20px}`,
    `.mb .mb-moves{margin:16px 0 4px;padding:14px 16px;border:1px solid ${c.line};border-radius:12px;background:${c.soft}}`,
    `.mb .mb-moves h2{margin:0 0 8px;font-size:15px;font-weight:650}.mb .mb-moves ol{margin:0;padding-left:20px}.mb .mb-moves li{margin:0 0 4px;color:${c.body}}.mb .mb-moves li strong{color:${c.ink}}`,
    `.mb .mb-sec{padding:18px 0 6px;border-top:1px solid ${c.rule}}.mb .mb-moves+.mb-sec,.mb .mb-body>.mb-sec:first-child{border-top:0}`,
    `.mb .mb-sechead{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px;margin:0 0 10px}`,
    `.mb .mb-step{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:999px;background:${c.ink};color:${c.white};font-size:12px;font-weight:700;flex:none;align-self:center}`,
    `.mb h2{margin:0;font-size:16px;font-weight:650;color:${c.ink}}.mb .mb-meta{font-size:12.5px;color:${c.muted}}`,
    `.mb h3{margin:0 0 4px;font-size:14px;font-weight:650;color:${c.ink}}`,
    `.mb .mb-text{margin:0 0 10px;color:${c.body};font-size:14px}.mb .mb-ask{color:${c.ink};font-weight:650;margin-top:12px}`,
    `.mb .mb-rows,.mb .mb-jobs{list-style:none;margin:0 0 10px;padding:0;border:1px solid ${c.line};border-radius:12px;overflow:hidden}`,
    `.mb .mb-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 14px;padding:11px 14px;border-top:1px solid ${c.rule}}.mb .mb-row:first-child{border-top:0}`,
    `.mb .mb-main{display:flex;gap:10px;min-width:0;flex:1 1 16rem}.mb .mb-main strong{display:block;font-size:14px;font-weight:650;color:${c.ink}}`,
    `.mb .mb-sub{display:block;font-size:12.5px;color:${c.muted};margin-top:1px}`,
    `.mb .mb-dot{flex:none;width:8px;height:8px;margin-top:7px;border-radius:999px;background:${c.underline}}`,
    `.mb .mb-bad .mb-dot{background:${c.alertInk}}.mb .mb-row.mb-bad{background:${c.alertSoft}}`,
    `.mb .mb-right{display:flex;flex-wrap:wrap;gap:6px;align-items:center}`,
    `.mb .mb-choices,.mb .mb-checks,.mb .mb-row-actions,.mb .mb-chips{display:flex;flex-wrap:wrap;gap:6px}`,
    `.mb .mb-btn{appearance:none;font:inherit;font-size:13px;font-weight:600;line-height:1.2;padding:8px 13px;border-radius:9px;border:1px solid ${c.ink};cursor:pointer;transition:background .15s,color .15s,border-color .15s,box-shadow .15s}`,
    `.mb .mb-primary{background:${c.ink};color:${c.white}}.mb .mb-primary:hover{background:${c.strong};box-shadow:0 1px 0 ${c.line}}`,
    `.mb .mb-secondary{background:${c.white};color:${c.ink}}.mb .mb-secondary:hover{background:${c.head}}`,
    `.mb .mb-quiet{background:${c.white};color:${c.body};border-color:${c.line}}.mb .mb-quiet:hover{border-color:${c.underline};color:${c.ink};background:${c.soft}}`,
    `.mb .mb-choice,.mb .mb-check{padding:6px 10px;font-size:12.5px;border-radius:999px;border-color:${c.line};color:${c.ink};background:${c.white}}`,
    `.mb .mb-choice:hover,.mb .mb-check:hover{border-color:${c.ink};background:${c.head}}`,
    `.mb .mb-btn[data-sent="true"]{background:${c.ink};color:${c.white};border-color:${c.ink};cursor:default}`,
    `.mb .mb-btn:focus-visible,.mb .mb-tog:focus-visible{outline:2px solid ${c.strong};outline-offset:2px}`,
    `.mb .mb-actions{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 8px}`,
    `.mb .mb-table{overflow-x:auto;margin:0 0 10px;border:1px solid ${c.line};border-radius:12px}`,
    `.mb table{width:100%;border-collapse:collapse;font-size:13px;line-height:1.45}.mb th{text-align:left;font-size:12px;font-weight:650;padding:9px 12px;border-bottom:1px solid ${c.line};white-space:nowrap;color:${c.ink};background:${c.white}}`,
    `.mb td{padding:9px 12px;border-bottom:1px solid ${c.rule};vertical-align:top;color:${c.ink}}.mb tr:last-child td{border-bottom:0}.mb .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}`,
    `.mb tr.mb-bad td{background:${c.alertSoft}}`,
    `.mb .mb-pill{display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid ${c.line};background:${c.soft};color:${c.body};font-size:11.5px;font-weight:600;white-space:nowrap}`,
    `.mb .mb-pill-bad{border-color:${c.alertLine};background:${c.alertSoft};color:${c.alertInk}}`,
    `.mb .mb-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;margin:0 0 12px;border:1px solid ${c.line};border-radius:12px;overflow:hidden}`,
    `.mb .mb-kpi{padding:12px 14px;border-right:1px solid ${c.rule};min-width:0}.mb .mb-kpi:last-child{border-right:0}`,
    `.mb .mb-kpi span{display:block;font-size:12px;color:${c.muted}}.mb .mb-kpi strong{display:block;font-size:19px;font-weight:650;color:${c.strong};font-variant-numeric:tabular-nums;margin-top:2px}`,
    `.mb .mb-kpi em{display:block;font-style:normal;font-size:11.5px;color:${c.muted};margin-top:2px}.mb .mb-unknown strong{color:${c.muted};font-size:15px}`,
    `.mb .mb-bars{margin:0 0 12px}.mb .mb-barrow{display:grid;grid-template-columns:9.5rem minmax(0,1fr) 3rem;gap:10px;align-items:center;margin:0 0 6px;font-size:13px;color:${c.body}}`,
    `.mb .mb-barrow strong{text-align:right;color:${c.ink};font-variant-numeric:tabular-nums}.mb .mb-bar{height:8px;border-radius:999px;background:${c.rule};overflow:hidden}.mb .mb-fill{display:block;height:100%;background:${c.strong};border-radius:999px}`,
    fillCss(),
    `.mb .mb-callouts{display:grid;gap:10px;margin:12px 0}.mb .mb-callout{padding:12px 14px;border:1px solid ${c.line};border-radius:12px;background:${c.soft}}`,
    `.mb .mb-callout strong{display:block;font-size:14px;color:${c.ink}}.mb .mb-callout p{margin:4px 0 0;font-size:13.5px;color:${c.body}}.mb .mb-callout .mb-actions{margin-bottom:0}`,
    `.mb .mb-callout.mb-bad{background:${c.alertSoft};border-color:${c.alertLine}}.mb .mb-callout.mb-bad>strong{color:${c.alertInk}}`,
    `.mb .mb-inbox{margin:12px 0 8px;padding:12px 14px;border:1px dashed ${c.underline};border-radius:12px;background:${c.white}}.mb .mb-inbox p{margin:0;font-size:13px;color:${c.muted}}`,
    `.mb .mb-jobs li{display:flex;align-items:center;gap:10px;padding:10px 14px;border-top:1px solid ${c.rule}}.mb .mb-jobs li:first-child{border-top:0}.mb .mb-jobs li>div{flex:1;min-width:0}.mb .mb-jobs strong{font-size:14px}`,
    `.mb .mb-sec-tell{margin-top:8px}.mb .mb-tell{padding:14px 16px;border:1px solid ${c.line};border-radius:12px;background:${c.soft}}.mb .mb-tell p{margin:0 0 10px;color:${c.body}}.mb .mb-or{margin:10px 0 0;font-size:12.5px;color:${c.muted}}`,
    `.mb .mb-chip{border-radius:999px}`,
    // Lookahead gantt.
    `.mb .mb-g{margin:6px 0 10px;border:1px solid ${c.line};border-radius:12px;overflow:hidden}`,
    `.mb .mb-gtools{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid ${c.rule};background:${c.soft}}`,
    `.mb .mb-seg{display:inline-flex;border:1px solid ${c.line};border-radius:9px;overflow:hidden;background:${c.white}}`,
    `.mb .mb-tog{appearance:none;font:inherit;font-size:12.5px;font-weight:600;padding:6px 11px;border:0;border-right:1px solid ${c.line};background:${c.white};color:${c.body};cursor:pointer}.mb .mb-tog:last-child{border-right:0}`,
    `.mb .mb-tog:hover{background:${c.head};color:${c.ink}}.mb .mb-tog[aria-pressed="true"]{background:${c.ink};color:${c.white}}`,
    `.mb .mb-gcap{margin:8px 12px 0;font-size:12.5px;color:${c.muted}}.mb .gt{display:none}`,
    `.mb .mb-gscroll{overflow-x:auto;padding:6px 0 4px}.mb .mb-gin{min-width:720px}`,
    `.mb .gr{display:grid;grid-template-columns:15rem minmax(0,1fr);align-items:center;border-top:1px solid ${c.rule};min-height:44px}.mb .ghead{border-top:0;min-height:30px}`,
    `.mb .gl{position:sticky;left:0;z-index:1;background:${c.white};padding:6px 12px;border-right:1px solid ${c.rule};min-width:0}.mb .gl strong{display:block;font-size:12.5px;line-height:1.3}.mb .gl span{display:block;font-size:11px;color:${c.muted}}`,
    `.mb .gw{display:grid;padding:0 6px}.mb .gd{font-size:10.5px;color:${c.muted};text-align:center;padding:4px 0;border-left:1px solid ${c.white}}.mb .gwk{color:${c.ink};font-weight:650;text-align:left;padding-left:3px;border-left-color:${c.line}}.mb .gsun{color:${c.underline}}`,
    `.mb .gbar-track{position:relative;height:26px;margin:0 6px}`,
    `.mb .gbar{position:absolute;top:3px;height:20px;border-radius:6px;background:${c.underline};color:${c.white};font-size:10.5px;font-weight:650;line-height:20px;padding:0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:6px}`,
    `.mb .gcrit .gbar{background:${c.alertInk}}`,
    `.mb .mb-g[data-party="sub"] .gp-self,.mb .mb-g[data-party="self"] .gp-sub{display:none}`,
    `.mb .gend{margin:0;padding:8px 12px;border-top:1px solid ${c.rule};font-size:12px;color:${c.muted};text-align:right}`,
    `.mb .mb-legend{margin:0;padding:8px 12px;border-top:1px solid ${c.rule};font-size:12px;color:${c.muted};display:flex;align-items:center;gap:6px;flex-wrap:wrap}`,
    `.mb .lg{display:inline-block;width:14px;height:8px;border-radius:3px;margin-left:8px}.mb .lg:first-child{margin-left:0}.mb .lg-crit{background:${c.alertInk}}.mb .lg-norm{background:${c.underline}}`,
    ...gantts.map((g) => ganttCss(g.acts, g.start)),
    `.mb .mb-foot{padding:12px 22px 16px;border-top:1px solid ${c.rule};font-size:12.5px;color:${c.muted};display:flex;flex-wrap:wrap;gap:6px 14px;justify-content:space-between}`,
    // A page (the /today link) has no chat to send to, so prompt buttons are hidden there.
    `.mb[data-mode="page"] .mb-btn{display:none}.mb[data-mode="page"] .mb-or{display:none}`,
    // Tablet.
    `@media (max-width:720px){.mb .mb-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.mb .mb-kpi:nth-child(2){border-right:0}.mb .mb-kpi:nth-child(-n+2){border-bottom:1px solid ${c.rule}}.mb .gr{grid-template-columns:11rem minmax(0,1fr)}}`,
    // Phone.
    `@media (max-width:480px){.mb{margin:0;border-radius:0;border-left:0;border-right:0}.mb header,.mb .mb-body,.mb .mb-foot{padding-left:16px;padding-right:16px}.mb h1{font-size:20px}.mb .mb-finish strong{font-size:15px}.mb .mb-finish div{padding:8px 10px}.mb .mb-barrow{grid-template-columns:7rem minmax(0,1fr) 2.6rem}.mb .mb-right{width:100%}.mb .gr{grid-template-columns:9rem minmax(0,1fr)}.mb .mb-btn{padding:9px 12px}}`,
  ].join("");
}

export function briefBodyHtml(doc: BriefDoc, mode: "chat" | "page" = "chat"): string {
  const finish = doc.finish
    ? `<div class="mb-finish"><div><span>Contract finish</span><strong>${esc(doc.finish.contract)}</strong></div><div${doc.finish.late ? ' class="mb-bad" data-alert="delay"' : ""}><span>Forecast finish</span><strong>${esc(doc.finish.forecast)}</strong></div><div${doc.finish.late ? ' class="mb-bad" data-alert="delay"' : ""}><span>Variance</span><strong>${esc(doc.finish.variance)}</strong></div></div>`
    : "";
  const moves = doc.moves
    ? `<div class="mb-moves"><h2>${esc(doc.moves.title)}</h2><ol>${doc.moves.items.map((m) => `<li><strong>${esc(m.lead)}</strong> ${esc(m.rest)}</li>`).join("")}</ol></div>`
    : "";
  const board = doc.board ? `<a href="${esc(doc.board.href)}">${esc(doc.board.label)}</a>` : "";
  return `<article class="card mb" data-presentation="brief" data-mode="${mode}"><header><p class="mb-mark">Athena · Morning brief</p><h1>${esc(doc.greeting)}</h1><p class="mb-when">${esc(doc.when)}</p>${doc.badge ? `<span class="mb-badge">${esc(doc.badge)}</span>` : ""}${finish}</header><div class="mb-body">${moves}${doc.sections.map(section).join("")}</div><div class="mb-foot"><span>${esc(doc.footer)}</span>${board}</div></article>`;
}

/** Finished HTML document for the chat card. */
export function renderBriefHtml(doc: BriefDoc, mode: "chat" | "page" = "chat"): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${briefCss(doc)}</style></head><body>${briefBodyHtml(doc, mode)}</body></html>`;
}
