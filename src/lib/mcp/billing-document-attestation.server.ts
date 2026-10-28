import { createClient } from "@supabase/supabase-js";
import { ToolError, type ToolContext } from "@lovable.dev/mcp-js";
import { dbError, type Sb } from "./guard";

/** Called only after the original has been downloaded and its type, size and hash checked. */
export async function registerVerifiedBillingOriginal(
  sb: Sb,
  ctx: ToolContext,
  job: string,
  upload: string,
  size: number,
  sha256: string,
): Promise<{ id: string; already_stored: boolean }> {
  const token = ctx.getToken();
  if (!token) throw new ToolError("Verified member required.");
  const identity = await sb.auth.getUser(token);
  if (identity.error || !identity.data.user?.id) throw new ToolError("Verified member required.");
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const url = env?.SUPABASE_URL ?? env?.VITE_SUPABASE_URL;
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ToolError("Document verification is temporarily unavailable.");
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("mcp_billing_document_register", {
    _job: job,
    _id: upload,
    _size: size,
    _sha256: sha256,
    _actor: identity.data.user.id,
  });
  if (error) dbError(error);
  return data as { id: string; already_stored: boolean };
}

/** Called only after re-reading and fingerprint-checking the original; rechecks the actor in SQL. */
export async function linkVerifiedBillingOriginal(
  sb: Sb,
  ctx: ToolContext,
  job: string,
  document: string,
  invoice: string | null,
  version: number | null,
  receipt: string | null,
): Promise<{ already_linked: boolean }> {
  const token = ctx.getToken();
  if (!token) throw new ToolError("Verified member required.");
  const identity = await sb.auth.getUser(token);
  if (identity.error || !identity.data.user?.id) throw new ToolError("Verified member required.");
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const url = env?.SUPABASE_URL ?? env?.VITE_SUPABASE_URL;
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ToolError("Document verification is temporarily unavailable.");
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("mcp_billing_document_link", {
    _job: job,
    _document: document,
    _invoice: invoice,
    _version: version,
    _receipt: receipt,
    _actor: identity.data.user.id,
  });
  if (error) dbError(error);
  return data as { already_linked: boolean };
}

/** Atomically records facts and attaches an original, only after byte verification. */
export async function recordWithVerifiedBillingOriginal(
  sb: Sb,
  ctx: ToolContext,
  job: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const token = ctx.getToken();
  if (!token) throw new ToolError("Verified member required.");
  const identity = await sb.auth.getUser(token);
  if (identity.error || !identity.data.user?.id) throw new ToolError("Verified member required.");
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const url = env?.SUPABASE_URL ?? env?.VITE_SUPABASE_URL;
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ToolError("Document verification is temporarily unavailable.");
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("mcp_billing_record_document", {
    _job: job,
    _action: action,
    _p: payload,
    _actor: identity.data.user.id,
  });
  if (error) dbError(error);
  return data as Record<string, unknown>;
}

/** Reserve a bounded attempt for the verified upload owner before fetching attached bytes. */
export async function reserveBillingMemberUpload(
  sb: Sb,
  ctx: ToolContext,
  upload: {
    id: string;
    job_id: string;
    company_id: string;
    filename: string;
    mime_type: string;
    storage_path: string;
  },
): Promise<(bytes: Uint8Array) => Promise<void>> {
  const token = ctx.getToken();
  if (!token) throw new ToolError("Verified member required.");
  const identity = await sb.auth.getUser(token);
  if (identity.error || !identity.data.user?.id) throw new ToolError("Verified member required.");
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const url = env?.SUPABASE_URL ?? env?.VITE_SUPABASE_URL;
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ToolError("Document upload is temporarily unavailable.");
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("mcp_billing_upload_claim", {
    _id: upload.id,
    _actor: identity.data.user.id,
    _token_hash: null,
  });
  if (error) dbError(error);
  if (
    !data ||
    !["open", "finished"].includes(data.status) ||
    ["id", "job_id", "company_id", "filename", "mime_type", "storage_path"].some(
      (key) => data[key] !== upload[key as keyof typeof upload],
    ) ||
    !upload.storage_path.startsWith(`${upload.company_id}/${upload.job_id}/${upload.id}/`) ||
    upload.storage_path.split("/").length !== 4 ||
    upload.storage_path.includes("..")
  )
    throw new ToolError("That upload is not available for this project.");
  return async (bytes) => {
    const { assertUploadBytes } = await import("./file-upload");
    const { sha256Hex } = await import("./file-share");
    const checked = assertUploadBytes(bytes, upload.filename, "financial_document");
    if (checked.mime !== upload.mime_type)
      throw new ToolError("That file does not match this upload.");
    // A completed session can only compare the original; it may never insert again.
    const stored =
      data.status === "finished"
        ? { error: true }
        : await admin.storage
            .from("athena-financial-documents")
            .upload(upload.storage_path, bytes, { contentType: upload.mime_type, upsert: false });
    if (stored.error) {
      const { readBoundedFinancialStoragePath } = await import("./billing-original.server");
      const previous = await readBoundedFinancialStoragePath(upload.storage_path);
      if (
        previous.length !== bytes.length ||
        (await sha256Hex(previous)) !== (await sha256Hex(bytes))
      )
        throw new ToolError(
          "A different file is already stored for this upload. Start a new upload.",
        );
    }
  };
}
