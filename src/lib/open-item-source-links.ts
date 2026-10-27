/** Only saved, ordinary Gmail thread addresses become links; no mail is fetched. */
export function gmailThreadUrl(value: string): string | null {
  if (!/^https:\/\/mail\.google\.com\//i.test(value)) return null;
  const containsControlOrSpace = (text: string) =>
    [...text].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127);
  if (containsControlOrSpace(value)) return null;
  try {
    if (containsControlOrSpace(decodeURIComponent(value))) return null;
    const url = new URL(value);
    if (url.origin !== "https://mail.google.com" || url.username || url.password) return null;
    if (!/^\/mail\/(?:u\/(?:\d{1,3}\/)?|)$/.test(url.pathname)) return null;
    if (
      !/^#(?:all|inbox|sent|starred|important|snoozed|spam|trash)\/[A-Za-z0-9_-]{16,200}$/.test(
        url.hash,
      )
    )
      return null;
    const selectors = [...url.searchParams];
    if (selectors.length > 1 || selectors.some(([key]) => key !== "authuser")) return null;
    const account = url.searchParams.get("authuser");
    if (
      account !== null &&
      !/^\d{1,3}$/.test(account) &&
      !/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(account)
    )
      return null;
    if (url.pathname === "/mail/u/" && account === null) return null;
    return value;
  } catch {
    return null;
  }
}

/** Preserve the original detail text; extract only validated destinations beside it. */
export function gmailThreadUrls(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    const preceding = match.index > 0 ? text[match.index - 1] : "";
    if (preceding && !/[\s([<{"']/.test(preceding)) continue;
    const candidate = match[0].replace(/[.,;:!?)\]}]+$/, "");
    const valid = gmailThreadUrl(candidate);
    if (valid) found.add(valid);
  }
  return [...found];
}
