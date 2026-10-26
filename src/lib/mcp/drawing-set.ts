import { DRAWING_MARKUP_REQUIRED, drawingMarkupCard } from "./drawing-markup";
import { pdfPageCount } from "./pdf-pages";
import { htmlBlock } from "./cards/markdown";
// Stored drawing sets. New originals use a dedicated private drawing bucket; #190
// originals remain in athena-files. Both use the same guarded
// company/job path file_share uses. The document entry keeps its old fields and gains
// a nullable path. A takeoff read returns one rendered page only when that path
// belongs to the caller's company and job.
import { ToolError } from "@lovable.dev/mcp-js";
import { bytesToBase64 } from "./estimating-sheet";
import type { Doc } from "./estimating";
import {
  FILE_BUCKET,
  FILE_MAX_BYTES,
  FileRejected,
  allowedDownloadUrl,
  downloadDrawingSource,
  drawingSource,
  decodeBase64,
  safeFilename,
  sha256Hex,
  storagePath,
  validateFile,
} from "./file-share";

export const DRAWING_URL_SECONDS = 15 * 60;
export const DRAWING_BUCKET = "athena-drawings";
/** New original drawings. file_share and generated markup PDFs stay on FILE_MAX_BYTES. */
export const DRAWING_MAX_BYTES = 100 * 1024 * 1024;
export const DRAWING_B64_MAX_CHARS = Math.ceil(DRAWING_MAX_BYTES / 3) * 4 + 8;
export const drawingTooBigMessage = () =>
  `That drawing is over ${DRAWING_MAX_BYTES / 1024 / 1024} MB. Nothing was stored.`;
export const ORIGINAL_DELETE_REFUSAL =
  "Stored original drawings cannot be deleted. Nothing was removed.";
export const MARKUP_DELETE_REFUSAL = "Stored markups cannot be deleted. Nothing was removed.";

type StoredObjectRow = {
  path?: string | null;
  kind?: string | null;
  storage_bucket?: string | null;
};

/** 100 MB only when the object is written to athena-drawings. athena-files stays at 10 MB. */
export function drawingUploadLimit(bucketName: string): number {
  return bucketName === DRAWING_BUCKET ? DRAWING_MAX_BYTES : FILE_MAX_BYTES;
}

/** True for the drawings bucket, an original-set path, or any stored source record. */
export function originalDeleteRefused(
  bucketName: string,
  path: string,
  records: StoredObjectRow[] = [],
): boolean {
  if (bucketName === DRAWING_BUCKET) return true;
  const folder = path.split("/")[2] ?? "";
  if (folder.startsWith("drawing-") && !folder.startsWith("drawing-markup-")) return true;
  return records.some((row) => {
    if (!row.path || row.path !== path) return false;
    if (row.kind === "markup") return false;
    return row.kind == null || row.kind === "source" || row.storage_bucket === DRAWING_BUCKET;
  });
}

/** Cleanup may not remove a stored original or a saved markup. */
export function immutableDrawingDeleteRefused(
  bucketName: string,
  path: string,
  records: StoredObjectRow[] = [],
): string | null {
  if (originalDeleteRefused(bucketName, path, records)) return ORIGINAL_DELETE_REFUSAL;
  const folder = path.split("/")[2] ?? "";
  if (
    folder.startsWith("drawing-markup-") ||
    records.some((row) => row.path === path && row.kind === "markup")
  )
    return MARKUP_DELETE_REFUSAL;
  return null;
}
const MAX_PAGES = 4;

export type DrawingUpload = {
  filename?: string;
  content_base64?: string;
  file?: { download_url: string; file_id: string; mime_type?: string; file_name?: string };
  sheets?: string[];
  source_url?: string;
  /** Direct upload confirm: the content-hash path and the upload route's signed receipt. */
  staged_path?: string;
  upload_receipt?: string;
  /**
   * Internal: an object the direct upload route already wrote to athena-drawings,
   * from its signed receipt. The confirm step never downloads it again.
   */
  staged?: { path: string; content_hash: string; size: number };
};

