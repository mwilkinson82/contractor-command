// Contract, spec, and submittal-piece files. The tool call stays small; the bytes use an upload link, a fetchable link, or chunks.
import { ToolError, defineTool, type JsonValueInput } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { newSubmittalPiece } from "../../submittal-piece-input";
import { dbError, run, text, type Sb } from "../guard";
import {
  FULL_ACCESS_MESSAGE,
  READ_ONLY_MESSAGE,
  audit,
  memberCompanies,
  prefix,
  resolveJob,
} from "../jobs";
import { FileRejected, newToken, sha256Hex, tokenHash } from "../file-share";
import {
  DOC_BUCKET,
  EXTRACT_MAX_CHARS,
  FILE_UPLOAD_CALL_CHARS,
  FILE_UPLOAD_CHUNK_CHARS,
  FILE_UPLOAD_DESCRIPTION,
  assertUploadBytes,
  decodeChunk,
  extractUploadDocument,
  fetchAllowedFile,
  joinChunks,
  missingChunk,
  uploadFilename,
  uploadLink,
  uploadMaxBytes,
  type UploadPurpose,
} from "../file-upload";
import { findPackagePiece, pieceRef } from "../submittal-package";
import { submittalRpc } from "./submittal-package-tools";
import { prepareReadable, type ReadableSource } from "../document-readable";
import { guide } from "../visible";
import { readUploadRecovery, requireOwnUpload } from "../upload-recovery";
import { ambiguousCompanyMessage } from "../company-choice";
import { fileUploadCardResultMeta } from "../cards/file-upload-card";

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
  "Use the authenticated upload card for begin and resume; it uploads and calls finish automatically. Do not issue a parallel finish while the card is completing. For a text-only host, begin returns upload_url; after bytes arrive, call finish with the same upload_id without asking for another upload. Upload-link success alone confirms bytes only. Say the file is available on the job only after job_association is verified. project_documents list exposes the current member's own pending uploads on that exact job; use resume for the selected ID. The two-hour link expiry blocks new bytes, but authenticated finish can attach bytes received before expiry. Chunk recovery shows received parts; finish only after every intended chunk has been sent. from_url accepts a fetchable HTTPS file link; chunk accepts ordered base64 pieces of at most 12000 characters, then finish. Stored contract/spec files are the sources clause checks read, and stored submittal pieces are ready for package build.";

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

const ASSOCIATION_UNCONFIRMED =
  "The file's entry on this job could not be verified. Its upload may already be stored. Reload the job's files before retrying, and keep the same upload ID.";

/** Verify the member-visible job entry, not just a successful storage write or cached receipt. */
async function verifyDocumentAssociation(
  sb: Sb,
  job: { job_id: string; company_id: string },
  session: Pick<Session, "id" | "purpose" | "storage_path">,
  documentId?: string,
  fileHash?: string,
) {
  const { data, error } = await sb
    .from(session.purpose === "contract" ? "mcp_contract_documents" : "mcp_spec_documents")
    .select("id,company_id,job_id,upload_id,storage_bucket,storage_path,file_sha256")
    .eq("job_id", job.job_id)
    .eq("company_id", job.company_id)
    .eq("upload_id", session.id)
    .maybeSingle();
  if (
    error ||
    !data ||
    data.job_id !== job.job_id ||
    data.company_id !== job.company_id ||
    data.upload_id !== session.id ||
    data.storage_bucket !== DOC_BUCKET ||
    data.storage_path !== session.storage_path ||
    (documentId && data.id !== documentId) ||
    (fileHash && data.file_sha256 !== fileHash)
  )
    throw new ToolError(ASSOCIATION_UNCONFIRMED);
  return data.id;
}

async function loadBytes(
  sb: Sb,
  session: Session,
  mode?: "object" | "chunks" | null,
): Promise<Uint8Array> {
  const direct = await download(sb, session.bucket, session.storage_path);
  if (mode !== "chunks" && direct?.length) return direct;
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
  if (direct?.length && (await sha256Hex(direct)) !== (await sha256Hex(bytes)))
    throw new ToolError(
      "The assembled file differs from the received chunks. No attachment was confirmed.",
    );
  if (!direct?.length)
    await storeObject(sb, session.bucket, session.storage_path, bytes, session.mime_type);
  return bytes;
}

