// Adds the MCP Apps card view to the MCP endpoint without changing auth or the toolkit.
// The toolkit (@lovable.dev/mcp-js) has no resources or tool _meta, so after the handler has run:
//  - initialize: advertise the resources capability;
//  - tools/list: add contract_terms' UI _meta (MCP Apps ui.resourceUri + ChatGPT openai/outputTemplate);
//  - resources/list, resources/templates/list, resources/read: answer for the card templates.
// Only 200 JSON-RPC responses are rewritten, so 401/403 (token and allowlist checks) pass through untouched,
// and a resources/* call still has to clear the handler's token check first.
import { CONTRACT_TERMS_UI_META, noticeCardsResources, readNoticeCardsResource } from "./notice-cards";

type Msg = { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: unknown };

const HANDLED = new Set(["initialize", "tools/list", "resources/list", "resources/templates/list", "resources/read"]);

/** id -> request, for the requests this layer rewrites. */
export function appsRequests(bodyText: string): Map<unknown, Msg> {
  const out = new Map<unknown, Msg>();
  try {
    const parsed = JSON.parse(bodyText) as Msg | Msg[];
    for (const m of Array.isArray(parsed) ? parsed : [parsed]) if (m && m.id !== undefined && m.method && HANDLED.has(m.method)) out.set(m.id, m);
  } catch {
    /* not JSON: nothing to do */
  }
  return out;
}

export function rewriteMessage(m: Msg, req: Msg | undefined): Msg {
  if (!req || !m || m.id === undefined) return m;
  switch (req.method) {
    case "initialize": {
      const caps = (m.result?.capabilities ?? null) as Record<string, unknown> | null;
      if (!caps) return m;
      return { ...m, result: { ...m.result, capabilities: { ...caps, resources: caps.resources ?? { listChanged: false } } } };
    }
    case "tools/list": {
      const tools = m.result?.tools as { name: string; _meta?: Record<string, unknown> }[] | undefined;
      if (!Array.isArray(tools)) return m;
      return { ...m, result: { ...m.result, tools: tools.map((t) => (t.name === "contract_terms" ? { ...t, _meta: { ...(t._meta ?? {}), ...CONTRACT_TERMS_UI_META } } : t)) } };
    }
    case "resources/list": {
      const prior = (m.result?.resources as unknown[] | undefined) ?? [];
      return { jsonrpc: "2.0", id: m.id, result: { ...(m.result ?? {}), resources: [...prior, ...noticeCardsResources()] } };
    }
    case "resources/templates/list":
      return m.error ? { jsonrpc: "2.0", id: m.id, result: { resourceTemplates: [] } } : m;
    case "resources/read": {
      const r = readNoticeCardsResource(String(req.params?.uri ?? ""));
      return r ? { jsonrpc: "2.0", id: m.id, result: r } : m;
    }
  }
  return m;
}

export function rewritePayload(payload: unknown, reqs: Map<unknown, Msg>): { value: unknown; changed: boolean } {
  let changed = false;
  const one = (m: Msg) => {
    const out = rewriteMessage(m, m && reqs.get(m.id));
    if (out !== m) changed = true;
    return out;
  };
  const value = Array.isArray(payload) ? payload.map(one) : one(payload as Msg);
  return { value, changed };
}

function freshHeaders(res: Response): Headers {
  const h = new Headers(res.headers);
  h.delete("content-length");
  h.delete("content-encoding");
  return h;
}

export async function rewriteAppsResponse(res: Response, reqs: Map<unknown, Msg>): Promise<Response> {
  if (reqs.size === 0 || res.status !== 200 || !res.body) return res;
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  const text = await res.clone().text();
  let out = text;
  if (type.includes("application/json")) {
    try {
      const { value, changed } = rewritePayload(JSON.parse(text), reqs);
      if (changed) out = JSON.stringify(value);
    } catch {
      return res;
    }
  } else if (type.includes("text/event-stream")) {
    out = text
      .split("\n")
      .map((line) => {
        if (!line.startsWith("data:")) return line;
        try {
          const { value, changed } = rewritePayload(JSON.parse(line.slice(5).trimStart()), reqs);
          return changed ? `data: ${JSON.stringify(value)}` : line;
        } catch {
          return line;
        }
      })
      .join("\n");
  } else return res;
  if (out === text) return res;
  return new Response(out, { status: res.status, statusText: res.statusText, headers: freshHeaders(res) });
}