export type DrawingJob = { company_id: string; job_id: string };

export type StoredDrawing = {
  name: string;
  path: string;
  sheets?: string[];
  record: DrawingRecord;
  duplicate: boolean;
  pageCount?: number;
};
export type DrawingRecord = {
  id: string;
  path: string;
  filename: string;
  content_hash: string;
  source_key: string;
  source_url: string | null;
  sheets: string[];
  version: number;
  created_at: string;
  sheet?: string;
  page?: number;
  parent_id?: string;
  storage_bucket?: string;
};

export type SheetPage = {
  sheet: string;
  page: number;
  png: Uint8Array;
  signedUrl: string;
};

type Bucket = {
  upload: (
    path: string,
    body: Uint8Array,
    opts: { contentType: string; upsert: boolean; cacheControl: string },
  ) => Promise<{ error: { message: string } | null }>;
  download: (path: string) => Promise<{
    data: { arrayBuffer: () => Promise<ArrayBuffer> } | null;
    error: { message: string } | null;
  }>;
  createSignedUrl: (
    path: string,
    seconds: number,
  ) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
  remove: (paths: string[]) => Promise<{ error: { message: string } | null }>;
};

export type DrawingStore = {
  storage: { from: (bucket: string) => Bucket };
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export async function drawingRpc<T>(
  sb: DrawingStore,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await sb.rpc(name, args);
  if (error || data == null)
    throw new ToolError(
      "Drawing version storage is unavailable. Try again after the drawing storage update is installed.",
    );
  return data as T;
}

export const drawingRecords = (sb: DrawingStore, job: DrawingJob) =>
  drawingRpc<DrawingRecord[]>(sb, "mcp_drawing_records", { _job: job.job_id });

export function drawingBucket(record?: Pick<DrawingRecord, "storage_bucket">): string {
  const name = record?.storage_bucket ?? FILE_BUCKET;
  if (name !== FILE_BUCKET && name !== DRAWING_BUCKET)
    throw new ToolError("The stored drawing has an invalid storage location.");
  return name;
}
const bucket = (sb: DrawingStore, name = FILE_BUCKET) => sb.storage.from(name);

/** True only for this company and job, and only for a drawing object. */
export function drawingOwned(path: string, companyId: string, jobId: string): boolean {
  if (!path || path.includes("..") || path.includes("\\") || path.startsWith("/")) return false;
  const parts = path.split("/");
  if (parts.length !== 4 || parts.some((part) => !part || part === "." || part === ".."))
    return false;
  return parts[0] === companyId && parts[1] === jobId && parts[2].startsWith("drawing-");
}

/** Sheet order on the document entry is the page order. The first sheet is page 1. */
export function sheetPageIndex(sheets: string[] | undefined, sheet: string): number | null {
  const want = sheet.trim().toLowerCase();
  if (!want || !sheets?.length) return null;
  const index = sheets.findIndex((name) => name.trim().toLowerCase() === want);
  return index >= 0 ? index : null;
}

/** The named sheet, plus sheets on lines that carry a markup. Capped so one call stays small. */
export function sheetsForMarkup(input: {
  sheet?: string | null;
  lines: { sheet?: string | null; markup_ref?: string | null }[];
}): string[] {
  const out: string[] = [];
  const add = (raw: string | null | undefined) => {
    const sheet = raw?.trim();
    if (!sheet || out.length >= MAX_PAGES) return;
    if (out.some((name) => name.toLowerCase() === sheet.toLowerCase())) return;
    out.push(sheet);
  };
  add(input.sheet);
  for (const line of input.lines) if (line.markup_ref?.trim()) add(line.sheet);
  return out;
}

/** Keep a path Athena stored. A path sent by the host is ignored. */
export function keepDrawingPaths(next: Doc[], prior: Doc[]): Doc[] {
  return next.map((doc) => {
    const { path: _client, ...rest } = doc;
    const prev = prior.find(
      (row) => row.name.trim().toLowerCase() === doc.name.trim().toLowerCase(),
    );
    return prev?.path ? { ...rest, path: prev.path } : rest;
  });
}

/** Record the stored object on the matching document entry, or append one. Other fields stay. */
export function withDrawingPath(
  documents: Doc[],
  stored: Pick<StoredDrawing, "name" | "path" | "sheets">,
): Doc[] {
  const docs = documents.map((doc) => ({
    ...doc,
    sheets: doc.sheets ? [...doc.sheets] : doc.sheets,
  }));
  const name = stored.name.trim().toLowerCase();
  let hit = docs.find((doc) => doc.name.trim().toLowerCase() === name);
  if (!hit) {
    const sets = docs.filter((doc) => doc.kind !== "spec");
    if (sets.length === 1) hit = sets[0];
  }
  if (hit) {
    hit.path = stored.path;
    if (stored.sheets?.length) hit.sheets = [...stored.sheets];
    return docs;
  }
  docs.push({
    name: stored.name,
    kind: "base",
    sheets: stored.sheets ? [...stored.sheets] : [],
    path: stored.path,
  });
  return docs;
}

export function sheetPageLine(sheet: string, page: number): string {
  return `Stored page for ${sheet}, page ${page} of the drawing set. Use this page for "mark up drawing ${sheet}" asks. Do not ask for an attachment.`;
}

const storedMessage = (message: string) =>
  message.replaceAll("Nothing was shared.", "Nothing was stored.");

/** Explain a rejected host handoff without exposing its signed path or credentials. */
function rejectedDrawingLink(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "The attachment did not include an HTTPS download link. Nothing was stored.";
  }
  if (url.protocol !== "https:")
    return "The attachment supplied a local or non-HTTPS link instead of an HTTPS download link. Nothing was stored.";
  if (url.username || url.password)
    return "The attachment download link contains embedded sign-in details. Nothing was stored.";
  return `Athena does not yet accept attachment downloads from ${url.hostname}. Nothing was stored.`;
}

