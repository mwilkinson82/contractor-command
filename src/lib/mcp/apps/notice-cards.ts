// Styled notice cards for contract_terms (MCP Apps for Claude, Apps SDK for ChatGPT).
// The card view is the DEFAULT output of contract_terms: the tool advertises the UI template on every
// tools/list, and every result carries structuredContent.notice_cards. Hosts without UI support fall back
// to the text, and the host-display block (visible.ts) tells them to draw the same cards themselves.
// Clause text is shown exactly as saved; nothing here rewrites or summarizes it.
import type { ClauseRow } from "../contract-clauses";
import { isNoticeAddressClause, noticeEventOf, recipientIn, type NoticeEvent } from "../notice-plain";

/** MCP Apps standard template (Claude, and ChatGPT's MCP Apps support). */
export const NOTICE_CARDS_URI = "ui://athena/notice-cards.html";
export const NOTICE_CARDS_MIME = "text/html;profile=mcp-app";
/** ChatGPT Apps SDK template (openai/outputTemplate). Same HTML, Skybridge mime type. */
export const NOTICE_CARDS_SKYBRIDGE_URI = "ui://athena/notice-cards.skybridge.html";
export const NOTICE_CARDS_SKYBRIDGE_MIME = "text/html+skybridge";

export const THEMES = {
  /** Primary: white cards, light gray panels behind text and clauses, clean blue for buttons and highlights. */
  light: {
    label: "Light",
    font: `-apple-system, "SF Pro Text", "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif`,
    page: "#FFFFFF", card: "#FFFFFF", inset: "#F3F4F5", border: "#E6E7E9", text: "#1C1E21", muted: "#65676B",
    chip: "#F3F4F5", chipText: "#3A3B3D", radius: "20px", insetRadius: "14px", shadow: "0 1px 4px rgba(28,30,33,0.06)",
    urgent: "#0064E0", urgentBg: "#E8F1FD", button: "#0064E0", buttonText: "#FFFFFF", buttonRadius: "999px", link: "#0064E0",
  },
  /** Subtle variant: same colors on a soft gray page, so the white cards float. */
  soft: {
    label: "Soft",
    font: `-apple-system, "SF Pro Text", "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif`,
    page: "#F3F4F5", card: "#FFFFFF", inset: "#F3F4F5", border: "#ECEDEE", text: "#1C1E21", muted: "#65676B",
    chip: "#F3F4F5", chipText: "#3A3B3D", radius: "24px", insetRadius: "16px", shadow: "0 2px 10px rgba(28,30,33,0.07)",
    urgent: "#0064E0", urgentBg: "#E8F1FD", button: "#0064E0", buttonText: "#FFFFFF", buttonRadius: "999px", link: "#0064E0",
  },
} as const;
export type ThemeName = keyof typeof THEMES;
/** The theme used unless the member picks the other one in the card view. Change here to switch the default. */
export const DEFAULT_NOTICE_THEME: ThemeName = "light";

export const SUMMARY_OFFER = "Do you want me to summarize this legal text so you know what it means in plain English?";

const LABEL: Record<NoticeEvent, string> = {
  delay: "Delay", change: "Change", claim: "Claim", differing_site_conditions: "Differing site conditions",
  nonpayment: "Non-payment", schedule_disagreement: "Schedule disagreement", cure: "Notice to cure",
};

export type NoticeCard = {
  section: string;
  heading: string | null;
  event: string;
  days: number | null;
  day_type: string | null;
  recipient: string | null;
  /** You give this notice (false for a notice you receive, like a notice to cure). */
  you_send: boolean;
  /** Short deadline (7 days or fewer) on a notice you give: highlighted in blue. */
  urgent: boolean;
  verbatim_text: string;
  verified: boolean;
};

/** Notice cards from the saved clauses, shortest deadline first. Clause text is passed through unchanged. */
export function noticeCards(clauses: ClauseRow[]): NoticeCard[] {
  const address = clauses.filter(isNoticeAddressClause).map((c) => recipientIn(c.verbatim_text)).find(Boolean) ?? null;
  const cards: NoticeCard[] = [];
  for (const c of clauses) {
    if (isNoticeAddressClause(c)) continue;
    const e = noticeEventOf(c);
    if (!e) continue;
    const youSend = e !== "cure";
    cards.push({
      section: c.section,
      heading: c.heading,
      event: LABEL[e],
      days: c.n_days,
      day_type: c.day_type,
      recipient: youSend ? recipientIn(c.verbatim_text) ?? address : null,
      you_send: youSend,
      urgent: youSend && c.n_days != null && c.n_days <= 7,
      verbatim_text: c.verbatim_text,
      verified: c.source === "document",
    });
  }
  return cards.sort((a, b) => (a.days ?? 999) - (b.days ?? 999) || a.section.localeCompare(b.section, undefined, { numeric: true }));
}

