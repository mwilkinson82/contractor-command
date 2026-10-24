import { createClient } from "@supabase/supabase-js";
import { TOKEN_RE, tokenHash } from "./mcp/file-share";
import { openShare } from "./file-share-route.server";
import { isUuid } from "./report-pages";
import { submittalRecordPath } from "./submittal-record-page";

export type DraftRecord = { job_id: string; submittal_id: string; id: string; number: string };
type DraftResolver = (hash: string) => Promise<DraftRecord | null>;

/** A draft token locates a sign-in destination, never grants read access to the draft. */
const draftRecord: DraftResolver = async (hash) => {
  const env = (
    globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }
  ).process?.env;
  const url = env?.SUPABASE_URL ?? env?.VITE_SUPABASE_URL;
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Backend unavailable");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: pkg, error } = await sb
    .from("mcp_submittal_packages")
    .select("id,company_id,job_id,submittal_id")
    .eq("token_hash", hash)
    .is("approved_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error("Package lookup unavailable");
  if (!pkg) return null;
  const { data: submittal, error: subError } = await sb
    .from("mcp_submittals")
    .select("number")
    .eq("id", pkg.submittal_id)
    .eq("job_id", pkg.job_id)
    .eq("company_id", pkg.company_id)
    .maybeSingle();
  if (subError) throw new Error("Record lookup unavailable");
  return submittal ? { ...pkg, number: submittal.number } : null;
};

export async function openSubmittalFile(
  token: string,
  method: "GET" | "HEAD",
  open = openShare,
  resolveDraft: DraftResolver = draftRecord,
) {
  const response = await open(token, method);
  if (response.status !== 410 || !TOKEN_RE.test(token)) return response;
  let record: DraftRecord | null;
  try {
    record = await resolveDraft(await tokenHash(token));
  } catch {
    return new Response(method === "HEAD" ? null : "Try again in a moment.", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  if (
    !record ||
    !isUuid(record.id) ||
    !isUuid(record.job_id) ||
    !isUuid(record.submittal_id) ||
    !record.number?.trim() ||
    record.number.length > 40
  )
    return response;
  // No board key, signed file URL or other access capability is attached. The
  // existing record checks the signed-in member's job access before signing a PDF.
  const location = `${submittalRecordPath(record.job_id, record.number)}?open=package&package_id=${record.id}`;
  return new Response(null, {
    status: 302,
    headers: {
      location,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex",
    },
  });
}
