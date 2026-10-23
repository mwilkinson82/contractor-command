/** Interactive MCP Apps view for an email draft: editable To, Cc, Subject and Body, one Send button.
 *  Send records the approval with Athena (email_draft → email_confirm_send, or submittal_delivery
 *  draft → approve) through the host's tools/call bridge, then posts the approved text to the chat so the
 *  member's connected email account sends it. Athena never sends mail from the card. */
import { WHITE } from "./palette";

/** The email card's own scheme: warm paper, charcoal ink, one teal accent. Every other card keeps the
 *  navy/blue palette; this is the one deliberate exception, so a draft reads as a letter, not a dashboard tile. */
export const EMAIL_CARD_PALETTE = Object.freeze({
  paper: "#FAFAF7",
  ink: "#1C1917",
  stone: "#78716C",
  line: "#E7E5E4",
  teal: "#0F766E",
  muted: "#A8A29E",
  white: WHITE,
});

export const EMAIL_CARD_URI = "ui://athena/email-card.html";
export const EMAIL_CARD_MIME = "text/html;profile=mcp-app";
/** Tools whose result opens on the email card. The chase keeps the native card: it lists several submittals. */
export const EMAIL_CARD_TOOLS = new Set(["email_draft", "submittal_delivery"]);
export const emailCardMeta = { ui: { resourceUri: EMAIL_CARD_URI } } as const;
export const emailCardResourceMeta = {
  ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true },
};

