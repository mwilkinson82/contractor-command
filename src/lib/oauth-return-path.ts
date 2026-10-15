export function oauthReturnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    // Reject URL control characters before parsing.
    // eslint-disable-next-line no-control-regex
    /[\\\u0000-\u001f\u007f]/.test(value)
  )
    return "/";
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

// Only this canonical route can be carried through a passwordless OAuth link.
export function oauthConsentReturn(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 512) return undefined;
  const safe = oauthReturnPath(value);
  const url = new URL(safe, "https://app.invalid");
  const id = url.searchParams.get("authorization_id");
  if (
    url.pathname !== "/oauth/consent" ||
    url.hash ||
    [...url.searchParams.keys()].length !== 1 ||
    !id ||
    !/^[a-zA-Z0-9_-]{1,200}$/.test(id)
  )
    return undefined;
  return `/oauth/consent?authorization_id=${encodeURIComponent(id)}`;
}
