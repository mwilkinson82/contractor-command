import { newSubmittalPiece, submittalPieceMime } from "./submittal-piece-input";
import type { SubmittalRecordPayload } from "./submittal-record-page";
import type { PackageKind } from "./mcp/submittals";

const BUCKET = "athena-submittals",
  MAX_BYTES = 50 * 1024 * 1024;
type Result = { data?: unknown; error: { message: string } | null };
export type PieceUploadClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<Result>;
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        file: Blob,
        options: {
          contentType: string;
          upsert: false;
        },
      ): PromiseLike<Result>;
    };
  };
};
export type PieceUploadInput = {
  jobId: string;
  number: string;
  file: File;
  pieceId?: string;
  newPiece?: { kind: PackageKind; source_party: string; required: boolean };
};

/** Uses the existing member RLS and guarded attachment writer. Board tokens are never inputs. */
export async function uploadSubmittalPiece(client: PieceUploadClient, input: PieceUploadInput) {
  const mime = submittalPieceMime(input.file.name);
  if (!mime || !input.file.size || input.file.size > MAX_BYTES)
    throw new Error("Choose a PDF, PNG, JPEG, DOCX, XLSX or CSV between 1 byte and 50 MB.");
  if (!!input.pieceId === !!input.newPiece)
    throw new Error("Choose an existing piece or add a new piece.");
  const parsed = input.newPiece ? newSubmittalPiece.safeParse(input.newPiece) : undefined;
  if (parsed && !parsed.success)
    throw new Error("A new piece needs its kind and source (up to 120 characters).");
  const newPiece = parsed?.success ? parsed.data : undefined;
  const read = async () => {
    const result = await client.rpc("mcp_submittal_record_get", {
      _job: input.jobId,
      _number: input.number,
    });
    if (result.error || !result.data)
      throw new Error("The record could not be read with your account. Nothing was sent.");
    return result.data as SubmittalRecordPayload;
  };
  const before = await read();
  // The server independently checks the same permission again on storage INSERT and attachment.
  if (
    before.read_only !== false ||
    before.job_id !== input.jobId ||
    !before.company_id ||
    !before.current.id
  )
    throw new Error("Full job access is required to upload a piece. This view remains read only.");
  if (input.pieceId && !before.current.package_items?.some((p) => p.id === input.pieceId))
    throw new Error(
      "That piece is no longer in this revision. Reopen the record before uploading.",
    );
  const pieceId = input.pieceId ?? crypto.randomUUID();
  const path = `${before.company_id}/${input.jobId}/pieces/${crypto.randomUUID()}/${input.file.name}`;
  const stored = await client.storage
    .from(BUCKET)
    .upload(path, input.file, { contentType: mime, upsert: false });
  if (stored.error) throw new Error("The file could not be stored. No piece was added.");
  let writeError = false;
  try {
    const attached = await client.rpc("mcp_submittal_package_write", {
      _job: input.jobId,
      _submittal: before.current.id,
      _action: "attach",
      _p: { item_id: pieceId, path, ...(newPiece ? { new_piece: newPiece } : {}) },
    });
    writeError = !!attached.error;
  } catch {
    writeError = true;
  }
  // A committed read is the receipt, including when the attachment response was lost.
  const after = await read().catch(() => {
    throw new Error(
      "The file is stored, but its attachment could not be checked. Open the record before uploading again.",
    );
  });
  const items = after.current.package_items ?? [];
  const index = items.findIndex(
    (p) => p.id === pieceId && p.file_ref === `${BUCKET}/${path}` && p.status === "received",
  );
  if (index < 0)
    throw new Error(
      writeError
        ? "The file is stored, but its attachment was not confirmed. Check the record before uploading again."
        : "The attachment could not be verified. Check the record before uploading again.",
    );
  return { pieceId, ref: `P${index + 1}`, filename: input.file.name, payload: after };
}
