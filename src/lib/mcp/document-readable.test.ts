import { beforeEach, expect, it, vi } from "vitest";
import { jsPDF } from "jspdf";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { Sb } from "./guard";
import * as renderer from "./pdf-renderer";
import {
  loadReadable,
  prepareReadable,
  readableKey,
  type ReadableSource,
} from "./document-readable";
const objects = new Map<string, Uint8Array>();
let failedWrite = false;
const sb = {
  storage: {
    from: () => ({
      download: async (path: string) =>
        objects.has(path)
          ? { data: new Blob([objects.get(path)! as BlobPart]), error: null }
          : { data: null, error: { message: "Object not found", statusCode: "404" } },
      upload: async (path: string, bytes: Uint8Array, options: { upsert: boolean }) => {
        expect(options.upsert).toBe(false);
        if (failedWrite) return { error: { message: "storage unavailable" } };
        if (objects.has(path)) return { error: { message: "already exists" } };
        objects.set(path, bytes.slice());
        return { error: null };
      },
    }),
  },
} as unknown as Sb;
function source(bytes: Uint8Array): ReadableSource {
  return {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    company_id: "alp",
    job_id: "2710",
    upload_id: "upload",
    storage_bucket: "athena-documents",
    storage_path: "alp/2710/upload/Original.pdf",
    file_sha256: createHash("sha256").update(bytes).digest("hex"),
    size_bytes: bytes.length,
  };
}
beforeEach(() => {
  objects.clear();
  failedWrite = false;
  vi.restoreAllMocks();
});
it("publishes complete page text once and reuses it without PDF extraction", async () => {
  const pdf = new jsPDF();
  pdf.text("First page", 10, 20);
  pdf.addPage();
  pdf.text("Final page", 10, 20);
  const bytes = new Uint8Array(pdf.output("arraybuffer"));
  const original = bytes.slice();
  const s = source(bytes);
  const extract = vi.spyOn(renderer, "extractPdfiumDocumentText");
  const first = await prepareReadable(sb, s, bytes);
  expect(first.reused).toBe(false);
  expect(first.document).toMatchObject({
    state: "ready",
    total_pdf_pages: 2,
    covered_pdf_pages: 2,
    source_sha256: s.file_sha256,
  });
  expect(first.document.pages[1]).toMatchObject({ page: 2, text: "Final page" });
  expect(extract).toHaveBeenCalledTimes(1);
  expect((await prepareReadable(sb, s, bytes)).reused).toBe(true);
  expect((await loadReadable(sb, s))!.pages).toEqual(first.document.pages);
  expect(extract).toHaveBeenCalledTimes(1);
  expect(objects.size).toBe(1);
  expect(bytes).toEqual(original);
});
it("refuses stale identity, incomplete coverage, corrupted text and wrong-job keys", async () => {
  const bytes = new TextEncoder().encode("fixture");
  const s = source(bytes);
  await prepareReadable(sb, s, bytes, ["page one", "page two"]);
  const key = readableKey(s);
  const doc = JSON.parse(new TextDecoder().decode(objects.get(key)));
  const set = (d: unknown) => objects.set(key, new TextEncoder().encode(JSON.stringify(d)));
  set(null);
  await expect(loadReadable(sb, s)).rejects.toThrow(/does not match/);
  set({ ...doc, pages: [null, doc.pages[1]] });
  await expect(loadReadable(sb, s)).rejects.toThrow(/does not match/);
  set({ ...doc, source_id: "another-source" });
  await expect(loadReadable(sb, s)).rejects.toThrow(/does not match/);
  set({ ...doc, pages: doc.pages.slice(0, 1) });
  await expect(loadReadable(sb, s)).rejects.toThrow(/does not match/);
  set({ ...doc, pages: [{ page: 1, text: "tampered" }, doc.pages[1]] });
  await expect(loadReadable(sb, s)).rejects.toThrow(/does not match/);
  set(doc);
  expect(await loadReadable(sb, { ...s, file_sha256: "a".repeat(64) })).toBeNull();
  expect(() => readableKey({ ...s, job_id: "other-job" })).toThrow(/job-scoped/);
  await expect(
    prepareReadable(sb, s, new TextEncoder().encode("different"), ["x"]),
  ).rejects.toThrow(/bytes do not match/);
});
it("never publishes ready on a failed extraction or storage write, and reconciles concurrent publication", async () => {
  const pdf = new jsPDF();
  pdf.text("Original", 10, 20);
  const bytes = new Uint8Array(pdf.output("arraybuffer"));
  const s = source(bytes);
  failedWrite = true;
  await expect(prepareReadable(sb, s, bytes)).rejects.toThrow(/could not be saved/);
  expect(objects.size).toBe(0);
  failedWrite = false;
  const prepared = await Promise.all([
    prepareReadable(sb, s, bytes),
    prepareReadable(sb, s, bytes),
  ]);
  expect(prepared.map((x) => x.reused).sort()).toEqual([false, true]);
  expect(objects.size).toBe(1);
  const malformed = new TextEncoder().encode("not a PDF");
  await expect(prepareReadable(sb, source(malformed), malformed)).rejects.toThrow(
    /could not be extracted/,
  );
});
it.skipIf(!process.env.ATHENA_OFFICE_PDF)(
  "persists all 450 actual Office pages and repeats retrieval without parsing",
  async () => {
    const bytes = new Uint8Array(readFileSync(process.env.ATHENA_OFFICE_PDF!));
    const s = source(bytes);
    const extract = vi.spyOn(renderer, "extractPdfiumDocumentText");
    const ready = await prepareReadable(sb, s, bytes);
    expect(ready.document.total_pdf_pages).toBe(450);
    expect(ready.document.pages[148].text).toMatch(/14\.2\.2/);
    expect(ready.document.pages[449].text.length).toBeGreaterThan(0);
    const second = await prepareReadable(sb, s, bytes);
    const read = await loadReadable(sb, s);
    expect(second.reused).toBe(true);
    expect(read!.pages[148]).toEqual(ready.document.pages[148]);
    expect(extract).toHaveBeenCalledTimes(1);
    if (process.env.ATHENA_DURABLE_PROOF)
      writeFileSync(
        process.env.ATHENA_DURABLE_PROOF,
        JSON.stringify(
          {
            source_bytes: bytes.length,
            source_sha256: s.file_sha256,
            total_pages: 450,
            covered_pages: read!.covered_pdf_pages,
            readable_bytes: objects.get(readableKey(s))!.length,
            readable_text_sha256: read!.text_sha256,
            pdf_extractions: extract.mock.calls.length,
            repeated_preparation_reused: true,
            repeated_read_reused: true,
            original_unchanged: createHash("sha256").update(bytes).digest("hex") === s.file_sha256,
          },
          null,
          2,
        ),
      );
  },
  30000,
);
