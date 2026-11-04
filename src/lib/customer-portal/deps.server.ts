// Live dependencies for the customer page: the service-role client (customers never get a database role of their
// own) and Resend. Server-only.
import { createClient } from "@supabase/supabase-js";
import { portalEmailEnabled, sendPortalEmail } from "./email";
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

export const liveDeps: PortalDeps = {
  rpc: async (fn, args) => {
    const { data, error } = await (
      service().rpc as unknown as (
        f: string,
        a: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>
    )(fn, args);
    if (error) throw new Error("rpc failed");
    return data;
  },
  signPhotos: async (paths) => {
    const out = new Map<string, string>();
    const { data } = await service().storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
    for (const row of data ?? []) if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
    return out;
  },
  send: (m) => sendPortalEmail(m),
  emailOn: () => portalEmailEnabled(),
};