/** structuredContent block the card view reads. */
export function noticeCardsPayload(job: { job_number: string; name?: string | null }, clauses: ClauseRow[]) {
  return { job: { job_number: job.job_number, name: job.name ?? null }, theme: DEFAULT_NOTICE_THEME, summary_offer: SUMMARY_OFFER, cards: noticeCards(clauses) };
}

/** Tool descriptor _meta linking contract_terms to its card view in both hosts. */
export const CONTRACT_TERMS_UI_META = Object.freeze({
  ui: { resourceUri: NOTICE_CARDS_URI, visibility: ["model", "app"] },
  "ui/resourceUri": NOTICE_CARDS_URI,
  "openai/outputTemplate": NOTICE_CARDS_SKYBRIDGE_URI,
  "openai/widgetAccessible": false,
  "openai/toolInvocation/invoking": "Reading the contract…",
  "openai/toolInvocation/invoked": "Contract notice terms",
});

const RESOURCE_META = { ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } }, "openai/widgetDescription": "Notice deadline cards for the job, with the exact contract clause text.", "openai/widgetPrefersBorder": false, "openai/widgetCSP": { connect_domains: [], resource_domains: [] } };

export function noticeCardsResources() {
  return [
    { uri: NOTICE_CARDS_URI, name: "notice-cards", title: "Notice cards", mimeType: NOTICE_CARDS_MIME, _meta: RESOURCE_META },
    { uri: NOTICE_CARDS_SKYBRIDGE_URI, name: "notice-cards-chatgpt", title: "Notice cards", mimeType: NOTICE_CARDS_SKYBRIDGE_MIME, _meta: RESOURCE_META },
  ];
}

export function readNoticeCardsResource(uri: string) {
  const r = noticeCardsResources().find((x) => x.uri === uri);
  if (!r) return null;
  return { contents: [{ uri: r.uri, mimeType: r.mimeType, text: noticeCardsHtml(), _meta: RESOURCE_META }] };
}

