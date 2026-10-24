import {
  TAKEOFF_CARD_URI,
  TAKEOFF_CARD_URIS,
  TAKEOFF_CARD_MIME,
  TAKEOFF_CARD_TOOLS,
  takeoffCardHtml,
  takeoffCardMeta,
  takeoffResourceMeta,
} from "./cards/takeoff-card";
// ChatGPT reads openai/outputTemplate from the tool result _meta. @lovable.dev/mcp-js
// drops that field before the MCP server sees the handler return, so this bridge
// puts it back on the meeting tools and getting_started, and registers the card widget resource.
import { McpServer } from "@modelcontextprotocol/server";
import { CARD_TOOLS } from "./cards/attach";
import { drawingFileMeta } from "./drawing-file-input";
import {
  NATIVE_CARD_URIS,
  NATIVE_CARD_MIME,
  NATIVE_CARD_TOOLS,
  nativeCardHtml,
  nativeCardMeta,
  nativeResourceMeta,
} from "./cards/native";
import { CARD_WIDGET_MIME, CARD_WIDGET_URI, cardWidgetHtml, cardWidgetMeta } from "./cards/widget";
import {
  EMAIL_CARD_MIME,
  EMAIL_CARD_TOOLS,
  EMAIL_CARD_URI,
  emailCardHtml,
  emailCardMeta,
  emailCardResourceMeta,
} from "./cards/email-card";
import {
  DRAWING_CARD_MIME,
  DRAWING_CARD_TOOLS,
  DRAWING_CARD_URI,
  DRAWING_CARD_URIS,
  drawingCardHtml,
  drawingCardMeta,
  drawingCardResultMeta,
  drawingResourceMeta,
} from "./cards/drawing-card";

const MEETINGS = new Set([
  "pm_meeting",
  "pm_morning",
  "pm_evening",
  "athena_morning_hitlist",
  "athena_hello",
  "morning_brief",
  "morning_brief_settings",
]);
const CARD_WIDGET_TOOLS = new Set<string>([...CARD_TOOLS, "lookahead_list"]);
const TEMPLATE = { ...cardWidgetMeta };
const patched = Symbol.for("athena.cardWidgetBridge");

type RegisterTool = (
  name: string,
  config: { _meta?: Record<string, unknown> },
  cb: (...args: unknown[]) => Promise<Record<string, unknown>>,
) => unknown;

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

/** The full-page preview is for the app, not a base64 text document for the model.
 * Keep the actual image content blocks and all factual measurement/checkpoint data. */
export function boundTakeoffResult(result: Record<string, unknown>): Record<string, unknown> {
  const original = result.structuredContent as Record<string, unknown> | undefined;
  if (!original?.engine || typeof original.preview !== "string") return result;
  const structuredContent = { ...original };
  delete structuredContent.preview;
  return {
    ...result,
    structuredContent,
    _meta: {
      ...(result._meta as Record<string, unknown> | undefined),
      "athena/takeoffView": { preview: original.preview },
    },
  };
}

const proto = McpServer.prototype as unknown as {
  [patched]?: boolean;
  registerTool: RegisterTool;
  registerResource?: (
    name: string,
    uri: string,
    config: Record<string, unknown>,
    read: () => Promise<unknown>,
  ) => unknown;
};