// Everything from the result is written with textContent or .value, never as markup.
// The only outbound calls are JSON-RPC messages to the host: tools/call and ui/message.
const SCRIPT = `(function(){
var ready=false, origin=null, lastSize="", nextId=2, pending={}, host={};
var S={mode:"email",draft:null,original:null,key:null,deliveryId:null,ctx:{},approved:false,sent:false,allowed:true,busy:false,note:""};
var el={};
function $(id){return document.getElementById(id)}
function send(m){window.parent.postMessage(Object.assign({jsonrpc:"2.0"},m),origin&&origin!=="null"?origin:"*")}
function request(method,params){return new Promise(function(res,rej){var id=nextId++;pending[id]={res:res,rej:rej,t:setTimeout(function(){delete pending[id];rej(new Error("No answer from the host."))},60000)};send({id:id,method:method,params:params})})}
function size(){if(!ready)return;var b=document.body.getBoundingClientRect();var d={width:Math.ceil(b.width),height:Math.ceil(b.height)};var k=JSON.stringify(d);if(k!==lastSize){lastSize=k;send({method:"ui/notifications/size-changed",params:d})}}
function text(n){return String(n==null?"":n)}
function list(s){return text(s).split(",").map(function(x){return x.trim()}).filter(Boolean)}
function same(a,b){return a.to===b.to&&a.cc.join(",")===b.cc.join(",")&&a.subject===b.subject&&a.body===b.body}
function norm(d){d=d||{};return{to:text(d.to).trim(),cc:Array.isArray(d.cc)?d.cc.map(text):[],subject:text(d.subject),body:text(d.body),link:d.link?text(d.link):null,attachment:d.attachment?text(d.attachment):null}}
function fields(){return{to:el.to.value.trim(),cc:list(el.cc.value),subject:el.subject.value.trim(),body:el.body.value,link:S.original.link,attachment:S.original.attachment}}
function pill(){var p=el.pill;p.className="pill";if(S.sent){p.textContent="Sent";p.className+=" done"}else if(S.approved){p.textContent="Approved";p.className+=" done"}else if(!S.allowed){p.textContent="Sending is off"}else{p.textContent="Not sent"}}
function edited(){return S.original&&!same(fields(),S.original)}
function refresh(){pill();var can=S.allowed&&!S.sent&&!S.busy&&!!host.serverTools;el.send.disabled=!can;el.reset.hidden=!edited()||S.busy;el.send.textContent=S.approved?"Approved · ask again to send":"Approve and send";
 el.note.textContent=S.note||(!S.allowed?"Sending is turned off. Copy this into your email app.":!host.serverTools?"This host can't approve from the card. Answer yes in the chat instead.":S.approved?"Approved with Athena. Your connected email account sends it.":"Approving records the exact text with Athena. Your connected email account sends it.");size()}
function grow(){el.body.style.height="auto";el.body.style.height=Math.min(600,el.body.scrollHeight+4)+"px";size()}
function field(label,id,multi){var w=document.createElement("div");w.className="row";var l=document.createElement("label");l.textContent=label;l.htmlFor=id;var i=document.createElement(multi?"textarea":"input");i.id=id;if(!multi)i.type=id==="to"?"email":"text";i.addEventListener("input",function(){S.note="";if(multi)grow();refresh()});w.appendChild(l);w.appendChild(i);el[id]=i;return w}
function build(){var app=$("app");var card=document.createElement("article");card.className="card";
 var h=document.createElement("header");var mark=document.createElement("p");mark.className="mark";mark.textContent="Athena";var t=document.createElement("h1");t.textContent=S.mode==="delivery"?"Submittal email":"Email draft";el.pill=document.createElement("span");h.appendChild(mark);h.appendChild(t);h.appendChild(el.pill);card.appendChild(h);
 var b=document.createElement("div");b.className="body";b.appendChild(field("To","to"));b.appendChild(field("Cc","cc"));b.appendChild(field("Subject","subject"));b.appendChild(field("Body","body",true));
 el.extra=document.createElement("div");el.extra.className="extra";b.appendChild(el.extra);
 var f=document.createElement("div");f.className="actions";el.send=document.createElement("button");el.send.type="button";el.send.className="primary";el.send.addEventListener("click",approve);el.reset=document.createElement("button");el.reset.type="button";el.reset.className="quiet";el.reset.textContent="Undo edits";el.reset.addEventListener("click",function(){fill(S.original);S.note="";refresh();grow()});f.appendChild(el.send);f.appendChild(el.reset);b.appendChild(f);
 el.note=document.createElement("p");el.note.className="note";b.appendChild(el.note);card.appendChild(b);app.replaceChildren(card)}
function fill(d){el.to.value=d.to;el.cc.value=d.cc.join(", ");el.subject.value=d.subject;el.body.value=d.body;
 el.extra.replaceChildren();if(d.attachment){var a=document.createElement("span");a.className="chip";a.textContent="Attachment: "+d.attachment+" (attach it in your email app before Send)";el.extra.appendChild(a)}
 if(d.link){var r=document.createElement("p");r.className="link";var lab=document.createElement("span");lab.textContent="Link: ";r.appendChild(lab);if(/^https:\\/\\/app\\.meetathena\\.io\\//.test(d.link)){var an=document.createElement("a");an.href=d.link;an.target="_blank";an.rel="noopener noreferrer";an.textContent=d.link;r.appendChild(an)}else{var sp=document.createElement("span");sp.textContent=d.link;r.appendChild(sp)}el.extra.appendChild(r)}}
function show(result){var sc=(result&&result.structuredContent)||{};if(!sc.draft||typeof sc.draft!=="object"){$("app").textContent="Athena could not load this email. The draft is in the conversation.";size();return}
 S.mode=sc.delivery_id!==undefined||sc.kind==="package"||sc.kind==="chase"?"delivery":"email";
 S.original=norm(sc.draft);S.key=sc.draft_key||null;S.deliveryId=sc.delivery_id||null;S.approved=sc.approved===true;S.sent=sc.sent===true;S.allowed=sc.send_allowed!==false;
 S.ctx={job_number:sc.job_number||null,company_id:sc.company_id||null,submittal_id:sc.submittal_id||null,package_item_id:sc.package_item_id||null,kind:sc.kind||null};
 build();fill(S.original);refresh();grow()}
function fail(r){var t=r&&r.content&&r.content.filter(function(c){return c.type==="text"}).map(function(c){return c.text}).join(" ");return (t||"Athena could not record this draft.").replace(/\\s+/g," ").trim().slice(0,300)}
function callTool(name,args){return request("tools/call",{name:name,arguments:args}).then(function(r){if(!r||r.isError)throw new Error(fail(r));return r})}
function withCtx(o){var c=S.ctx;if(c.job_number)o.job_number=c.job_number;if(c.company_id)o.company_id=c.company_id;return o}
function approve(){if(S.busy)return;var d=fields();
 if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(d.to)){S.note="Enter one recipient address.";refresh();return}
 if(!d.subject){S.note="Enter a subject.";refresh();return}if(!d.body.trim()){S.note="The body is empty.";refresh();return}
 S.busy=true;S.note="Recording the draft with Athena…";refresh();
 var changed=edited()||!S.key;var p;
 if(S.mode==="delivery"){var draftArgs=withCtx({action:"draft",kind:S.ctx.kind||"package",submittal_id:S.ctx.submittal_id,package_item_id:S.ctx.package_item_id||undefined,draft:{to:d.to,cc:d.cc,subject:d.subject,body:d.body,link:d.link}});
  p=(changed||!S.deliveryId?callTool("submittal_delivery",draftArgs).then(function(r){var sc=r.structuredContent||{};S.deliveryId=sc.delivery_id||S.deliveryId;S.key=sc.draft_key||S.key}):Promise.resolve())
   .then(function(){return callTool("submittal_delivery",withCtx({action:"approve",delivery_id:S.deliveryId,draft_key:S.key,confirmed:true,submittal_id:S.ctx.submittal_id}))})}
 else{var base=withCtx({to:d.to,cc:d.cc,subject:d.subject,body:d.body});if(d.link)base.link=d.link;if(d.attachment)base.attachment=d.attachment;
  p=(changed?callTool("email_draft",Object.assign({},base)).then(function(r){var sc=r.structuredContent||{};S.key=sc.draft_key||S.key}):Promise.resolve())
   .then(function(){return callTool("email_confirm_send",Object.assign({},base,{draft_key:S.key,confirmed:true}))})}
 p.then(function(){S.original=d;S.approved=true;S.busy=false;S.note="";refresh();
   var lines=["Send this approved email now, exactly as below, from my connected email account, then tell me which account it went from."+(S.mode==="delivery"?" Then record the receipt with submittal_delivery record_sent.":""),"Draft key: "+S.key,"To: "+d.to];if(d.cc.length)lines.push("Cc: "+d.cc.join(", "));lines.push("Subject: "+d.subject,"",d.body);if(d.link)lines.push("",d.link);if(d.attachment)lines.push("","Attach: "+d.attachment);
   if(host.message)return request("ui/message",{role:"user",content:[{type:"text",text:lines.join("\\n")}]}).then(function(){S.note="Approved. The chat has the exact text and will send it from your connected email account."},function(){S.note="Approved with Athena. Tell the chat: send the approved email."}).then(refresh);
   S.note="Approved with Athena. Tell the chat: send the approved email.";refresh()})
  .catch(function(e){S.busy=false;S.note=(e&&e.message)||"Athena could not record this draft.";refresh()})}
function receive(ev){if(ev.source!==window.parent)return;var m=ev.data;if(!m||m.jsonrpc!=="2.0")return;
 if(!ready){if(m.id!==1||m.error||!m.result||typeof m.result!=="object")return;origin=ev.origin;ready=true;host=(m.result.hostCapabilities&&typeof m.result.hostCapabilities==="object")?m.result.hostCapabilities:{};send({method:"ui/notifications/initialized",params:{}});size();return}
 if(ev.origin!==origin)return;
 if(m.id!=null&&m.method==null){var w=pending[m.id];if(!w)return;clearTimeout(w.t);delete pending[m.id];if(m.error)w.rej(new Error(text(m.error.message)||"The host refused the request."));else w.res(m.result);return}
 if(m.method==="ui/notifications/tool-result")show(m.params);
 else if(m.method==="ui/notifications/tool-cancelled"){$("app").textContent="Athena request cancelled.";size()}
 else if(m.method==="ui/resource-teardown"&&m.id!=null){send({id:m.id,result:{}});window.removeEventListener("message",receive);if(observer)observer.disconnect()}
 else if(m.method==="ping"&&m.id!=null)send({id:m.id,result:{}})}
window.addEventListener("message",receive);
var observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(size):null;if(observer)observer.observe(document.body);
send({id:1,method:"ui/initialize",params:{protocolVersion:"2026-01-26",appInfo:{name:"Athena email card",version:"1.0.0"},appCapabilities:{availableDisplayModes:["inline"]}}});
})();`;

