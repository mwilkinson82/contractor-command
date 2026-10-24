// The submittal record address. No imports, so the log renderer and the URL builder can both use it.

/**
 * /r/job/<job>/submittal/<number>?t=<token>, signed with the same token as the job's submittal log link.
 * Null when there is no signed log link to borrow the token from.
 */
export function submittalRecordUrl(
  submittalsBoardUrl: string | null | undefined,
  number: string,
): string | null {
  if (!submittalsBoardUrl || !number.trim()) return null;
  let url: URL;
  try {
    url = new URL(submittalsBoardUrl);
  } catch {
    return null;
  }
  const match = /^\/r\/job\/([0-9a-f-]{36})\/submittals$/i.exec(url.pathname);
  if (!match) return null;
  url.pathname = `/r/job/${match[1]}/submittal/${encodeURIComponent(number.trim())}`;
  url.hash = "";
  return url.toString();
}
