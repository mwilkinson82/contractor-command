/** Card discovery/resource presentation after the SDK. Does not authorize requests.
 *  tools/call text for lookahead_get and list_open_items drops the inline HTML document
 *  when the host did not advertise a card. structuredContent, widget template, and resource URI stay. */
import {
  NATIVE_CARD_MIME,
  NATIVE_CARD_TOOLS,
  NATIVE_CARD_URI,
  NATIVE_CARD_URIS,
  TEXT_CARD_TOOLS,
  nativeCardHtml,
  nativeResourceMeta,
  nativeCardMeta,
} from "./cards/native";
import { isMcpPost } from "./server-info-branding";
import { phoneHostText } from "./phone-reply";
import { timingFields, type CardTiming } from "./card-timing";
import { EMAIL_CARD_MIME, EMAIL_CARD_TOOLS, EMAIL_CARD_URI, emailCardHtml, emailCardMeta, emailCardResourceMeta } from "./cards/email-card";
import { outsideFencedBlocks } from "./cards/verbatim";
import { claudeCardReply } from "./cards/claude-reply";
import { drawingFileMeta } from "./drawing-file-input";

export const ATHENA_MCP_APPS_CAPABILITIES = {
  extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [NATIVE_CARD_MIME] } },
} as const;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
type Call = {
  id: unknown;
  method: string;
  params: Obj;
  modern: boolean;
  inlineHtml: boolean;
  claude: boolean;
};
type Visit = { calls: Call[]; acceptsJson?: boolean };
type Host = { name: string; capabilities: unknown };

/** Every card view: the native card (current and legacy URI) and the editable email card. */
const CARD_VIEWS: Record<string, { name: string; title: string; mimeType: string; html: () => string; meta: Record<string, unknown> }> = Object.fromEntries([
  ...[...NATIVE_CARD_URIS].map((uri) => [uri, { name: uri === NATIVE_CARD_URI ? "athena-native-card" : "athena-native-card-legacy", title: "Athena native card", mimeType: NATIVE_CARD_MIME, html: nativeCardHtml, meta: nativeResourceMeta }]),
  [EMAIL_CARD_URI, { name: "athena-email-card", title: "Athena email card", mimeType: EMAIL_CARD_MIME, html: emailCardHtml, meta: emailCardResourceMeta }],
]);
const isCardUri = (uri: unknown): uri is string => typeof uri === "string" && uri in CARD_VIEWS;
/** Tools that open on a card view, with the `_meta.ui` each advertises. */
const cardMetaFor = (name: string) => (EMAIL_CARD_TOOLS.has(name) ? emailCardMeta.ui : NATIVE_CARD_TOOLS.has(name) ? nativeCardMeta.ui : null);

/** Session id from initialize → whether that client can show a card, and whether it is Claude. Same isolate only. */
const cardSessions = new Map<string, { inlineHtml: boolean; claude: boolean }>();

function hasUiCapability(capabilities: unknown): boolean {
  const caps = obj(capabilities);
  const extensions = obj(caps?.extensions);
  const ui = obj(extensions?.["io.modelcontextprotocol/ui"]);
  if (!ui) return false;
  const types = ui.mimeTypes;
  return Array.isArray(types)
    ? types.some((type) => typeof type === "string" && type.length > 0)
    : true;
}

/** Claude gets a facts-only reply on native card tools; the card view draws the HTML. */
export function isClaudeHost(host: Host | null): boolean {
  return !!host && /claude|anthropic/i.test(host.name);
}

/** ChatGPT and Claude count as card hosts. Anyone else needs an advertised UI capability. */
export function hostInlinesCard(host: Host | null): boolean {
  if (!host) return false;
  if (/claude|chatgpt|openai/i.test(host.name)) return true;
  return hasUiCapability(host.capabilities);
}

function readHost(request: Request, params: Obj, meta: Obj | null): Host | null {
  const info = obj(params.clientInfo) ?? obj(meta?.["io.modelcontextprotocol/clientInfo"]);
  const capabilities = meta?.["io.modelcontextprotocol/clientCapabilities"] ?? params.capabilities;
  const named = typeof info?.name === "string" ? info.name : "";
  const ua = request.headers.get("user-agent") ?? "";
  const name = named || (/claude|chatgpt|openai|grok/i.test(ua) ? ua : "");
  if (!name && capabilities == null) return null;
  return { name, capabilities };
}

