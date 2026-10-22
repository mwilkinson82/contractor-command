// Hub and Athena share one deployment. After sign-in, the next page stays on
// the host where the member signed in. A returnTo on the other product is ignored.
import { athenaPathAllowed } from "@/lib/athena-routes";
import { oauthReturnPath } from "@/lib/oauth-return-path";

export function signInHostKind(hostname: string): "athena" | "hub" {
  const host = hostname.trim().toLowerCase().replace(/:\d+$/, "");
  if (host === "meetathena.io" || host.endsWith(".meetathena.io")) return "athena";
  return "hub";
}

/** Athena opens /account. The Hub opens the command center. Lovable.app is a Hub host. */
export function defaultPostLoginPath(hostname: string): string {
  return signInHostKind(hostname) === "athena" ? "/account" : "/";
}

function sameHostPath(hostname: string, absolute: string): string | null {
  let url: URL;
  try {
    url = new URL(absolute);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const here = hostname.trim().toLowerCase().replace(/:\d+$/, "");
  if (url.hostname.toLowerCase() !== here) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Where to go after sign-in on `hostname`.
 * Relative paths stay on this host. An absolute URL on any other host is ignored.
 * On Athena, a Hub page (anything the Athena shell does not serve) becomes /account.
 */
export function postLoginDestination(hostname: string, candidate?: string | null): string {
  const fallback = defaultPostLoginPath(hostname);
  if (!candidate) return fallback;
  const raw = candidate.trim();
  if (!raw) return fallback;

  let relative = raw;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) {
    if (raw.startsWith("//")) return fallback;
    const kept = sameHostPath(hostname, raw);
    if (!kept) return fallback;
    relative = kept;
  }

  const safe = oauthReturnPath(relative);
  const path = new URL(safe, "https://app.invalid").pathname;
  if (path === "/login" || path.startsWith("/login/") || path === "/auth/callback") return fallback;
  if (signInHostKind(hostname) === "athena" && !athenaPathAllowed(path)) return fallback;
  return safe;
}