// Exact ChatGPT file-parameter storage accounts. Azure names are first-come,
// so a prefix such as oai* would accept an account any customer can register.
// oaisdmntprbrazilsouth: live #231 handoff. oaisdmntpreastus2: live 2026-10-23 handoff.
export const CHATGPT_DRAWING_HOSTS = [
  "oaisdmntprbrazilsouth.blob.core.windows.net",
  "oaisdmntpreastus2.blob.core.windows.net",
] as const;
const CHATGPT_DRAWING_HOST_SET = new Set<string>(CHATGPT_DRAWING_HOSTS);

export function allowedDrawingDownloadUrl(raw: string): boolean {
  if (allowedDownloadUrl(raw)) return true;
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      CHATGPT_DRAWING_HOST_SET.has(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch {
    return false;
  }
}

/** ChatGPT file fetch: existing hosts plus the observed storage accounts; no redirects, size-capped. */
async function fetchDrawing(url: string): Promise<Uint8Array> {
  if (!allowedDrawingDownloadUrl(url)) throw new FileRejected(rejectedDrawingLink(url));
  // The deployed edge runtime supports manual/follow, but rejects redirect:"error".
  // Inspect the first response ourselves; never fetch a Location destination.
  const res = await fetch(url, { redirect: "manual" });
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel();
    throw new FileRejected(
      "The attachment download redirected to another address. Provide a direct download link. Nothing was stored.",
    );
  }
  if (!res.ok || !res.body)
    throw new FileRejected(
      "Athena couldn't download that file. Pass the file's bytes as content_base64 instead. Nothing was stored.",
    );
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > DRAWING_MAX_BYTES) {
    await res.body.cancel();
    throw new FileRejected(drawingTooBigMessage());
  }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > DRAWING_MAX_BYTES) {
      await reader.cancel();
      throw new FileRejected(drawingTooBigMessage());
    }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Direct upload confirm. Hash and size come from the upload route's signed receipt,
 * so no bytes are loaded here. Page counting is deferred to sheet indexing: a full
 * pdf-lib parse of a 70 MB set does not fit the server's memory next to the file.
 */
