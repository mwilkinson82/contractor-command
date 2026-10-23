// ChatGPT reads openai/outputTemplate from the tool result _meta. @lovable.dev/mcp-js
// drops that field before the MCP server sees the handler return, so this bridge
// puts it back on the meeting tools and getting_started, and registers the card widget resource.
import { McpServer } from "@modelcontextprotocol/server";
import { CARD_TOOLS } from "./cards/attach";
import { drawingFileMeta } from "./drawing-file-input";
import { NATIVE_CARD_URIS, NATIVE_CARD_MIME, NATIVE_CARD_TOOLS, nativeCardHtml, nativeCardMeta, nativeResourceMeta } from "./cards/native";
import { CARD_WIDGET_MIME, CARD_WIDGET_URI, cardWidgetHtml, cardWidgetMeta } from "./cards/widget";

const MEETINGS = new Set(["pm_meeting", "pm_morning", "pm_evening", "athena_morning_hitlist", "athena_hello", "morning_brief", "morning_brief_settings"]);
const CARD_WIDGET_TOOLS = new Set<string>([...CARD_TOOLS, "lookahead_list"]);
const TEMPLATE = { ...cardWidgetMeta };
const patched = Symbol.for("athena.cardWidgetBridge");

type RegisterTool = (name: string, config: { _meta?: Record<string, unknown> }, cb: (...args: unknown[]) => Promise<Record<string, unknown>>) => unknown;

/** Keep a meeting reply one card. Drop a nested widget script so the host does not repaint forever. */
export function boundMeetingResult(result: Record<string, unknown>): Record<string, unknown> {
  const sc = { ...((result.structuredContent as Record<string, unknown> | undefined) ?? {}) };
  if (sc.card && typeof sc.card === "object") {
    const card = { ...(sc.card as Record<string, unknown>) };
    delete card.html;
    delete card.card;
    sc.card = card;
  }
  if (typeof sc.html === "string") sc.html = sc.html.replace(/<script[\s\S]*?<\/script>/gi, "");
  const content = Array.isArray(result.content) ? result.content : [];
  let sawResource = false;
  const nextContent = content.filter((block) => {
    const row = block as { type?: string };
    if (row.type !== "resource") return true;
    if (sawResource) return false;
    sawResource = true;
    return true;
  });
  const out: Record<string, unknown> = { ...result, structuredContent: sc, content: nextContent };
  try {
    if (JSON.stringify(out).length > 120_000) {
      delete sc.html;
      out.structuredContent = sc;
    }
  } catch {
    delete sc.html;
    out.structuredContent = sc;
  }
  return out;
}

const proto = McpServer.prototype as unknown as { [patched]?: boolean; registerTool: RegisterTool; registerResource?: (name: string, uri: string, config: Record<string, unknown>, read: () => Promise<unknown>) => unknown };

if (!proto[patched]) {
  proto[patched] = true;
  const orig = proto.registerTool;
  proto.registerTool = function (this: { registerResource?: (name: string, uri: string, config: Record<string, unknown>, read: () => Promise<unknown>) => unknown }, name, config, cb) {
    const registered = (this as { _registeredResources?: Record<string, unknown> })._registeredResources;
    const already = !!registered?.[CARD_WIDGET_URI];
    if (!already && typeof this.registerResource === "function" && !(this as { _athenaCard?: boolean })._athenaCard) {
      (this as { _athenaCard?: boolean })._athenaCard = true;
      try {
        this.registerResource("athena-card", CARD_WIDGET_URI, { title: "Athena card", mimeType: CARD_WIDGET_MIME }, async () => ({
          contents: [{ uri: CARD_WIDGET_URI, mimeType: CARD_WIDGET_MIME, text: cardWidgetHtml() }],
        }));
      } catch {
        // A second server in the same process already registered this uri.
      }
    }
    if (NATIVE_CARD_TOOLS.has(name) && typeof this.registerResource === "function" && !(this as { _athenaNativeCard?: boolean })._athenaNativeCard) {
      // A distinct resource, not a replacement for ChatGPT's skybridge widget.
      for (const uri of NATIVE_CARD_URIS) {
        this.registerResource(`athena-native-card-${uri === nativeCardMeta.ui.resourceUri ? "current" : "legacy"}`, uri, { title: "Athena native card", mimeType: NATIVE_CARD_MIME, _meta: nativeResourceMeta }, async () => ({
          contents: [{ uri, mimeType: NATIVE_CARD_MIME, text: nativeCardHtml(), _meta: nativeResourceMeta }],
        }));
      }
      (this as { _athenaNativeCard?: boolean })._athenaNativeCard = true;
    }
    // openai/outputTemplate on tools/list makes ChatGPT
    // treat the tool as a widget, skip the styled card text, and hide the Athena icon.
    const fileMeta = drawingFileMeta(name);
    const next = NATIVE_CARD_TOOLS.has(name) || Object.keys(fileMeta).length
      ? { ...config, _meta: { ...config._meta, ...fileMeta, ...(NATIVE_CARD_TOOLS.has(name) ? nativeCardMeta : {}) } }
      : config;
    const wrapped = async (...args: unknown[]) => {
      const result = (await cb(...args)) ?? {};
      if (!CARD_WIDGET_TOOLS.has(name)) return result;
      if (name === "living_report_get" && (result.structuredContent as Record<string, unknown> | undefined)?.report_type !== "billing_forecast") return result;
      const safe = MEETINGS.has(name) ? boundMeetingResult(result) : result;
      return { ...safe, _meta: { ...(safe._meta ?? {}), ...TEMPLATE } };
    };
    return orig.call(this, name, next, wrapped);
  };
}
