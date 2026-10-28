// File intake for the connector. Tool calls stay under 20,000 characters, so the bytes
// move by a short-lived upload link, a fetchable https link, or base64 chunks.
import { inflateRawSync } from "node:zlib";
import { allowedDrawingDownloadUrl } from "./drawing-set";
import { FileRejected } from "./file-share";

export const FILE_UPLOAD_CHUNK_CHARS = 12_000;
export const FILE_UPLOAD_CALL_CHARS = 20_000;
export const FILE_UPLOAD_HOURS = 2;
export const DOC_MAX_BYTES = 100 * 1024 * 1024;
export const PIECE_MAX_BYTES = 100 * 1024 * 1024;
export const EXTRACT_MAX_CHARS = 400_000;
export const FILE_UPLOAD_LINK_BASE = "https://app.meetathena.io/r/file-upload/";
export const DOC_BUCKET = "athena-documents";

export const FILE_UPLOAD_DESCRIPTION =
  "Uploads a PDF, DOCX, or TXT for ChatGPT, Claude, and Grok Bot: action begin returns a two-hour upload link (send the raw bytes to that link, or open it and choose the file) then action finish stores it, action from_url fetches the client's https file link, and action chunk accepts base64 pieces of at most 12000 characters in order before finish, saving a contract or spec on the job or attaching a submittal piece; action prepare_readable with document_id explicitly prepares complete reusable PDF text for an existing saved source without replacing or uploading its original; use project_documents for reads.";

const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
} as const;
export type UploadExt = keyof typeof MIME;
export type UploadPurpose = "contract" | "spec" | "submittal_piece" | "financial_document";

export function uploadMaxBytes(purpose: UploadPurpose): number {
  return purpose === "submittal_piece" ? PIECE_MAX_BYTES : DOC_MAX_BYTES;
}

export function uploadFilename(
  name: string,
  purpose: UploadPurpose = "contract",
): { name: string; ext: UploadExt; mime: string } {
  const base = name
    .split(/[\\/]/)
    .pop()!
    .normalize("NFKC")
    .replace(/[^\w .()-]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-120);
  const ext = base.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase();
  if (
    ext !== "pdf" &&
    ext !== "docx" &&
    ext !== "txt" &&
    !(purpose === "financial_document" && (ext === "jpg" || ext === "jpeg" || ext === "png"))
  )
    throw new FileRejected(
      purpose === "financial_document"
        ? "Use a PDF, Word, text, JPEG, or PNG file. Nothing was stored."
        : "Use a PDF, Word (.docx), or text (.txt) file. Nothing was stored.",
    );
  const stem =
    base
      .slice(0, -(ext.length + 1))
      .replace(/^[.\s]+/, "")
      .trim() || "file";
  return { name: `${stem}.${ext}`, ext, mime: MIME[ext] };
}

const starts = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

export function sniffUpload(bytes: Uint8Array, ext: UploadExt): boolean {
  if (!bytes.length) return false;
  if (ext === "pdf") return starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (ext === "jpg" || ext === "jpeg") return starts(bytes, [0xff, 0xd8, 0xff]);
  if (ext === "png") return starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (ext === "docx")
    return (
      starts(bytes, [0x50, 0x4b, 0x03, 0x04]) && unzipEntry(bytes, "word/document.xml") != null
    );
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) || starts(bytes, [0x50, 0x4b, 0x03, 0x04]))
    return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return !bytes.includes(0);
  } catch {
    return false;
  }
}

export function assertUploadBytes(bytes: Uint8Array, filename: string, purpose: UploadPurpose) {
  const file = uploadFilename(filename, purpose);
  const max = uploadMaxBytes(purpose);
  if (!bytes.length) throw new FileRejected("The file is empty. Nothing was stored.");
  if (bytes.length > max) throw new FileRejected(`That file is over 100 MB. Nothing was stored.`);
  if (!sniffUpload(bytes, file.ext))
    throw new FileRejected(`That file isn't a real .${file.ext} file. Nothing was stored.`);
  return file;
}

