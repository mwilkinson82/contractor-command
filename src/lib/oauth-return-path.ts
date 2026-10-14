export function oauthReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return "/";
  // A fixed parsing origin keeps route search validation safe during SSR.
  const origin = "https://app.invalid";
  try {
    const target = new URL(value, origin);
    if (target.origin !== origin || target.pathname.startsWith("//")) return "/";
    return target.pathname + target.search + target.hash;
  } catch {
    return "/";
  }
}

// Magic links open in a new tab and land on /auth/callback without the
// original ?redirect, so the consent page also stashes its URL here.
const KEY = "alp.oauth.consentReturn";
const TTL_MS = 30 * 60 * 1000;

export function rememberOAuthReturn(path: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    /* storage unavailable */
  }
}

export function consumeOAuthReturn(): string | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    localStorage.removeItem(KEY);
    const { path, at } = JSON.parse(raw) as { path?: unknown; at?: number };
    if (typeof at !== "number" || Date.now() - at > TTL_MS) return undefined;
    const safe = oauthReturnPath(path);
    return safe.startsWith("/oauth/consent") ? safe : undefined;
  } catch {
    return undefined;
  }
}