function stagedDrawing(
  upload: DrawingUpload,
  staged: NonNullable<DrawingUpload["staged"]>,
): { bytes: null; filename: string; pageCount: undefined } {
  try {
    const { name, ext } = safeFilename(upload.filename?.trim() || "drawing-set.pdf");
    if (ext !== "pdf") throw new FileRejected("A drawing set has to be a PDF. Nothing was stored.");
    if (staged.size <= 0 || staged.size > DRAWING_MAX_BYTES) throw new FileRejected(drawingTooBigMessage());
    const names = upload.sheets ?? [];
    if (new Set(names.map((s) => s.trim().toLowerCase())).size !== names.length)
      throw new FileRejected("Give each sheet one unique name in PDF page order. Nothing was stored.");
    return { bytes: null, filename: name, pageCount: undefined };
  } catch (e) {
    if (e instanceof FileRejected) throw new ToolError(e.message);
    throw e;
  }
}

export async function readDrawingBytes(
  upload: DrawingUpload,
): Promise<{ bytes: Uint8Array; filename: string; pageCount: number }> {
  const filename =
    upload.filename?.trim() ||
    upload.file?.file_name?.trim() ||
    (upload.source_url ? "drawing-set.pdf" : "");
  if (!filename) throw new ToolError("Name the drawing PDF. Nothing was stored.");
  try {
    let bytes: Uint8Array;
    if (upload.content_base64) bytes = decodeBase64(upload.content_base64, DRAWING_MAX_BYTES);
    else if (upload.source_url)
      bytes = await downloadDrawingSource(upload.source_url, DRAWING_MAX_BYTES);
    else if (upload.file?.download_url) bytes = await fetchDrawing(upload.file.download_url);
    else throw new FileRejected("Send the drawing PDF as content_base64. Nothing was stored.");
    const checked = validateFile(bytes, filename, DRAWING_MAX_BYTES);
    if (checked.ext !== "pdf")
      throw new FileRejected("A drawing set has to be a PDF. Nothing was stored.");
    const names = upload.sheets ?? [];
    if (new Set(names.map((s) => s.trim().toLowerCase())).size !== names.length)
      throw new FileRejected(
        "Give each sheet one unique name in PDF page order. Nothing was stored.",
      );
    // Import uses the existing pure-JavaScript PDF parser, without loading a
    // renderer or requiring browser globals/native canvas support.
    let pageCount: number;
    try {
      pageCount = await pdfPageCount(bytes);
    } catch (err) {
      const reason =
        err instanceof Error && err.message ? err.message : "This PDF could not be read.";
      throw new FileRejected(
        /Nothing was stored\.$/.test(reason) ? reason : `${reason} Nothing was stored.`,
      );
    }
    if (names.length > pageCount)
      throw new FileRejected(
        "There are more sheet names than PDF pages. Correct the page index; nothing was stored.",
      );
    return { bytes, filename: checked.name, pageCount };
  } catch (e) {
    if (e instanceof FileRejected)
      throw new ToolError(
        /over \d+ MB/.test(e.message) ? drawingTooBigMessage() : storedMessage(e.message),
      );
    throw e;
  }
}

/** Read one owned original. New originals live in athena-drawings; #190 originals stay in athena-files. */
async function readStoredOriginal(
  sb: DrawingStore,
  path: string,
  preferred?: string | null,
): Promise<{ bytes: Uint8Array; bucket: string }[]> {
  const names: string[] = [];
  const add = (name?: string | null) => {
    if ((name === FILE_BUCKET || name === DRAWING_BUCKET) && !names.includes(name))
      names.push(name);
  };
  add(preferred);
  add(DRAWING_BUCKET);
  add(FILE_BUCKET);
  const hits: { bytes: Uint8Array; bucket: string }[] = [];
  for (const name of names) {
    const file = await bucket(sb, name).download(path);
    if (file.error || !file.data) continue;
    hits.push({ bytes: new Uint8Array(await file.data.arrayBuffer()), bucket: name });
  }
  return hits;
}

