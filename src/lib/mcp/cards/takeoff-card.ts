import takeoffClient from "./takeoff-client.js?raw";
/** Self-contained MCP Apps measurement viewer. No fetch, external scripts or model display commands. */
export const TAKEOFF_CARD_URI = "ui://athena/takeoff-v3.html";
export const TAKEOFF_CARD_URIS = new Set([
  TAKEOFF_CARD_URI,
  "ui://athena/takeoff-v2.html",
  "ui://athena/takeoff-v1.html",
]);
export const TAKEOFF_CARD_MIME = "text/html;profile=mcp-app";
export const TAKEOFF_CARD_TOOLS = new Set([
  "sheet_calibrate",
  "takeoff_geometry",
  "estimate_takeoff_get",
  "estimate_takeoff_save",
  "estimate_status",
  "estimate_item_mark",
  "estimate_build",
  "estimate_takeoff_export",
  "estimate_bid_summary",
]);
export const takeoffCardMeta = { ui: { resourceUri: TAKEOFF_CARD_URI } };
export const takeoffResourceMeta = {
  ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
  "openai/widgetPrefersBorder": true,
  "openai/ui": { availableDisplayModes: ["inline", "fullscreen"], preferredDisplayMode: "inline" },
};
export function takeoffCardHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{font:14px/1.45 system-ui,sans-serif;color:#1E3A5F;background:white}*{box-sizing:border-box}p,strong{overflow-wrap:anywhere}body{margin:0}header{background:#1E3A5F;border-top:4px solid #1E5FED;color:white;padding:16px}h1{font-size:20px;margin:4px 0}h2{font-size:16px}p{margin:6px 0}.brand{font-size:11px;letter-spacing:.14em}main{padding:14px}.layout{display:grid;grid-template-columns:minmax(0,2fr) minmax(250px,1fr);gap:14px}.tools{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:8px 0}button,select,input,textarea{font:inherit;border:1px solid #6B7280;border-radius:6px;padding:8px;background:white;color:#1E3A5F;max-width:100%}button{cursor:pointer}button.primary{background:#1E5FED;color:white;border-color:#1E5FED}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #1E5FED;outline-offset:2px}.viewport{overflow:auto;max-height:620px;border:1px solid #6B7280;background:rgba(107,114,128,.08);touch-action:pan-x pan-y}.surface{position:relative;width:100%;min-width:100%}.surface>img{display:block;width:100%;height:auto}.surface>svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.row{border:1px solid #6B7280;border-radius:8px;padding:10px;margin:7px 0;overflow-wrap:anywhere}.selected{border:2px solid #1E5FED}.risk{border-color:#DC2626;color:#DC2626}.accepted{color:#1E5FED}.proposed,.note{color:#6B7280}.small{font-size:12px}.status{padding:8px 14px;white-space:pre-wrap}.confirmation{border:2px solid #1E5FED;padding:12px;border-radius:8px;margin:10px 0}.crop{width:160px;height:160px;object-fit:contain;border:1px solid #6B7280}.list{max-height:720px;overflow:auto}.drawer textarea{display:block;width:100%;min-height:70px}label{display:block}.kpis{display:flex;flex-wrap:wrap;gap:12px}.kpis strong{display:block;color:#1E5FED;font-size:21px}.kpis>div{border:1px solid #6B7280;border-radius:6px;padding:8px;flex:1;min-width:110px}@media(max-width:767px){.layout{display:block}.list{max-height:none}.viewport{max-height:450px}.desktop{display:none}.tools button{min-height:42px}.kpis>div{min-width:90px}.surface{touch-action:pan-x pan-y}}@media(prefers-color-scheme:dark){:root{color-scheme:light}}
</style></head><body><div id="app"><p class="status">Loading your drawing takeoff…</p></div><p id="status" class="status" role="status" aria-live="polite"></p><script>${takeoffClient}</script></body></html>`;
}