function storedReply(visible: string, structured: Record<string, unknown>) {
  return guide(
    {
      ...text(visible),
      structuredContent: structured as JsonValueInput,
      ...(structured.upload_context || Array.isArray(structured.pending_uploads)
        ? { _meta: fileUploadCardResultMeta }
        : {}),
    },
    UPLOAD_GUIDE,
  );
}

function uploadContext(
  job: { company_id: string; job_number: string },
  session: Pick<Session, "id" | "purpose" | "filename" | "mime_type" | "expires_at" | "status"> &
    Partial<Session>,
  bytesReceived: boolean,
  url?: string,
) {
  return {
    company_id: job.company_id,
    job_number: job.job_number,
    upload_id: session.id,
    filename: session.filename,
    mime_type: session.mime_type,
    purpose: session.purpose,
    expires_at: session.expires_at,
    status: session.status,
    bytes_received: bytesReceived,
    expired: session.status !== "finished" && new Date(session.expires_at).getTime() <= Date.now(),
    ...(url ? { upload_url: url } : {}),
    restart: {
      company_id: job.company_id,
      job_number: job.job_number,
      purpose: session.purpose,
      filename: session.filename,
      ...(session.submittal_id ? { submittal_id: session.submittal_id } : {}),
      ...(session.new_piece
        ? { new_piece: session.new_piece }
        : session.piece_id
          ? { package_item: session.piece_id }
          : {}),
    },
  };
}