export async function storeDrawingSet(
  sb: DrawingStore,
  job: DrawingJob,
  upload: DrawingUpload,
  prior: Doc[] = [],
): Promise<StoredDrawing> {
  const staged = upload.staged;
  const { bytes, filename, pageCount } = staged
    ? stagedDrawing(upload, staged)
    : await readDrawingBytes(upload);
  const hash = staged ? staged.content_hash : await sha256Hex(bytes!);
  const records = await drawingRecords(sb, job);
  const source = upload.source_url ? drawingSource(upload.source_url) : null;
  const existing = records.find((row) => row.content_hash === hash);
  // Index #190 drawings lazily; a re-share of an older stored PDF must not upload a second copy.
  let legacy: Doc | undefined;
  let legacyBucket: string | undefined;
  if (!existing) {
    // Registered originals already have a verified hash and bucket. They are not
    // #190 legacy files: probing them in athena-files fails after a new import.
    const indexedPaths = new Set(records.map((row) => row.path));
    for (const doc of prior) {
      if (!doc.path || !drawingOwned(doc.path, job.company_id, job.job_id)) continue;
      // A registered source already compared its hash above. Do not re-download it.
      if (indexedPaths.has(doc.path)) continue;
      const recorded = records.find((row) => row.path === doc.path);
      // Unindexed paths have no registry row. The read still prefers a recorded
      // bucket, then athena-drawings, then athena-files.
      const hits = await readStoredOriginal(
        sb,
        doc.path,
        recorded ? drawingBucket(recorded) : null,
      );
      if (!hits.length)
        throw new ToolError(
          "An existing drawing could not be checked for duplicates. Try again; nothing new was stored.",
        );
      let matched: { bytes: Uint8Array; bucket: string } | undefined;
      for (const hit of hits) {
        if ((await sha256Hex(hit.bytes)) === hash) {
          matched = hit;
          break;
        }
      }
      if (matched) {
        legacy = doc;
        legacyBucket = matched.bucket;
        break;
      }
    }
  }
  const path =
    existing?.path ??
    legacy?.path ??
    storagePath(job.company_id, job.job_id, `drawing-${hash}`, "source.pdf");
  const storageBucket = existing
    ? drawingBucket(existing)
    : legacy
      ? (legacyBucket ?? FILE_BUCKET)
      : DRAWING_BUCKET;
  if (!drawingOwned(path, job.company_id, job.job_id))
    throw new ToolError("Athena couldn't store that drawing. Nothing was stored.");
  const alreadyStaged = !!staged && staged.path === path && storageBucket === DRAWING_BUCKET;
  if (!existing && !legacy && !alreadyStaged) {
    if (!bytes) throw new ToolError("Athena couldn't store that drawing. Nothing was stored.");
    // New originals go to athena-drawings (100 MB). A write into athena-files keeps the 10 MB cap.
    if (bytes.length > drawingUploadLimit(storageBucket)) {
      throw new ToolError(
        storageBucket === DRAWING_BUCKET
          ? drawingTooBigMessage()
          : `That drawing is over ${FILE_MAX_BYTES / 1024 / 1024} MB. Nothing was stored.`,
      );
    }
    const up = await bucket(sb, storageBucket).upload(path, bytes, {
      contentType: "application/pdf",
      upsert: false,
      cacheControl: "no-store",
    });
    // Same hash has a deterministic path: concurrent identical imports cannot create two objects.
    if (up.error) {
      const check = await bucket(sb, storageBucket).download(path);
      if (
        check.error ||
        !check.data ||
        (await sha256Hex(new Uint8Array(await check.data.arrayBuffer()))) !== hash
      )
        throw new ToolError("Athena couldn't store that drawing right now. Try again in a moment.");
    }
  }
  const sheets = upload.sheets?.length ? upload.sheets : (existing?.sheets ?? legacy?.sheets ?? []);
  const record = await drawingRpc<DrawingRecord>(sb, "mcp_drawing_source_save", {
    _job: job.job_id,
    _record: {
      path,
      storage_bucket: storageBucket,
      filename: existing?.filename ?? legacy?.name ?? filename,
      content_hash: hash,
      source_key: source?.key ?? existing?.source_key ?? `file:${filename.toLowerCase()}`,
      source_url: source?.url ?? existing?.source_url ?? null,
      sheets,
    },
  });
  return {
    name: record.filename,
    path: record.path,
    sheets: record.sheets,
    record,
    duplicate: !!existing || !!legacy,
    pageCount,
  };
}

