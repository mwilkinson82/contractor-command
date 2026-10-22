// Where an expired, missing, or bad job-board link may send the member after
// email-code sign-in. Only a same-origin /r/job/<id>/<page> path is allowed.
// The token and utm params are removed so the stable URL loads live data.
import { oauthReturnPath } from "./oauth-return-path";
import { hostedPageName, isUuid, JOB_PAGES } from "./report-pages";

export const BOARD_SIGN_IN_TITLE = "Sign in to keep this board open";

const PARSE_ORIGIN = "https://app.invalid";

function dropBoardNoise(params: URLSearchParams) {
  for (const key of [...params.keys()]) {
    const name = key.toLowerCase();
    if (name === "t" || name.startsWith("utm_")) params.delete(key);
  }
}

/**
 * A relative /r/job path on this origin, with the signed token and utm params
 * removed. Anything else (other origins, other paths, protocol-relative URLs)
 * is rejected so the sign-in cannot be used as an open redirect.
 */
export function boardSignInReturn(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return undefined;
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  const safe = oauthReturnPath(value);
  if (safe === "/") return undefined;
  let url: URL;
  try {
    url = new URL(safe, PARSE_ORIGIN);
  } catch {
    return undefined;
  }
  if (url.origin !== PARSE_ORIGIN) return undefined;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 4 || parts[0] !== "r" || parts[1] !== "job") return undefined;
  const jobId = parts[2];
  const page = hostedPageName(parts[3]);
  if (!isUuid(jobId) || !(JOB_PAGES as readonly string[]).includes(page)) return undefined;
  dropBoardNoise(url.searchParams);
  const search = url.searchParams.toString();
  const hash = url.hash && url.hash !== "#" ? url.hash : "";
  return `/r/job/${jobId}/${page}${search ? `?${search}` : ""}${hash}`;
}

/**
 * Prefer the address the member actually opened. If that address is not a
 * job board, fall back to the route's own job and page — never to the
 * rejected address.
 */
export function boardReturnForVisit(
  page: string,
  jobId: string | undefined,
  location?: string,
): string | undefined {
  if (location) {
    const fromLocation = boardSignInReturn(location);
    if (fromLocation) return fromLocation;
  }
  if (!jobId) return undefined;
  return boardSignInReturn(`/r/job/${jobId}/${hostedPageName(page)}`);
}
