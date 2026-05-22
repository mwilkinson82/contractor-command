// Shared allowlist for post-checkout return URLs. AOS (and any other
// alpcontractorcircle.com subdomain) may deep-link the user to
// /upgrade?return_to=<absolute URL>; after a successful Stripe checkout
// we bounce them back. Only absolute https URLs on *.alpcontractorcircle.com
// are honored. Returns the normalized URL string, or null if invalid.

export const RETURN_TO_STORAGE_KEY = "alp.cc.returnTo";

export function isAllowedReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    if (host === "alpcontractorcircle.com" || host.endsWith(".alpcontractorcircle.com")) {
      return u.toString();
    }
    return null;
  } catch {
    return null;
  }
}
