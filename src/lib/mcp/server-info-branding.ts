/**
 * Athena connector branding for the MCP `initialize` response.
 *
 * The MCP toolkit only forwards name/version/title into `serverInfo`, so the
 * spec's `icons` and `websiteUrl` fields (MCP 2025-11-25 Implementation) are
 * added here, after the handler has run. This touches nothing else: requests
 * that are not a JSON-RPC `initialize`, and any non-200 response (401, 403,
 * errors), pass through byte-for-byte. Auth, tokens, consent and the
 * allowlist are untouched.
 */

import { ATHENA_ICON_64_PNG_BASE64 } from "./athena-icon-64";

const ORIGIN = "https://app.meetathena.io";

// Smallest first: ChatGPT shows a broken icon when the fetched icon is too
// large (reported for ~13 KB files; our 512 PNG is ~14 KB).
export const ATHENA_SERVER_ICONS = Object.freeze([
  { src: `${ORIGIN}/brand/athena/athena-icon-64.png`, mimeType: "image/png", sizes: ["64x64"] },
  // Same 64px mark inline (SEP-973 allows data: URIs) for clients that won't fetch a cross-origin icon.
  { src: `data:image/png;base64,${ATHENA_ICON_64_PNG_BASE64}`, mimeType: "image/png", sizes: ["64x64"] },
  { src: `${ORIGIN}/brand/athena/athena-primary-512.png`, mimeType: "image/png", sizes: ["512x512"] },
  { src: `${ORIGIN}/brand/athena/athena-mark-primary.svg`, mimeType: "image/svg+xml", sizes: ["any"] },
]);

export const ATHENA_WEBSITE_URL = ORIGIN;

/** serverInfo.version and the "Athena vX" line on onboarding. */
export const ATHENA_VERSION = "0.8.5";

/** MCP 2025-11-25 Implementation.description. There is no publisher field in the spec. */
export const ATHENA_DESCRIPTION = "Athena powered by ALP, construction agents. Built by ALP.";

type JsonRpcMessage = { jsonrpc?: string; id?: unknown; method?: string; result?: { serverInfo?: Record<string, unknown> } };

/** Ids of `initialize` requests in a JSON-RPC body (single or batch). */
export function initializeRequestIds(bodyText: string): unknown[] {
  try {
    const parsed = JSON.parse(bodyText) as JsonRpcMessage | JsonRpcMessage[];
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.filter((m) => m && m.method === "initialize" && m.id !== undefined).map((m) => m.id);
  } catch {
    return [];
  }
}

/** Adds icons/websiteUrl to serverInfo on initialize results. Never overwrites existing values. */
export function brandJsonRpcPayload(payload: unknown, ids: unknown[]): { value: unknown; changed: boolean } {
  let changed = false;
  const brand = (m: JsonRpcMessage) => {
    const info = m?.result?.serverInfo;
    if (!info || typeof info !== "object" || !ids.includes(m.id)) return m;
    changed = true;
    return {
      ...m,
      result: {
        ...m.result,
        serverInfo: {
          ...info,
          icons: info.icons ?? ATHENA_SERVER_ICONS.map((i) => ({ ...i, sizes: [...i.sizes] })),
          websiteUrl: info.websiteUrl ?? ATHENA_WEBSITE_URL,
          description: info.description ?? ATHENA_DESCRIPTION,
        },
      },
    };
  };
  const value = Array.isArray(payload) ? payload.map(brand) : brand(payload as JsonRpcMessage);
  return { value, changed };
}

function brandSseEvent(event: string, ids: unknown[]): string {
  return event
    .split("\n")
    .map((line) => {
      if (!line.startsWith("data:")) return line;
      const raw = line.slice(5).trimStart();
      try {
        const { value, changed } = brandJsonRpcPayload(JSON.parse(raw), ids);
        return changed ? `data: ${JSON.stringify(value)}` : line;
      } catch {
        return line;
      }
    })
    .join("\n");
}

function freshHeaders(res: Response): Headers {
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return headers;
}

/** Rewrites a successful initialize response. Anything unexpected is returned unchanged. */
export async function brandInitializeResponse(res: Response, ids: unknown[]): Promise<Response> {
  if (ids.length === 0 || res.status !== 200 || !res.body) return res;
  const type = (res.headers.get("content-type") ?? "").toLowerCase();

  if (type.includes("application/json")) {
    const text = await res.clone().text();
    try {
      const { value, changed } = brandJsonRpcPayload(JSON.parse(text), ids);
      if (!changed) return res;
      return new Response(JSON.stringify(value), { status: res.status, statusText: res.statusText, headers: freshHeaders(res) });
    } catch {
      return res;
    }
  }

  if (type.includes("text/event-stream")) {
    // A POST initialize stream carries one JSON-RPC response and then closes,
    // so it is buffered and re-emitted as a plain body. (Piping the original
    // body would be cancelled when the framework swaps responses.)
    const text = await res.clone().text();
    const branded = text
      .split(/(\r?\n\r?\n)/)
      .map((part) => (/^\r?\n\r?\n$/.test(part) ? part : brandSseEvent(part, ids)))
      .join("");
    if (branded === text) return res;
    return new Response(branded, { status: res.status, statusText: res.statusText, headers: freshHeaders(res) });
  }

  return res;
}

/** True for a POST to the MCP endpoint. */
export function isMcpPost(request: Request): boolean {
  if (request.method.toUpperCase() !== "POST") return false;
  const path = new URL(request.url).pathname;
  return path === "/mcp" || path === "/mcp/";
}
