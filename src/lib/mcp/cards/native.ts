/** Standard MCP Apps view for the two Claude regressions. The existing ChatGPT resource is separate. */
export const NATIVE_CARD_URI = "ui://athena/native-card.html";
export const NATIVE_CARD_MIME = "text/html;profile=mcp-app";
export const NATIVE_CARD_TOOLS = new Set(["lookahead_get", "lookahead_list", "list_open_items", "submittal_log", "submittals_list", "submittals_import", "submittal_chase", "submittal_package", "submittal_delivery"]);
/** Replies whose text is the styled markdown, plus HTML only for a host that can show a card. */
export const TEXT_CARD_TOOLS = new Set(["lookahead_get", "list_open_items", "submittal_log", "submittals_list", "submittals_import", "submittal_chase", "submittal_package", "submittal_delivery"]);
export const nativeCardMeta = { ui: { resourceUri: NATIVE_CARD_URI } } as const;
export const nativeResourceMeta = { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true } };

// No sampling, tool calls, network requests, or model-authored CSS. Render Athena's server-built HTML.
const SCRIPT = `(function(){
var app=document.getElementById("app"), ready=false, origin=null, lastSize="";
function send(message){window.parent.postMessage(Object.assign({jsonrpc:"2.0"},message),origin&&origin!=="null"?origin:"*")}
function size(){if(!ready)return;var box=document.body.getBoundingClientRect();var dims={width:Math.ceil(box.width),height:Math.ceil(box.height)};var key=JSON.stringify(dims);if(key!==lastSize){lastSize=key;send({method:"ui/notifications/size-changed",params:dims})}}
function display(result){
 var sc=result&&result.structuredContent, html=sc&&sc.html;
 if(typeof html!=="string"||!html.trim()){app.textContent="Athena could not load this card. The complete reply is available in the conversation.";size();return}
 var doc=new DOMParser().parseFromString(html,"text/html");
 // Only inert card markup crosses into the view. Never execute returned scripts or event handlers.
 var allowed=new Set(["ARTICLE","HEADER","SECTION","DIV","SPAN","P","H1","H2","H3","STRONG","B","EM","UL","OL","LI","TABLE","THEAD","TBODY","TR","TH","TD","A","BR"]);
 doc.body.querySelectorAll("*").forEach(function(el){
  if(!allowed.has(el.tagName)){el.remove();return}
  Array.from(el.attributes).forEach(function(a){if(!/^(class|data-[a-z-]+|aria-[a-z-]+|role|tabindex|colspan|rowspan|href)$/.test(a.name))el.removeAttribute(a.name)});
  if(el.hasAttribute("href")){var href=el.getAttribute("href");if(!/^https:\\/\\/app\\.meetathena\\.io\\/r\\//.test(href))el.removeAttribute("href");else{el.setAttribute("target","_blank");el.setAttribute("rel","noopener noreferrer")}}
 });
 // Styles are generated on the backend from Athena's fixed palette, never supplied by the model.
 var styles=doc.head.querySelectorAll("style"), css=Array.from(styles).map(function(s){return s.textContent}).join("\\n");
 // Reject CSS capable of fetching a remote resource, even if supplied in a malformed result.
 if(/url\\s*\\(|@import|expression\\s*\\(/i.test(css)){app.textContent="Athena could not load this card. The complete reply is available in the conversation.";size();return}
 document.getElementById("card-style").textContent=css;
 app.replaceChildren.apply(app,Array.from(doc.body.childNodes));size();
}
function receive(event){
 if(event.source!==window.parent)return;
 var m=event.data;if(!m||m.jsonrpc!=="2.0")return;
 if(!ready){
  if(m.id!==1||m.error||!m.result||typeof m.result!=="object")return;
  origin=event.origin;ready=true;send({method:"ui/notifications/initialized",params:{}});size();return;
 }
 if(event.origin!==origin)return;
 if(m.method==="ui/notifications/tool-result")display(m.params);
 else if(m.method==="ui/notifications/tool-cancelled"){app.textContent="Athena request cancelled.";size()}
 else if(m.method==="ui/resource-teardown"&&m.id!=null){send({id:m.id,result:{}});window.removeEventListener("message",receive);if(observer)observer.disconnect()}
 else if(m.method==="ping"&&m.id!=null)send({id:m.id,result:{}});
}
window.addEventListener("message",receive);
var observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(size):null;if(observer)observer.observe(document.body);
send({id:1,method:"ui/initialize",params:{protocolVersion:"2026-01-26",appInfo:{name:"Athena card",version:"1.0.0"},appCapabilities:{availableDisplayModes:["inline"]}}});
})();`;

export function nativeCardHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="card-style"></style><style>body{margin:0;background:#FFFFFF;color:#1E3A5F;font:15px/1.45 system-ui,sans-serif}#app{min-width:0}#app>.card{border-top:4px solid #1E5FED}#app>p{margin:12px;padding:12px;border-left:4px solid #1E5FED;color:#6B7280}table{width:100%;border-collapse:collapse}td,th{overflow-wrap:anywhere}</style></head><body><main id="app" aria-live="polite"><p>Athena · Loading your card…</p></main><script>${SCRIPT}</script></body></html>`;
}
