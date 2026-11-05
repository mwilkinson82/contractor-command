// Live dependencies for the reviewer return page and the inbound capture: the service-role client (reviewers never
// get a database role of their own), Storage and the customer email sender. Server-only.
import { createClient } from "@supabase/supabase-js";
import { sendPortalEmail } from "../customer-portal/email";
import { isCompanyLogoUrl } from "../payment-applications/brand";
// The same private bucket as submittal packages and pieces (src/lib/mcp/submittal-package.ts).
const SUBMITTAL_BUCKET = "athena-submittals";
import type { ReturnDeps } from "./page";

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

export async function serviceRpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await (
    service().rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>
  )(fn, args);
  if (error) throw new Error("rpc failed");
  return data;
}

export async function serviceUpload(path: string, bytes: Uint8Array, contentType: string) {
  const { error } = await service()
    .storage.from(SUBMITTAL_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (error) throw new Error("upload failed");
}

export const liveReturnDeps: ReturnDeps = {
  rpc: serviceRpc,
  upload: serviceUpload,
  // Team notices go to members; sendPortalEmail keeps them behind ATHENA_PORTAL_EMAIL_ENABLED.
  send: (m) => sendPortalEmail(m),
  // Only a PNG or JPEG in the public company-logos bucket on our own backend, the same rule pay apps use.
  logo: (url) => {
    const backend = env(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
    return url && backend && isCompanyLogoUrl(url, backend) ? url : null;
  },
};
