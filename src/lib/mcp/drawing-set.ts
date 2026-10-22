// Stored drawing sets. The PDF goes in the private athena-files bucket on the same
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
  decodeBase64,
  storagePath,
  validateFile,
} from "./file-share";

export const DRAWING_URL_SECONDS = 15 * 60;
const MAX_PAGES = 4;
const MAX_EDGE = 1600;

export type DrawingUpload = {
  filename?: string;
  content_base64?: string;
  file?: { download_url: string; file_id: string; mime_type?: string; file_name?: string };
  sheets?: string[];
};

export type DrawingJob = { company_id: string; job_id: string };

export type StoredDrawing = { name: string; path: string; sheets?: string[] };

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
  download: (
    path: string,
  ) => Promise<{ data: { arrayBuffer: () => Promise<ArrayBuffer> } | null; error: { message: string } | null }>;
  createSignedUrl: (
    path: string,
    seconds: number,
  ) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
  remove: (paths: string[]) => Promise<{ error: { message: string } | null }>;
};

export type DrawingStore = { storage: { from: (bucket: string) => Bucket } };

const bucket = (sb: DrawingStore) => sb.storage.from(FILE_BUCKET);

/** True only for this company and job, and only for a drawing object. */
export function drawingOwned(path: string, companyId: string, jobId: string): boolean {
  if (!path || path.includes("..") || path.includes("\\") || path.startsWith("/")) return false;
  const parts = path.split("/");
  if (parts.length !== 4 || parts.some((part) => !part || part === "." || part === "..")) return false;
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
    const prev = prior.find((row) => row.name.trim().toLowerCase() === doc.name.trim().toLowerCase());
    return prev?.path ? { ...rest, path: prev.path } : rest;
  });
}

