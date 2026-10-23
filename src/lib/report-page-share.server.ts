import { createClient } from "@supabase/supabase-js";
import { TOKEN_RE, tokenHash } from "./mcp/file-share";
import { REPORT_PAGE_HEADERS, renderReportDocument, reportGoneHtml, type PagePayload } from "./report-pages";

type RuntimeGlobals = typeof globalThis & { process?: { env?: Record<string, string | undefined> } };
const env = (names: string[]) => {
  const r = globalThis as RuntimeGlobals;
  for (const n of names) { const v = r.process?.env?.[n]?.trim(); if (v) return v; }
  return undefined;
};
export type ShareResolver = (hash: string) => Promise<PagePayload | null>;

/** Anon client: mcp_report_share_open is SECURITY DEFINER, hash in, the live report out (or NULL). */
const defaultResolver: ShareResolver = async (hash) => {
  const url = env(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  const key = env(["SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"]);
  if (!url || !key) throw new Error("Backend not configured");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)("mcp_report_share_open", { _token_hash: hash });
  if (error) throw new Error("lookup failed");
  return (data ?? null) as PagePayload | null;
};

const gone = (status: number, head: boolean) => new Response(head ? null : reportGoneHtml(), { status, headers: REPORT_PAGE_HEADERS });

export async function openReportShare(token: string, method: "GET" | "HEAD", resolve: ShareResolver = defaultResolver): Promise<Response> {
  const head = method === "HEAD";
  if (!TOKEN_RE.test(token)) return gone(404, head);
  if (head) return new Response(null, { status: 200, headers: REPORT_PAGE_HEADERS }); // HEAD never counts a view
  let p: PagePayload | null;
  try { p = await resolve(await tokenHash(token)); } catch { return new Response("Try again in a moment.", { status: 503, headers: { "cache-control": "no-store" } }); }
  if (!p) return gone(410, false);
  return new Response(renderReportDocument(p), { status: 200, headers: REPORT_PAGE_HEADERS });
}