export const fileUpload = defineTool({
  name: "file_upload",
  title: "Upload a contract, spec, or submittal file",
  description: FILE_UPLOAD_DESCRIPTION,
  inputSchema: {
    action: z.enum([
      "begin",
      "chunk",
      "finish",
      "from_url",
      "prepare_readable",
      "pending",
      "resume",
    ]),
    job_number: jobNumber,
    company_id: companyId,
    purpose: z.enum(["contract", "spec", "submittal_piece"]).optional(),
    filename: z.string().trim().min(1).max(120).optional(),
    upload_id: z.string().uuid().optional(),
    before_upload: z.string().uuid().optional(),
    document_id: z.string().uuid().optional(),
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
      if (args.company_id) {
        const want = args.company_id.trim().toLowerCase();
        const companies = await memberCompanies(sb);
        const byId = companies.find((c) => c.id.toLowerCase() === want);
        const named = byId ? [byId] : companies.filter((c) => c.name.trim().toLowerCase() === want);
        if (named.length > 1) throw new ToolError(ambiguousCompanyMessage(args.company_id, named));
        if (named.length !== 1 || named[0].id !== job.company_id)
          throw new ToolError("That job is not in the company you named. Nothing changed.");
      }
      const purposeArg = args.purpose as UploadPurpose | undefined;
      if (purposeArg === "submittal_piece" && job.scope !== "full")
        throw new ToolError(FULL_ACCESS_MESSAGE);

      if (args.action === "pending") {
        const pending = await readUploadRecovery(sb, job, { before: args.before_upload });
        return storedReply(
          `${prefix(job)}Pending uploads: ${pending.uploads.length}. Choose an upload to resume.`,
          {
            company_id: job.company_id,
            job_number: job.job_number,
            upload_recovery_view: true,
            pending_uploads: pending.uploads,
            pending_next_before: pending.next_before,
          },
        );
      }
      if (args.action === "resume") {
        if (!args.upload_id) throw new ToolError("Choose a pending upload from this job's files.");
        const owned = await requireOwnUpload(sb, job, args.upload_id);
        const session = await rpc<Session | null>(sb, "mcp_file_upload_get", {
          _id: args.upload_id,
          _job: job.job_id,
        });
        if (!session) throw new ToolError("That upload is not available to you on this job.");
        assertSessionPath(job.company_id, job.job_id, session);
        return storedReply(
          `${prefix(job)}${session.filename}: ${owned.bytes_received ? (owned.received_via === "chunks" ? "Received chunks; finish only after all intended chunks have been sent." : "Upload received; job attachment is awaiting confirmation.") : owned.expired ? "Upload link expired before eligible bytes arrived." : "Waiting for the file."}`,
          {
            company_id: job.company_id,
            job_number: job.job_number,
            upload_id: session.id,
            upload_context: {
              ...uploadContext(job, session, owned.bytes_received),
              received_via: owned.received_via ?? null,
              received_chunks: owned.received_chunks ?? 0,
            },
          },
        );
      }

      if (args.action === "prepare_readable") {
        if (job.scope !== "full" && job.scope !== "contract")
          throw new ToolError(READ_ONLY_MESSAGE);
        if (!args.document_id)
          throw new ToolError("Choose the exact saved document_id. No upload is required.");
        const sources: (ReadableSource & { mime_type: string })[] = [];
        for (const table of ["mcp_contract_documents", "mcp_spec_documents"] as const) {
          const { data, error } = await sb
            .from(table)
            .select(
              "id,company_id,job_id,upload_id,storage_bucket,storage_path,file_sha256,size_bytes,mime_type",
            )
            .eq("job_id", job.job_id)
            .eq("company_id", job.company_id)
            .eq("id", args.document_id)
            .maybeSingle();
          if (error) dbError(error);
          if (data) sources.push(data as unknown as ReadableSource & { mime_type: string });
        }
        if (sources.length !== 1 || sources[0].mime_type !== "application/pdf")
          throw new ToolError("Choose one saved PDF source on this job. Nothing changed.");
        const source = sources[0];
        // Validate the exact scoped reference before downloading any bytes.
        const { readableKey } = await import("../document-readable");
        readableKey(source);
        const bytes = await download(sb, DOC_BUCKET, source.storage_path!);
        if (!bytes) throw new ToolError("The original could not be read with current job access.");
        const ready = await prepareReadable(sb, source, bytes);
        await audit(sb, job, "file_upload", "prepare_readable", source.id);
        return storedReply(
          `Complete readable PDF prepared for job ${job.job_number}: ${ready.document.total_pdf_pages} physical pages. Original and contract facts unchanged.`,
          {
            document_id: source.id,
            readable_state: "ready",
            clause_index_state: "extracted",
            clause_count: ready.clause_count,
            clause_index_reused: ready.clause_index_reused,
            total_pdf_pages: ready.document.total_pdf_pages,
            source_sha256: source.file_sha256,
            reused_extraction: ready.reused,
            original_changed: false,
          },
        );
      }
      if (args.action === "begin") {
        // Confirm the reviewed recovery surface is installed before creating an upload.
        await readUploadRecovery(sb, job);
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
        return storedReply(
          [
            `${prefix(job)}Add ${file.name} with the upload card. It uploads the file and confirms its job attachment in one action.`,
            "The upload link is an alternative when this host cannot show upload controls. It works for 2 hours; pending uploads remain visible in this job's files.",
            link,
          ].join("\n"),
          {
            upload_id: session.id,
            upload_context: uploadContext(job, { ...session, ...target }, false, link),
            upload_complete: false,
            job_association: "unconfirmed",
            finish_required: true,
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
        await requireOwnUpload(sb, job, args.upload_id);
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
      const owned = await requireOwnUpload(sb, job, args.upload_id);
      const session = await rpc<Session | null>(sb, "mcp_file_upload_get", {
        _id: args.upload_id,
        _job: job.job_id,
      });
      if (!session) throw new ToolError("That upload is not on this job. Nothing was stored.");
      if (session.purpose === "submittal_piece" && job.scope !== "full")
        throw new ToolError(FULL_ACCESS_MESSAGE);
      if (session.status === "finished" && session.result?.visible) {
        assertSessionPath(job.company_id, job.job_id, session);
        const cached: Record<string, string | number | boolean | null> = {
          ...session.result.structured,
          company_id: job.company_id,
          job_number: job.job_number,
          upload_id: session.id,
          filename: session.filename,
          job_association: "verified",
          upload_complete: true,
          finish_required: false,
        };
        if (session.purpose === "submittal_piece") {
          const context = await submittalRpc<{ items: Item[] }>(
            sb,
            "mcp_submittal_package_context",
            {
              _job: job.job_id,
              _submittal: session.submittal_id,
            },
          );
          if (
            !session.piece_id ||
            !context.items.some(
              (item) =>
                item.id === session.piece_id &&
                item.file_ref === `athena-submittals/${session.storage_path}`,
            )
          )
            throw new ToolError(ASSOCIATION_UNCONFIRMED);
        } else {
          cached.document_id = await verifyDocumentAssociation(
            sb,
            job,
            session,
            typeof cached.document_id === "string" ? cached.document_id : undefined,
          );
        }
        // A completed specification with no extracted text may be retried after a
        // parser repair. Never replace an official contract or create another source.
        if (session.purpose === "spec" && cached?.body_chars === 0) {
          assertSessionPath(job.company_id, job.job_id, session);
          const { data: doc, error } = await sb
            .from("mcp_spec_documents")
            .select("id,body,storage_path,file_sha256")
            .eq("job_id", job.job_id)
            .eq("upload_id", session.id)
            .maybeSingle();
          if (error) dbError(error);
          if (!doc || doc.id !== cached.document_id || doc.storage_path !== session.storage_path)
            throw new ToolError("The stored specification could not be verified. Nothing changed.");
          if (doc.body)
            return storedReply(
              `${prefix(job)}Specification stored: ${session.filename}.\nText read from the file: ${doc.body.length.toLocaleString()} characters.`,
              {
                ...cached,
                body_chars: doc.body.length,
                truncated: doc.body.length >= EXTRACT_MAX_CHARS,
              },
            );
          const bytes = await loadBytes(sb, session);
          if (!doc.file_sha256 || (await sha256Hex(bytes)) !== doc.file_sha256)
            throw new ToolError(
              "The stored specification's original bytes could not be verified. Nothing changed.",
            );
          const extracted = await extractUploadDocument(
            bytes,
            uploadFilename(session.filename).ext,
          );
          if (extracted.chars) return finishBytes(sb, job, { ...session, tracked: false }, bytes);
        }
        return storedReply(session.result.visible, cached);
      }
      if (
        new Date(session.expires_at).getTime() <= Date.now() &&
        (!owned.bytes_received || !owned.received_via)
      )
        throw new ToolError(
          "The upload link expired before eligible bytes were received. Start a new upload from Athena.",
        );
      assertSessionPath(job.company_id, job.job_id, session);
      const bytes = await loadBytes(sb, session, owned.received_via);
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
    session.purpose === "submittal_piece" ? null : await extractUploadDocument(bytes, checked.ext);
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
    const fileHash = await sha256Hex(bytes);
    const saved = await rpc<{ id: string; body_chars: number; truncated: boolean; name: string }>(
      sb,
      "mcp_contract_document_save",
      {
        _job: job.job_id,
        _p: {
          kind: session.purpose,
          name: checked.name,
          body: extracted?.text ?? "",
          bucket: DOC_BUCKET,
          path: session.storage_path,
          mime_type: checked.mime,
          size_bytes: bytes.length,
          file_sha256: fileHash,
          upload_id: session.id,
          truncated: extracted?.truncated ?? false,
        },
      },
    );
    await verifyDocumentAssociation(sb, job, session, saved.id, fileHash);
    let readableState = "not_pdf";
    let readablePages: number | null = null;
    let clauseCount: number | null = null;
    if (checked.ext === "pdf") {
      try {
        const ready = await prepareReadable(
          sb,
          {
            id: saved.id,
            company_id: job.company_id,
            job_id: job.job_id,
            upload_id: session.id,
            storage_bucket: DOC_BUCKET,
            storage_path: session.storage_path,
            file_sha256: await sha256Hex(bytes),
            size_bytes: bytes.length,
          },
          bytes,
          extracted?.pdf_pages,
        );
        readableState = "ready";
        readablePages = ready.document.total_pdf_pages;
        clauseCount = ready.clause_count;
      } catch {
        readableState = "failed";
      }
    }
    const label = session.purpose === "contract" ? "Contract" : "Specification";
    const read = saved.body_chars
      ? `Text read from the file: ${saved.body_chars.toLocaleString()} characters${saved.truncated ? ", which is the most kept for clause checks" : ""}.`
      : "No text could be read from the file. The file is stored.";
    visible = [
      `${prefix(job)}${label} stored: ${saved.name}.`,
      read,
      readableState === "ready"
        ? `Complete reusable readable document ready: ${readablePages} physical PDF pages.`
        : readableState === "failed"
          ? "Complete readable document preparation failed. Original is stored; use explicit prepare_readable to retry. Cached text may be incomplete."
          : "",
    ]
      .filter(Boolean)
      .join("\n");
    structured = {
      stored: true,
      purpose: session.purpose,
      upload_id: session.id,
      document_id: saved.id,
      filename: saved.name,
      readable_state: readableState,
      total_pdf_pages: readablePages,
      clause_index_state: readableState === "ready" ? "extracted" : "unavailable",
      clause_count: clauseCount,
      body_chars: saved.body_chars,
      truncated: saved.truncated,
      size_bytes: bytes.length,
    };
  }
  structured = {
    ...structured,
    company_id: job.company_id,
    job_number: job.job_number,
    job_association: "verified",
    upload_complete: true,
    finish_required: false,
  };
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
