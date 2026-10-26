import { NATIVE_CARD_MIME, nativeResourceMeta } from "./native";

/** Drawing views have preview/zoom and private PDF links; the existing card views stay unchanged. */
export const DRAWING_CARD_URI = "ui://athena/drawing-card-v4.html";
export const LEGACY_DRAWING_CARD_URI = "ui://athena/drawing-card.html";
export const DRAWING_CARD_URIS = new Set([DRAWING_CARD_URI, "ui://athena/drawing-card-v3.html", "ui://athena/drawing-card-v2.html", LEGACY_DRAWING_CARD_URI]);
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
button:disabled{background:#6B7280;border-color:#6B7280;color:#FFFFFF;cursor:default}.tools select{min-width:0;max-width:100%;min-height:44px}input{max-width:100%}input[type="text"]{min-height:44px;padding:8px;border:1px solid #6B7280;border-radius:6px;color:#1E3A5F;background:#FFFFFF;font:16px/1.4 system-ui}</style></head><body><div id="app" aria-live="polite"><p class="status">Athena · Loading your drawing…</p></div><p id="status" class="note" role="status"></p><script>
(function(){
var app=document.getElementById("app"),status=document.getElementById("status"),ready=false,parentOrigin=null,lastSize="",requestId=2,pending=new Set(),toolRequests=new Map(),contextRequests=new Set(),host={},storageOrigin=${origin},currentResult=null,committedResult=null,committedContext=null,supersededSources=new Set(),restoring=false,restoreAttempted=false;
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
function previewPins(surface,annotations){
 if(!Array.isArray(annotations))return;
 annotations.forEach(function(a,index){var g=a&&a.geometry,p=g&&(g.kind==="pin"?g.point:Array.isArray(g.points)&&g.points[0]);
 if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1)return;
 var pin=node("span",String(index+1),"drawing-pin");pin.title=String(a.label||"");pin.style.position="absolute";pin.style.left=String(p.x*100)+"%";pin.style.top=String(p.y*100)+"%";pin.style.transform="translate(-50%,-50%)";pin.style.border="2px solid "+(alert(a.severity)?"#DC2626":"#1E5FED");pin.style.borderRadius="50%";pin.style.background="#FFFFFF";pin.style.color="#1E3A5F";pin.style.width="24px";pin.style.height="24px";pin.style.display="grid";pin.style.placeItems="center";surface.append(pin);
 });
}
function callDrawingTool(name,args){return new Promise(function(resolve,reject){var id=requestId++,timer=setTimeout(function(){toolRequests.delete(id);reject(new Error("The host did not confirm storage. Check the job's drawing library before retrying."))},60000);toolRequests.set(id,{resolve:resolve,reject:reject,timer:timer});send({id:id,method:"tools/call",params:{name:name,arguments:args}})})}
function sameJob(a,b){return a&&b&&a.job_number===b.job_number&&a.company_id===b.company_id}
function storedContext(sc,fallback){var c=sc.drawing_source_context||fallback,s=sc.source;if(!c||!s||typeof s.id!=="string")return null;return {job_number:c.job_number,company_id:c.company_id,source_id:s.id}}
function remember(result,fallback){
 var sc=result&&result.structuredContent,c=sc&&storedContext(sc,fallback);if(!sc||!c||sc.stored!==true&&sc.saved!==true){display(result);return}
 if(committedContext&&!sameJob(c,committedContext))supersededSources.clear();
 var previous=currentResult&&currentResult.structuredContent&&currentResult.structuredContent.source;if(previous&&previous.id!==c.source_id)supersededSources.add(previous.id);
 committedResult=result;committedContext=c;
 var facts={job_number:c.job_number,company_id:c.company_id,source_id:c.source_id,filename:sc.source.filename,sheets:sc.source.sheets||[],sheet_index_required:sc.sheet_index_required===true,stored:true};
 if(sc.saved===true){facts.markup_id=sc.markup&&sc.markup.id;facts.markup_version=sc.markup&&sc.markup.version}
 try{if(window.openai&&typeof window.openai.setWidgetState==="function")window.openai.setWidgetState({modelContent:facts,privateContent:{athenaDrawing:c}})}catch(e){}
 var id=requestId++;contextRequests.add(id);send({id:id,method:"ui/update-model-context",params:{structuredContent:facts,content:[{type:"text",text:JSON.stringify(facts)}]}});
 display(result);
}
function receiveResult(result){
 var sc=result&&result.structuredContent,c=sc&&(sc.upload_context||sc.drawing_source_context||sc),source=sc&&sc.source;
 if(sc&&sc.import_failed===true){committedResult=null;committedContext=null;supersededSources.clear();restoring=false;restoreAttempted=true;try{if(window.openai&&typeof window.openai.setWidgetState==="function")window.openai.setWidgetState({})}catch(e){}display(result);return}
 if(committedResult&&(sameJob(sc&&sc.upload_context,committedContext)||sameJob(c,committedContext)&&source&&(supersededSources.has(source.id)||sc.saved===false&&committedResult.structuredContent.saved===true&&source.id===committedContext.source_id))){display(committedResult);return}
 var restored=window.openai&&window.openai.widgetState&&window.openai.widgetState.privateContent&&window.openai.widgetState.privateContent.athenaDrawing;
 if(!committedResult&&!restoreAttempted&&host.serverTools&&sc&&sc.stored===false&&sc.upload_context&&sameJob(c,restored)&&typeof restored.source_id==="string"){
  restoring=true;restoreAttempted=true;status.textContent="Reloading your stored drawing…";size();
  callDrawingTool("drawing_set_import",{job_number:c.job_number,company_id:c.company_id,source_id:restored.source_id}).then(function(r){if(!restoring)return;if(!r||!r.structuredContent||r.structuredContent.stored!==true)throw new Error("The stored drawing could not be reloaded.");remember(r,c)}).catch(function(){if(!restoring)return;display(result);status.textContent="The saved source could not be reloaded. Check the drawing library before uploading again.";size()}).finally(function(){restoring=false});return;
 }
 if(restoring&&sc&&sc.stored===false&&sc.upload_context)return;
 if(sc&&sc.stored===true&&sc.drawing_source_context){remember(result,sc.drawing_source_context);return}
 display(result);
}
function storedControls(body,sc){
 var c=sc.drawing_source_context;if(!c||sc.stored!==true)return;
 if(sc.sheet_index_context){
  var names=node("input"),busy=false;names.type="text";names.style.width="100%";names.style.marginBottom="10px";names.value=(sc.source.sheets||[]).join(", ");names.ariaLabel="Stored sheet names in PDF page order";names.placeholder="S-100, S-101, A-100…";
  var save=button("Save sheet names",async function(){if(busy||!host.serverTools)return;var sheets=names.value.split(/[,\\n]/).map(function(s){return s.trim()}).filter(Boolean);if(!sheets.length){status.textContent="Enter the sheet names in PDF page order.";size();return}busy=true;save.disabled=true;status.textContent="Saving the sheet index…";size();
   try{var r=await callDrawingTool("drawing_set_import",{job_number:c.job_number,company_id:c.company_id,source_id:c.source_id,sheets:sheets});if(r&&r.structuredContent&&r.structuredContent.index_error)throw new Error(r.structuredContent.index_error);if(!r||!r.structuredContent||r.structuredContent.stored!==true||r.structuredContent.sheet_index_required===true)throw new Error("The complete sheet index was not confirmed. The original is still stored; no re-upload is needed.");remember(r,c)}catch(e){status.textContent=e.message||"The sheet names could not be saved."}finally{busy=false;save.disabled=!host.serverTools;size()}
  },"download");save.disabled=!host.serverTools;
  body.append(node("h2","Name the stored sheets once"),node("p","Enter one name per PDF page, in page order"+(sc.page_count?" ("+sc.page_count+" pages)":"")+". Athena saves these names on this stored drawing; the original PDF is unchanged.","note"),names,save);
 }else if(sc.source&&Array.isArray(sc.source.sheets)&&sc.source.sheets.length){
  var select=node("select"),busyOpen=false;select.ariaLabel="Stored sheet to open";sc.source.sheets.forEach(function(s){var o=node("option",s);o.value=s;select.append(o)});if(sc.requested_sheet&&sc.source.sheets.includes(sc.requested_sheet))select.value=sc.requested_sheet;
  var open=button("Open stored sheet",async function(){if(busyOpen||!host.serverTools)return;busyOpen=true;open.disabled=true;status.textContent="Opening the stored sheet…";size();try{var r=await callDrawingTool("drawing_markup",{job_number:c.job_number,company_id:c.company_id,source_id:c.source_id,sheet:select.value,operation:"prepare"});if(!r||!r.structuredContent)throw new Error("The sheet could not be opened.");display(r)}catch(e){status.textContent=e.message||"The sheet could not be opened."}finally{busyOpen=false;open.disabled=!host.serverTools;size()}},"download");open.disabled=!host.serverTools;var controls=node("div",null,"tools");controls.append(select,open);body.append(controls);
 }
 body.append(button("Store another PDF",function(){committedResult=null;committedContext=null;supersededSources.clear();try{if(window.openai&&typeof window.openai.setWidgetState==="function")window.openai.setWidgetState({})}catch(e){}display({structuredContent:{stored:false,upload_context:{job_number:c.job_number,company_id:c.company_id},card:{title:"Store your drawing PDF",job:sc.card.job}}})}));
}
function uploader(body,context){
 var panel=node("section"),pick=node("input"),names=node("input"),busy=false;
 pick.style.display="block";pick.style.marginBottom="8px";names.style.width="100%";names.style.marginBottom="10px";pick.type="file";pick.accept="application/pdf,.pdf";pick.ariaLabel="Drawing PDF";
 names.type="text";names.placeholder="S-100, S-101, A-100…";names.ariaLabel="Sheet names in PDF page order";
 panel.append(node("h2","Upload directly to Athena"),node("p","Choose a PDF up to 100 MB. It is stored on this job; your local file is unchanged.","note"),pick,node("p","Sheet names in PDF page order (optional)","note"),names);
 var submit=button("Store PDF on this job",async function(){
  if(busy||!host.serverTools)return;
  var file=pick.files&&pick.files[0];if(!file){status.textContent="Choose a PDF first.";size();return}
  if(file.size>104857600){status.textContent="That PDF is over 100 MB. Nothing was stored.";size();return}
  busy=true;submit.disabled=true;status.textContent="Storing your PDF…";size();
  try{var bytes=new Uint8Array(await file.arrayBuffer()),parts=[];for(var i=0;i<bytes.length;i+=8192)parts.push(String.fromCharCode.apply(null,bytes.subarray(i,i+8192)));
   var sheets=names.value.split(/[,\\n]/).map(function(s){return s.trim()}).filter(Boolean);
   var result=await callDrawingTool("drawing_set_import",{job_number:context.job_number,company_id:context.company_id,drawing:{filename:file.name,content_base64:btoa(parts.join("")),sheets:sheets}});
   if(result&&result.structuredContent){remember(result,context);if(result.structuredContent.stored!==true)status.textContent="The new upload was not stored. No older drawing was substituted."}
   else throw new Error("The host did not return a storage result. Check the drawing library before retrying.");
  }catch(e){status.textContent=e&&e.message||"The new upload could not be stored. No older drawing was substituted."}
  finally{busy=false;submit.disabled=!host.serverTools;size()}
 },"download");submit.disabled=!host.serverTools;panel.append(submit);
 if(!host.serverTools)panel.append(node("p","This host has not enabled uploads from cards. No file has been sent.","note"));body.append(panel);
}
function positionFindings(body,surface,img,sc){
 if(sc.saved!==false||!sc.source||!sc.source.id||!Array.isArray(sc.drawing_annotations)||!sc.drawing_annotations.length)return;
 var annotations=JSON.parse(JSON.stringify(sc.drawing_annotations)),select=node("select"),progress=node("p",null,"note"),busy=false;
 select.ariaLabel="Finding to locate";annotations.forEach(function(a,i){var option=node("option",String(i+1)+". "+String(a.label||"Finding"));option.value=String(i);select.append(option)});
 var save=button("Save dated markup",async function(){
  if(busy||!host.serverTools||!annotations.some(function(a){return !!a.geometry}))return;
  busy=true;save.disabled=true;status.textContent="Saving located markup…";size();
  try{var result=await callDrawingTool("drawing_markup",{job_number:sc.job_number,company_id:sc.company_id,sheet:sc.sheet,source_id:sc.source.id,operation:"save",annotations:annotations});
   if(result&&result.structuredContent){remember(result,{job_number:sc.job_number,company_id:sc.company_id});if(result.structuredContent.saved!==true)status.textContent="The markup was not saved. The original is unchanged."}
   else throw new Error("Storage was not confirmed. Check the drawing library before retrying.");
  }catch(e){status.textContent=e&&e.message||"The markup could not be saved."}finally{busy=false;refresh();size()}
 },"download");
 function refresh(){var located=annotations.filter(function(a){return !!a.geometry}).length;save.disabled=busy||!host.serverTools||located===0;progress.textContent=String(located)+" of "+String(annotations.length)+" findings placed on the sheet. "+String(annotations.length-located)+(annotations.length-located===1?" remains":" remain")+" in the key only; their positions are not guessed."+(!host.serverTools?" This host has not enabled saving from cards.":located===0?" Place a pin to enable Save dated markup.":"")}
 img.addEventListener("click",function(event){if(busy)return;var box=img.getBoundingClientRect(),x=(event.clientX-box.left)/box.width,y=(event.clientY-box.top)/box.height,index=Number(select.value);
  if(!Number.isInteger(index)||!annotations[index]||!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||y>1)return;
  annotations[index].geometry={kind:"pin",point:{x:x,y:y}};surface.querySelectorAll(".drawing-pin").forEach(function(pin){pin.remove()});previewPins(surface,annotations);status.textContent="Pin placed on the sheet. Nothing saved yet.";refresh();size();
 });
 var controls=node("div",null,"tools");controls.append(select,save);body.append(node("p","Choose a finding, then tap its location on the sheet. Save creates a dated copy of the named stored source; quantities and the original stay unchanged.","note"),controls,progress);refresh();
}
function display(result){
 var sc=result&&result.structuredContent,card=sc&&sc.card;
 if(!card||typeof card.title!=="string"){app.replaceChildren(node("p","Athena could not load this drawing card. The complete reply remains in the conversation.","status"));size();return}
 currentResult=result;var shell=node("article",null,"card"),head=node("header"),body=node("main");head.append(node("p","ATHENA","brand"),node("h1",card.title));if(card.job)head.append(node("p",card.job));shell.append(head,body);
 if(Array.isArray(card.kpis)){var kpis=node("div",null,"kpis");card.kpis.forEach(function(k){var box=node("div",null,"kpi"+(alert(k.flag)?" alert":""));box.append(node("small",k.label),node("strong",k.value));kpis.append(box)});body.append(kpis)}
 if(sc.upload_context&&typeof sc.upload_context.job_number==="string"&&typeof sc.upload_context.company_id==="string")uploader(body,sc.upload_context);
 storedControls(body,sc);
 function validPicture(c){return c&&c.type==="image"&&c.mimeType==="image/png"&&typeof c.data==="string"&&c.data.length>0&&c.data.length<=12000000&&/^[A-Za-z0-9+/]*={0,2}$/.test(c.data)}
 var picture=validPicture(sc.drawing_preview)?sc.drawing_preview:Array.isArray(result.content)&&result.content.find(validPicture);
 if(picture){body.append(node("h2","Stored sheet preview"));var tools=node("div",null,"tools"),viewport=node("div",null,"preview"),surface=node("div"),img=node("img"),zoom=1;surface.style.position="relative";surface.style.width="100%";img.src="data:image/png;base64,"+picture.data;img.alt=String(sc.sheet||sc.markup&&sc.markup.sheet||"Drawing")+" · Athena stored-sheet preview";img.addEventListener("load",size);viewport.tabIndex=0;viewport.ariaLabel="Drawing preview; arrow keys pan when zoomed";surface.append(img);if(sc.saved===false)previewPins(surface,sc.drawing_annotations);viewport.append(surface);function scale(value){zoom=Math.min(3,Math.max(1,value));surface.style.width=String(zoom*100)+"%";size()}tools.append(button("Zoom in",function(){scale(zoom+.5)}),button("Zoom out",function(){scale(zoom-.5)}),button("Reset",function(){scale(1)}));body.append(tools,viewport,node("p","Zoom to inspect the sheet; pan within the preview. Supplied pins refer to the saved drawing.","note"));positionFindings(body,surface,img,sc)}
 if(Array.isArray(card.sections))card.sections.forEach(function(section){var part=node("section");if(section.heading)part.append(node("h2",section.heading));if(Array.isArray(section.rows))section.rows.forEach(function(row){var line=node("div",null,"row"+(alert(row.flag)?" alert":""));var href=safeLink(row.href,sc);if(href)line.append(button(row.cells&&row.cells[0]||"Open file",function(){openLink(href)},"download"));if(Array.isArray(row.cells))row.cells.forEach(function(cell,index){if(!href||index>0)line.append(node(index===0?"strong":"p",cell))});part.append(line)});body.append(part)});
 if(card.ask&&card.ask.prompt)body.append(node("p",card.ask.prompt));if(card.next_move)body.append(node("p",card.next_move,"note"));status.textContent="";app.replaceChildren(shell);size();
}
function receive(event){if(event.source!==window.parent)return;var m=event.data;if(!m||m.jsonrpc!=="2.0")return;
 if(!ready){if(m.id!==1||m.error||!m.result||typeof m.result!=="object")return;parentOrigin=event.origin;host=m.result.hostCapabilities||{};ready=true;send({method:"ui/notifications/initialized",params:{}});size();return}
 if(event.origin!==parentOrigin)return;
 if(m.method==null&&contextRequests.has(m.id)){contextRequests.delete(m.id);return}
 if(m.method==null&&toolRequests.has(m.id)){var task=toolRequests.get(m.id);toolRequests.delete(m.id);clearTimeout(task.timer);if(m.error||m.result&&m.result.isError)task.reject(new Error("Athena did not confirm this operation. Check the drawing library and saved versions before retrying; no older source was selected automatically."));else task.resolve(m.result);return}
 if(m.method==null&&pending.has(m.id)){pending.delete(m.id);status.textContent=m.error||m.result&&m.result.isError?"The file could not be opened. Use the private download link in the conversation.":"";size();return}
 if(m.method==="ui/notifications/tool-result")receiveResult(m.params);
 else if(m.method==="ui/notifications/tool-cancelled"){status.textContent="Athena request cancelled.";size()}
 else if(m.method==="ping"&&m.id!=null)send({id:m.id,result:{}});
 else if(m.method==="ui/resource-teardown"&&m.id!=null){send({id:m.id,result:{}});window.removeEventListener("message",receive);if(observer)observer.disconnect();pending.clear();toolRequests.forEach(function(task){clearTimeout(task.timer);task.reject(new Error("Upload view closed; storage was not confirmed."))});toolRequests.clear()}
}
window.addEventListener("message",receive);var observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(size):null;if(observer)observer.observe(document.body);
send({id:1,method:"ui/initialize",params:{protocolVersion:"2026-01-26",appInfo:{name:"Athena drawings",version:"1.0.0"},appCapabilities:{availableDisplayModes:["inline"]}}});
})();
</script></body></html>`;
}