/** Self-contained card view. No network, no external assets. `preview` inlines data for local screenshots. */
export function noticeCardsHtml(preview?: { data: unknown; theme?: ThemeName }): string {
  const themes = JSON.stringify(THEMES);
  const pre = preview ? `window.__ATHENA_PREVIEW__=${JSON.stringify(preview).replace(/</g, "\\u003c")};` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{font-family:var(--font);background:var(--page);color:var(--text);font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased}
.wrap{padding:16px;max-width:760px;margin:0 auto}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:2px 2px 14px}
.title{font-size:17px;font-weight:650;letter-spacing:-.01em}.sub{color:var(--muted);font-size:13px;margin-top:2px}
.seg{display:flex;background:var(--chip);border-radius:999px;padding:3px;gap:2px}
.seg button{border:0;background:transparent;color:var(--muted);font:inherit;font-size:12px;padding:5px 12px;border-radius:999px;cursor:pointer}
.seg button.on{background:var(--card);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.grid{display:grid;gap:12px}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px}
.card.urgent{border-color:var(--urgent);box-shadow:inset 3px 0 0 var(--urgent),var(--shadow)}
.row{display:flex;align-items:flex-start;gap:12px}
.tile{flex:0 0 auto;width:52px;min-height:52px;border-radius:var(--insetRadius);background:var(--inset);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:6px 4px}
.tile b{font-size:20px;line-height:1;font-weight:700}.tile span{font-size:10px;color:var(--muted);margin-top:3px;text-transform:uppercase;letter-spacing:.04em}
.card.urgent .tile{background:var(--urgentBg)}.card.urgent .tile b{color:var(--urgent)}
.head{flex:1;min-width:0}.h{font-weight:650;font-size:15px}.sec{color:var(--muted);font-weight:500;margin-right:6px}
.meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.chip{background:var(--chip);color:var(--chipText);border-radius:999px;padding:3px 10px;font-size:12px}
.chip.u{background:var(--urgentBg);color:var(--urgent);font-weight:600}
.to{margin-top:8px;color:var(--muted);font-size:13px}.to b{color:var(--text);font-weight:600}
.clause{margin-top:12px;background:var(--inset);border-radius:var(--insetRadius);padding:12px 14px;font-size:13.5px;white-space:pre-wrap}
.flag{margin-top:8px;font-size:12px;color:var(--urgent)}
.ask{margin-top:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;box-shadow:var(--shadow)}
.ask p{margin:0;font-size:14px}.ask button{border:0;cursor:pointer;font:inherit;font-weight:600;background:var(--button);color:var(--buttonText);border-radius:var(--buttonRadius);padding:9px 16px;white-space:nowrap}
.empty{color:var(--muted);padding:20px;text-align:center}
a{color:var(--link)}
</style></head><body><div class="wrap" id="app"><div class="empty">Loading notice terms…</div></div>
<script>${pre}
(function(){
var THEMES=${themes};var data=null,theme=null,mcpId=1,pending={};
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function rich(s){return esc(s).replace(/\\*\\*([^*]+)\\*\\*/g,"<strong>$1</strong>")}
function applyTheme(n){var t=THEMES[n]||THEMES.light;var r=document.documentElement.style;for(var k in t){if(k!=="label")r.setProperty("--"+k,t[k])}theme=n}
function pick(n){applyTheme(n);try{localStorage.setItem("athena-theme",n)}catch(e){}try{window.openai&&window.openai.setWidgetState&&window.openai.setWidgetState({theme:n})}catch(e){}render()}
function saved(){try{var w=window.openai&&window.openai.widgetState;if(w&&w.theme)return w.theme}catch(e){}try{return localStorage.getItem("athena-theme")}catch(e){return null}}
function card(c){var days=c.days==null?"—":c.days;var unit=c.days==null?"no days":(c.day_type?c.day_type+" days":"days");
return '<div class="card'+(c.urgent?' urgent':'')+'"><div class="row"><div class="tile"><b>'+esc(days)+'</b><span>'+esc(c.days==null?"":"days")+'</span></div><div class="head">'+
'<div class="h"><span class="sec">§'+esc(c.section)+'</span>'+esc(c.heading||c.event)+'</div><div class="meta"><span class="chip">'+esc(c.event)+'</span><span class="chip">'+esc(c.days==null?"No deadline stated":"Within "+c.days+" "+unit)+'</span>'+(c.urgent?'<span class="chip u">Act fast</span>':'')+(c.you_send?'':'<span class="chip">You receive this</span>')+'</div>'+
(c.you_send?'<div class="to">Send to: <b>'+esc(c.recipient||"Not named in the contract")+'</b></div>':'')+'</div></div><div class="clause">'+rich(c.verbatim_text)+'</div>'+(c.verified?'':'<div class="flag">Check this against the signed contract.</div>')+'</div>'}
function render(){var el=document.getElementById("app");if(!data){return}var cards=(data.cards||[]);var j=data.job||{};
var seg='<div class="seg">'+Object.keys(THEMES).map(function(k){return '<button data-t="'+k+'" class="'+(k===theme?'on':'')+'">'+esc(THEMES[k].label)+'</button>'}).join("")+'</div>';
el.innerHTML='<div class="top"><div><div class="title">Notice deadlines</div><div class="sub">Job '+esc(j.job_number||"")+(j.name?' · '+esc(j.name):'')+' · exact contract wording</div></div>'+seg+'</div>'+
(cards.length?'<div class="grid">'+cards.map(card).join("")+'</div>':'<div class="empty">No notice clauses are recorded for this job yet.</div>')+
'<div class="ask"><p>Summarize in plain English?</p><button id="sum">Yes, summarize</button></div>';
Array.prototype.forEach.call(el.querySelectorAll(".seg button"),function(b){b.onclick=function(){pick(b.getAttribute("data-t"))}});
document.getElementById("sum").onclick=summarize;notifySize()}
function summarize(){var p="Yes, summarize the notice clauses for job "+((data&&data.job&&data.job.job_number)||"")+" in plain English.";
if(window.openai&&window.openai.sendFollowUpMessage){window.openai.sendFollowUpMessage({prompt:p});return}
rpc("ui/message",{role:"user",content:[{type:"text",text:p}]})}
function setData(sc){if(!sc)return;var d=sc.notice_cards||sc;if(!d||!d.cards)return;data=d;if(!theme)applyTheme(saved()||d.theme||"light");render()}
function post(m){try{window.parent.postMessage(m,"*")}catch(e){}}
function rpc(method,params){var id=mcpId++;post({jsonrpc:"2.0",id:id,method:method,params:params});return id}
function notifySize(){if(window.openai)return;var h=document.documentElement.scrollHeight;post({jsonrpc:"2.0",method:"ui/notifications/size-changed",params:{height:h}})}
window.addEventListener("message",function(ev){var m=ev.data;if(!m||m.jsonrpc!=="2.0")return;
if(m.method==="ui/notifications/tool-result"){setData(m.params&&m.params.structuredContent)}
if(m.id!=null&&m.result&&pending[m.id]==="init"){post({jsonrpc:"2.0",method:"ui/notifications/initialized",params:{}});delete pending[m.id]}});
window.addEventListener("openai:set_globals",function(){if(window.openai&&window.openai.toolOutput)setData(window.openai.toolOutput)});
if(window.__ATHENA_PREVIEW__){applyTheme(window.__ATHENA_PREVIEW__.theme||"light");setData(window.__ATHENA_PREVIEW__.data);return}
if(window.openai&&window.openai.toolOutput){setData(window.openai.toolOutput)}
if(!window.openai){var id=rpc("ui/initialize",{protocolVersion:"2026-01-26",appInfo:{name:"athena-notice-cards",version:"1"},appCapabilities:{}});pending[id]="init"}
applyTheme(saved()||${JSON.stringify(DEFAULT_NOTICE_THEME)});
})();
</script></body></html>`;
}
