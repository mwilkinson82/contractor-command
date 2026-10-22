// Supabase Auth's Site URL still sends the OAuth authorize step to
// contractor-command.lovable.app/oauth/consent. That consent hop is the only
// lovable.app path that moves to https://app.meetathena.io. A plain /login on
// that host is the Hub and stays there. app.alpcontractorcircle.com never moves.
import { athenaAppOrigin, isLovableHost } from "@/lib/athena-host";
import { oauthConsentReturn } from "@/lib/oauth-return-path";

export function isLovableAuthPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/") || pathname.startsWith("/oauth/");
}

/** /login on lovable.app is Athena only when it is returning to OAuth consent. */
export function isLovableAthenaLogin(pathname: string, search?: string): boolean {
  if (pathname.startsWith("/oauth/")) return true;
  if (pathname !== "/login" && !pathname.startsWith("/login/")) return false;
  const raw = search?.startsWith("?") ? search.slice(1) : search ?? "";
  return !!oauthConsentReturn(new URLSearchParams(raw).get("redirect"));
}

function withPrefix(value: string | undefined, prefix: string): string {
  if (!value) return "";
  return value.startsWith(prefix) ? value : `${prefix}${value}`;
}

/** Absolute https://app.meetathena.io URL, or null when this hit should stay. */
export function lovableAuthRedirectTarget(input: {
  hostname: string;
  pathname: string;
  search?: string;
  hash?: string;
}): string | null {
  const hostname = input.hostname.trim().toLowerCase().replace(/:\d+$/, "");
  if (!isLovableHost(hostname)) return null;
  const pathname = input.pathname || "/";
  const search = withPrefix(input.search, "?");
  if (!isLovableAthenaLogin(pathname, search)) return null;
  return `${athenaAppOrigin()}${pathname}${search}${withPrefix(input.hash, "#")}`;
}

/** Public host a member's browser used. Forwarded host wins; Lovable's proxy sets it. */
export function requestHostname(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const raw = forwarded.split(",")[0].trim();
  if (raw) return raw.replace(/:\d+$/, "");
  return new URL(request.url).hostname;
}

/** 302 for OAuth consent on a *.lovable.app host. A Hub /login on that host stays. */
export function lovableAuthRedirectResponse(request: Request): Response | null {
  const url = new URL(request.url);
  const target = lovableAuthRedirectTarget({
    hostname: requestHostname(request),
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  });
  if (!target) return null;
  return new Response(null, {
    status: 302,
    headers: { location: target, "cache-control": "no-store" },
  });
}

/**
 * Runs at module load, before React paints. Hides the document and replaces
 * the location so a cached shell cannot flash the lovable.app address.
 */
export function applyBrowserLovableAuthRedirect(): void {
  if (typeof window === "undefined") return;
  const target = lovableAuthRedirectTarget({
    hostname: window.location.hostname,
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  });
  if (!target) return;
  const root = document.documentElement;
  if (root) root.style.visibility = "hidden";
  window.location.replace(target);
}

/** Blocking head script. Same rule as lovableAuthRedirectTarget, before the body. */
export const LOVABLE_AUTH_REDIRECT_BOOT = `(function(){try{var h=location.hostname.toLowerCase();if(!h.endsWith(".lovable.app"))return;var p=location.pathname;var oauth=p.indexOf("/oauth/")===0;var login=p==="/login"||p.indexOf("/login/")===0;if(!oauth&&!login)return;if(login){var back=new URLSearchParams(location.search).get("redirect")||"";if(back.indexOf("/oauth/consent?authorization_id=")!==0)return;}var d=document.documentElement;if(d)d.style.visibility="hidden";location.replace(${JSON.stringify(athenaAppOrigin())}+p+location.search+location.hash);}catch(e){}})();`;
