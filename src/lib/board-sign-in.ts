// Where an expired, missing, or bad job-board link may send the member after
// email-code sign-in. Only a same-origin /r/job/<id>/<page> path is allowed.
// Ordinary boards drop the token. A submittal record keeps its existing token
// so its read-only record and exact upload destination survive account sign-in.
import { oauthReturnPath } from "./oauth-return-path";
import { hostedPageName, isUuid, JOB_PAGES } from "./report-pages";

export const BOARD_SIGN_IN_TITLE = "Sign in to keep this board open";

const PARSE_ORIGIN = "https://app.invalid";

function dropBoardNoise(params: URLSearchParams, keepToken = false) {
  for (const key of [...params.keys()]) {
    const name = key.toLowerCase();
    if ((!keepToken && name === "t") || name.startsWith("utm_")) params.delete(key);
  }
}

/**
 * A relative /r/job path on this origin. Submittal records retain their existing
 * board token; other boards drop it. Tracking parameters are always removed.
 * Anything else (other origins, other paths, protocol-relative URLs)
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
  if (parts[0] !== "r" || parts[1] !== "job") return undefined;
  const jobId = parts[2];
  if (!isUuid(jobId)) return undefined;
  const isRecord = parts.length === 5 && parts[3] === "submittal";
  const isRequestLog = parts.length === 4 && (parts[3] === "rfis" || parts[3] === "rfcs" || parts[3] === "cos");
  dropBoardNoise(url.searchParams, isRecord || isRequestLog);
  const search = url.searchParams.toString();
  const hash = url.hash && url.hash !== "#" ? url.hash : "";
  // A submittal record: /r/job/<id>/submittal/<number>. The number stays percent-encoded as the browser sent it.
  if (parts.length === 5 && parts[3] === "submittal") {
    const number = parts[4].split(/[?#]/)[0];
    if (!number || number.length > 120) return undefined;
    return `/r/job/${jobId}/submittal/${number}${search ? `?${search}` : ""}${hash}`;
  }
  if (parts.length !== 4) return undefined;
  const page = hostedPageName(parts[3]);
  if (!(JOB_PAGES as readonly string[]).includes(page) && !isRequestLog) return undefined;
  return `/r/job/${jobId}/${page}${search ? `?${search}` : ""}${hash}`;
}

/**
 * The morning brief board. Only the exact /today path. Query params are dropped
 * so this cannot carry a token or an off-site address.
 */
export function todaySignInReturn(value: unknown): string | undefined {
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
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  if (url.origin !== PARSE_ORIGIN || path !== "/today") return undefined;
  const hash = url.hash && url.hash !== "#" ? url.hash : "";
  return `/today${hash}`;
}

/** A job board, or the morning brief at /today. Anything else is rejected. */
export function signInReturn(value: unknown): string | undefined {
  return boardSignInReturn(value) ?? todaySignInReturn(value);
}

/** A same-address link only changes the fragment; explicitly reload to retry member access. */
export function continueBoardSignIn(
  returnTo: unknown,
  navigation: {
    pathname: string;
    search: string;
    hash: string;
    assign: (path: string) => void;
    reload: () => void;
  },
): void {
  const next = signInReturn(returnTo);
  if (!next) return;
  const target = new URL(next, PARSE_ORIGIN);
  if (
    target.pathname === navigation.pathname &&
    target.search === navigation.search &&
    target.hash === navigation.hash
  ) {
    navigation.reload();
  } else {
    navigation.assign(next);
  }
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
