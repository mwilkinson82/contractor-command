// ChatGPT MCP Apps card. Same shape as the team picker (ui:// resource, outputTemplate,
// HTML stays out of the tool text). This one paints whatever card the tool put on structuredContent.card.
import { sovCss } from "./sov-style";
import { LONG_CELL_MIN, SHORT_CELL_MAX, cardBaseCss } from "./card-style";
import { responsiveCardCss } from "./responsive";
import { onboardingCss } from "./onboarding-style";
import { reportLinkCss } from "./report-link-card";

export const CARD_WIDGET_URI = "ui://athena/card.html";
export const CARD_WIDGET_MIME = "text/html+skybridge";
/** The card is self-contained: no fetch, external assets or embedded frames. */
export const cardWidgetResourceMeta = {
  ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true },
  "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
  "openai/widgetPrefersBorder": true,
  "openai/widgetDescription":
    "Athena's card shows this result's figures, status and buttons. The member reads the details on the card, so answer with your own short read of what matters and one next step rather than restating it.",
};

const SCRIPT = `(function(){
var root=window.openai||{};
var app=document.getElementById("app");
if(!app||app.dataset.subscribed==="1")return;
app.dataset.subscribed="1";
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}
function cellKind(t){var v=String(t||"").trim();if(/^[$\\d][\\d.,]*%?$/.test(v))return "num";if(v&&v.length<=${SHORT_CELL_MAX}&&!/\\s/.test(v))return "short";return v.length>=${LONG_CELL_MIN}?"long":""}
function isAlert(level){return level==="risk"||level==="delay"||level==="overdue"}
function raw(c){return /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(String(c||"").trim())}
function clean(c){return String(c==null?"":c).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig," ").replace(/\\s+/g," ").replace(/^[,·\\s-]+|[,·\\s-]+$/g,"").trim()}
function view(r){
  var cells=r.cells||[];
  var words=cells.filter(function(c){return c&&!raw(c)}).map(clean).filter(Boolean);
  var href=typeof r.href==="string"&&/^https:\\/\\/app\\.meetathena\\.io\\/r\\//.test(r.href)?r.href:"";
  var ref=r.refId||"";
  var secondary=ref && ref.charAt(0)!=="#" && !/^[0-9a-f]{8}-/i.test(ref)?ref:"";
  return {label:words.join(" · ")||"Item", href:href, ref:ref, secondary:secondary};
}
function linked(v){
  var id=v.ref?' data-id="'+esc(v.ref)+'"':"";
  var body=v.href?'<a href="'+esc(v.href)+'">'+esc(v.label)+'</a>':esc(v.label);
  return '<span'+id+'>'+body+(v.secondary?'<span class="ref">'+esc(v.secondary)+'</span>':"")+'</span>';
}
function paint(card){
if(card.presentation==="report-link"){
 var head='<article class="card" data-presentation="report-link"><header><h1>'+esc(card.title||"Athena")+'</h1>'+(card.job?'<p class="job">'+esc(card.job)+'</p>':'')+'</header><div class="report-body">';
 var kpis=(card.kpis||[]).map(function(k){return '<div class="report-kpi"><span>'+esc(k.label)+'</span><strong>'+esc(k.value)+'</strong></div>'}).join('');
 if(kpis)head+='<div class="report-kpis">'+kpis+'</div>';
 var actions=[];
 (card.sections||[]).forEach(function(s){(s.rows||[]).forEach(function(r){if(s.heading==="Link")head+='<p>'+esc((r.cells||[]).join(' '))+'</p>';else if(s.heading==="Open"){var v=view(r);if(v.href)actions.push('<a href="'+esc(v.href)+'">'+esc(v.label)+'</a>')}})});
 head+='</div>';if(actions.length)head+='<div class="report-actions">'+actions.join('')+'</div>';
 return head+'</article>';
}
var labels={intake:"Intake",progress:"What I have so far",ask:"Needed",result:"Result"};
var state=card.state||"result";
var h='<article class="card"'+((card.presentation==="onboarding"||card.presentation==="sov")?' data-presentation="'+card.presentation+'"':'')+' data-state="'+esc(state)+'"><header><p class="mark">Athena</p><h1>'+esc(card.title||"Athena")+'</h1>';
if(card.job)h+='<p class="job">'+esc(card.job)+'</p>';
h+='</header><div class="body">';
if(card.show_state!==false)h+='<p class="eyebrow">'+esc(labels[state]||"Result")+'</p>';
if(card.progress&&card.progress.total>0){
  var done=Math.max(0,Math.min(card.progress.done,card.progress.total));
  var pct=Math.round(done/card.progress.total*100);
  h+='<div class="track" aria-label="'+done+' of '+card.progress.total+'"><div class="fill" style="width:'+pct+'%"></div></div>';
}
(card.kpis||[]).forEach(function(k){
  var alert=isAlert(k.flag);
  h+='<div class="kpi'+(alert?' alert" data-alert="'+k.flag:'')+'"><span>'+esc(k.label)+'</span><strong>'+esc(k.value)+'</strong></div>';
});
if(card.ask&&card.ask.prompt)h+='<div class="ask"><strong>This question</strong><p>'+esc(card.ask.prompt)+'</p></div>';
(card.sections||[]).forEach(function(s){
  var framed=s.framed?'<section class="framed'+(isAlert(s.flag)?' alert" data-alert="'+s.flag:'')+'">':'';
  var open=framed||(s.placeholder?'<section class="placeholder">':'');
  var close=s.framed||s.placeholder?'</section>':'';
  h+=open+'<h2>'+esc(s.heading)+'</h2>';
  if(s.kind==="chips"){
    h+='<p>';
    (s.rows||[]).forEach(function(r){
      var alert=isAlert(r.flag);
      h+='<span class="chip'+(r.tone?' tone-'+r.tone:'')+(alert?' alert" data-alert="'+r.flag:r.flag==="callout"?' callout':'')+'">'+linked(view(r))+'</span>';
    });
    h+='</p>'+close;
    return;
  }
  function head(flag){return flag==="delay"?"Delay":flag==="overdue"?"Overdue":flag==="risk"?"Risk":"Callout"}
  if(s.kind==="table"){
    var cols=s.columns||[];
    h+=s.scroll?'<div class="table-scroll" tabindex="0" role="region" aria-label="Continuation table">':'<div class="table-wrap">';
    h+='<table><thead><tr>'+cols.map(function(c){return '<th>'+esc(c)+'</th>'}).join('')+'</tr></thead><tbody>';
    (s.rows||[]).forEach(function(r){
      var alert=isAlert(r.flag);
      var seen=view(r);
      h+='<tr'+(alert?' class="alert" data-alert="'+r.flag+'"':r.flag==="callout"?' class="callout"':'')+'>'+(r.cells||[]).map(function(c,i){var t=raw(c)?"":clean(c);var body=i===(r.linkCell||0)?linked({label:t||seen.label,href:seen.href,ref:seen.ref,secondary:seen.secondary}):esc(t);var k=cellKind(t);return '<td'+(!t&&i>0?' class="blank"':k?' class="'+k+'"':'')+(cols[i]?' data-label="'+esc(cols[i])+'"':'')+'>'+((alert||r.flag==="callout")&&i===0?'<div class="flag-head">'+head(r.flag)+'</div><div class="flag-body">'+body+'</div>':body)+'</td>'}).join('')+'</tr>';
    });
    h+='</tbody></table></div>'+close;
    return;
  }
  h+='<ul>';
  (s.rows||[]).forEach(function(r){
    var alert=isAlert(r.flag);
    if(r.tone==="literal"){h+='<li class="tone-literal">'+esc((r.cells||[]).join("\\n"))+'</li>';return}
    if(r.tone==="quote"){h+='<li class="tone-quote">'+esc((r.cells||[]).join("\\n"))+'</li>';return}
    h+='<li'+(alert?' class="alert" data-alert="'+r.flag+'"':r.flag==="callout"?' class="callout"':r.tone?' class="tone-'+r.tone+'"':'')+'>'+((alert||r.flag==="callout")?'<div class="flag-head">'+head(r.flag)+'</div><div class="flag-body">':'')+linked(view(r))+((alert||r.flag==="callout")?'</div>':'')+'</li>';
  });
  h+='</ul>'+close;
});
(card.alerts||[]).forEach(function(a){
  if(!isAlert(a.level))return;
  var label=a.level==="delay"?"Delay":a.level==="overdue"?"Overdue":"Risk";
  h+='<div class="alert" data-alert="'+a.level+'"><div class="flag-head">'+label+'</div><div class="flag-body">'+esc(a.level)+': '+esc(a.text)+'</div></div>';
});
if(card.next_move)h+='<p class="next">Next move: '+esc(card.next_move)+'</p>';
h+='</div></article>';
return h;
}
var lastOutput="";
// The morning brief arrives as Athena's server-built HTML. Only inert markup and the brief's own
// palette CSS cross in; a button sends its fixed prompt as the member's next message.
var BRIEF_TAGS=new Set(["ARTICLE","HEADER","FOOTER","SECTION","DIV","SPAN","P","H1","H2","H3","STRONG","B","EM","UL","OL","LI","TABLE","THEAD","TBODY","TR","TH","TD","A","BR","BUTTON"]);
function briefHtml(html){
 var doc=new DOMParser().parseFromString(html,"text/html");
 var css=Array.from(doc.head.querySelectorAll("style")).map(function(s){return s.textContent}).join("\\n");
 if(/url\\s*\\(|@import|expression\\s*\\(/i.test(css))return false;
 doc.body.querySelectorAll("*").forEach(function(el){
  if(!BRIEF_TAGS.has(el.tagName)){el.remove();return}
  Array.from(el.attributes).forEach(function(a){if(!/^(class|data-[a-z-]+|aria-[a-z-]+|role|tabindex|colspan|rowspan|href|type)$/.test(a.name))el.removeAttribute(a.name)});
  if(el.tagName==="BUTTON")el.setAttribute("type","button");
  if(el.hasAttribute("href")){var href=el.getAttribute("href");if(!/^https:\\/\\/app\\.meetathena\\.io\\/r\\//.test(href))el.removeAttribute("href");else{el.setAttribute("target","_blank");el.setAttribute("rel","noopener noreferrer")}}
 });
 var style=document.getElementById("brief-style");if(!style){style=document.createElement("style");style.id="brief-style";document.head.appendChild(style)}
 style.textContent=css;app.replaceChildren.apply(app,Array.from(doc.body.childNodes));return true;
}
function tapBrief(event){
 var t=event.target&&typeof event.target.closest==="function"?event.target:null;if(!t||!app.contains(t))return;
 var tog=t.closest("button[data-set]");
 if(tog&&tog.tagName==="BUTTON"){var box=tog.closest("[data-toggle-root]");var kv=String(tog.getAttribute("data-set")||"").split("=");if(!box||kv.length!==2||!/^[a-z]+$/.test(kv[0]))return;box.setAttribute("data-"+kv[0],kv[1]);Array.from(tog.parentNode.querySelectorAll("button[data-set]")).forEach(function(b){b.setAttribute("aria-pressed",b===tog?"true":"false")});return}
 var btn=t.closest("button[data-prompt]");if(!btn||btn.tagName!=="BUTTON"||btn.getAttribute("data-sent")==="true")return;
 var text=String(btn.getAttribute("data-prompt")||"").slice(0,500);var host=window.openai||root;
 if(!text.trim()||!host||typeof host.sendFollowUpMessage!=="function")return;
 btn.setAttribute("data-sent","true");host.sendFollowUpMessage({prompt:text});
}
if(typeof app.addEventListener==="function")app.addEventListener("click",tapBrief);
function display(output){
 if(!output||!output.card||typeof output.card.title!=="string")return;
 var key=JSON.stringify(output);if(key===lastOutput)return;lastOutput=key;
 if(output.card.presentation==="brief"&&typeof output.html==="string"&&briefHtml(output.html)){app.dataset.painted="1";return}
 var main=paint(output.card),lead=output.getting_started;
 app.innerHTML=lead&&lead.title?'<div class="stack">'+paint(lead)+main+'</div>':main;
 app.dataset.painted="1";
}
// ChatGPT can deliver toolOutput after the resource script has run. Subscribe
// before the initial read so a late result is not permanently replaced by an empty card.
if(typeof window.addEventListener==="function")window.addEventListener("openai:set_globals",function(event){
 var globals=event&&event.detail&&event.detail.globals;
 if(globals&&Object.prototype.hasOwnProperty.call(globals,"toolOutput"))display(globals.toolOutput);
});
display((window.openai||root).toolOutput);
})();`;

export function cardWidgetHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
${cardBaseCss(true)}
.stack{display:flex;flex-direction:column;gap:12px}
${responsiveCardCss(true)}
${onboardingCss}
${sovCss}
${reportLinkCss}
</style></head><body><div id="app"></div><script>${SCRIPT}</script></body></html>`;
}

export const CARD_WIDGET = {
  uri: CARD_WIDGET_URI,
  mimeType: CARD_WIDGET_MIME,
  html: cardWidgetHtml,
};
/** Result _meta only. tools/list must not carry this, or ChatGPT treats the tool as a widget. */
export const cardWidgetMeta = {
  "openai/outputTemplate": CARD_WIDGET_URI,
} as const;