if (!proto[patched]) {
  proto[patched] = true;
  const orig = proto.registerTool;
  proto.registerTool = function (
    this: {
      registerResource?: (
        name: string,
        uri: string,
        config: Record<string, unknown>,
        read: () => Promise<unknown>,
      ) => unknown;
    },
    name,
    config,
    cb,
  ) {
    const registered = (this as { _registeredResources?: Record<string, unknown> })
      ._registeredResources;
    const already = !!registered?.[CARD_WIDGET_URI];
    if (
      !already &&
      typeof this.registerResource === "function" &&
      !(this as { _athenaCard?: boolean })._athenaCard
    ) {
      (this as { _athenaCard?: boolean })._athenaCard = true;
      try {
        this.registerResource(
          "athena-card",
          CARD_WIDGET_URI,
          { title: "Athena card", mimeType: CARD_WIDGET_MIME },
          async () => ({
            contents: [
              { uri: CARD_WIDGET_URI, mimeType: CARD_WIDGET_MIME, text: cardWidgetHtml() },
            ],
          }),
        );
      } catch {
        // A second server in the same process already registered this uri.
      }
    }
    if (
      NATIVE_CARD_TOOLS.has(name) &&
      typeof this.registerResource === "function" &&
      !(this as { _athenaNativeCard?: boolean })._athenaNativeCard
    ) {
      // A distinct resource, not a replacement for ChatGPT's skybridge widget.
      for (const uri of NATIVE_CARD_URIS) {
        this.registerResource(
          `athena-native-card-${uri === nativeCardMeta.ui.resourceUri ? "current" : "legacy"}`,
          uri,
          { title: "Athena native card", mimeType: NATIVE_CARD_MIME, _meta: nativeResourceMeta },
          async () => ({
            contents: [
              {
                uri,
                mimeType: NATIVE_CARD_MIME,
                text: nativeCardHtml(),
                _meta: nativeResourceMeta,
              },
            ],
          }),
        );
      }
      (this as { _athenaNativeCard?: boolean })._athenaNativeCard = true;
    }
    if (
      EMAIL_CARD_TOOLS.has(name) &&
      typeof this.registerResource === "function" &&
      !(this as { _athenaEmailCard?: boolean })._athenaEmailCard
    ) {
      // The editable email card: its own resource, same MCP Apps profile as the native card.
      this.registerResource(
        "athena-email-card",
        EMAIL_CARD_URI,
        { title: "Athena email card", mimeType: EMAIL_CARD_MIME, _meta: emailCardResourceMeta },
        async () => ({
          contents: [
            {
              uri: EMAIL_CARD_URI,
              mimeType: EMAIL_CARD_MIME,
              text: emailCardHtml(),
              _meta: emailCardResourceMeta,
            },
          ],
        }),
      );
      (this as { _athenaEmailCard?: boolean })._athenaEmailCard = true;
    }
    if (
      DRAWING_CARD_TOOLS.has(name) &&
      typeof this.registerResource === "function" &&
      !(this as { _athenaDrawingCard?: boolean })._athenaDrawingCard
    ) {
      for (const uri of DRAWING_CARD_URIS)
        this.registerResource(
          uri === DRAWING_CARD_URI ? "athena-drawing-card" : "athena-drawing-card-legacy",
          uri,
          { title: "Athena drawing card", mimeType: DRAWING_CARD_MIME, _meta: drawingResourceMeta },
          async () => ({
            contents: [
              {
                uri,
                mimeType: DRAWING_CARD_MIME,
                text: drawingCardHtml(),
                _meta: drawingResourceMeta,
              },
            ],
          }),
        );
      (this as { _athenaDrawingCard?: boolean })._athenaDrawingCard = true;
    }
    if (
      TAKEOFF_CARD_TOOLS.has(name) &&
      typeof this.registerResource === "function" &&
      !(this as { _athenaTakeoffCard?: boolean })._athenaTakeoffCard
    ) {
      for (const uri of TAKEOFF_CARD_URIS)
        this.registerResource(
          uri === TAKEOFF_CARD_URI ? "athena-takeoff" : "athena-takeoff-legacy",
          uri,
          {
            title: "Athena drawing takeoff",
            mimeType: TAKEOFF_CARD_MIME,
            _meta: takeoffResourceMeta,
          },
          async () => ({
            contents: [
              {
                uri,
                mimeType: TAKEOFF_CARD_MIME,
                text: takeoffCardHtml(),
                _meta: takeoffResourceMeta,
              },
            ],
          }),
        );
      (this as { _athenaTakeoffCard?: boolean })._athenaTakeoffCard = true;
    }
    // openai/outputTemplate on tools/list makes ChatGPT
    // treat the tool as a widget, skip the styled card text, and hide the Athena icon.
    const fileMeta = drawingFileMeta(name);
    // The email view retains precedence for submittal_delivery.
    const cardMeta = TAKEOFF_CARD_TOOLS.has(name)
      ? takeoffCardMeta
      : DRAWING_CARD_TOOLS.has(name)
        ? drawingCardMeta
        : EMAIL_CARD_TOOLS.has(name)
          ? emailCardMeta
          : NATIVE_CARD_TOOLS.has(name)
            ? nativeCardMeta
            : {};
    const next =
      Object.keys(fileMeta).length || Object.keys(cardMeta).length
        ? { ...config, _meta: { ...config._meta, ...fileMeta, ...cardMeta } }
        : config;
    const wrapped = async (...args: unknown[]) => {
      const result = (await cb(...args)) ?? {};
      if (
        TAKEOFF_CARD_TOOLS.has(name) &&
        (result.structuredContent as Record<string, unknown> | undefined)?.engine
      ) {
        const bounded = boundTakeoffResult(result);
        return {
          ...bounded,
          _meta: {
            ...(bounded._meta ?? {}),
            ...takeoffCardMeta,
            "openai/outputTemplate": TAKEOFF_CARD_URI,
          },
        };
      }
      if (!CARD_WIDGET_TOOLS.has(name)) return result;
      if (
        name === "living_report_get" &&
        (result.structuredContent as Record<string, unknown> | undefined)?.report_type !==
          "billing_forecast"
      )
        return result;
      const safe = MEETINGS.has(name) ? boundMeetingResult(result) : result;
      return {
        ...safe,
        _meta: {
          ...(safe._meta ?? {}),
          ...(DRAWING_CARD_TOOLS.has(name) ? drawingCardResultMeta : TEMPLATE),
        },
      };
    };
    return orig.call(this, name, next, wrapped);
  };
}
