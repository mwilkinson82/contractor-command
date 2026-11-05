// Live dependencies for the customer page: the service-role client (customers never get a database role of their
// own) and Resend. Server-only.
import { createClient } from "@supabase/supabase-js";
import { portalEmailEnabled, sendPortalEmail } from "./email";
import { isCompanyLogoUrl } from "../payment-applications/brand";
import type { PortalDeps } from "./server";

const PHOTO_BUCKET = "athena-progress";
type Env = Record<string, string | undefined>;
const runtimeEnv = (): Env => (globalThis as { process?: { env?: Env } }).process?.env ?? {};
const env = (names: string[]) => {
  for (const n of names) {
    const v = runtimeEnv()[n]?.trim();
    if (v) return v;
  }
  return undefined;
};

let client: ReturnType<typeof createClient> | null = null;
function service() {
  if (client) return client;
  const url = env(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  const key = env(["SUPABASE_SERVICE_ROLE_KEY"]);
  if (!url || !key) throw new Error("Backend not configured");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

const serviceRpc = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
  const { data, error } = await (
    service().rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>
  )(fn, args);
  if (error) throw new Error("rpc failed");
  return data;
};

export const liveDeps: PortalDeps = {
  rpc: serviceRpc,
  // Job notices for the customer's decisions and messages: mcp_job_notice_record is service role only. Team
  // emails go out through the same switch as customer email.
  notice: { rpc: serviceRpc, send: (m) => sendPortalEmail(m) },
  signPhotos: async (paths) => {
    const out = new Map<string, string>();
    const { data } = await service().storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
    for (const row of data ?? []) if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
    return out;
  },
  send: (m) => sendPortalEmail(m),
  emailOn: () => portalEmailEnabled(),
  // Paying an approved pay application through the contractor's connected Stripe account. Loaded on use: the
  // client payment wiring reads this file's rpc.
  pay: async (p) => {
    const [{ openCheckout }, { checkoutDeps }, { athenaAppOrigin }] = await Promise.all([
      import("../client-payments/checkout"),
      import("../client-payments/deps.server"),
      import("../athena-host"),
    ]);
    return openCheckout(checkoutDeps(athenaAppOrigin()), p);
  },
  // Only a PNG or JPEG in the public company-logos bucket on our own backend, the same rule pay apps use.
  logo: async (access) => {
    const backend = env(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
    const data = await liveDeps.rpc("mcp_portal_brand", { _access: access });
    const url = (data as { logo_url?: unknown } | null)?.logo_url;
    return typeof url === "string" && backend && isCompanyLogoUrl(url, backend) ? url : null;
  },
};
