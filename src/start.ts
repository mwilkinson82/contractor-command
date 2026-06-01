import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

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

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, csrfOriginGuard],
  functionMiddleware: [attachSupabaseAuth],
}));

