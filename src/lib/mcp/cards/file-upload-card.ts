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
*{box-sizing:border-box}body{margin:0;color:#1E3A5F;background:#FFFFFF;font:15px/1.5 system-ui,sans-serif}header{background:#1E3A5F;color:white;padding:16px;border-top:4px solid #1E5FED}h1{font-size:21px;margin:0}h2{font-size:17px}main{padding:16px}p{overflow-wrap:anywhere}.row{border:1px solid #6B7280;border-radius:8px;padding:12px;margin:10px 0}button,input{font:inherit;max-width:100%;min-height:44px}button{border:1px solid #1E5FED;border-radius:6px;padding:8px 14px;margin:5px 8px 5px 0;color:#1E3A5F;background:white;cursor:pointer}button.primary{background:#1E5FED;color:white}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible{outline:3px solid #1E5FED;outline-offset:2px}.note{color:#6B7280}#status{padding:0 16px 12px;white-space:pre-wrap}input{display:block;margin:12px 0}
</style></head><body><div id="app" aria-live="polite">Loading your job files…</div><p id="status" role="status"></p><script>${client}</script></body></html>`;
}
