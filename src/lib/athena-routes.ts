// Athena-only route shell. On an Athena host (meetathena.io and subdomains)
// only these paths render; every Circle Hub route redirects to /account.
// Pure so it can be unit-tested without a router.

export const ATHENA_HOME = "/account";

/** Exact paths allowed on the Athena host. */
const ATHENA_EXACT = new Set([
  "/login",
  "/auth/callback",
  "/account",
  "/team",
  "/oauth/consent",
  "/.lovable/oauth/consent",
  "/reset-password",
  "/forgot-password",
  "/magic-link",
  "/mcp",
  "/today",
]);

/** Prefixes allowed on the Athena host (connect discovery, MCP, shared artifacts, server hooks). */
const ATHENA_PREFIXES = [
  "/.well-known/",
  "/mcp/",
  "/account/",
  "/oauth/",
  "/r/", // Athena report pages and share links
  "/f/", // Athena file shares
  "/brand/",
  "/email/unsubscribe",
  "/lovable/", // server-only email hooks
  "/api/public/athena/",
];

export function athenaPathAllowed(pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (ATHENA_EXACT.has(p)) return true;
  return ATHENA_PREFIXES.some((prefix) => p === prefix.replace(/\/$/, "") || p.startsWith(prefix));
}

/** Job pages, the portfolio, and share links. They use the same session as the field board. */
export function isHostedReport(pathname: string): boolean {
  return /^\/r\/(job|portfolio|s)(\/|$)/.test(pathname);
}

/** The morning brief board. Signed-out visitors see the email-code sign-in on the page. */
export function isTodayPage(pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return p === "/today";
}

/** Where to send a path on the Athena host: null = render it, else the redirect target. */
export function athenaHostRedirect(pathname: string): string | null {
  if (pathname === "/team") return `${ATHENA_HOME}#team`;
  return athenaPathAllowed(pathname) ? null : ATHENA_HOME;
}

/** Default landing after sign-in: Athena host goes to /account, the Hub keeps "/". */
export function postSignInDefault(athenaHost: boolean): string {
  return athenaHost ? ATHENA_HOME : "/";
}
