import client from "./file-upload-client.js?raw";
import { FILE_UPLOAD_ORIGIN } from "../file-upload-origin";

export const FILE_UPLOAD_CARD_URI = "ui://athena/file-upload-v1.html";
export const FILE_UPLOAD_CARD_MIME = "text/html;profile=mcp-app";
export const fileUploadCardMeta = { ui: { resourceUri: FILE_UPLOAD_CARD_URI } };
export const fileUploadCardResultMeta = {
  ...fileUploadCardMeta,
  "openai/outputTemplate": FILE_UPLOAD_CARD_URI,
};
export const fileUploadResourceMeta = {
  ui: { prefersBorder: true, csp: { connectDomains: [FILE_UPLOAD_ORIGIN], resourceDomains: [] } },
  "openai/widgetCSP": { connect_domains: [FILE_UPLOAD_ORIGIN], resource_domains: [] },
};
export const hasFileUploadView = (value: unknown) => {
  const sc = value as { upload_context?: unknown; upload_recovery_view?: boolean } | undefined;
  return !!sc && (!!sc.upload_context || sc.upload_recovery_view === true);
};
export function fileUploadCardHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}body{margin:0;background:#fff;color:#1f2937;font:14px/1.45 system-ui,sans-serif}article{padding:12px}header{padding:0 0 8px;border-bottom:1px solid #e5e7eb}h1{font-size:18px;margin:0;font-weight:650}h2{font-size:14px;margin:14px 0 6px}main{padding:10px 0 0}p{margin:6px 0;overflow-wrap:anywhere}strong{overflow-wrap:anywhere}.row{border-bottom:1px solid #e5e7eb;padding:8px 0;margin:0}.row p{color:#6b7280;font-size:13px}button,input{font:inherit;max-width:100%;min-height:44px}button{border:1px solid #d1d5db;border-radius:8px;padding:8px 12px;margin:6px 6px 0 0;background:#fff;color:#1f2937;cursor:pointer}button.primary{background:#2563eb;border-color:#2563eb;color:#fff}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #2563eb;outline-offset:2px}details{margin-top:12px;font-size:13px}summary{padding:8px 0;cursor:pointer;color:#4b5563}.note{color:#6b7280}#status{margin:0;padding:0 12px 12px;white-space:pre-wrap}#status[hidden]{display:none}input{display:block;margin:10px 0}
</style></head><body><div id="app" aria-live="polite">Loading your job files…</div><p id="status" role="status"></p><script>${client}</script></body></html>`;
}
