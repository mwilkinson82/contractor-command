import { createClient } from "@supabase/supabase-js";
import { ToolError } from "@lovable.dev/mcp-js";
import type { Sb } from "./guard";
import { assertUploadBytes, readBounded, uploadMaxBytes } from "./file-upload";
import { sha256Hex } from "./file-share";

type Original = {
  id: string;
  job_id: string;
  company_id: string;
  filename: string;
  mime_type: string;
  storage_path: string;
};
type Verified = Original & { sha256: string; size_bytes: number };

async function requireMember(sb: Sb, token: string): Promise<void> {
  if (!token) throw new ToolError("Verified member required.");
  const identity = await sb.auth.getUser(token);
  if (identity.error || !identity.data.user?.id) throw new ToolError("Verified member required.");
}

/** Server-only download of an already authorized path, with no redirect and a bounded stream. */
export async function readBoundedFinancialStoragePath(path: string): Promise<Uint8Array> {
  if (path.split("/").length !== 4 || path.includes(".."))
    throw new ToolError("The original is unavailable.");
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const url = env?.SUPABASE_URL ?? env?.VITE_SUPABASE_URL;
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ToolError("Document retrieval is temporarily unavailable.");
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.storage
    .from("athena-financial-documents")
    .createSignedUrl(path, 60);
  if (error || !data?.signedUrl) throw new ToolError("The original is unavailable.");
  let signed: URL;
  try {
    signed = new URL(data.signedUrl);
  } catch {
    throw new ToolError("The original is unavailable.");
  }
  if (
    signed.origin !== new URL(url).origin ||
    !signed.pathname.startsWith("/storage/v1/object/sign/athena-financial-documents/") ||
    decodeURIComponent(
      signed.pathname.slice("/storage/v1/object/sign/athena-financial-documents/".length),
    ) !== path
  )
    throw new ToolError("The original is unavailable.");
  let response: Response;
  try {
    response = await fetch(signed, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new ToolError("The original is unavailable.");
  }
  if (!response.ok || response.status >= 300) throw new ToolError("The original is unavailable.");
  const bytes = await readBounded(response, uploadMaxBytes("financial_document"));
  return bytes;
}

/** Download only the path returned by a scoped RPC; signed URL remains server-side. */
async function boundedOriginal(original: Original): Promise<Uint8Array> {
  if (
    !original.storage_path.startsWith(
      `${original.company_id}/${original.job_id}/${original.id}/`,
    ) ||
    original.storage_path.split("/").length !== 4 ||
    original.storage_path.includes("..") ||
    original.storage_path.split("/")[3] !== original.filename
  )
    throw new ToolError("That original is not available for this project.");
  const bytes = await readBoundedFinancialStoragePath(original.storage_path);
  const checked = assertUploadBytes(bytes, original.filename, "financial_document");
  if (checked.mime !== original.mime_type)
    throw new ToolError("The original file type does not match its record.");
  return bytes;
}

/** Rechecks the active member and exact upload session before reading an unregistered original. */
export async function readUploadedFinancialOriginal(
  sb: Sb,
  token: string,
  job: string,
  id: string,
): Promise<Uint8Array> {
  await requireMember(sb, token);
  const { data, error } = await sb.rpc("mcp_billing_upload_get", { _job: job, _id: id });
  if (error || !data) throw new ToolError("That upload is not available for this project.");
  const upload = data as unknown as Original;
  if (upload.id !== id || upload.job_id !== job)
    throw new ToolError("That upload is not available for this project.");
  return boundedOriginal(upload);
}

/** An assigned superintendent can read only their own exact cost upload. */
export async function readUploadedCostReceipt(
  sb: Sb,
  token: string,
  job: string,
  record: string,
  id: string,
): Promise<Uint8Array> {
  await requireMember(sb, token);
  const { data, error } = await sb.rpc("mcp_cost_receipt_upload_get", {
    _job: job,
    _record: record,
    _id: id,
  });
  if (error || !data) throw new ToolError("That upload is not available for this submission.");
  const upload = data as unknown as Original & { record_id: string };
  if (upload.id !== id || upload.job_id !== job || upload.record_id !== record)
    throw new ToolError("That upload is not available for this submission.");
  return boundedOriginal(upload);
}

/** A scoped RPC authorizes one linked cost receipt before bytes are retrieved. */
export async function readVerifiedCostReceipt(
  sb: Sb,
  token: string,
  job: string,
  record: string,
  id: string,
): Promise<{ document: Verified; bytes: Uint8Array }> {
  await requireMember(sb, token);
  const { data, error } = await sb.rpc("mcp_cost_receipt_get", {
    _job: job,
    _record: record,
    _id: id,
  });
  if (error || !data) throw new ToolError("That receipt is not available for this submission.");
  const document = data as unknown as Verified & { record_id: string };
  if (document.id !== id || document.job_id !== job || document.record_id !== record)
    throw new ToolError("That receipt is not available for this submission.");
  const bytes = await boundedOriginal(document);
  if (bytes.length !== document.size_bytes || (await sha256Hex(bytes)) !== document.sha256)
    throw new ToolError("The receipt does not match its recorded fingerprint.");
  return { document, bytes };
}

/** Rechecks full project access and verifies type, size and SHA-256 before returning bytes. */
export async function readVerifiedFinancialOriginal(
  sb: Sb,
  token: string,
  job: string,
  id: string,
): Promise<{ document: Verified; bytes: Uint8Array }> {
  await requireMember(sb, token);
  const { data, error } = await sb.rpc("mcp_billing_documents_get", { _job: job });
  if (error || !data) throw new ToolError("That original is not available for this project.");
  const documents = (data as unknown as { documents: Verified[] }).documents;
  const document = documents.find((d) => d.id === id && d.job_id === job);
  if (!document) throw new ToolError("That original is not available for this project.");
  const bytes = await boundedOriginal(document);
  if (bytes.length !== document.size_bytes || (await sha256Hex(bytes)) !== document.sha256)
    throw new ToolError(
      "The original does not match its recorded fingerprint. Nothing was recorded.",
    );
  return { document, bytes };
}