export function decodeChunk(raw: string): Uint8Array {
  const clean = raw.replace(/\s+/g, "");
  if (clean.length > FILE_UPLOAD_CHUNK_CHARS)
    throw new FileRejected(
      `That chunk is over ${FILE_UPLOAD_CHUNK_CHARS.toLocaleString()} characters. Nothing was stored.`,
    );
  if (!clean || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1)
    throw new FileRejected("That chunk isn't valid. Nothing was stored.");
  const bin = atob(clean.padEnd(Math.ceil(clean.length / 4) * 4, "="));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function missingChunk(indexes: number[]): number | null {
  if (!indexes.length) return 0;
  const have = new Set(indexes);
  const max = Math.max(...indexes);
  for (let i = 0; i <= max; i++) if (!have.has(i)) return i;
  return null;
}

export function joinChunks(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export type Extracted = { text: string; chars: number; truncated: boolean; pdf_pages?: string[] };

export function extractUploadText(bytes: Uint8Array, ext: UploadExt): Extracted {
  let text = "";
  try {
    if (ext === "txt")
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
    else if (ext === "docx") text = docxText(bytes);
    else text = pdfText(bytes);
  } catch {
    text = "";
  }
  text = text
    .replaceAll("\u0000", "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const truncated = text.length > EXTRACT_MAX_CHARS;
  if (truncated) text = text.slice(0, EXTRACT_MAX_CHARS);
  return { text, chars: text.length, truncated };
}

/** Use the existing bundled PDF engine for font mappings and page provenance. */
export async function extractUploadDocument(bytes: Uint8Array, ext: UploadExt): Promise<Extracted> {
  if (ext === "jpg" || ext === "jpeg" || ext === "png")
    return { text: "", chars: 0, truncated: false };
  if (ext !== "pdf") return extractUploadText(bytes, ext);
  try {
    const { extractPdfiumDocumentText } = await import("./pdf-renderer");
    const pages = await extractPdfiumDocumentText(bytes);
    const text = pages
      .map((page, index) => `[[PDF page ${index + 1}]]\n${page.replaceAll("\u0000", "").trim()}`)
      .join("\n\n");
    // An image-only PDF remains explicitly unreadable; markers alone are not text.
    if (!pages.some((page) => page.replaceAll("\u0000", "").trim()))
      return { text: "", chars: 0, truncated: false, pdf_pages: pages };
    const truncated = text.length > EXTRACT_MAX_CHARS;
    const kept = text.slice(0, EXTRACT_MAX_CHARS);
    return { text: kept, chars: kept.length, truncated, pdf_pages: pages };
  } catch {
    return { text: "", chars: 0, truncated: false };
  }
}

function docxText(bytes: Uint8Array): string {
  const xml = unzipEntry(bytes, "word/document.xml");
  if (!xml) return "";
  const source = new TextDecoder("utf-8").decode(xml);
  const parts: string[] = [];
  const re = /<w:t[^>]*>([^<]*)<\/w:t>|<\/w:p>/g;
  for (let m = re.exec(source); m; m = re.exec(source))
    parts.push(m[1] == null ? "\n" : decodeXml(m[1]));
  return parts.join("");
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

export function unzipEntry(bytes: Uint8Array, want: string): Uint8Array | null {
  const b = Buffer.from(bytes);
  let o = 0;
  while (o + 30 <= b.length && b.readUInt32LE(o) === 0x04034b50) {
    const method = b.readUInt16LE(o + 8);
    const comp = b.readUInt32LE(o + 18);
    const nameLen = b.readUInt16LE(o + 26);
    const extra = b.readUInt16LE(o + 28);
    const name = b.slice(o + 30, o + 30 + nameLen).toString("utf8");
    const start = o + 30 + nameLen + extra;
    const data = b.subarray(start, start + comp);
    if (name === want) {
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      return null;
    }
    o = start + comp;
  }
  return null;
}

function pdfText(bytes: Uint8Array): string {
  const latin = Buffer.from(bytes).toString("latin1");
  const streams: string[] = [];
  const re = /<<([^>]*)>>\s*stream\r?\n/g;
  for (let m = re.exec(latin); m; m = re.exec(latin)) {
    const end = latin.indexOf("endstream", m.index + m[0].length);
    if (end < 0) break;
    let raw = latin.slice(m.index + m[0].length, end);
    if (raw.endsWith("\r\n")) raw = raw.slice(0, -2);
    else if (raw.endsWith("\n")) raw = raw.slice(0, -1);
    const buf = Buffer.from(raw, "latin1");
    if (/FlateDecode/.test(m[1])) {
      try {
        streams.push(inflateRawSync(buf).toString("latin1"));
      } catch {
        /* skip a stream that is not text */
      }
    } else streams.push(raw);
  }
  const parts: string[] = [];
  const str = /\(((?:\\.|[^\\)])*)\)/g;
  for (const stream of streams) {
    for (let m = str.exec(stream); m; m = str.exec(stream)) parts.push(unescapePdf(m[1]));
  }
  return parts.join(" ");
}

function unescapePdf(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "\\") {
      out += s[i];
      continue;
    }
    const n = s[++i];
    if (n === "n") out += "\n";
    else if (n === "r") out += "\r";
    else if (n === "t") out += "\t";
    else if (n === "(" || n === ")" || n === "\\") out += n;
    else if (n >= "0" && n <= "7") {
      let oct = n;
      for (let k = 0; k < 2 && s[i + 1] >= "0" && s[i + 1] <= "7"; k++) oct += s[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else if (n) out += n;
  }
  return out;
}

export function uploadLink(token: string): string {
  return FILE_UPLOAD_LINK_BASE + token;
}

export async function fetchAllowedFile(url: string, maxBytes: number): Promise<Uint8Array> {
  if (!allowedDrawingDownloadUrl(url))
    throw new FileRejected(
      "Athena can't fetch that link. Use the upload link, or send the file in chunks of at most 12,000 characters. Nothing was stored.",
    );
  const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel();
    throw new FileRejected("That link redirected somewhere else. Nothing was stored.");
  }
  if (!res.ok || !res.body)
    throw new FileRejected("Athena couldn't download that file. Nothing was stored.");
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > maxBytes) {
      await reader.cancel();
      throw new FileRejected(
        `That file is over ${Math.round(maxBytes / 1024 / 1024)} MB. Nothing was stored.`,
      );
    }
    parts.push(value);
  }
  return joinChunks(parts);
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export function uploadPage(input: {
  filename: string;
  purpose: string;
  until: string;
  error?: string;
  done?: boolean;
}): string {
  const title = input.done ? "File stored" : input.error ? "Upload didn't work" : "Upload a file";
  const body = input.done
    ? `<h1>File stored</h1><p>Go back and tell Athena the file is in.</p>`
    : input.error
      ? `<h1>Upload didn't work</h1><p class="err">${escapeHtml(input.error)}</p>`
      : `<h1>Upload this file</h1><p>${escapeHtml(input.filename)} · ${escapeHtml(input.purpose)} · link works until ${escapeHtml(input.until)}.</p><form method="post" enctype="multipart/form-data"><input type="file" name="file" required><button type="submit">Store on this job</button></form>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title} · Athena</title><style>body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#F4F7FB;color:#1E3A5F}main{max-width:32rem;margin:10vh auto;padding:24px}button{background:#1E5FED;color:#fff;border:0;border-radius:8px;padding:12px 18px;font:inherit}p{color:#4B5563}.err{color:#B91C1C}input{display:block;margin:16px 0}</style></head><body><main>${body}</main></body></html>`;
}

export async function readBounded(req: Request, max: number): Promise<Uint8Array> {
  const claimed = Number(req.headers.get("content-length") ?? "0");
  if (claimed > max)
    throw new FileRejected(
      `That file is over ${Math.round(max / 1024 / 1024)} MB. Nothing was stored.`,
    );
  if (!req.body) throw new FileRejected("The file is empty. Nothing was stored.");
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) {
      await reader.cancel();
      throw new FileRejected(
        `That file is over ${Math.round(max / 1024 / 1024)} MB. Nothing was stored.`,
      );
    }
    parts.push(value);
  }
  return joinChunks(parts);
}
