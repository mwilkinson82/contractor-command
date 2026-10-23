/** Presentation-only seam after the SDK's OAuth/transport handler. Never authorizes a request. */
import {
  NATIVE_CARD_MIME,
  NATIVE_CARD_TOOLS,
  NATIVE_CARD_URI,
  nativeCardHtml,
  nativeResourceMeta,
  nativeCardMeta,
} from "./cards/native";
import { isMcpPost } from "./server-info-branding";

export const ATHENA_MCP_APPS_CAPABILITIES = {
  extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [NATIVE_CARD_MIME] } },
} as const;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
type ClientHint = { name: string; native: boolean };
type Call = { id: unknown; method: string; params: Obj; client: ClientHint | null };
type Visit = { calls: Call[]; cacheKey: string | null; userAgent: string };

function clientHint(info: unknown, caps: unknown): ClientHint | null {
  const name = obj(info)?.name;
  if (typeof name !== "string" || !name.trim()) return null;
  const ui = obj(obj(obj(caps)?.extensions)?.["io.modelcontextprotocol/ui"]);
  return { name, native: Array.isArray(ui?.mimeTypes) && ui.mimeTypes.includes(NATIVE_CARD_MIME) };
}

/** Legacy HTTP is stateless. Hints are short-lived, bounded, and scoped to a bearer fingerprint + user agent.
 * A cold worker, expired entry, token refresh or unknown client keeps the full fallback. No tokens/job data are stored. */
