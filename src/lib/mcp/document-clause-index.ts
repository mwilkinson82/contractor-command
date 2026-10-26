import { ToolError } from "@lovable.dev/mcp-js";
import type { Sb } from "./guard";
import type { ReadableSource, ReadableDocument } from "./document-readable";
import { readableKey } from "./document-readable";
import { sha256Hex } from "./file-share";
import { indexLiteralClauses, type ClauseEntry } from "./literal-clauses";
const BUCKET = "athena-documents",
  MAX_BYTES = 100 * 1024 * 1024;
export type ClauseIndex = {
  format: "athena-clause-index-v2";
  state: "extracted";
  source_id: string;
  source_sha256: string;
  source_text_sha256: string;
  source_extraction_version: string;
  covered_pdf_pages: number;
  index_version: "literal-sections-v2";
  entries_sha256: string;
  entries: ClauseEntry[];
};
export const clauseIndexKey = (s: ReadableSource) =>
  readableKey(s).replace(".athena-readable-v1-", ".athena-clauses-v2-");
const hash = (v: unknown) => sha256Hex(new TextEncoder().encode(JSON.stringify(v)));
export async function loadClauseIndex(
  sb: Sb,
  source: ReadableSource,
  readable: ReadableDocument,
): Promise<ClauseIndex | null> {
  const { data, error } = await sb.storage.from(BUCKET).download(clauseIndexKey(source));
  if (error || !data) {
    if (
      String((error as { statusCode?: string } | null)?.statusCode) === "404" ||
      /missing|not found|does not exist/i.test(error?.message ?? "")
    )
      return null;
    throw new ToolError("The saved clause index could not be read with current job access.");
  }
  if (data.size > MAX_BYTES)
    throw new ToolError("The saved clause index exceeds the supported size.");
  let index: ClauseIndex;
  try {
    index = JSON.parse(await data.text());
  } catch {
    throw new ToolError("The saved clause index is invalid; original source text is preserved.");
  }
  if (
    !index ||
    index.format !== "athena-clause-index-v2" ||
    index.state !== "extracted" ||
    index.index_version !== "literal-sections-v2" ||
    index.source_id !== source.id ||
    index.source_sha256 !== source.file_sha256 ||
    index.source_text_sha256 !== readable.text_sha256 ||
    index.source_extraction_version !== readable.extraction_version ||
    index.covered_pdf_pages !== readable.total_pdf_pages ||
    !Array.isArray(index.entries) ||
    (await hash(index.entries)) !== index.entries_sha256
  )
    throw new ToolError(
      "The saved clause index does not match this source version; nothing changed.",
    );
  let page = 1,
    offset = 0;
  for (const entry of index.entries) {
    if (!entry || !Array.isArray(entry.parts) || !entry.parts.length)
      throw new ToolError("The saved clause index has incomplete coverage.");
    for (const p of entry.parts) {
      const original = readable.pages[page - 1];
      if (
        !p ||
        !original ||
        p.page !== page ||
        p.start !== offset ||
        !Number.isSafeInteger(p.end) ||
        p.end < p.start ||
        p.end > original.text.length
      )
        throw new ToolError("The saved clause index has incomplete page coverage.");
      offset = p.end;
      if (offset === original.text.length) {
        page++;
        offset = 0;
      }
    }
  }
  if (page !== readable.total_pdf_pages + 1 || offset !== 0)
    throw new ToolError("The saved clause index is incomplete; no absent clause was inferred.");
  return index;
}
export async function prepareClauseIndex(
  sb: Sb,
  source: ReadableSource,
  readable: ReadableDocument,
) {
  const existing = await loadClauseIndex(sb, source, readable);
  if (existing) return { index: existing, reused: true };
  const entries = indexLiteralClauses(readable.pages);
  const index: ClauseIndex = {
    format: "athena-clause-index-v2",
    state: "extracted",
    source_id: source.id,
    source_sha256: source.file_sha256!,
    source_text_sha256: readable.text_sha256,
    source_extraction_version: readable.extraction_version,
    covered_pdf_pages: readable.total_pdf_pages,
    index_version: "literal-sections-v2",
    entries_sha256: await hash(entries),
    entries,
  };
  const body = new TextEncoder().encode(JSON.stringify(index));
  if (body.length > MAX_BYTES)
    throw new ToolError(
      "The complete clause index exceeds the supported size; it was not truncated.",
    );
  const { error } = await sb.storage
    .from(BUCKET)
    .upload(clauseIndexKey(source), body, { contentType: "application/json", upsert: false });
  if (error && !/duplicate|already exists/i.test(error.message))
    throw new ToolError("Readable text is preserved, but its clause index could not be stored.");
  const saved = await loadClauseIndex(sb, source, readable);
  if (!saved) throw new ToolError("Clause index storage could not be verified.");
  return { index: saved, reused: !!error };
}
