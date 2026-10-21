import { createClient } from "@supabase/supabase-js";
import { TOKEN_RE, downloadHeaders, goneHtml, tokenHash } from "./mcp/file-share";

type RuntimeGlobals = typeof globalThis & { process?: { env?: Record<string, string | undefined> } };
const env = (names: string[]) => {
  const r = globalThis as RuntimeGlobals;
  for (const n of names) { const v = r.process?.env?.[n]?.trim(); if (v) return v; }
  return undefined;
};

type Opened = { filename: string; mime_type: string; size_bytes: number; signed_url: string } | null;
export type Resolver = (hash: string, count: boolean) => Promise<Opened>;

/** Anon client: mcp_file_share_open is the only thing it can call for files (SECURITY DEFINER, hash in, one row out). */
const defaultResolver: Resolver = async (hash, count) => {
  const url = env(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  const key = env(["SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"]);
  if (!url || !key) throw new Error("Backend not configured");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)("mcp_file_share_open", { _token_hash: hash, _count: count });
  if (error) throw new Error("lookup failed");
  return (data ?? null) as Opened;
};

const gone = (status: number, head: boolean) =>
  new Response(head ? null : goneHtml(), { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" } });

export async function openShare(token: string, method: "GET" | "HEAD", resolve: Resolver = defaultResolver, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const head = method === "HEAD";
  if (!TOKEN_RE.test(token)) return gone(404, head);
  let row: Opened;
  try { row = await resolve(await tokenHash(token), !head); } catch { return new Response("Try again in a moment.", { status: 503, headers: { "cache-control": "no-store" } }); }
  if (!row) return gone(410, head);
  const headers = downloadHeaders(row.filename, row.mime_type, row.size_bytes);
  if (head) return new Response(null, { status: 200, headers });
  const up = await fetchImpl(row.signed_url, { redirect: "error" });
  if (!up.ok || !up.body) return gone(410, false);
  return new Response(up.body, { status: 200, headers });
}
