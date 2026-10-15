export const PUBLIC_ROUTES = new Set([
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/auth/callback",
  "/welcome",
  "/scheduler-preview",
  "/oauth/consent",
  "/.lovable/oauth/consent",
]);

// Read the pending location as well as its public-route status from the same
// snapshot. The rendered route can lag behind history during async beforeLoad.
export function signedOutReturnPath(location: { pathname: string; href: string }): string | null {
  return PUBLIC_ROUTES.has(location.pathname) ? null : location.href;
}
