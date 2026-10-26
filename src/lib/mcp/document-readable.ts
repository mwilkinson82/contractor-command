// Immutable, job-scoped derived text. Original objects and canonical source rows
// are never updated here. Preparation is an explicit write, retrieval is read-only.
import { ToolError } from "@lovable.dev/mcp-js";
import type { Sb } from "./guard";
import { DOC_BUCKET, DOC_MAX_BYTES } from "./file-upload";
import { sha256Hex } from "./file-share";
import { extractPdfiumDocumentText } from "./pdf-renderer";

export type ReadableSource = {
  id: string;
  company_id: string;
  job_id: string;
  upload_id?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  file_sha256: string | null;
  size_bytes: number | null;
};
export type ReadableDocument = {
  format: "athena-readable-pdf-v1";
  state: "ready";
  source_id: string;
  source_sha256: string;
  source_bytes: number;
  company_id: string;
  job_id: string;
  extraction_version: "pdfium-3.0.0-text-v1";
  prepared_at: string;
  total_pdf_pages: number;
  covered_pdf_pages: number;
  text_sha256: string;
  pages: { page: number; text: string }[];
};
export function readableKey(source: ReadableSource): string {
  const path = source.storage_path;
  if (
    source.storage_bucket !== DOC_BUCKET ||
    !path ||
    path.includes("..") ||
    path.split("/").length !== 4 ||
    !path.startsWith(`${source.company_id}/${source.job_id}/`) ||
    (source.upload_id != null && path.split("/")[2] !== source.upload_id) ||
    !/^[0-9a-f]{64}$/.test(source.file_sha256 ?? "") ||
    !source.size_bytes ||
    source.size_bytes < 1 ||
    source.size_bytes > DOC_MAX_BYTES
  )
    throw new ToolError("This source has no verified job-scoped original reference.");
  return `${path.slice(0, path.lastIndexOf("/") + 1)}.athena-readable-v1-${source.id}-${source.file_sha256}.json`;
}
export async function loadReadable(
  sb: Sb,
  source: ReadableSource,
): Promise<ReadableDocument | null> {
  const { data, error } = await sb.storage.from(DOC_BUCKET).download(readableKey(source));
  if (error || !data) {
    const code = String(
      (error as { statusCode?: string; status?: number } | null)?.statusCode ??
        (error as { status?: number } | null)?.status ??
        "",
    );
    if (
      code === "404" ||
      /not found|does not exist|missing|object not found/i.test(error?.message ?? "")
    )
      return null;
    throw new ToolError(
      "The saved readable document could not be read with your current job access.",
    );
  }
  if (data.size > DOC_MAX_BYTES)
    throw new ToolError("The saved readable document exceeds the supported size.");
  let doc: ReadableDocument;
  try {
    doc = JSON.parse(await data.text());
  } catch {
    throw new ToolError("The saved readable document is invalid. Nothing changed.");
  }
  if (
    !doc ||
    typeof doc !== "object" ||
    doc.format !== "athena-readable-pdf-v1" ||
    doc.state !== "ready" ||
    doc.extraction_version !== "pdfium-3.0.0-text-v1" ||
    doc.source_id !== source.id ||
    doc.source_sha256 !== source.file_sha256 ||
    doc.source_bytes !== source.size_bytes ||
    doc.company_id !== source.company_id ||
    doc.job_id !== source.job_id ||
    !Array.isArray(doc.pages) ||
    !doc.pages.length ||
    doc.pages.length !== doc.total_pdf_pages ||
    doc.covered_pdf_pages !== doc.total_pdf_pages ||
    !doc.pages.every((p, i) => p && p.page === i + 1 && typeof p.text === "string") ||
    (await sha256Hex(new TextEncoder().encode(JSON.stringify(doc.pages)))) !== doc.text_sha256
  )
    throw new ToolError(
      "The saved readable document does not match this source version or complete page coverage. Nothing changed.",
    );
  return doc;
}
export async function prepareReadable(
  sb: Sb,
  source: ReadableSource,
  bytes: Uint8Array,
  extractedPages?: string[],
): Promise<{ document: ReadableDocument; reused: boolean }> {
  readableKey(source);
  if (
    bytes.length > DOC_MAX_BYTES ||
    bytes.length !== source.size_bytes ||
    (await sha256Hex(bytes)) !== source.file_sha256
  )
    throw new ToolError(
      "The original bytes do not match this source. No readable document was saved.",
    );
  const existing = await loadReadable(sb, source);
  if (existing) return { document: existing, reused: true };
  let texts: string[];
  try {
    texts = extractedPages ?? (await extractPdfiumDocumentText(bytes));
  } catch {
    throw new ToolError(
      "The original PDF could not be extracted. No ready readable document was saved.",
    );
  }
  if (!texts.length)
    throw new ToolError("No physical pages were extracted. No ready readable document was saved.");
  const pages = texts.map((text, index) => ({ page: index + 1, text }));
  const doc: ReadableDocument = {
    format: "athena-readable-pdf-v1",
    state: "ready",
    source_id: source.id,
    source_sha256: source.file_sha256!,
    source_bytes: bytes.length,
    company_id: source.company_id,
    job_id: source.job_id,
    extraction_version: "pdfium-3.0.0-text-v1",
    prepared_at: new Date().toISOString(),
    total_pdf_pages: pages.length,
    covered_pdf_pages: pages.length,
    pages,
    text_sha256: await sha256Hex(new TextEncoder().encode(JSON.stringify(pages))),
  };
  const body = new TextEncoder().encode(JSON.stringify(doc));
  if (body.length > DOC_MAX_BYTES)
    throw new ToolError(
      "The complete readable document exceeds the supported size. It was not truncated or marked ready.",
    );
  const { error } = await sb.storage
    .from(DOC_BUCKET)
    .upload(readableKey(source), body, { contentType: "application/json", upsert: false });
  if (error && !/already exists|duplicate/i.test(error.message))
    throw new ToolError("The original is preserved, but the readable document could not be saved.");
  // Read after write (also reconciles a concurrent winning preparation). No overwrite.
  const saved = await loadReadable(sb, source);
  if (!saved)
    throw new ToolError("Readable document readiness could not be verified. Original unchanged.");
  return { document: saved, reused: !!error };
}
