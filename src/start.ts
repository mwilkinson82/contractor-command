import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { brandInitializeResponse, initializeRequestIds, isMcpPost } from "./lib/mcp/server-info-branding";

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
const TRUSTED_HOST_SUFFIXES = [
  ".lovable.app",
  ".lovableproject.com",
  ".lovable.dev",
];
const TRUSTED_HOSTS = new Set([
  "app.alpcontractorcircle.com",
  "contractor-command.lovable.app",
]);

function isTrustedHost(host: string): boolean {
  if (TRUSTED_HOSTS.has(host)) return true;
  return TRUSTED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

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
 * Private MCP prototype gate: a bearer token whose email isn't on the
 * allowlist gets 403 before reaching /mcp. This only ever rejects; the MCP
 * handler still verifies every token's signature and re-checks the email.
 * Requests with no token pass through so the handler returns 401 +
 * WWW-Authenticate.
 */
const MCP_ALLOWED_EMAILS = new Set(["marshall@marshallwilkinson.com"]);
const mcpAllowlistGate = createMiddleware().server(async ({ next, request }) => {
  const url = new URL(request.url);
  if (url.pathname !== "/mcp" && !url.pathname.startsWith("/mcp/")) return next();
  const authz = request.headers.get("authorization") ?? "";
  if (!authz.startsWith("Bearer ")) return next();
  let email = "";
  try {
    const part = authz.slice(7).split(".")[1] ?? "";
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    email = String((JSON.parse(json) as { email?: unknown }).email ?? "").trim().toLowerCase();
  } catch {
    return next();
  }
  if (!MCP_ALLOWED_EMAILS.has(email)) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  return next();
});

/**
 * Athena icon on the MCP initialize response (serverInfo.icons / websiteUrl).
 * Runs after the allowlist gate; only a 200 initialize result is rewritten.
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
  requestMiddleware: [errorMiddleware, mcpAllowlistGate, mcpServerInfoBranding, csrfOriginGuard],
  functionMiddleware: [attachSupabaseAuth],
}));