/** Read a job-owned original by identity, without rewriting its file or registry row. */
export async function readStoredDrawingBytes(
  sb: DrawingStore,
  job: DrawingJob,
  record: DrawingRecord,
): Promise<Uint8Array> {
  if (!drawingOwned(record.path, job.company_id, job.job_id))
    throw new ToolError("That drawing source does not belong to this job.");
  const file = await bucket(sb, drawingBucket(record)).download(record.path);
  if (file.error || !file.data)
    throw new ToolError("The stored drawing could not be opened. Try again; no upload is needed.");
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  if ((await sha256Hex(bytes)) !== record.content_hash)
    throw new ToolError(
      "The stored drawing does not match its saved fingerprint. Review its source revision first.",
    );
  return bytes;
}

export async function readStoredDrawingSet(
  sb: DrawingStore,
  job: DrawingJob,
  record: DrawingRecord,
): Promise<StoredDrawing> {
  const bytes = await readStoredDrawingBytes(sb, job, record);
  return {
    name: record.filename,
    path: record.path,
    sheets: record.sheets,
    record,
    duplicate: true,
    pageCount: await pdfPageCount(bytes),
  };
}

/** Re-index an existing original in place without encoding its bytes into a new upload. */
export async function indexStoredDrawingSet(
  sb: DrawingStore,
  job: DrawingJob,
  input: {
    path: string;
    filename: string;
    sheets: string[];
    record?: DrawingRecord;
    complete?: boolean;
  },
): Promise<StoredDrawing> {
  if (
    !drawingOwned(input.path, job.company_id, job.job_id) ||
    (input.record && input.record.path !== input.path)
  )
    throw new ToolError("That drawing source does not belong to this job. Nothing was indexed.");
  const storageBucket = drawingBucket(input.record);
  const file = await bucket(sb, storageBucket).download(input.path);
  if (file.error || !file.data)
    throw new ToolError("The stored drawing could not be opened. Try again; no upload is needed.");
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  const checked = validateFile(bytes, input.filename, DRAWING_MAX_BYTES);
  if (checked.ext !== "pdf")
    throw new ToolError("A drawing set has to be a PDF. Nothing was indexed.");
  const hash = await sha256Hex(bytes);
  if (input.record && hash !== input.record.content_hash)
    throw new ToolError(
      "The stored drawing does not match its saved fingerprint. Review its source revision first.",
    );
  if (new Set(input.sheets.map((name) => name.trim().toLowerCase())).size !== input.sheets.length)
    throw new ToolError("Give each sheet one unique name in PDF page order. Nothing was indexed.");
  const pageCount = await pdfPageCount(bytes);
  if (input.sheets.length > pageCount)
    throw new ToolError(
      "There are more sheet names than PDF pages. Correct the page index; nothing was indexed.",
    );
  if (input.complete && input.sheets.length !== pageCount)
    throw new ToolError(
      `This stored PDF has ${pageCount} pages. Give one sheet name per PDF page, in order. No index was changed; no re-upload is needed.`,
    );
  const record = await drawingRpc<DrawingRecord>(sb, "mcp_drawing_source_save", {
    _job: job.job_id,
    _record: {
      path: input.path,
      storage_bucket: storageBucket,
      filename: input.record?.filename ?? input.filename,
      content_hash: hash,
      source_key: input.record?.source_key ?? `file:${input.filename.toLowerCase()}`,
      source_url: input.record?.source_url ?? null,
      sheets: input.sheets,
    },
  });
  return {
    name: record.filename,
    path: record.path,
    sheets: record.sheets,
    record,
    duplicate: true,
    pageCount,
  };
}

