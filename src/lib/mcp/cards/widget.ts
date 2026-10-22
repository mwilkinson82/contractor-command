// ChatGPT MCP Apps card. Same shape as the team picker (ui:// resource, outputTemplate,
// HTML stays out of the tool text). This one paints whatever card the tool put on structuredContent.card.
import { ALERT, BLUE, GRAY, NAVY, WHITE } from "./palette";

export const CARD_WIDGET_URI = "ui://athena/card.html";
export const CARD_WIDGET_MIME = "text/html+skybridge";

const SCRIPT = `(function(){
var root=window.openai||{};
var card=(root.toolOutput||{}).card||{};
var P=${JSON.stringify({ navy: NAVY, blue: BLUE, gray: GRAY, white: WHITE, alert: ALERT })};
var app=document.getElementById("app");
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}
function isAlert(level){return level==="risk"||level==="delay"||level==="overdue"}
var labels={intake:"Intake",progress:"What I have so far",ask:"Needed",result:"Result"};
var state=card.state||"result";
var h='<article class="card" data-state="'+esc(state)+'"><header><p class="mark">Athena</p><h1>'+esc(card.title||"Athena")+'</h1>';
if(card.job)h+='<p class="job">'+esc(card.job)+'</p>';
h+='</header><div class="body"><p class="eyebrow">'+esc(labels[state]||"Result")+'</p>';
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
      h+='<span class="chip'+(r.tone?' tone-'+r.tone:'')+(alert?' alert" data-alert="'+r.flag:'')+'">'+esc((r.cells||[])[0]||"")+'</span>';
    });
    h+='</p>';
    return;
  }
  if(s.kind==="table"){
    var cols=s.columns||[];
    h+='<table><thead><tr>'+cols.map(function(c){return '<th>'+esc(c)+'</th>'}).join('')+'</tr></thead><tbody>';
    (s.rows||[]).forEach(function(r){
      var alert=isAlert(r.flag);
      h+='<tr'+(alert?' class="alert" data-alert="'+r.flag+'"':'')+'>'+(r.cells||[]).map(function(c){return '<td>'+esc(c)+'</td>'}).join('')+'</tr>';
    });
    h+='</tbody></table>';
    return;
  }
  h+='<ul>';
  (s.rows||[]).forEach(function(r){
    var alert=isAlert(r.flag);
    h+='<li'+(alert?' class="alert" data-alert="'+r.flag+'"':'')+'>'+esc((r.cells||[]).join(' · '))+'</li>';
  });
  h+='</ul>';
});
(card.alerts||[]).forEach(function(a){
  if(!isAlert(a.level))return;
  h+='<p class="alert" data-alert="'+a.level+'">'+esc(a.level)+': '+esc(a.text)+'</p>';
});
if(card.next_move)h+='<p class="next">Next move: '+esc(card.next_move)+'</p>';
h+='</div></article>';
app.innerHTML=h;
})();`;

export function cardWidgetHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:${WHITE};color:${NAVY};font:15px/1.45 system-ui,sans-serif}
.card{border:1px solid ${GRAY};border-radius:14px;overflow:hidden;background:${WHITE}}
header{background:${NAVY};color:${WHITE};padding:16px 18px}
.mark{margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase}
h1{margin:0;font-size:22px}.job{margin:6px 0 0}
.body{padding:16px 18px}
.eyebrow{display:inline-block;margin:0 0 10px;padding:3px 8px;border-radius:999px;background:${BLUE};color:${WHITE};font-size:12px;font-weight:700}
.track{height:8px;border-radius:999px;border:1px solid ${GRAY};overflow:hidden;margin:0 0 14px}
.fill{height:100%;background:${BLUE}}
.kpi{display:inline-block;min-width:120px;border:1px solid ${GRAY};border-radius:10px;padding:8px 10px;margin:0 8px 8px 0}
.kpi span{display:block;color:${GRAY};font-size:12px}
h2{margin:16px 0 8px;font-size:14px}
th{background:${BLUE};color:${WHITE};text-align:left;padding:6px 8px}
td{padding:6px 8px;border-bottom:1px solid ${GRAY}}
.chip{display:inline-block;margin:0 6px 6px 0;padding:4px 8px;border-radius:999px;border:1px solid ${GRAY}}
.tone-known{border-color:${BLUE};color:${BLUE}}.tone-unknown{color:${GRAY}}.tone-action{background:${BLUE};color:${WHITE}}
.ask{margin:12px 0;padding:12px;border-left:4px solid ${BLUE}}
.next{font-weight:700}
.alert{color:${ALERT};border:1px solid ${ALERT};border-radius:10px}
li.alert{display:block;margin:8px 0;padding:10px 12px}
</style></head><body><div id="app"></div><script>${SCRIPT}</script></body></html>`;
}

export const CARD_WIDGET = { uri: CARD_WIDGET_URI, mimeType: CARD_WIDGET_MIME, html: cardWidgetHtml };
export const cardWidgetMeta = { "openai/outputTemplate": CARD_WIDGET_URI } as const;