export class NativeClientHints {
  private readonly hints = new Map<string, { hint: ClientHint; expires: number }>();
  constructor(
    private readonly now = Date.now,
    private readonly ttl = 15 * 60_000,
    private readonly max = 128,
  ) {}
  get(key: string | null): ClientHint | null {
    if (!key) return null;
    const value = this.hints.get(key);
    if (!value || value.expires <= this.now()) {
      this.hints.delete(key);
      return null;
    }
    return value.hint;
  }
  remember(key: string | null, hint: ClientHint | null): void {
    if (!key || !hint) return;
    for (const [k, value] of this.hints) if (value.expires <= this.now()) this.hints.delete(k);
    this.hints.delete(key);
    while (this.hints.size >= this.max) this.hints.delete(this.hints.keys().next().value!);
    this.hints.set(key, { hint, expires: this.now() + this.ttl });
  }
}
export const nativeClientHints = new NativeClientHints();

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
    if (
      !["initialize", "tools/list", "resources/list", "resources/read"].includes(method) &&
      !(method === "tools/call" && NATIVE_CARD_TOOLS.has(String(params.name)))
    )
      continue;
    if (method === "resources/read" && params.uri !== NATIVE_CARD_URI) continue;
    const meta = obj(call._meta) ?? obj(params._meta);
    calls.push({
      id: call.id,
      method,
      params,
      client:
        method === "initialize"
          ? clientHint(params.clientInfo, params.capabilities)
          : clientHint(
              meta?.["io.modelcontextprotocol/clientInfo"],
              meta?.["io.modelcontextprotocol/clientCapabilities"],
            ),
    });
  }
  if (!calls.length) return null;
  const userAgent = request.headers.get("user-agent") ?? "";
  const auth = request.headers.get("authorization");
  let cacheKey: string | null = null;
  if (auth?.startsWith("Bearer ")) {
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${auth}\n${userAgent}`),
    );
    cacheKey = Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, "0")).join("");
  }
  return { calls, cacheKey, userAgent };
}

const resourceEntry = () => ({
  uri: NATIVE_CARD_URI,
  name: "athena-native-card",
  title: "Athena native card",
  mimeType: NATIVE_CARD_MIME,
  _meta: nativeResourceMeta,
});
const resourceContents = () => ({
  contents: [
    {
      uri: NATIVE_CARD_URI,
      mimeType: NATIVE_CARD_MIME,
      text: nativeCardHtml(),
      _meta: nativeResourceMeta,
    },
  ],
});

export function nativeCardPayload(
  payload: unknown,
  visit: Visit,
  hints = nativeClientHints,
): { value: unknown; changed: boolean } {
  let changed = false;
  const transform = (value: unknown): unknown => {
    const message = obj(value);
    const call = visit.calls.find((c) => c.id === message?.id);
    if (!message || !call) return value;
    const result = obj(message.result);
    const error = obj(message.error);
    const missingMethod = error?.code === -32601;
    let next: Obj | null = null;
    if (call.method === "initialize" && result?.serverInfo && !error) {
      hints.remember(visit.cacheKey, call.client);
      const caps = obj(result.capabilities) ?? {},
        extensions = obj(caps.extensions) ?? {};
      next = {
        ...result,
        capabilities: {
          ...caps,
          resources: caps.resources ?? {},
          extensions: { ...extensions, ...ATHENA_MCP_APPS_CAPABILITIES.extensions },
        },
      };
    } else if (call.method === "tools/list" && Array.isArray(result?.tools) && !error) {
      let repaired = false;
      const tools = result.tools.map((value) => {
        const tool = obj(value);
        if (!tool || !NATIVE_CARD_TOOLS.has(String(tool.name))) return value;
        const meta = obj(tool._meta) ?? {},
          ui = obj(meta.ui) ?? {};
        if (typeof ui.resourceUri === "string") return value;
        repaired = true;
        // Do not introduce, remove or alter openai/outputTemplate.
        return { ...tool, _meta: { ...meta, ui: { ...ui, ...nativeCardMeta.ui } } };
      });
      if (repaired) next = { ...result, tools };
    } else if (
      call.method === "resources/list" &&
      (Array.isArray(result?.resources) || missingMethod)
    ) {
      const resources = Array.isArray(result?.resources) ? result.resources : [];
      if (!resources.some((r) => obj(r)?.uri === NATIVE_CARD_URI))
        next = { ...(result ?? {}), resources: [...resources, resourceEntry()] };
    } else if (
      call.method === "resources/read" &&
      call.params.uri === NATIVE_CARD_URI &&
      missingMethod
    ) {
      // Some deployed SDK builds omit resource handlers. Only this static, non-personal shell is repaired,
      // after the SDK returns 200. Authentication/authorization failures and other resource URIs are untouched.
      next = resourceContents();
    } else if (call.method === "tools/call" && result && !error && result.isError !== true) {
      const client = call.client ?? hints.get(visit.cacheKey);
      const sc = obj(result.structuredContent),
        card = obj(sc?.card);
      const chatgpt = /chatgpt|openai/i.test(`${client?.name ?? ""} ${visit.userAgent}`);
      if (
        client?.native &&
        !chatgpt &&
        card?.state === "result" &&
        typeof sc?.html === "string" &&
        Array.isArray(result.content)
      ) {
        const kpis = Array.isArray(card.kpis)
          ? card.kpis
              .map((k) => {
                const row = obj(k);
                return row ? `${row.label}: ${row.value}` : "";
              })
              .filter(Boolean)
          : [];
        const summary = [
          `Athena · ${card.title ?? "Card"}${card.job ? ` · ${card.job}` : ""}`,
          ...kpis,
        ].join("\n");
        let replaced = false;
        const content = result.content.flatMap((block) => {
          if (obj(block)?.type !== "text") return [block];
          if (replaced) return [];
          replaced = true;
          return [{ ...obj(block), text: summary }];
        });
        if (replaced) next = { ...result, content };
      }
    }
    if (!next) return value;
    changed = true;
    const { error: _error, ...rest } = message;
    return { ...rest, result: next };
  };
  return { value: Array.isArray(payload) ? payload.map(transform) : transform(payload), changed };
}

/** Only finite 200 JSON/SSE responses for selected MCP methods are inspected. Errors/non-MCP traffic pass unchanged. */
export async function nativeCardResponse(
  response: Response,
  visit: Visit | null,
  hints = nativeClientHints,
): Promise<Response> {
  if (!visit || response.status !== 200 || !response.body) return response;
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!type.includes("application/json") && !type.includes("text/event-stream")) return response;
  const text = await response.clone().text();
  let changed = false;
  const transform = (raw: string) => {
    try {
      const out = nativeCardPayload(JSON.parse(raw), visit, hints);
      changed ||= out.changed;
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
  if (!changed) return response;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