export class DrawingSheetIndexRequired extends ToolError {
  constructor(public record: DrawingRecord) {
    super(
      "This drawing is stored, but its sheet names need to be indexed. No older drawing was substituted.",
    );
  }
}

/** Current imported revisions first, then legacy #190 document entries. Original paths never change. */
export async function storedSheet(
  sb: DrawingStore,
  job: DrawingJob,
  documents: Doc[],
  requested: string,
  selected?: { sourceId?: string; filename?: string },
) {
  const records = await drawingRecords(sb, job);
  const selectedName = selected?.filename?.trim().toLowerCase();
  // The identity returned by storage outranks a host's renamed attachment label.
  const matches = (row: DrawingRecord) =>
    selected?.sourceId
      ? row.id === selected.sourceId
      : !selectedName || row.filename.toLowerCase() === selectedName;
  const chosen = records.find(
    (row) => matches(row) && drawingOwned(row.path, job.company_id, job.job_id),
  );
  if (chosen && !chosen.sheets.length) throw new DrawingSheetIndexRequired(chosen);
  let record = records.find(
    (row) =>
      matches(row) &&
      sheetPageIndex(row.sheets, requested) != null &&
      drawingOwned(row.path, job.company_id, job.job_id),
  );
  if (!record) {
    if (selected?.sourceId)
      throw new ToolError(
        "The selected source does not contain this sheet on this job. No other drawing was substituted.",
      );
    const doc = documents.find(
      (row) =>
        (!selectedName || row.name.toLowerCase() === selectedName) &&
        row.path &&
        drawingOwned(row.path, job.company_id, job.job_id) &&
        sheetPageIndex(row.sheets, requested) != null,
    );
    if (!doc?.path && selectedName)
      throw new ToolError(
        `The requested upload ${selected!.filename} is not stored with sheet ${requested}. Nothing was marked up; no older drawing was substituted.`,
      );
    if (!doc?.path)
      throw new ToolError(
        `Sheet ${requested} is not indexed on this job. Name its stored drawing set and page order; do not re-upload a set already stored.`,
      );
    const file = await bucket(sb).download(doc.path);
    if (file.error || !file.data)
      throw new ToolError(
        "The stored drawing could not be opened. Try again; no upload is needed.",
      );
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    record = await drawingRpc<DrawingRecord>(sb, "mcp_drawing_source_save", {
      _job: job.job_id,
      _record: {
        path: doc.path,
        filename: doc.name,
        content_hash: await sha256Hex(bytes),
        source_key: `file:${doc.name.toLowerCase()}`,
        sheets: doc.sheets ?? [],
      },
    });
  }
  const index = sheetPageIndex(record.sheets, requested)!;
  const file = await bucket(sb, drawingBucket(record)).download(record.path);
  if (file.error || !file.data)
    throw new ToolError("The stored drawing could not be opened. Try again; no upload is needed.");
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  if ((await sha256Hex(bytes)) !== record.content_hash)
    throw new ToolError(
      "The stored drawing does not match its saved fingerprint. Review the source revision before marking it up.",
    );
  const png = await renderPdfPage(bytes, index);
  if (!png)
    throw new ToolError(
      "The sheet index points beyond the stored PDF. Correct the sheet index; no upload is needed.",
    );
  return { record, sheet: record.sheets[index], page: index + 1, png };
}

export async function removeDrawing(
  sb: DrawingStore,
  path: string,
  bucketName = FILE_BUCKET,
): Promise<void> {
  const [companyId, jobId] = path.split("/");
  let records: StoredObjectRow[] = [];
  if (companyId && jobId) {
    try {
      records = await drawingRecords(sb, { company_id: companyId, job_id: jobId });
    } catch {
      // Path and bucket rules still apply when the version registry is not installed.
      records = [];
    }
  }
  const refusal = immutableDrawingDeleteRefused(bucketName, path, records);
  if (refusal) throw new ToolError(refusal);
  await bucket(sb, bucketName).remove([path]);
}

