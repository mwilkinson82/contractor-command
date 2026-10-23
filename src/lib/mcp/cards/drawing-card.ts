import { NATIVE_CARD_MIME, nativeResourceMeta } from "./native";

/** Drawing views have preview/zoom and private PDF links; the existing card views stay unchanged. */
export const DRAWING_CARD_URI = "ui://athena/drawing-card-v2.html";
export const LEGACY_DRAWING_CARD_URI = "ui://athena/drawing-card.html";
export const DRAWING_CARD_TOOLS = new Set(["drawing_set_import", "drawing_markup"]);
export const drawingCardMeta = { ui: { resourceUri: DRAWING_CARD_URI } } as const;
export const drawingCardResultMeta = {
  ...drawingCardMeta,
  "openai/outputTemplate": DRAWING_CARD_URI,
} as const;
export const DRAWING_CARD_MIME = NATIVE_CARD_MIME;
export const drawingResourceMeta = nativeResourceMeta;

export function drawingCardHtml(
  storageUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
): string {
  let storageOrigin = "";
  try {
    const url = new URL(storageUrl);
    if (url.protocol === "https:" && !url.username && !url.password) storageOrigin = url.origin;
  } catch {
    /* Missing config disables PDF links, never relaxes their origin check. */
  }
  const origin = JSON.stringify(storageOrigin).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}body{margin:0;background:#FFFFFF;color:#1E3A5F;font:15px/1.45 system-ui,sans-serif}.card{border:1px solid #6B7280;border-top:4px solid #1E5FED;border-radius:12px;overflow:hidden;min-width:0}header{background:#1E3A5F;color:#FFFFFF;padding:18px}header p{margin:4px 0}h1{font-size:22px;margin:4px 0;overflow-wrap:anywhere}.brand{font-size:11px;letter-spacing:.12em}main{padding:16px}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px}.kpi{padding:12px;border:1px solid #6B7280;border-radius:8px;min-width:0}.kpi small{display:block;color:#6B7280}.kpi strong{display:block;overflow-wrap:anywhere}h2{font-size:16px;margin:20px 0 10px}.row{border-left:3px solid #1E5FED;background:#FFFFFF;padding:10px 12px;margin:8px 0;overflow-wrap:anywhere}.row p{margin:3px 0;white-space:pre-wrap}.row p+p{color:#6B7280}.alert{border-color:#DC2626}.alert strong{color:#DC2626}.tools{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}button{min-height:44px;padding:9px 13px;border:1px solid #1E5FED;border-radius:7px;background:#FFFFFF;color:#1E3A5F;font:inherit;cursor:pointer}button:focus-visible{outline:3px solid #1E5FED;outline-offset:2px}.download{background:#1E5FED;color:#FFFFFF}.preview{overflow:auto;border:1px solid #6B7280;border-radius:8px;max-height:560px;touch-action:pan-x pan-y}.preview img{display:block;width:100%;max-width:none;height:auto}.note{color:#6B7280;font-size:13px;overflow-wrap:anywhere}.status{padding:12px;border-left:3px solid #1E5FED;color:#6B7280}@media(max-width:480px){header,main{padding:12px}h1{font-size:20px}.kpis .kpi:last-child:nth-child(odd){grid-column:1/-1}.preview{max-height:400px}}
</style></head><body><div id="app" aria-live="polite"><p class="status">Athena · Loading your drawing…</p></div><p id="status" class="note" role="status"></p><script>
(function(){
var app=document.getElementById("app"),status=document.getElementById("status"),ready=false,parentOrigin=null,lastSize="",requestId=2,pending=new Set(),storageOrigin=${origin};
function send(message){window.parent.postMessage(Object.assign({jsonrpc:"2.0"},message),parentOrigin&&parentOrigin!=="null"?parentOrigin:"*")}
function size(){if(!ready)return;var box=document.body.getBoundingClientRect(),dims={width:Math.ceil(box.width),height:Math.ceil(box.height)},key=JSON.stringify(dims);if(key!==lastSize){lastSize=key;send({method:"ui/notifications/size-changed",params:dims})}}
function node(tag,text,css){var el=document.createElement(tag);if(text!=null)el.textContent=String(text);if(css)el.className=css;return el}
function alert(flag){return flag==="risk"||flag==="delay"||flag==="overdue"}
function safeLink(raw,sc){try{var url=new URL(raw);if(url.protocol!=="https:"||url.username||url.password||url.port)return null;
 if(url.origin==="https://app.meetathena.io"&&url.pathname.startsWith("/r/"))return url.href;
 var source=sc.source||{},markup=sc.markup||{},path=String(markup.path||""),prefix=String(source.company_id||"")+"/"+String(source.job_id||"")+"/drawing-markup-";
 if(storageOrigin&&url.origin===storageOrigin&&source.company_id&&source.job_id&&markup.kind==="markup"&&markup.parent_id===source.id&&path.startsWith(prefix)&&!path.split("/").some(function(p){return p===".."||p==="."})&&decodeURIComponent(url.pathname)==="/storage/v1/object/sign/athena-files/"+path&&url.searchParams.get("token"))return url.href;
 if(raw===source.source_url&&["drive.google.com","www.dropbox.com","dropbox.com","dl.dropboxusercontent.com"].includes(url.hostname))return url.href;
 }catch(e){}return null}
function openLink(url){var id=requestId++;pending.add(id);status.textContent="Opening your file…";send({id:id,method:"ui/open-link",params:{url:url}})}
function button(label,fn,css){var el=node("button",label,css);el.type="button";el.addEventListener("click",fn);return el}
function display(result){
 var sc=result&&result.structuredContent,card=sc&&sc.card;
 if(!card||typeof card.title!=="string"){app.replaceChildren(node("p","Athena could not load this drawing card. The complete reply remains in the conversation.","status"));size();return}
 var shell=node("article",null,"card"),head=node("header"),body=node("main");head.append(node("p","ATHENA","brand"),node("h1",card.title));if(card.job)head.append(node("p",card.job));shell.append(head,body);
 if(Array.isArray(card.kpis)){var kpis=node("div",null,"kpis");card.kpis.forEach(function(k){var box=node("div",null,"kpi"+(alert(k.flag)?" alert":""));box.append(node("small",k.label),node("strong",k.value));kpis.append(box)});body.append(kpis)}
 function validPicture(c){return c&&c.type==="image"&&c.mimeType==="image/png"&&typeof c.data==="string"&&c.data.length>0&&c.data.length<=12000000&&/^[A-Za-z0-9+/]*={0,2}$/.test(c.data)}
 var picture=validPicture(sc.drawing_preview)?sc.drawing_preview:Array.isArray(result.content)&&result.content.find(validPicture);
 if(picture){body.append(node("h2","Stored sheet preview"));var tools=node("div",null,"tools"),viewport=node("div",null,"preview"),img=node("img"),zoom=1;img.src="data:image/png;base64,"+picture.data;img.alt=String(sc.sheet||sc.markup&&sc.markup.sheet||"Drawing")+" · Athena stored-sheet preview";img.addEventListener("load",size);viewport.tabIndex=0;viewport.ariaLabel="Drawing preview; arrow keys pan when zoomed";viewport.append(img);function scale(value){zoom=Math.min(3,Math.max(1,value));img.style.width=String(zoom*100)+"%";size()}tools.append(button("Zoom in",function(){scale(zoom+.5)}),button("Zoom out",function(){scale(zoom-.5)}),button("Reset",function(){scale(1)}));body.append(tools,viewport,node("p","Zoom to inspect the sheet; pan within the preview. Supplied pins refer to the saved drawing.","note"))}
 if(Array.isArray(card.sections))card.sections.forEach(function(section){var part=node("section");if(section.heading)part.append(node("h2",section.heading));if(Array.isArray(section.rows))section.rows.forEach(function(row){var line=node("div",null,"row"+(alert(row.flag)?" alert":""));var href=safeLink(row.href,sc);if(href)line.append(button(row.cells&&row.cells[0]||"Open file",function(){openLink(href)},"download"));if(Array.isArray(row.cells))row.cells.forEach(function(cell,index){if(!href||index>0)line.append(node(index===0?"strong":"p",cell))});part.append(line)});body.append(part)});
 if(card.ask&&card.ask.prompt)body.append(node("p",card.ask.prompt));if(card.next_move)body.append(node("p",card.next_move,"note"));status.textContent="";app.replaceChildren(shell);size();
}
function receive(event){if(event.source!==window.parent)return;var m=event.data;if(!m||m.jsonrpc!=="2.0")return;
 if(!ready){if(m.id!==1||m.error||!m.result||typeof m.result!=="object")return;parentOrigin=event.origin;ready=true;send({method:"ui/notifications/initialized",params:{}});size();return}
 if(event.origin!==parentOrigin)return;
 if(m.method==null&&pending.has(m.id)){pending.delete(m.id);status.textContent=m.error||m.result&&m.result.isError?"The file could not be opened. Use the private download link in the conversation.":"";size();return}
 if(m.method==="ui/notifications/tool-result")display(m.params);
 else if(m.method==="ui/notifications/tool-cancelled"){status.textContent="Athena request cancelled.";size()}
 else if(m.method==="ping"&&m.id!=null)send({id:m.id,result:{}});
 else if(m.method==="ui/resource-teardown"&&m.id!=null){send({id:m.id,result:{}});window.removeEventListener("message",receive);if(observer)observer.disconnect();pending.clear()}
}
window.addEventListener("message",receive);var observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(size):null;if(observer)observer.observe(document.body);
send({id:1,method:"ui/initialize",params:{protocolVersion:"2026-01-26",appInfo:{name:"Athena drawings",version:"1.0.0"},appCapabilities:{availableDisplayModes:["inline"]}}});
})();
</script></body></html>`;
}
