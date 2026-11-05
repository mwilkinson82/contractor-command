import { createClient } from "@supabase/supabase-js";
import { TOKEN_RE, tokenHash } from "./mcp/file-share";
import { REPORT_PAGE_HEADERS, renderReportDocument, reportGoneHtml, type PagePayload } from "./report-pages";
import { resolvePaymentBrand } from "./payment-applications/brand";

type RuntimeGlobals = typeof globalThis & { process?: { env?: Record<string, string | undefined> } };
const env = (names: string[]) => {
  const r = globalThis as RuntimeGlobals;
  for (const n of names) { const v = r.process?.env?.[n]?.trim(); if (v) return v; }
  return undefined;
};
export type ShareResolver = (hash: string) => Promise<PagePayload | null>;
/** The contractor's saved logo as a data: URI, or null. Name-only when the logo can't be read. */
export type LogoLoader = (logoUrl: string, company: string | undefined) => Promise<string | null>;

const toBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Reads the logo the same way pay apps and document emails do: only the company-logos bucket, size and format checked. */
const defaultLogoLoader: LogoLoader = async (logoUrl, company) => {
  const brand = await resolvePaymentBrand({ companyName: company, logoUrl, backendUrl: env(["SUPABASE_URL", "VITE_SUPABASE_URL"]) });
  if (!brand.logo || !brand.logoFormat) return null;
  return `data:image/${brand.logoFormat === "PNG" ? "png" : "jpeg"};base64,${toBase64(brand.logo)}`;
};

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

export async function openReportShare(token: string, method: "GET" | "HEAD", resolve: ShareResolver = defaultResolver, loadLogo: LogoLoader = defaultLogoLoader): Promise<Response> {
  const head = method === "HEAD";
  if (!TOKEN_RE.test(token)) return gone(404, head);
  if (head) return new Response(null, { status: 200, headers: REPORT_PAGE_HEADERS }); // HEAD never counts a view
  let p: PagePayload | null;
  try { p = await resolve(await tokenHash(token)); } catch { return new Response("Try again in a moment.", { status: 503, headers: { "cache-control": "no-store" } }); }
  if (!p) return gone(410, false);
  // Client-facing: the contractor's saved logo leads when they have one (company_logo_url, added Nov 2026).
  const logoUrl = (p as { company_logo_url?: unknown }).company_logo_url;
  let logo: string | null = null;
  if (typeof logoUrl === "string" && logoUrl) { try { logo = await loadLogo(logoUrl, p.company); } catch { logo = null; } }
  return new Response(renderReportDocument(p, { logo }), { status: 200, headers: REPORT_PAGE_HEADERS });
}

