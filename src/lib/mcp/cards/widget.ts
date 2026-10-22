// ChatGPT MCP Apps card. Same shape as the team picker (ui:// resource, outputTemplate,
// HTML stays out of the tool text). This one paints whatever card the tool put on structuredContent.card.
import { ALERT, BLUE, GRAY, NAVY, WHITE, cssColor } from "./palette";

export const CARD_WIDGET_URI = "ui://athena/card.html";
export const CARD_WIDGET_MIME = "text/html+skybridge";

const SCRIPT = `(function(){
var root=window.openai||{};
var output=root.toolOutput||{};
var P=${JSON.stringify({ navy: NAVY, blue: BLUE, gray: GRAY, white: WHITE, alert: ALERT })};
var app=document.getElementById("app");
if(!app||app.dataset.painted==="1")return;
app.dataset.painted="1";
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}
function isAlert(level){return level==="risk"||level==="delay"||level==="overdue"}
function raw(c){return /^(#[0-9A-Fa-f]{3,8}|#\\d{1,4}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(String(c||"").trim())}
function clean(c){return String(c==null?"":c).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig," ").replace(/#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\\b/g," ").replace(/#\\d{1,4}\\b/g," ").replace(/\\s+/g," ").replace(/^[,·\\s-]+|[,·\\s-]+$/g,"").trim()}
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
var labels={intake:"Intake",progress:"What I have so far",ask:"Needed",result:"Result"};
var state=card.state||"result";
var h='<article class="card" data-state="'+esc(state)+'"><header><p class="mark">Athena</p><h1>'+esc(card.title||"Athena")+'</h1>';
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
  h+='<h2>'+esc(s.heading)+'</h2>';
  if(s.kind==="chips"){
    h+='<p>';
    (s.rows||[]).forEach(function(r){
      var alert=isAlert(r.flag);
      h+='<span class="chip'+(r.tone?' tone-'+r.tone:'')+(alert?' alert" data-alert="'+r.flag:'')+'">'+linked(view(r))+'</span>';
    });
    h+='</p>';
    return;
  }
  function head(flag){return flag==="delay"?"Delay":flag==="overdue"?"Overdue":"Risk"}
  if(s.kind==="table"){
    var cols=s.columns||[];
    h+='<table><thead><tr>'+cols.map(function(c){return '<th>'+esc(c)+'</th>'}).join('')+'</tr></thead><tbody>';
    (s.rows||[]).forEach(function(r){
      var alert=isAlert(r.flag);
      var seen=view(r);
      h+='<tr'+(alert?' class="alert" data-alert="'+r.flag+'"':'')+'>'+(r.cells||[]).map(function(c,i){var t=raw(c)?"":clean(c);var body=i===0?linked({label:t||seen.label,href:seen.href,ref:seen.ref,secondary:seen.secondary}):esc(t);return '<td>'+(alert&&i===0?'<div class="flag-head">'+head(r.flag)+'</div><div class="flag-body">'+body+'</div>':body)+'</td>'}).join('')+'</tr>';
    });
    h+='</tbody></table>';
    return;
  }
  h+='<ul>';
  (s.rows||[]).forEach(function(r){
    var alert=isAlert(r.flag);
    h+='<li'+(alert?' class="alert" data-alert="'+r.flag+'"':'')+'>'+(alert?'<div class="flag-head">'+head(r.flag)+'</div><div class="flag-body">':'')+linked(view(r))+(alert?'</div>':'')+'</li>';
  });
  h+='</ul>';
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
var main=paint(output.card||{});
var lead=output.getting_started;
app.innerHTML=lead&&lead.title?'<div class="stack">'+paint(lead)+main+'</div>':main;
})();`;

export function cardWidgetHtml(): string {
  const navy = cssColor(NAVY, "#1E3A5F");
  const blue = cssColor(BLUE, "#1E5FED");
  const gray = cssColor(GRAY, "#6B7280");
  const white = cssColor(WHITE, "#FFFFFF");
  const alert = cssColor(ALERT, "#DC2626");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:${white};color:${navy};font:15px/1.45 system-ui,sans-serif}
.stack{display:flex;flex-direction:column;gap:12px}
.card{border:1px solid ${gray};border-radius:14px;overflow:hidden;background:${white}}
header{background:${navy};color:${white};padding:16px 18px}
.mark{margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase}
h1{margin:0;font-size:22px}.job{margin:6px 0 0}
.body{padding:16px 18px}
.eyebrow{display:inline-block;margin:0 0 10px;padding:3px 8px;border-radius:999px;background:${blue};color:${white};font-size:12px;font-weight:700}
.track{height:8px;border-radius:999px;border:1px solid ${gray};overflow:hidden;margin:0 0 14px}
.fill{height:100%;background:${blue}}
.kpi{display:inline-block;min-width:120px;border:1px solid ${gray};border-radius:10px;padding:8px 10px;margin:0 8px 8px 0}
.kpi span{display:block;color:${gray};font-size:12px}
h2{margin:16px 0 8px;font-size:14px}
th{background:${blue};color:${white};text-align:left;padding:6px 8px}
td{padding:6px 8px;border-bottom:1px solid ${gray}}
.chip{display:inline-block;margin:0 6px 6px 0;padding:4px 8px;border-radius:999px;border:1px solid ${gray}}
.tone-known{border-color:${blue};color:${blue}}.tone-unknown{color:${gray}}.tone-action{background:${blue};color:${white}}
a{color:${blue};text-decoration:none}
.ref{display:block;margin-top:2px;font-size:11px;color:${gray}}
.ask{margin:12px 0;padding:12px;border-left:4px solid ${blue}}
.next{font-weight:700}
.alert{color:${alert}}
li.alert,p.alert{display:block;margin:8px 0;padding:0;border:2px solid ${alert};border-radius:12px;background:${white};overflow:hidden}
.flag-head{display:block;margin:0;padding:6px 10px;background:${alert};color:${white};font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.flag-body{padding:10px 12px}
tr.alert td{border:2px solid ${alert}}
</style></head><body><div id="app"></div><script>${SCRIPT}</script></body></html>`;
}

export const CARD_WIDGET = { uri: CARD_WIDGET_URI, mimeType: CARD_WIDGET_MIME, html: cardWidgetHtml };
export const cardWidgetMeta = { "openai/outputTemplate": CARD_WIDGET_URI } as const;