/** Drop the dumped HTML document from a text block. Markdown rows stay. */
export function stripInlineCardHtml(text: string): string {
  return outsideFencedBlocks(text, (part) =>
    part
      .replace(/REQUIRED VIEW: render this HTML card as-is\.[^\n]*/g, "")
      .replace(/<!doctype html[\s\S]*?<\/html>/gi, "")
      .replace(/<!doctype html[\s\S]*$/gi, "")
      .replace(/Card shown\. Do not add text(?:; wait for the user's pick)?\.?/g, "")
      .replace(/\n{3,}/g, "\n\n"),
  ).trim();
}

export async function nativeCardVisit(request: Request): Promise<Visit | null> {
  if (!isMcpPost(request)) return null;
  // Drawing uploads and unrelated large calls never enter this presentation pass.
  if (Number(request.headers.get("content-length") ?? 0) > 65_536) return null;
  let body: unknown;
  try {
    const raw = await request.clone().text();
    if (raw.length > 65_536) return null;
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  const calls: Call[] = [];
  for (const value of Array.isArray(body) ? body : [body]) {
    const call = obj(value),
      params = obj(call?.params) ?? {};
    if (!call || call.id == null || typeof call.method !== "string") continue;
    const method = call.method;
    if (method === "tools/call" && !cardMetaFor(String(params.name ?? ""))) continue;
    if (
      ![
        "initialize",
        "server/discover",
        "tools/list",
        "tools/call",
        "resources/list",
        "resources/templates/list",
        "resources/read",
      ].includes(method)
    )
      continue;
    if (method === "resources/read" && !isCardUri(params.uri)) continue;
    const meta = obj(call._meta) ?? obj(params._meta);
    const host = readHost(request, params, meta);
    const session = request.headers.get("mcp-session-id");
    const remembered = session ? cardSessions.get(session) : undefined;
    calls.push({
      id: call.id,
      method,
      params,
      inlineHtml: remembered?.inlineHtml ?? hostInlinesCard(host),
      claude: remembered?.claude ?? isClaudeHost(host),
      modern:
        String(
          meta?.["io.modelcontextprotocol/protocolVersion"] ??
            request.headers.get("MCP-Protocol-Version") ??
            "",
        ) >= "2026-07-28",
    });
  }
  if (!calls.length) return null;
  return { calls, acceptsJson: acceptsJson(request.headers.get("accept")) };
}

// Do not switch a stream-only client to JSON, including an explicit q=0 refusal.
function acceptsJson(accept: string | null): boolean {
  if (!accept) return false;
  const entries = accept.split(",").map((part) => {
    const [type, ...params] = part.trim().toLowerCase().split(";");
    const quality = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
    const q = quality == null ? 1 : Number(quality.slice(2));
    return { type: type.trim(), q: Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0 };
  });
  for (const type of ["application/json", "application/*", "*/*"]) {
    const matches = entries.filter((entry) => entry.type === type);
    if (matches.length) return matches.some((entry) => entry.q > 0);
  }
  return false;
}

/** Listed views: the current native card and the email card (the legacy URI stays readable, not listed). */
const LISTED_VIEWS = [NATIVE_CARD_URI, EMAIL_CARD_URI];
const resourceEntry = (uri: string) => {
  const view = CARD_VIEWS[uri];
  return { uri, name: view.name, title: view.title, mimeType: view.mimeType, _meta: view.meta };
};
const resourceContents = (uri: string) => {
  const view = CARD_VIEWS[uri];
  return { contents: [{ uri, mimeType: view.mimeType, text: view.html(), _meta: view.meta }] };
};

export function nativeCardPayload(
  payload: unknown,
  visit: Visit | null,
): { value: unknown; changed: boolean } {
  if (!visit) return { value: payload, changed: false };
  let changed = false;
  const transform = (value: unknown): unknown => {
    const message = obj(value);
    const call = visit.calls.find((c) => c.id === message?.id);
    if (!message || !call) return value;
    const result = obj(message.result);
    const error = obj(message.error);
    const missingMethod = error?.code === -32601;
    let next: Obj | null = null;
    if (
      ((call.method === "initialize" && result?.serverInfo) ||
        (call.method === "server/discover" && Array.isArray(result?.supportedVersions))) &&
      !error
    ) {
      const caps = obj(result.capabilities) ?? {},
        extensions = obj(caps.extensions) ?? {};
      next = {
        ...result,
        capabilities: {
          ...caps,
          resources: caps.resources ?? (call.modern ? { listChanged: false } : {}),
          extensions: { ...extensions, ...ATHENA_MCP_APPS_CAPABILITIES.extensions },
        },
      };
    } else if (call.method === "tools/list" && Array.isArray(result?.tools) && !error) {
      let repaired = false;
      const tools = result.tools.map((value) => {
        const tool = obj(value);
        if (!tool) return value;
        const name = String(tool.name);
        const cardUi = cardMetaFor(name);
        const meta = obj(tool._meta) ?? {},
          ui = obj(meta.ui) ?? {};
        const fileMeta = drawingFileMeta(name);
        const repairFile = Object.keys(fileMeta).length > 0 &&
          JSON.stringify(meta["openai/fileParams"]) !== JSON.stringify(fileMeta["openai/fileParams"]);
        const repairUi = !!cardUi && typeof ui.resourceUri !== "string";
        if (!repairFile && !repairUi) return value;
        repaired = true;
        // Do not introduce, remove or alter openai/outputTemplate.
        return { ...tool, _meta: { ...meta, ...fileMeta, ...(repairUi ? { ui: { ...ui, ...cardUi } } : {}) } };
      });
      if (repaired) next = { ...result, tools };
    } else if (
      call.method === "resources/list" &&
      ((!error && Array.isArray(result?.resources)) || missingMethod)
    ) {
      const resources = Array.isArray(result?.resources) ? result.resources : [];
      const missing = LISTED_VIEWS.filter((uri) => !resources.some((r) => obj(r)?.uri === uri));
      if (missing.length) next = { ...(result ?? {}), resources: [...resources, ...missing.map(resourceEntry)] };
    } else if (call.method === "resources/templates/list" && missingMethod) {
      next = { resourceTemplates: [] };
    } else if (
      call.method === "tools/call" &&
      result &&
      result.isError !== true &&
      call.claude &&
      cardMetaFor(String(call.params.name ?? ""))
    ) {
      next = claudeCardReply(result);
    } else if (
      call.method === "tools/call" &&
      result &&
      result.isError !== true &&
      !call.inlineHtml &&
      TEXT_CARD_TOOLS.has(String(call.params.name ?? "")) &&
      Array.isArray(result.content)
    ) {
      let edited = false;
      let wrotePhone = false;
      const phone = phoneHostText(String(call.params.name ?? ""), obj(result.structuredContent));
      const content = result.content.map((block) => {
        const row = obj(block);
        if (!row || row.type !== "text" || typeof row.text !== "string") return block;
        if (phone && !wrotePhone) {
          wrotePhone = true;
          edited = true;
          return { ...row, text: phone };
        }
        if (!/<!doctype html/i.test(row.text)) return block;
        edited = true;
        return { ...row, text: stripInlineCardHtml(row.text) };
      });
      if (edited) next = { ...result, content };
    } else if (
      call.method === "resources/read" &&
      isCardUri(call.params.uri) &&
      missingMethod
    ) {
      // Some deployed SDK builds omit resource handlers. Only this static, non-personal shell is repaired,
      // after the SDK returns a method-not-found reply. Auth failures and other resource URIs are untouched.
      next = resourceContents(String(call.params.uri));
    }
    if (!next) return value;
    // The SDK's modern codec normally stamps these fields. Synthetic resource replies
    // are created after that codec, so they must satisfy the same wire contract here.
    if (
      call.modern &&
      ["resources/list", "resources/templates/list", "resources/read"].includes(call.method)
    ) {
      next = { resultType: "complete", ttlMs: 0, cacheScope: "private", ...next };
    }
    changed = true;
    const { error: _error, ...rest } = message;
    return { ...rest, result: next };
  };
  return { value: Array.isArray(payload) ? payload.map(transform) : transform(payload), changed };
}

/** Inspect finite selected replies. Only the SDK's exact static-resource method miss can turn 404 into 200. */
function rememberCardSession(response: Response, visit: Visit | null) {
  const id = response.headers.get("mcp-session-id");
  const init = visit?.calls.find((call) => call.method === "initialize");
  if (id && init) cardSessions.set(id, { inlineHtml: init.inlineHtml, claude: init.claude });
}

export async function nativeCardResponse(
  response: Response,
  visit: Visit | null,
  timing?: CardTiming,
): Promise<Response> {
  rememberCardSession(response, visit);
  if (!visit) return response;
  const only = visit.calls.length === 1 ? visit.calls[0] : null;
  const cardRead = only?.method === "resources/read" ? only : null;
  const cardCall = only?.method === "tools/call" ? only : null;
  // Static shell diagnostics only: never log headers, identifiers, HTML or tool data.
  const trace = (outcome: string, status = response.status, format?: string) => {
    if (cardRead)
      console.info("[athena] card.resource", {
        protocol: cardRead.modern ? "modern" : "legacy",
        sdkStatus: response.status,
        status,
        outcome,
        ...(format ? { format } : {}),
        ...timingFields(timing),
      });
  };
  // A native card tool call: the tool name is static; the host kind says which reply shape it got.
  if (cardCall)
    console.info("[athena] card.call", {
      tool: String(cardCall.params.name ?? ""),
      protocol: cardCall.modern ? "modern" : "legacy",
      host: cardCall.claude ? "claude" : cardCall.inlineHtml ? "card-host" : "text-host",
      status: response.status,
      ...timingFields(timing),
    });
  const resourceMiss =
    response.status === 404 &&
    visit.calls.length === 1 &&
    ["resources/list", "resources/templates/list", "resources/read"].includes(
      visit.calls[0].method,
    );
  if (response.status !== 200 && !resourceMiss) {
    trace("sdk-rejected");
    return response;
  }
  if (!response.body) {
    trace("empty-response");
    return response;
  }
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!type.includes("application/json") && !type.includes("text/event-stream")) {
    trace("unsupported-response");
    return response;
  }
  const text = await response.clone().text();
  let changed = false;
  let dataMessages = 0;
  let staticReply: Obj | null = null;
  const transform = (raw: string) => {
    dataMessages++;
    try {
      const payload = JSON.parse(raw);
      if (resourceMiss && obj(obj(payload)?.error)?.code !== -32601) return raw;
      const out = nativeCardPayload(payload, visit);
      changed ||= out.changed;
      const message = obj(out.value);
      const result = obj(message?.result);
      const contents = result?.contents;
      if (
        cardRead &&
        message &&
        message.id === cardRead.id &&
        !message.error &&
        Array.isArray(contents) &&
        contents.length === 1
      ) {
        const content = obj(contents[0]);
        if (
          content &&
          content.uri === cardRead.params.uri &&
          content.mimeType === NATIVE_CARD_MIME &&
          typeof content.text === "string"
        )
          staticReply = message;
      }
      return out.changed ? JSON.stringify(out.value) : raw;
    } catch {
      return raw;
    }
  };
  const body = type.includes("application/json")
    ? transform(text)
    : text
        .split(/(\r?\n)/)
        .map((line) =>
          line.startsWith("data:") ? `data: ${transform(line.slice(5).trimStart())}` : line,
        )
        .join("");
  // Resource reads are finite RPC replies, not subscriptions. On the legacy SDK
  // path the repaired shell used to inherit the SDK's SSE/keep-alive envelope.
  // Prefer a single JSON response when negotiated; preserve SSE-only clients.
  const jsonCard = staticReply && dataMessages === 1 && visit.acceptsJson;
  if (!changed && !staticReply) {
    trace("no-static-card");
    return response;
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  if (staticReply) headers.set("cache-control", "no-store");
  if (jsonCard) {
    headers.set("content-type", "application/json");
    headers.delete("connection");
    headers.delete("x-accel-buffering");
  }
  trace(
    staticReply ? "served" : "no-static-card",
    resourceMiss ? 200 : response.status,
    jsonCard || type.includes("application/json") ? "json" : "sse",
  );
  return new Response(jsonCard ? JSON.stringify(staticReply) : body, {
    status: resourceMiss ? 200 : response.status,
    statusText: resourceMiss ? "OK" : response.statusText,
    headers,
  });
}