/** Record the stored object on the matching document entry, or append one. Other fields stay. */
export function withDrawingPath(documents: Doc[], stored: StoredDrawing): Doc[] {
  const docs = documents.map((doc) => ({ ...doc, sheets: doc.sheets ? [...doc.sheets] : doc.sheets }));
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

const storedMessage = (message: string) => message.replaceAll("Nothing was shared.", "Nothing was stored.");

/** Same ChatGPT file fetch as file_share: https, OpenAI hosts only, no redirects, size-capped. */
async function fetchDrawing(url: string): Promise<Uint8Array> {
  if (!allowedDownloadUrl(url))
    throw new FileRejected("Athena can't read that file link. Pass the file's bytes as content_base64 instead. Nothing was stored.");
  const res = await fetch(url, { redirect: "error" });
  if (!res.ok || !res.body)
    throw new FileRejected("Athena couldn't download that file. Pass the file's bytes as content_base64 instead. Nothing was stored.");
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > FILE_MAX_BYTES)
    throw new FileRejected(`That file is over ${FILE_MAX_BYTES / 1024 / 1024} MB, the most Athena can share. Nothing was stored.`);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > FILE_MAX_BYTES) {
      await reader.cancel();
      throw new FileRejected(`That file is over ${FILE_MAX_BYTES / 1024 / 1024} MB, the most Athena can share. Nothing was stored.`);
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

export async function readDrawingBytes(upload: DrawingUpload): Promise<{ bytes: Uint8Array; filename: string }> {
  const filename = upload.filename?.trim() || upload.file?.file_name?.trim() || "";
  if (!filename) throw new ToolError("Name the drawing PDF. Nothing was stored.");
  try {
    let bytes: Uint8Array;
    if (upload.content_base64) bytes = decodeBase64(upload.content_base64);
    else if (upload.file?.download_url) bytes = await fetchDrawing(upload.file.download_url);
    else throw new FileRejected("Send the drawing PDF as content_base64. Nothing was stored.");
    const checked = validateFile(bytes, filename);
    if (checked.ext !== "pdf") throw new FileRejected("A drawing set has to be a PDF. Nothing was stored.");
    return { bytes, filename: checked.name };
  } catch (e) {
    if (e instanceof FileRejected) throw new ToolError(storedMessage(e.message));
    throw e;
  }
}

export async function storeDrawingSet(sb: DrawingStore, job: DrawingJob, upload: DrawingUpload): Promise<StoredDrawing> {
  const { bytes, filename } = await readDrawingBytes(upload);
  const path = storagePath(job.company_id, job.job_id, `drawing-${crypto.randomUUID()}`, filename);
  if (!drawingOwned(path, job.company_id, job.job_id))
    throw new ToolError("Athena couldn't store that drawing. Nothing was stored.");
  const up = await bucket(sb).upload(path, bytes, {
    contentType: "application/pdf",
    upsert: false,
    cacheControl: "no-store",
  });
  if (up.error) throw new ToolError("Athena couldn't store that drawing right now. Nothing was stored. Try again in a moment.");
  return { name: filename, path, sheets: upload.sheets };
}

export async function removeDrawing(sb: DrawingStore, path: string): Promise<void> {
  await bucket(sb).remove([path]);
}

type PdfjsModule = {
  getDocument: (src: { data: Uint8Array; disableWorker: boolean; isEvalSupported: boolean; useSystemFonts: boolean }) => {
    promise: Promise<PdfDoc>;
  };
};

type PdfCanvas = {
  canvas: { toBuffer: (mime: "image/png") => Uint8Array };
  context: CanvasRenderingContext2D;
};

type PdfDoc = {
  numPages: number;
  canvasFactory: { create: (width: number, height: number) => PdfCanvas; destroy: (canvas: PdfCanvas) => void };
  getPage: (page: number) => Promise<{
    getViewport: (opts: { scale: number }) => { width: number; height: number };
    render: (opts: { canvas: PdfCanvas["canvas"]; canvasContext: CanvasRenderingContext2D; viewport: unknown }) => {
      promise: Promise<void>;
    };
    cleanup: () => void;
  }>;
  destroy: () => Promise<void>;
};

async function loadPdfjs(): Promise<PdfjsModule> {
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const entry = createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.mjs");
  return import(pathToFileURL(entry).href) as Promise<PdfjsModule>;
}

/** Rasterize one PDF page. pageIndex is zero-based. Returns null when that page is not in the file. */
export async function renderPdfPage(bytes: Uint8Array, pageIndex: number): Promise<Uint8Array | null> {
  if (pageIndex < 0) return null;
  const { getDocument } = await loadPdfjs();
  const pdf = await getDocument({
    data: bytes.slice(),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  try {
    if (pageIndex >= pdf.numPages) return null;
    const page = await pdf.getPage(pageIndex + 1);
    const base = page.getViewport({ scale: 1 });
    const longEdge = Math.max(base.width, base.height) || 1;
    const viewport = page.getViewport({ scale: Math.min(2, MAX_EDGE / longEdge) });
    const canvasAndCtx = pdf.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    try {
      await page.render({ canvas: canvasAndCtx.canvas, canvasContext: canvasAndCtx.context, viewport }).promise;
      return new Uint8Array(canvasAndCtx.canvas.toBuffer("image/png"));
    } finally {
      page.cleanup();
      pdf.canvasFactory.destroy(canvasAndCtx);
    }
  } finally {
    await pdf.destroy();
  }
}

export async function loadSheetPages(
  sb: DrawingStore,
  job: DrawingJob,
  documents: Doc[],
  sheets: string[],
): Promise<SheetPage[]> {
  const pages: SheetPage[] = [];
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
      const file = await bucket(sb).download(doc.path);
      if (file.error || !file.data) continue;
      const bytes = new Uint8Array(await file.data.arrayBuffer());
      const png = await renderPdfPage(bytes, index);
      if (!png?.length) continue;
      const signed = await bucket(sb).createSignedUrl(doc.path, DRAWING_URL_SECONDS);
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
  const note = pages.map((page) => `${sheetPageLine(page.sheet, page.page)}\nPage link: ${page.signedUrl}`).join("\n\n");
  const content = [...(result.content ?? [])];
  const first = content.findIndex((block) => block.type === "text" && typeof block.text === "string");
  if (first >= 0) content[first] = { ...content[first], text: `${note}\n\n${content[first].text ?? ""}` };
  else content.unshift({ type: "text", text: note });
  for (const page of pages) {
    content.push({ type: "image", data: bytesToBase64(page.png), mimeType: "image/png" });
  }
  return {
    ...result,
    content,
    structuredContent: {
      ...(result.structuredContent ?? {}),
      sheet_pages: pages.map((page) => ({ sheet: page.sheet, page: page.page, signed_url: page.signedUrl })),
    },
  };
}
