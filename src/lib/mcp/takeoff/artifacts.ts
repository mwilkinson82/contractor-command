import { ToolError } from "@lovable.dev/mcp-js";
import type { Sb } from "../guard";
import type { Job } from "../jobs";
import { FILE_BUCKET, FILE_MAX_BYTES, sha256Hex, safeFilename, storagePath } from "../file-share";
export type PrivateArtifact = {
  filename: string;
  path: string;
  content_hash: string;
  url: string;
  mime_type: string;
};
export async function saveTakeoffArtifact(
  sb: Sb,
  job: Job,
  filename: string,
  bytes: Uint8Array,
  mime: string,
): Promise<PrivateArtifact> {
  if (!bytes.length || bytes.length > FILE_MAX_BYTES)
    throw new ToolError(
      "Split this derived takeoff output into files below 10 MB. The original is unchanged.",
    );
  const name = safeFilename(filename).name,
    path = storagePath(
      job.company_id,
      job.job_id,
      `drawing-markup-takeoff-output-${crypto.randomUUID()}`,
      name,
    ),
    bucket = sb.storage.from(FILE_BUCKET);
  const upload = await bucket.upload(path, bytes, {
    contentType: mime,
    upsert: false,
    cacheControl: "no-store",
  });
  if (upload.error)
    throw new ToolError(
      "The derived takeoff file was not stored. No completed export was confirmed.",
    );
  const signed = await bucket.createSignedUrl(path, 900);
  if (signed.error || !signed.data?.signedUrl)
    throw new ToolError(
      "The private takeoff link could not be created. Retry without changing the original.",
    );
  return {
    filename: name,
    path,
    content_hash: await sha256Hex(bytes),
    url: signed.data.signedUrl,
    mime_type: mime,
  };
}
export function artifactRecord<T extends { url?: string }>(artifact: T): Omit<T, "url"> {
  const { url: _, ...record } = artifact;
  return record;
}