/** Rasterize the actual stored page. No browser or native canvas dependency. */
export async function renderPdfPage(
  bytes: Uint8Array,
  pageIndex: number,
): Promise<Uint8Array | null> {
  return (await import("./pdf-renderer")).renderPdfiumPage(bytes, pageIndex);
}

export async function loadSheetPages(
  sb: DrawingStore,
  job: DrawingJob,
  documents: Doc[],
  sheets: string[],
): Promise<SheetPage[]> {
  const pages: SheetPage[] = [];
  // Keep #190 reads available before the additive registry migration is installed.
  let records: DrawingRecord[] = [];
  try {
    records = await drawingRecords(sb, job);
  } catch {
    /* legacy documents still work */
  }
  for (const sheet of sheets) {
    try {
      const doc = documents.find(
        (row) =>
          typeof row.path === "string" &&
          drawingOwned(row.path, job.company_id, job.job_id) &&
          sheetPageIndex(row.sheets, sheet) != null,
      );
      if (!doc?.path) continue;
      const index = sheetPageIndex(doc.sheets, sheet);
      if (index == null) continue;
      const record = records.find((r) => r.path === doc.path);
      const sourceBucket = bucket(sb, drawingBucket(record));
      const file = await sourceBucket.download(doc.path);
      if (file.error || !file.data) continue;
      const bytes = new Uint8Array(await file.data.arrayBuffer());
      const png = await renderPdfPage(bytes, index);
      if (!png?.length) continue;
      const signed = await sourceBucket.createSignedUrl(doc.path, DRAWING_URL_SECONDS);
      if (signed.error || !signed.data?.signedUrl) continue;
      pages.push({ sheet, page: index + 1, png, signedUrl: signed.data.signedUrl });
    } catch {
      // A missing or unreadable page leaves the takeoff result as it was.
    }
  }
  return pages;
}

type PageResult = {
  content?: { type: string; text?: string; data?: string; mimeType?: string }[];
  structuredContent?: Record<string, unknown>;
};

/** Leave the result alone when there is no stored page. */
export function attachSheetPages<R extends PageResult>(result: R, pages: SheetPage[]): R {
  if (!pages.length) return result;
  const note = pages
    .map((page) => `${sheetPageLine(page.sheet, page.page)}\nPage link: ${page.signedUrl}`)
    .join("\n\n");
  const lines = Array.isArray(result.structuredContent?.lines)
    ? (result.structuredContent.lines as {
        sheet?: string | null;
        markup?: string | null;
        holdsBid?: boolean;
      }[])
    : [];
  const markup = pages.flatMap((page) => {
    const named = lines.filter(
      (line) => line.sheet?.toUpperCase() === page.sheet.toUpperCase() && line.markup?.trim(),
    );
    return named.length
      ? [
          {
            sheet: page.sheet,
            ...drawingMarkupCard(
              page.sheet,
              named.map((line) => ({ label: line.markup!, flag: line.holdsBid ? "risk" : null })),
            ),
          },
        ]
      : [];
  });
  const content = [...(result.content ?? [])];
  const first = content.findIndex(
    (block) => block.type === "text" && typeof block.text === "string",
  );
  if (first >= 0)
    content[first] = {
      ...content[first],
      text: `${note}\n${DRAWING_MARKUP_REQUIRED}\n\n${content[first].text ?? ""}${markup.map((m) => `\n\n${htmlBlock(m.html)}`).join("")}`,
    };
  else content.unshift({ type: "text", text: note });
  for (const page of pages) {
    content.push({ type: "image", data: bytesToBase64(page.png), mimeType: "image/png" });
  }
  return {
    ...result,
    content,
    structuredContent: {
      ...(result.structuredContent ?? {}),
      ...(markup.length ? { markup } : {}),
      sheet_pages: pages.map((page) => ({
        sheet: page.sheet,
        page: page.page,
        signed_url: page.signedUrl,
      })),
    },
  };
}
