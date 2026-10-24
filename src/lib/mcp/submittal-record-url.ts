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

/** Opens an exact package after the existing record page has authorized the member or board key. */
export function submittalPackageUrl(
  board: string | null | undefined,
  number: string,
  packageId: string,
): string | null {
  const record = submittalRecordUrl(board, number);
  if (!record || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(packageId))
    return null;
  const url = new URL(record);
  url.searchParams.set("open", "package");
  url.searchParams.set("package_id", packageId);
  return url.toString();
}

/** Opens the member uploader; a read-only board key never grants upload permission. */
export function submittalUploadUrl(
  board: string | null | undefined,
  number: string,
): string | null {
  const record = submittalRecordUrl(board, number);
  if (!record) return null;
  const url = new URL(record);
  url.searchParams.set("upload", "1");
  url.hash = "upload";
  return url.toString();
}

/** The existing authorized live log, including its board key. Never invent an address. */
export function submittalLogUrl(board: string | null | undefined): string | null {
  if (!board) return null;
  try {
    const url = new URL(board);
    if (
      url.origin !== "https://app.meetathena.io" ||
      url.username ||
      url.password ||
      !/^\/r\/job\/[0-9a-f-]{36}\/submittals$/i.test(url.pathname)
    )
      return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
