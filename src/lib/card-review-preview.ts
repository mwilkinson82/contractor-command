// QA branch only. This page has no authenticated client, database or email provider.
// The documents below come directly from the unchanged release-candidate renderers.
import { emailCardHtml } from "./mcp/cards/email-card";
import { nativeCardHtml } from "./mcp/cards/native";
import { renderHtml } from "./mcp/cards/html";
import { sovCard } from "./mcp/cards/structured";

export const CARD_REVIEW_SOURCE = "382d9c16848612450b12dfd1755a9a411b5282c7";
const savedUrl = "https://app.meetathena.io/r/job/00000000-0000-4000-8000-000000000801/payment-applications?application_id=00000000-0000-4000-8000-000000000802&version=3";
const draft = {
  to: "sam@example.invalid",
  cc: [],
  subject: "November payment application",
  body: `Please review the November payment application.\n\nView the saved application:\n${savedUrl}\n\nDownload the PDF:\n${savedUrl}&download=pdf\n\nThank you.`,
  attachment: "November-payment-application-v3.pdf",
  link: null,
};
const sov = sovCard({
  job: "1234 · Example project",
  rows: [
    { item_no: "01", cost_code: "01-100", division: "01", division_title: "General", description: "Project management", scheduled_value_display: "$30,000.00", pct_of_total: 30 },
    { item_no: "02", cost_code: "26-100", division: "26", division_title: "Electrical", description: "Rough-in, equipment and distribution", scheduled_value_display: "$70,000.00", pct_of_total: 70 },
  ],
  divisions: [], fee: null, totalDisplay: "$100,000.00", basis: "Recorded contract",
  audience: "internal", view: "lines",
});

export function cardReviewFixtures() {
  const sovHtml = renderHtml(sov);
  return {
    source: CARD_REVIEW_SOURCE,
    documents: { email: emailCardHtml(), sov: sovHtml, native: nativeCardHtml() },
    results: {
      email: { structuredContent: {
        draft, draft_key: "SYNTHETIC_ONLY", send_allowed: true,
        document_email: { id: "SYNTHETIC_ONLY", review_hash: "SYNTHETIC_ONLY", version: 3,
          from: "member@example.invalid", state: "reviewed", mailbox: { mode: "pinned" } },
      } },
      fallback: { structuredContent: {
        draft: { ...draft, attachment: null, link: `${savedUrl}&download=pdf` },
        draft_key: "SYNTHETIC_ONLY", send_allowed: true,
        link_fallback: { reason: "member_requested_link" },
      } },
      native: { structuredContent: { html: sovHtml } },
    },
  };
}

// Minimal MCP Apps host. It acknowledges initialization and reports frame height,
// but rejects every action. No real host or server tool is connected.
export const CARD_REVIEW_HOST_SCRIPT = `(function(){
"use strict";
var data=JSON.parse(document.getElementById("review-data").textContent);
var frame=document.getElementById("card"), surface=document.getElementById("surface"), width=document.getElementById("width"), stage=document.getElementById("stage"), status=document.getElementById("status");
function note(text){status.textContent=text}
function paint(){stage.style.width=width.value+"px";frame.style.height="1000px";note("Ready. Synthetic data; no backend, email or file operation is connected.");frame.srcdoc=surface.value==="sov"?data.documents.sov:surface.value==="native"?data.documents.native:data.documents.email}
window.addEventListener("message",function(event){
  if(event.source!==frame.contentWindow||surface.value==="sov")return;
  var m=event.data;if(!m||m.jsonrpc!=="2.0")return;
  function reply(result){frame.contentWindow.postMessage({jsonrpc:"2.0",id:m.id,result:result},"*")}
  if(m.method==="ui/initialize")reply({protocolVersion:"2026-01-26",hostInfo:{name:"synthetic-card-review",version:"1"},hostCapabilities:{serverTools:{},message:{}},hostContext:{theme:"light",displayMode:"inline"}});
  else if(m.method==="ui/notifications/initialized")frame.contentWindow.postMessage({jsonrpc:"2.0",method:"ui/notifications/tool-result",params:data.results[surface.value]},"*");
  else if(m.method==="ui/notifications/size-changed"&&m.params&&Number.isFinite(m.params.height))frame.style.height=Math.min(4000,Math.max(100,m.params.height+2))+"px";
  else if(m.id!=null){note("Intercepted "+String(m.method)+". Nothing was sent, opened or saved.");reply({isError:true,content:[{type:"text",text:"Synthetic review only. Sending, opening links and data operations are disabled."}]})}
});
surface.addEventListener("change",paint);width.addEventListener("change",paint);
document.getElementById("source").textContent="Renderer candidate "+data.source;
paint();
})();`;

export function syntheticCardReviewHtml(): string {
  // Escape '<' to prevent the embedded renderer's script tags closing this data block.
  const data = JSON.stringify(cardReviewFixtures()).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Athena email and SOV · synthetic review</title>
<style>body{margin:0;background:#f7f7f7;color:#202123;font:14px/1.5 system-ui,sans-serif}main{padding:16px}nav{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}select{font:inherit;padding:7px 12px;background:white;border:1px solid #ccc;border-radius:8px;max-width:100%}label{display:flex;flex-wrap:wrap;gap:8px;align-items:center;min-width:0}iframe{display:block;width:100%;height:1000px;border:0}#stage{max-width:100%;margin:12px auto}#source,#status{overflow-wrap:anywhere}h1{font-size:18px;margin:0}p{margin:6px 0}select:focus-visible{outline:2px solid #333;outline-offset:2px}</style></head>
<body><main><h1>Athena card acceptance</h1><p>Synthetic preview. Approval and link actions are intercepted. No email or live data operation is available.</p><p id="source"></p>
<nav aria-label="Review controls"><label>Card <select id="surface"><option value="email">Email PDF attachment review</option><option value="fallback">Email link-only fallback</option><option value="sov">Schedule of values · HTML</option><option value="native">Schedule of values · MCP Apps</option></select></label><label>Width <select id="width"><option value="600">600 px split pane</option><option value="375">375 px mobile</option><option value="800">800 px desktop</option></select></label></nav>
<p id="status" role="status" aria-live="polite"></p><div id="stage"><iframe title="Athena card under review" id="card" sandbox="allow-scripts"></iframe></div></main>
<script id="review-data" type="application/json">${data}</script><script>${CARD_REVIEW_HOST_SCRIPT}</script></body></html>`;
}

export function syntheticCardReviewResponse(): Response {
  return new Response(syntheticCardReviewHtml(), { headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow, noarchive",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self' about:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self' https://lovable.dev https://*.lovable.dev",
  } });
}
