// The OAuth consent page for Athena lives on app.meetathena.io. A consent link that lands on the Circle hub host
// (app.alpcontractorcircle.com/oauth/consent?authorization_id=...) is forwarded there with its query string intact.
// Only that host, that path, and only when authorization_id is present; every other hub request is untouched.
const HUB_HOST = "app.alpcontractorcircle.com";
const ATHENA_ORIGIN = "https://app.meetathena.io";

export function consentForwardUrl(request: Request): string | null {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return null;
  const url = new URL(request.url);
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host).split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
  if (host !== HUB_HOST) return null;
  if (url.pathname !== "/oauth/consent" && url.pathname !== "/oauth/consent/") return null;
  if (!url.searchParams.get("authorization_id")) return null;
  return `${ATHENA_ORIGIN}/oauth/consent${url.search}`;
}

export function consentForwardResponse(request: Request): Response | null {
  const to = consentForwardUrl(request);
  return to ? new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store" } }) : null;
}
