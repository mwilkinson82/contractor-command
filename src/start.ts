import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { brandInitializeResponse, initializeRequestIds, isMcpPost } from "./lib/mcp/server-info-branding";
import { isTrustedHost } from "./lib/trusted-hosts";
import { checkAthenaEntitlement, NO_ENTITLEMENT_MESSAGE } from "./lib/mcp/entitlement";
import { supabaseForToken } from "./lib/mcp/supabase";

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  // Bypass app middleware for /lovable/* — these routes (webhooks, cron,
  // email preview) authenticate themselves and must not be redirected or
  // wrapped in HTML error pages.
  const url = new URL(request.url);
  if (url.pathname.startsWith("/lovable/")) {
    return next();
  }
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

/**
 * Same-origin CSRF guard for state-changing requests.
 *
 * Defense-in-depth on top of the Bearer-token check in `requireSupabaseAuth`:
 * a browser cannot forge the Origin/Referer header, and same-origin server
 * function calls always include it. We explicitly allow:
 *   - safe HTTP methods (GET/HEAD/OPTIONS)
 *   - external webhook + cron endpoints under /api/public/* and /lovable/*
 *     which authenticate themselves via signatures / shared secrets.
 */
const csrfOriginGuard = createMiddleware().server(async ({ next, request }) => {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return next();
  }

  const url = new URL(request.url);
  if (
    url.pathname.startsWith("/api/public/") ||
    url.pathname.startsWith("/lovable/")
  ) {
    return next();
  }

  // /mcp authenticates with OAuth bearer tokens (not cookies) and enforces its
  // own origin allow-list in @lovable.dev/mcp-js, so browser MCP clients such
  // as Cursor's web agents must be able to POST cross-site.
  if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
    return next();
  }

  // Sec-Fetch-Site is set by all modern browsers and cannot be forged by
  // cross-site attackers. Trust it as the primary signal.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    fetchSite === "same-origin" ||
    fetchSite === "same-site" ||
    fetchSite === "none"
  ) {
    return next();
  }

  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  if (!origin) {
    // No Origin/Referer and no Sec-Fetch-Site signal — allow through.
    // Bearer-token auth in requireSupabaseAuth still gates real access.
    return next();
  }
  try {
    const originHost = new URL(origin).host;
    if (originHost === url.host || isTrustedHost(originHost)) {
      return next();
    }
    return new Response("Cross-origin request blocked", { status: 403 });
  } catch {
    return new Response("Invalid Origin", { status: 403 });
  }
});

/**
 * Athena access gate: a bearer token whose user has no membership entitlement
 * (src/lib/mcp/entitlement.ts, the same rule the Hub uses) gets 403 before
 * reaching /mcp. Supabase verifies the token inside the check. Requests with
 * no token, or where the check can't run (e.g. an expired token), pass through
 * so the MCP handler returns 401 + WWW-Authenticate; the per-tool guard
 * re-checks entitlement on every call.
 */
async function hasToolCall(request: Request): Promise<boolean> {
  if (request.method.toUpperCase() !== "POST") return false;
  try {
    const parsed = JSON.parse(await request.clone().text()) as { method?: string } | { method?: string }[];
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.some((m) => m?.method === "tools/call");
  } catch {
    return true; // unreadable body: keep the gate
  }
}

const mcpEntitlementGate = createMiddleware().server(async ({ next, request }) => {
  const url = new URL(request.url);
  if (url.pathname !== "/mcp" && !url.pathname.startsWith("/mcp/")) return next();
  const authz = request.headers.get("authorization") ?? "";
  if (!authz.startsWith("Bearer ")) return next();
  // 0.8.9: only tools/call needs the membership check here (the per-tool guard re-checks it too).
  // initialize, tools/list, ping and notifications skip the database round trip, so a cold
  // first connect (Claude's first fresh chat) gets its tool list fast instead of timing out.
  if (!(await hasToolCall(request))) return next();
  let ent;
  try {
    ent = await checkAthenaEntitlement(supabaseForToken(authz.slice(7).trim()));
  } catch {
    return next();
  }
  if (!ent.allowed && ent.reason === "no_entitlement") {
    return new Response(JSON.stringify({ error: "forbidden", message: NO_ENTITLEMENT_MESSAGE }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  return next();
});

/**
 * Athena icon on the MCP initialize response (serverInfo.icons / websiteUrl).
 * Runs after the entitlement gate; only a 200 initialize result is rewritten.
 */
const mcpServerInfoBranding = createMiddleware().server(async ({ next, request }) => {
  if (!isMcpPost(request)) return next();
  let ids: unknown[] = [];
  try {
    ids = initializeRequestIds(await request.clone().text());
  } catch {
    ids = [];
  }
  const result = await next();
  if (ids.length === 0) return result;
  try {
    return { ...result, response: await brandInitializeResponse(result.response, ids) };
  } catch {
    return result;
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, mcpEntitlementGate, mcpServerInfoBranding, csrfOriginGuard],
  functionMiddleware: [attachSupabaseAuth],
}));

