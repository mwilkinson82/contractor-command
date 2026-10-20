// Which brand a request should render. The Circle Hub and Athena share one
// deployment and one Supabase project; only presentation differs by host.
// Athena hosts are meetathena.io and its subdomains (see site-icons.ts).

/** Canonical Athena app origin. Override with ATHENA_APP_ORIGIN. */
export const DEFAULT_ATHENA_APP_ORIGIN = "https://app.meetathena.io";

export function athenaAppOrigin(): string {
  const fromEnv =
    typeof process !== "undefined" ? process.env?.ATHENA_APP_ORIGIN : undefined;
  return (fromEnv || DEFAULT_ATHENA_APP_ORIGIN).replace(/\/$/, "");
}

/** Hosts that must never be shown to members on the OAuth consent step. */
export function isLovableHost(hostname: string): boolean {
  return hostname.toLowerCase().endsWith(".lovable.app");
}
