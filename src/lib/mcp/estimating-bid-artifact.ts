import { ToolError } from "@lovable.dev/mcp-js";
import type { Sb } from "./guard";
import type { Job } from "./jobs";
import { FILE_MAX_BYTES, safeFilename, sha256Hex, storagePath } from "./file-share";

export const BID_EXPORT_BUCKET = "athena-estimate-exports";

/** The dedicated private bucket retains estimating's full/contract scope.
 * athena-files also permits supers and cannot hold these monetary reports.
 * The bucket/policies are a local release proposal, not installed by this code.
 * A signed URL is a bearer link valid for 15 minutes after issuance. */
export async function saveBidArtifact(
  sb: Sb,
  job: Job,
  version: number,
  format: "pdf" | "xlsx",
  bytes: Uint8Array,
  sourceSha256: string,
) {
  if (!Number.isSafeInteger(version) || version < 0 || !/^[a-f0-9]{64}$/.test(sourceSha256))
    throw new ToolError("The estimate version is unavailable. Nothing was exported.");
  const verifyVersion = async () => {
    const { data, error } = await sb.rpc("mcp_estimate_coverage_snapshot", { _job: job.job_id });
    const current = data as { version?: unknown; bid?: { company_id?: unknown } } | null;
    if (error || current?.version !== version || current.bid?.company_id !== job.company_id)
      throw new ToolError(
        "The estimate changed or access is unavailable. Refresh before exporting.",
      );
  };
  await verifyVersion();
  const mime =
    format === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (!bytes.length || bytes.length > FILE_MAX_BYTES)
    throw new ToolError("The private bid export must be below 10 MB. Nothing was exported.");
  const filename = safeFilename(`Bid-summary-v${version}.${format}`).name;
  const path = storagePath(job.company_id, job.job_id, `export-${crypto.randomUUID()}`, filename);
  const bucket = sb.storage.from(BID_EXPORT_BUCKET);
  const uploaded = await bucket.upload(path, bytes, {
    contentType: mime,
    upsert: false,
    cacheControl: "no-store",
  });
  if (uploaded.error)
    throw new ToolError("Private bid PDF and spreadsheet downloads are unavailable right now. No download was created.");
  const signed = await bucket.createSignedUrl(path, 900);
  if (signed.error || !signed.data?.signedUrl)
    throw new ToolError("The private bid link could not be created. No download was returned.");
  const url = new URL(signed.data.signedUrl);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".supabase.co") ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(
      `/storage/v1/object/sign/${BID_EXPORT_BUCKET}/${job.company_id}/${job.job_id}/`,
    )
  )
    throw new ToolError("The private export link is invalid. No download was returned.");
  // Storage and database calls are separate transactions. If the job changes or
  // access is lost during upload, don't return the link. An unlinked private
  // object may remain; retries create a fresh object and never overwrite it.
  await verifyVersion();
  return {
    filename,
    url: signed.data.signedUrl,
    mime_type: mime,
    sha256: await sha256Hex(bytes),
    snapshot_version: version,
    company_id: job.company_id,
    job_id: job.job_id,
    source_sha256: sourceSha256,
    expires_in: 900,
  };
}
