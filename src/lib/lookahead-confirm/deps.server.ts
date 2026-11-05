// Live dependencies for the look-ahead confirmation page: the service-role rpc the customer page uses (suppliers
// and subs never get a database role of their own) and Resend through sendPortalEmail. Server only.
import { liveDeps as portalDeps } from "../customer-portal/deps.server";
import { sendPortalEmail } from "../customer-portal/email";
import { isCompanyLogoUrl } from "../payment-applications/brand";
import type { ConfirmDeps } from "./server";

type Env = Record<string, string | undefined>;
const runtimeEnv = (): Env => (globalThis as { process?: { env?: Env } }).process?.env ?? {};

export const liveConfirmDeps: ConfirmDeps = {
  rpc: (fn, args) => portalDeps.rpc(fn, args),
  send: (m) => sendPortalEmail(m),
  // Only a PNG or JPEG in the public company-logos bucket on our own backend, the same rule pay apps use.
  logoOk: (url) => {
    const backend = (runtimeEnv().SUPABASE_URL ?? runtimeEnv().VITE_SUPABASE_URL)?.trim();
    return !!backend && isCompanyLogoUrl(url, backend);
  },
};
