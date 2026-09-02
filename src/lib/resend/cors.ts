const MARKETING_HOSTS = [
  "marshallwilkinson.com",
  "alpcontractorcircle.com",
  "alphandbook.com",
  "alpsalestraining.com",
  "alpoverwatch.com",
] as const;

export function allowedCorsOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") return origin;

  for (const domain of MARKETING_HOSTS) {
    if (host === domain || host.endsWith(`.${domain}`)) return origin;
  }
  return null;
}

export function captureCorsHeaders(origin: string | null | undefined): Record<string, string> {
  const allowed = allowedCorsOrigin(origin);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (allowed) headers["Access-Control-Allow-Origin"] = allowed;
  return headers;
}