export function emailCardHtml(): string {
  const { paper, ink, stone, line, teal, muted, white } = EMAIL_CARD_PALETTE;
  const css = [
    `body{margin:0;background:${paper};color:${ink};font:15px/1.45 system-ui,sans-serif}`,
    `#app{min-width:0}#app>p{margin:12px;padding:12px;border-left:4px solid ${teal};color:${stone}}`,
    `header{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;background:${paper};color:${ink};padding:18px 22px 10px}`,
    `.mark{margin:0;width:100%;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${stone}}`,
    `h1{margin:0;font-size:22px;flex:1}`,
    `.pill{padding:3px 10px;border-radius:999px;border:1px solid ${muted};color:${stone};font-size:12px;font-weight:700}`,
    `.pill.done{background:${teal};border-color:${teal};color:${white}}`,
    `.body{padding:12px 22px 20px}`,
    `.row{display:grid;grid-template-columns:72px 1fr;gap:8px;align-items:start;margin:0 0 10px}`,
    `label{padding-top:8px;color:${stone};font-size:13px}`,
    `input,textarea{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid ${line};border-radius:10px;font:inherit;color:${ink};background:${white}}`,
    `input:focus,textarea:focus{outline:2px solid ${teal};outline-offset:0;border-color:${teal}}`,
    `textarea{min-height:160px;resize:vertical;line-height:1.5}`,
    `.extra{margin:0 0 12px 80px}.chip{display:inline-block;padding:4px 10px;border:1px solid ${line};border-radius:999px;font-size:13px}.link{margin:6px 0 0;font-size:13px;color:${stone};overflow-wrap:anywhere}a{color:${teal}}`,
    `.actions{display:flex;gap:10px;align-items:center;margin:0 0 0 80px}`,
    `button{font:inherit;border-radius:8px;padding:9px 16px;cursor:pointer}`,
    `.primary{background:${teal};color:${white};border:1px solid ${teal};font-weight:700}.primary:disabled{background:${muted};border-color:${muted};cursor:default}`,
    `.quiet{background:${white};color:${ink};border:1px solid ${line}}[hidden]{display:none}`,
    `.note{margin:10px 0 0 80px;color:${stone};font-size:13px}`,
    `@media (max-width:520px){.row{grid-template-columns:1fr}label{padding-top:0}.extra,.actions,.note{margin-left:0}}`,
  ].join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main id="app" aria-live="polite"><p>Athena · Loading your email…</p></main><script>${SCRIPT}</script></body></html>`;
}
