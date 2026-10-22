// Site URL independence: every auth email link names its own destination, so the Supabase Auth Site URL can move
// to app.meetathena.io without changing any Circle Hub link. Hub flows always land on the Hub; Athena flows on Athena.
export const HUB_ORIGIN = "https://app.alpcontractorcircle.com";
export const ATHENA_ORIGIN = "https://app.meetathena.io";
const HUB_MAIL_SITE = "https://mail.alpcontractorcircle.com";

const HUB_HOSTS = new Set([
  "app.alpcontractorcircle.com",
  "localhost",
  "127.0.0.1",
]);

/** The Hub origin for Hub email links. PUBLIC_APP_ORIGIN / APP_ORIGIN are honored only when they point at a Hub host,
 *  so a Site URL on Athena or on a lovable.app host can never move a Hub link. */
export function hubOrigin(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.PUBLIC_APP_ORIGIN || env.APP_ORIGIN || "").trim();
  if (!raw) return HUB_ORIGIN;
  try {
    const u = new URL(raw);
    return HUB_HOSTS.has(u.hostname.toLowerCase()) ? u.origin : HUB_ORIGIN;
  } catch {
    return HUB_ORIGIN;
  }
}

const isAthena = (host: string) => host === "meetathena.io" || host.endsWith(".meetathena.io");

/** The final destination of a Supabase action link: its redirect_to param (or the link itself). */
export function linkDestinationHost(actionUrl: string | null | undefined): string | null {
  if (!actionUrl) return null;
  try {
    const u = new URL(actionUrl);
    const rt = u.searchParams.get("redirect_to");
    return (rt ? new URL(rt) : u).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Brand for an auth-hook email, from where its link goes (never from the Site URL). Unknown = Hub, as today. */
export function emailSiteFor(actionUrl: string | null | undefined): {
  siteName: string;
  siteUrl: string;
  athena: boolean;
} {
  const host = linkDestinationHost(actionUrl);
  if (host && isAthena(host)) return { siteName: "Athena", siteUrl: ATHENA_ORIGIN, athena: true };
  return { siteName: "Contractor Circle", siteUrl: HUB_MAIL_SITE, athena: false };
}
