import { createClient } from "@supabase/supabase-js";
import { ToolError, type ToolContext } from "@lovable.dev/mcp-js";
import { dbError, type Sb } from "./guard";
import { assertUploadBytes } from "./file-upload";
import { sha256Hex } from "./file-share";
import { readBoundedFinancialStoragePath } from "./billing-original.server";

export type ApOriginal = {
  id: string;
  company_id: string;
  job_id: string;
  record_id: string;
  version: number;
  filename: string;
  mime_type: string;
  storage_path: string;
  sha256: string;
  size_bytes: number;
  verified_at?: string | null;
};

export async function apOriginalRpc<T>(
  sb: Sb,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await (
    sb.rpc as unknown as (
      n: string,
      a: object,
    ) => Promise<{ data: T; error: { message: string } | null }>
  )(name, args);
  if (error) dbError(error);
  if (!data) throw new ToolError("The supplier original is unavailable.");
  return data;
}

async function member(sb: Sb, ctx: ToolContext) {
  const token = ctx.getToken();
  if (!token) throw new ToolError("Verified member required.");
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user?.id) throw new ToolError("Verified member required.");
  return data.user.id;
}
function admin() {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const url = env?.SUPABASE_URL ?? env?.VITE_SUPABASE_URL,
    key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ToolError("Original storage is temporarily unavailable.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function assertApOriginal(
  original: ApOriginal,
  job: string,
  record: string,
  version?: number,
) {
  if (
    original.job_id !== job ||
    original.record_id !== record ||
    (version !== undefined && original.version !== version) ||
    !original.storage_path.startsWith(`${original.company_id}/${job}/${original.id}/`) ||
    original.storage_path.split("/").length !== 4 ||
    original.storage_path.includes("..") ||
    original.storage_path.split("/")[3] !== original.filename
  )
    throw new ToolError("That original is not available for this bill version.");
}
export async function checkedApOriginalBytes(original: ApOriginal) {
  const bytes = await readBoundedFinancialStoragePath(original.storage_path);
  const checked = assertUploadBytes(bytes, original.filename, "financial_document");
  if (
    checked.mime !== original.mime_type ||
    bytes.length !== original.size_bytes ||
    (await sha256Hex(bytes)) !== original.sha256
  )
    throw new ToolError(
      "The original does not match its recorded file fingerprint. Nothing was linked.",
    );
  return bytes;
}

/** Dedicated AP claim; never selects or broadens the superintendent upload route. */
export async function storeApOriginal(
  sb: Sb,
  ctx: ToolContext,
  upload: ApOriginal,
  bytes: Uint8Array,
) {
  const actor = await member(sb, ctx),
    service = admin();
  const claim = await apOriginalRpc<ApOriginal>(
    service as unknown as Sb,
    "mcp_ap_original_upload_claim",
    { _id: upload.id, _actor: actor },
  );
  assertApOriginal(claim, upload.job_id, upload.record_id, upload.version);
  if (
    ["id", "company_id", "filename", "mime_type", "storage_path", "sha256", "size_bytes"].some(
      (k) => claim[k as keyof ApOriginal] !== upload[k as keyof ApOriginal],
    )
  )
    throw new ToolError("That original upload changed. Review the file again.");
  const checked = assertUploadBytes(bytes, upload.filename, "financial_document");
  if (
    checked.mime !== upload.mime_type ||
    bytes.length !== upload.size_bytes ||
    (await sha256Hex(bytes)) !== upload.sha256
  )
    throw new ToolError("The attachment does not match the reviewed upload.");
  if (!claim.verified_at) {
    const stored = await service.storage
      .from("athena-financial-documents")
      .upload(upload.storage_path, bytes, { contentType: upload.mime_type, upsert: false });
    if (!stored.error) return;
  }
  // Unknown/repeated storage outcome: compare exact bytes; never overwrite an object.
  await checkedApOriginalBytes(upload);
}

export async function verifyApOriginalUpload(
  sb: Sb,
  ctx: ToolContext,
  job: string,
  record: string,
  version: number,
  id: string,
) {
  const actor = await member(sb, ctx);
  const upload = await apOriginalRpc<ApOriginal>(sb, "mcp_ap_original_upload_get", {
    _job: job,
    _record: record,
    _version: version,
    _id: id,
  });
  assertApOriginal(upload, job, record, version);
  if (upload.id !== id) throw new ToolError("That original upload is unavailable.");
  await checkedApOriginalBytes(upload);
  return apOriginalRpc<ApOriginal>(admin() as unknown as Sb, "mcp_ap_original_verify", {
    _job: job,
    _record: record,
    _version: version,
    _id: id,
    _size: upload.size_bytes,
    _sha256: upload.sha256,
    _actor: actor,
  });
}

export async function readApOriginal(
  sb: Sb,
  ctx: ToolContext,
  job: string,
  record: string,
  id: string,
) {
  await member(sb, ctx);
  const document = await apOriginalRpc<ApOriginal>(sb, "mcp_ap_original_get", {
    _job: job,
    _record: record,
    _id: id,
  });
  assertApOriginal(document, job, record);
  if (document.id !== id) throw new ToolError("That supplier original is unavailable.");
  return { document, bytes: await checkedApOriginalBytes(document) };
}
