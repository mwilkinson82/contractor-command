// Contract, spec, and submittal-piece files. The tool call stays small; the bytes use an upload link, a fetchable link, or chunks.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { newSubmittalPiece } from "../../submittal-piece-input";
import { dbError, run, text, type Sb } from "../guard";
import { FULL_ACCESS_MESSAGE, READ_ONLY_MESSAGE, audit, prefix, resolveJob } from "../jobs";
import { FileRejected, newToken, sha256Hex, tokenHash } from "../file-share";
import {
  DOC_BUCKET,
  FILE_UPLOAD_CALL_CHARS,
  FILE_UPLOAD_CHUNK_CHARS,
  FILE_UPLOAD_DESCRIPTION,
  assertUploadBytes,
  decodeChunk,
  extractUploadText,
  fetchAllowedFile,
  joinChunks,
  missingChunk,
  textParts,
  uploadFilename,
  uploadLink,
  uploadMaxBytes,
  type UploadPurpose,
} from "../file-upload";
import { findPackagePiece, pieceRef } from "../submittal-package";
import { submittalRpc } from "./submittal-package-tools";
import { guide } from "../visible";

const jobNumber = z.string().trim().min(1).max(40);
const companyId = z.string().trim().min(1).max(200).optional();

type Session = {
  id: string;
  bucket: string;
  storage_path: string;
  expires_at: string;
  purpose: UploadPurpose;
  filename: string;
  mime_type: string;
  status: "open" | "finished";
  chunks: number[];
  submittal_id: string | null;
  piece_id: string | null;
  new_piece: { kind: string; source_party: string; required?: boolean } | null;
  result: {
    visible?: string;
    structured?: Record<string, string | number | boolean | null>;
  } | null;
  company_id?: string;
};

const UPLOAD_GUIDE =
  "File upload for ChatGPT, Claude, and Grok Bot. action begin returns upload_url. Send the raw bytes to that URL with the file content type, or open the URL and choose the file. action from_url takes source_url or file.download_url when the client gives a fetchable https link. action chunk takes upload_id, chunk_index starting at 0, and content_base64 of at most 12000 characters, in order, then action finish. A stored contract or spec is what clause checks read, so intake can omit contract_text. A stored submittal piece is ready for submittal_package action build.";

async function rpc<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (
    sb.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )(fn, args);
  if (error) dbError(error);
  return data as T;
}

function rejected(e: unknown): never {
  if (e instanceof FileRejected) throw new ToolError(e.message);
  throw e;
}

