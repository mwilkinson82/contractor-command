import { ToolError } from "@lovable.dev/mcp-js";
import type { Sb } from "./guard";

export type RecoverableUpload = {
  upload_id: string;
  company_id: string;
  job_id: string;
  purpose: "contract" | "spec" | "submittal_piece";
  filename: string;
  mime_type: string;
  expires_at: string;
  created_at: string;
  status: "open" | "finished";
  expired: boolean;
  bytes_received: boolean;
  received_via?: "object" | "chunks" | null;
  received_chunks?: number;
};
export type UploadRecovery = { uploads: RecoverableUpload[]; next_before: string | null };
export class UploadRecoveryUnavailable extends ToolError {
  constructor() {
    super(
      "Athena couldn't load pending uploads. Your current job files are unchanged. Please try again.",
    );
  }
}

/** The backend checks active membership, current job scope and upload creator on every call. */
export async function readUploadRecovery(
  sb: Sb,
  job: { job_id: string; company_id: string },
  options: { uploadId?: string; before?: string; limit?: number } = {},
): Promise<UploadRecovery> {
  if (typeof sb.rpc !== "function") throw new UploadRecoveryUnavailable();
  const { data, error } = await (
    sb.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: UploadRecovery | null; error: unknown }>
  )("mcp_file_upload_recovery", {
    _job: job.job_id,
    _upload: options.uploadId ?? null,
    _before: options.before ?? null,
    _limit: options.limit ?? 25,
  });
  if (
    error ||
    !data ||
    !Array.isArray(data.uploads) ||
    data.uploads.length > 25 ||
    data.uploads.some(
      (u) =>
        !u ||
        u.company_id !== job.company_id ||
        u.job_id !== job.job_id ||
        typeof u.upload_id !== "string" ||
        (options.uploadId && u.upload_id !== options.uploadId),
    )
  )
    throw new UploadRecoveryUnavailable();
  return data;
}

export async function requireOwnUpload(
  sb: Sb,
  job: { job_id: string; company_id: string },
  id: string,
) {
  const recovery = await readUploadRecovery(sb, job, { uploadId: id });
  if (recovery.uploads.length !== 1)
    throw new ToolError("That upload is not available to you on this job. No file was attached.");
  return recovery.uploads[0];
}
