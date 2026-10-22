import { oauthReturnPath } from "./oauth-return-path";

/**
 * A magic-link may return to a hosted Athena page. OAuth consent is never
 * carried this way: that path stays on the signed continuation.
 */
export function athenaPageReturn(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 512) return undefined;
  const safe = oauthReturnPath(value);
  const url = new URL(safe, "https://app.invalid");
  const path = url.pathname;
  if (path.startsWith("/oauth") || path.startsWith("//")) return undefined;
  const ok = path.startsWith("/r/") || path.startsWith("/f/") || path === "/account" || path.startsWith("/account/");
  if (!ok) return undefined;
  return path + url.search + url.hash;
}