async function asBytes(data: unknown): Promise<Uint8Array | null> {
  if (!data) return null;
  if (data instanceof Uint8Array) return data;
  if (typeof (data as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer === "function")
    return new Uint8Array(
      await (data as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer(),
    );
  return null;
}

async function download(sb: Sb, bucket: string, path: string): Promise<Uint8Array | null> {
  const res = await sb.storage.from(bucket).download(path);
  if (res.error || !res.data) return null;
  return asBytes(res.data);
}

async function storeObject(sb: Sb, bucket: string, path: string, bytes: Uint8Array, mime: string) {
  const up = await sb.storage
    .from(bucket)
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (!up.error) return;
  if (!/already exists|duplicate/i.test(up.error.message ?? ""))
    throw new ToolError("The file could not be stored. Try again. Nothing was saved.");
}

function purposeOf(value: string | undefined, action: string): UploadPurpose {
  if (value === "contract" || value === "spec" || value === "submittal_piece") return value;
  throw new ToolError(
    action === "from_url"
      ? "Say whether this file is the contract, a spec, or a submittal piece. Nothing was stored."
      : "Say whether this upload is the contract, a spec, or a submittal piece. Nothing was stored.",
  );
}

async function identify(sb: Sb, job: string, id?: string, number?: string) {
  if (id) return id;
  if (!number) throw new ToolError("Which submittal should this piece go on? Nothing was stored.");
  const result = await sb
    .from("mcp_submittals")
    .select("id,number,revision")
    .eq("job_id", job)
    .eq("number", number)
    .order("revision", { ascending: false })
    .limit(1);
  if (result.error) dbError(result.error);
  const row = (result.data?.[0] ?? null) as { id: string } | null;
  if (!row)
    throw new ToolError("That submittal number is not in this job's log. Nothing was stored.");
  return row.id;
}

type Item = {
  id: string;
  kind: string;
  source_party: string;
  status: string;
  file_ref?: string | null;
  required?: boolean;
};
async function pieceTarget(
  sb: Sb,
  jobId: string,
  args: {
    submittal_id?: string;
    submittal_number?: string;
    package_item?: string;
    package_item_id?: string;
    new_piece?: { kind: string; source_party: string; required?: boolean };
  },
) {
  const sid = await identify(sb, jobId, args.submittal_id, args.submittal_number);
  const data = await submittalRpc<{ is_current?: boolean; items: Item[] }>(
    sb,
    "mcp_submittal_package_context",
    { _job: jobId, _submittal: sid },
  );
  if (data.is_current === false)
    throw new ToolError("Use the latest revision from the living log. Nothing was stored.");
  const named = args.package_item ?? args.package_item_id;
  if (args.new_piece && named)
    throw new ToolError(
      "Choose an existing piece or add a new piece, not both. Nothing was stored.",
    );
  if (!named && !args.new_piece)
    throw new ToolError(
      `Name the piece (P1, P2, or its piece id) or add one with its kind and source. Pieces: ${data.items.length ? data.items.map((item, n) => `${pieceRef(n)} ${item.kind.replace(/_/g, " ")}`).join("; ") : "none logged yet"}.`,
    );
  let piece: Item | null = null;
  if (named) {
    try {
      piece = findPackagePiece(data.items, named) as Item;
    } catch (e) {
      throw new ToolError(e instanceof Error ? e.message : "Name one piece.");
    }
    if (!piece?.id)
      throw new ToolError(
        `That piece is not on this submittal. Pieces: ${data.items.map((item, n) => pieceRef(n)).join(", ") || "none"}.`,
      );
  }
  return {
    submittal_id: sid,
    piece_id: piece?.id ?? crypto.randomUUID(),
    new_piece: args.new_piece ?? null,
    items: data.items,
  };
}

function assertSessionPath(companyId: string, jobId: string, session: Session) {
  const root = `${companyId}/${jobId}/`;
  if (!session.storage_path.startsWith(root) || session.storage_path.includes(".."))
    throw new ToolError("That upload is not on this job. Nothing was stored.");
  if (session.purpose === "submittal_piece") {
    if (
      session.bucket !== "athena-submittals" ||
      !session.storage_path.startsWith(`${root}pieces/`)
    )
      throw new ToolError("That upload is not a submittal piece on this job. Nothing was stored.");
  } else if (session.bucket !== DOC_BUCKET || session.storage_path.split("/").length !== 4) {
    throw new ToolError("That upload is not a contract or spec on this job. Nothing was stored.");
  }
}

async function loadBytes(sb: Sb, session: Session): Promise<Uint8Array> {
  const direct = await download(sb, session.bucket, session.storage_path);
  if (direct?.length) return direct;
  const chunks = (session.chunks ?? []).map(Number);
  const gap = missingChunk(chunks);
  if (gap != null)
    throw new ToolError(
      chunks.length
        ? `Chunk index ${gap} hasn't arrived yet. Nothing was stored.`
        : "The file isn't in yet. Use the upload link, or send the chunks, then confirm. Nothing was stored.",
    );
  const parts: Uint8Array[] = [];
  for (let i = 0; i <= Math.max(...chunks); i++) {
    const part = await download(sb, session.bucket, `${session.storage_path}.part.${i}`);
    if (!part?.length)
      throw new ToolError(`Chunk index ${i} hasn't arrived yet. Nothing was stored.`);
    parts.push(part);
  }
  const bytes = joinChunks(parts);
  await storeObject(sb, session.bucket, session.storage_path, bytes, session.mime_type);
  return bytes;
}

function storedReply(
  visible: string,
  structured: Record<string, string | number | boolean | null>,
) {
  return guide({ ...text(visible), structuredContent: structured }, UPLOAD_GUIDE);
}

export const fileUpload = defineTool({
  name: "file_upload",
  title: "Upload a contract, spec, or submittal file",
  description: FILE_UPLOAD_DESCRIPTION,
  inputSchema: {
    action: z.enum(["begin", "chunk", "finish", "from_url"]),
    job_number: jobNumber,
    company_id: companyId,
    purpose: z.enum(["contract", "spec", "submittal_piece"]).optional(),
    filename: z.string().trim().min(1).max(120).optional(),
    upload_id: z.string().uuid().optional(),
    chunk_index: z.number().int().min(0).max(6000).optional(),
    content_base64: z.string().max(FILE_UPLOAD_CHUNK_CHARS).optional(),
    source_url: z.string().trim().max(8000).optional(),
    file: z
      .object({
        download_url: z.string().trim().max(8000),
        file_id: z.string().max(200).optional(),
        file_name: z.string().trim().min(1).max(120).optional(),
        mime_type: z.string().max(200).optional(),
      })
      .optional(),
    submittal_id: z.string().uuid().optional(),
    submittal_number: z.string().trim().min(1).max(40).optional(),
    package_item: z.string().trim().min(1).max(200).optional(),
    package_item_id: z.string().uuid().optional(),
    new_piece: newSubmittalPiece.optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: (args, ctx) =>
    run("file_upload", ctx, { jobNumber: args.job_number }, async (sb) => {
      const size = JSON.stringify(args).length;
      if (size > FILE_UPLOAD_CALL_CHARS)
        throw new ToolError(
          `Input is ${size.toLocaleString()} characters; the limit is 20,000. Trim or split it.`,
        );
      const job = await resolveJob(sb, args.job_number, args.company_id, "write");
      const purposeArg = args.purpose as UploadPurpose | undefined;
      if (purposeArg === "submittal_piece" && job.scope !== "full")
        throw new ToolError(FULL_ACCESS_MESSAGE);

      if (args.action === "begin") {
        const purpose = purposeOf(purposeArg, "begin");
        if (purpose === "submittal_piece" && job.scope !== "full")
          throw new ToolError(FULL_ACCESS_MESSAGE);
        let file: ReturnType<typeof uploadFilename>;
        try {
          file = uploadFilename(args.filename ?? "");
        } catch (e) {
          rejected(e);
        }
        const target =
          purpose === "submittal_piece" ? await pieceTarget(sb, job.job_id, args) : null;
        const token = newToken();
        const session = await rpc<Session>(sb, "mcp_file_upload_begin", {
          _job: job.job_id,
          _purpose: purpose,
          _filename: file.name,
          _mime: file.mime,
          _token_hash: await tokenHash(token),
          _submittal: target?.submittal_id ?? null,
          _piece: target?.piece_id ?? null,
          _new_piece: target?.new_piece ?? null,
        });
        const link = uploadLink(token);
        const label =
          purpose === "contract"
            ? "Contract"
            : purpose === "spec"
              ? "Specification"
              : "Submittal piece";
        return storedReply(
          [
            `${prefix(job)}${label} upload link ready for ${file.name}.`,
            "Open this link and choose the file, or send the raw file to this same link. The link works for 2 hours.",
            link,
          ].join("\n"),
          {
            upload_id: session.id,
            upload_url: link,
            expires_at: session.expires_at,
            filename: file.name,
            mime_type: file.mime,
            purpose,
            method:
              "PUT the raw bytes to upload_url, or open upload_url and choose the file, then call file_upload action finish with upload_id.",
          },
        );
      }

      if (args.action === "chunk") {
        if (!args.upload_id || args.chunk_index == null || !args.content_base64)
          throw new ToolError(
            "Send the upload id, the chunk index, and the chunk. Nothing was stored.",
          );
        if (args.content_base64.length > FILE_UPLOAD_CHUNK_CHARS)
          throw new ToolError(
            `That chunk is over ${FILE_UPLOAD_CHUNK_CHARS.toLocaleString()} characters. Nothing was stored.`,
          );
        const session = await rpc<Session | null>(sb, "mcp_file_upload_get", {
          _id: args.upload_id,
          _job: job.job_id,
        });
        if (!session) throw new ToolError("That upload is not on this job. Nothing was stored.");
        if (session.purpose === "submittal_piece" && job.scope !== "full")
          throw new ToolError(FULL_ACCESS_MESSAGE);
        if (new Date(session.expires_at).getTime() <= Date.now() || session.status !== "open")
          throw new ToolError("That upload link has expired. Start again. Nothing was stored.");
        assertSessionPath(job.company_id, job.job_id, session);
        let bytes: Uint8Array;
        try {
          bytes = decodeChunk(args.content_base64);
        } catch (e) {
          rejected(e);
        }
        await storeObject(
          sb,
          session.bucket,
          `${session.storage_path}.part.${args.chunk_index}`,
          bytes,
          session.mime_type,
        );
        await rpc(sb, "mcp_file_upload_chunk", {
          _id: session.id,
          _job: job.job_id,
          _index: args.chunk_index,
        });
        return storedReply(
          `${prefix(job)}Chunk ${args.chunk_index} stored for ${session.filename}.`,
          {
            upload_id: session.id,
            chunk_index: args.chunk_index,
            received: true,
          },
        );
      }

      if (args.action === "from_url") {
        const purpose = purposeOf(purposeArg, "from_url");
        if (purpose === "submittal_piece" && job.scope !== "full")
          throw new ToolError(FULL_ACCESS_MESSAGE);
        const url = args.source_url ?? args.file?.download_url;
        if (
          args.source_url &&
          args.file?.download_url &&
          args.source_url !== args.file.download_url
        )
          throw new ToolError("Provide one file link. Nothing was stored.");
        if (!url) throw new ToolError("Pass the file link. Nothing was stored.");
        let file: ReturnType<typeof uploadFilename>;
        try {
          file = uploadFilename(args.filename || args.file?.file_name || "");
        } catch (e) {
          rejected(e);
        }
        const target =
          purpose === "submittal_piece" ? await pieceTarget(sb, job.job_id, args) : null;
        let bytes: Uint8Array;
        try {
          bytes = await fetchAllowedFile(url, uploadMaxBytes(purpose));
          assertUploadBytes(bytes, file.name, purpose);
        } catch (e) {
          rejected(e);
        }
        const id = crypto.randomUUID();
        const path =
          purpose === "submittal_piece"
            ? `${job.company_id}/${job.job_id}/pieces/${id}/${file.name}`
            : `${job.company_id}/${job.job_id}/${id}/${file.name}`;
        const bucket = purpose === "submittal_piece" ? "athena-submittals" : DOC_BUCKET;
        await storeObject(sb, bucket, path, bytes, file.mime);
        return finishBytes(
          sb,
          job,
          {
            id,
            bucket,
            storage_path: path,
            purpose,
            filename: file.name,
            mime_type: file.mime,
            submittal_id: target?.submittal_id ?? null,
            piece_id: target?.piece_id ?? null,
            new_piece: target?.new_piece ?? null,
            tracked: false,
          },
          bytes,
        );
      }

      if (!args.upload_id)
        throw new ToolError("Which upload should be confirmed? Nothing was stored.");
      const session = await rpc<Session | null>(sb, "mcp_file_upload_get", {
        _id: args.upload_id,
        _job: job.job_id,
      });
      if (!session) throw new ToolError("That upload is not on this job. Nothing was stored.");
      if (session.purpose === "submittal_piece" && job.scope !== "full")
        throw new ToolError(FULL_ACCESS_MESSAGE);
      if (session.status === "finished" && session.result?.visible)
        return storedReply(
          session.result.visible,
          session.result.structured ?? { upload_id: session.id, stored: true },
        );
      if (new Date(session.expires_at).getTime() <= Date.now())
        throw new ToolError("That upload link has expired. Start again. Nothing was stored.");
      assertSessionPath(job.company_id, job.job_id, session);
      const bytes = await loadBytes(sb, session);
      return finishBytes(sb, job, { ...session, tracked: true }, bytes);
    }),
});

async function finishBytes(
  sb: Sb,
  job: {
    job_id: string;
    job_number: string;
    name: string;
    company_id: string;
    scope?: "full" | "contract" | "super";
  },
  session: Pick<
    Session,
    | "id"
    | "bucket"
    | "storage_path"
    | "purpose"
    | "filename"
    | "mime_type"
    | "submittal_id"
    | "piece_id"
    | "new_piece"
  > & { tracked?: boolean },
  bytes: Uint8Array,
) {
  let checked: ReturnType<typeof assertUploadBytes>;
  try {
    checked = assertUploadBytes(bytes, session.filename, session.purpose);
  } catch (e) {
    rejected(e);
  }
  const extracted =
    session.purpose === "submittal_piece" ? null : extractUploadText(bytes, checked.ext);
  let visible: string;
  let structured: Record<string, string | number | boolean | null>;
  if (session.purpose === "submittal_piece") {
    if (!session.submittal_id || !session.piece_id)
      throw new ToolError("That piece is not on this submittal. Nothing was stored.");
    const relative = session.storage_path;
    await submittalRpc(sb, "mcp_submittal_package_write", {
      _job: job.job_id,
      _submittal: session.submittal_id,
      _action: "attach",
      _p: {
        item_id: session.piece_id,
        path: relative,
        ...(session.new_piece ? { new_piece: session.new_piece } : {}),
      },
    });
    const after = await submittalRpc<{ items: Item[] }>(sb, "mcp_submittal_package_context", {
      _job: job.job_id,
      _submittal: session.submittal_id,
    });
    const index = after.items.findIndex(
      (item) => item.id === session.piece_id && item.file_ref === `athena-submittals/${relative}`,
    );
    if (index < 0)
      throw new ToolError(
        "The attachment could not be verified. Open the record before trying again.",
      );
    const item = after.items[index];
    visible = `${prefix(job)}${pieceRef(index)} ${item.kind.replace(/_/g, " ")} from ${item.source_party} is stored (${checked.name}).`;
    structured = {
      stored: true,
      purpose: "submittal_piece",
      upload_id: session.id,
      piece_id: session.piece_id,
      ref: pieceRef(index),
      filename: checked.name,
      file_ref: `athena-submittals/${relative}`,
    };
  } else {
    const parts = textParts(extracted?.text ?? "");
    const saved = await rpc<{ id: string; body_chars: number; truncated: boolean; name: string }>(
      sb,
      "mcp_contract_document_save",
      {
        _job: job.job_id,
        _p: {
          kind: session.purpose,
          name: checked.name,
          body: parts[0],
          bucket: DOC_BUCKET,
          path: session.storage_path,
          mime_type: checked.mime,
          size_bytes: bytes.length,
          file_sha256: await sha256Hex(bytes),
          upload_id: session.id,
          truncated: extracted?.truncated ?? false,
        },
      },
    );
    for (let i = 1; i < parts.length; i++) {
      const added = await rpc<{ body_chars: number }>(sb, "mcp_contract_document_append", {
        _job: job.job_id,
        _kind: session.purpose,
        _id: saved.id,
        _part: parts[i],
        _last: i === parts.length - 1,
      });
      parts[i] = "";
      saved.body_chars = added.body_chars;
    }
    const label = session.purpose === "contract" ? "Contract" : "Specification";
    const read = saved.body_chars
      ? `Text read from the file: ${saved.body_chars.toLocaleString()} characters${saved.truncated ? ", which is the most kept for clause checks" : ""}.`
      : "No text could be read from the file. The file is stored.";
    visible = [`${prefix(job)}${label} stored: ${saved.name}.`, read].join("\n");
    structured = {
      stored: true,
      purpose: session.purpose,
      upload_id: session.id,
      document_id: saved.id,
      filename: saved.name,
      body_chars: saved.body_chars,
      truncated: saved.truncated,
      size_bytes: bytes.length,
    };
  }
  const result = { visible, structured };
  if (session.tracked)
    await rpc(sb, "mcp_file_upload_complete", {
      _id: session.id,
      _job: job.job_id,
      _result: result,
    });
  await audit(sb, job, "file_upload", `store_${session.purpose}`, session.id);
  return storedReply(visible, structured);
}
