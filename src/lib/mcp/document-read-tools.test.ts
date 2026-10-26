import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { jsPDF } from "jspdf";
import { extractUploadDocument } from "./file-upload";
import { prepareReadable, type ReadableSource } from "./document-readable";
import type { Sb } from "./guard";
import { mapPdfiumTextPages } from "./pdf-renderer";
const state = vi.hoisted(() => ({
  scope: "full",
  rows: {} as Record<string, Record<string, unknown>[]>,
  calls: [] as unknown[][],
  error: null as null | { message: string },
  bytes: new Uint8Array(),
  storageError: false,
  readable: new Map<string, Uint8Array>(),
}));
vi.mock("./guard", () => ({
  run: async (_t: string, _c: unknown, _o: unknown, fn: (sb: unknown) => Promise<unknown>) =>
    fn({
      from: table,
      auth: { getUser: async () => ({ data: { user: { id: "fixture-reader" } }, error: null }) },
      storage: {
        from: (bucket: string) => ({
          download: async (path: string) => {
            state.calls.push(["download", bucket, path]);
            if (path.includes(".athena-readable-"))
              return state.readable.has(path)
                ? { data: new Blob([state.readable.get(path)! as BlobPart]), error: null }
                : { data: null, error: { message: "missing", statusCode: "404" } };
            return {
              data: state.storageError ? null : new Blob([state.bytes as BlobPart]),
              error: state.storageError ? { message: "denied" } : null,
            };
          },
        }),
      },
    }),
  dbError: (e: { message: string }) => {
    throw new Error(e.message);
  },
}));
vi.mock("./jobs", () => ({
  memberCompanies: async () => [{ id: "alp", name: "ALP Construction" }],
  resolveJob: async (_sb: unknown, job: string, company?: string) => {
    state.calls.push(["resolve", job, company]);
    return { job_id: "job-2710", job_number: job, company_id: "alp", scope: state.scope };
  },
}));
function table(name: string) {
  let rows = state.rows[name] ?? [];
  const q = {
    select(cols: string) {
      state.calls.push(["select", name, cols]);
      return q;
    },
    eq(col: string, value: unknown) {
      state.calls.push(["eq", name, col, value]);
      rows = rows.filter((r) => r[col] === value);
      return q;
    },
    ilike(col: string, value: string) {
      state.calls.push(["ilike", name, col, value]);
      return q;
    },
    order(col: string) {
      state.calls.push(["order", name, col]);
      rows = [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col])));
      return q;
    },
    async range(from: number, to: number) {
      return { data: rows.slice(from, to + 1), error: state.error };
    },
  };
  return q;
}
import { projectDocuments, sourcePages, searchSource } from "./tools/document-read-tools";
const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const call = (input: Record<string, unknown>) =>
  (
    projectDocuments as unknown as {
      handler: (a: Record<string, unknown>, c: unknown) => Promise<{ structuredContent: any }>;
    }
  ).handler(
    {
      job_number: "2710",
      company_id: "alp",
      action: "list",
      offset: 0,
      limit: 10,
      page_count: 1,
      ...input,
    },
    {},
  );
const source = (extra: Record<string, unknown> = {}) => ({
  id,
  job_id: "job-2710",
  company_id: "alp",
  name: "Exact source.pdf",
  mime_type: "application/pdf",
  size_bytes: 2511305,
  file_sha256: "5e".repeat(32),
  updated_at: "2026-10-26",
  body: "[[PDF page 1]]\nOther text\n[[PDF page 2]]\nReview with reasonable promptness.",
  ...extra,
});
beforeEach(() => {
  state.scope = "full";
  state.rows = { mcp_spec_documents: [source()] };
  state.calls = [];
  state.error = null;
  state.storageError = false;
  state.readable.clear();
  state.bytes = new Uint8Array();
});
describe("saved source discovery and reads", () => {
  it("lists stored identity and bytes without retrieving or exposing source body", async () => {
    const r = await call({});
    expect(r.structuredContent.documents).toHaveLength(1);
    expect(r.structuredContent.documents[0]).toMatchObject({
      id,
      name: "Exact source.pdf",
      mime_type: "application/pdf",
      size_bytes: 2511305,
      kind: "spec",
    });
    expect(r.structuredContent.documents[0].body).toBeUndefined();
    expect(
      state.calls.filter((c) => c[0] === "select").every((c) => !String(c[2]).includes("body")),
    ).toBe(true);
    expect(
      state.calls
        .filter((c) => c[0] === "eq")
        .every(
          (c) =>
            (c[2] === "job_id" && c[3] === "job-2710") || (c[2] === "company_id" && c[3] === "alp"),
        ),
    ).toBe(true);
    expect(state.calls[0]).toEqual(["resolve", "2710", "alp"]);
  });
  it("refuses another named company rather than falling back to a unique job", async () => {
    await expect(call({ company_id: "unrelated-company" })).rejects.toThrow(
      /not in the company you named/,
    );
    expect(state.calls.filter((c) => c[0] === "select")).toEqual([]);
    const r = await call({ company_id: "ALP Construction" });
    expect(r.structuredContent.company_id).toBe("alp");
  });
  it("reads only the chosen source and requested physical pages", async () => {
    const r = await call({ action: "read", document_id: id, page: 2, kind: "spec" });
    expect(r.structuredContent.documents[0]).toMatchObject({
      page_citations_available: true,
      pages: [
        { page: 2, text: "Review with reasonable promptness.", response_text_truncated: false },
      ],
    });
    expect(r.structuredContent.documents[0].pages).toHaveLength(1);
    await expect(
      call({ action: "read", document_id: "ffffffff-ffff-4fff-8fff-ffffffffffff" }),
    ).rejects.toThrow(/not available on this job/);
    await expect(call({ action: "read" })).rejects.toThrow(/exact document ID/);
  });
  it("selects a source before searching and never filters on the truncated cache", async () => {
    const selection = (await call({ action: "search", query: "late clause" })).structuredContent
      .documents[0];
    expect(selection.document_selection_required).toBe(true);
    expect(selection.hits).toBeUndefined();
    const r = await call({ action: "search", document_id: id, query: "reasonable promptness" });
    expect(r.structuredContent.documents[0].hits).toEqual([
      { page: 2, quote: "Review with reasonable promptness." },
    ]);
    expect(state.calls.some((c) => c[0] === "ilike")).toBe(false);
    expect(searchSource(source().body, "insurance", 10)).toEqual([]);
    await expect(call({ action: "search" })).rejects.toThrow(/literal words/);
  });
  it("returns every per-kind page without losing records between kinds", async () => {
    state.rows = {
      mcp_contract_documents: [source({ id: "a" }), source({ id: "b" }), source({ id: "c" })],
      mcp_spec_documents: [source({ id: "d" }), source({ id: "e" }), source({ id: "f" })],
    };
    const first = await call({ limit: 2 });
    expect(first.structuredContent.documents.map((d: any) => d.id)).toEqual(["a", "b", "d", "e"]);
    expect(first.structuredContent.next_offset).toBe(2);
    const second = await call({ limit: 2, offset: 2 });
    expect(second.structuredContent.documents.map((d: any) => d.id)).toEqual(["c", "f"]);
    expect(second.structuredContent.next_offset).toBeNull();
  });
  it("preserves missing/legacy mapping and refuses limited job scope", async () => {
    state.rows.mcp_spec_documents = [source({ body: "" })];
    expect(
      (await call({ action: "read", document_id: id })).structuredContent.documents[0],
    ).toMatchObject({ readable: false, page_citations_available: false, pages: [] });
    state.rows.mcp_spec_documents = [source({ body: "Legacy insurance text" })];
    expect(
      (await call({ action: "read", document_id: id })).structuredContent.documents[0],
    ).toMatchObject({
      page_citations_available: false,
      pages: [{ page: null, text: "Legacy insurance text" }],
    });
    state.scope = "super";
    state.calls = [];
    await expect(call({})).rejects.toThrow(/cannot read/);
    expect(state.calls).toHaveLength(1);
    state.scope = "contract";
    await expect(call({})).resolves.toBeDefined();
  });
  it("traces original bytes to the same record and freshly extracted content without writing", async () => {
    const body = "Submittals reviewed with reasonable promptness.";
    state.bytes = new TextEncoder().encode(body);
    const hash = createHash("sha256").update(state.bytes).digest("hex");
    state.rows.mcp_spec_documents = [
      source({
        name: "Source.txt",
        body,
        body_sha256: hash,
        size_bytes: state.bytes.length,
        file_sha256: hash,
        created_by: "fixture-uploader",
        upload_id: id,
        storage_bucket: "athena-documents",
        storage_path: `alp/job-2710/${id}/Source.txt`,
      }),
    ];
    const trace = (await call({ action: "verify", document_id: id })).structuredContent
      .documents[0];
    expect(trace).toMatchObject({
      authenticated_user_id: "fixture-reader",
      uploader_user_id: "fixture-uploader",
      company_id: "alp",
      job_id: "job-2710",
      original_matches_record: true,
      stored_body_hash_matches: true,
      fresh_extraction_matches_stored: true,
      freshly_extracted_chars: body.length,
      record_changed: false,
    });
    expect(trace.storage_object_key).toBe(`alp/job-2710/${id}/Source.txt`);
    state.bytes = new TextEncoder().encode("changed bytes");
    const changed = (await call({ action: "verify", document_id: id })).structuredContent
      .documents[0];
    expect(changed.original_matches_record).toBe(false);
    expect(changed.freshly_extracted_chars).toBeNull();
    state.storageError = true;
    await expect(call({ action: "verify", document_id: id })).rejects.toThrow(/current job access/);
  });
  it("refuses cross-job source rows and mismatched storage references before downloading", async () => {
    state.rows.mcp_spec_documents = [
      source({ job_id: "other-job" }),
      source({ company_id: "other-company" }),
    ];
    await expect(call({ action: "verify", document_id: id })).rejects.toThrow(
      /not available on this job/,
    );
    state.rows.mcp_spec_documents = [
      source({
        storage_bucket: "athena-documents",
        storage_path: `alp/other-job/${id}/Source.pdf`,
      }),
    ];
    await expect(call({ action: "verify", document_id: id })).rejects.toThrow(
      /not associated with this job/,
    );
    expect(state.calls.some((c) => c[0] === "download")).toBe(false);
  });
  it("reports database failures and never exposes storage capabilities", async () => {
    state.error = { message: "unavailable" };
    await expect(call({})).rejects.toThrow("unavailable");
    state.error = null;
    state.storageError = false;
    state.bytes = new Uint8Array();
    const r = await call({});
    expect(JSON.stringify(r)).not.toMatch(/storage_path|signed_url|upload_url/);
  });
});
describe("physical page provenance", () => {
  it("never invents citations for malformed, nonsequential or embedded page markers", () => {
    for (const body of [
      "legacy",
      "prefix [[PDF page 1]]\ntext",
      "[[PDF page 2]]\ntext",
      "[[PDF page 1]]\ntext\n[[PDF page 1]]\nembedded",
    ])
      expect(sourcePages(body)).toEqual([{ page: null, text: body }]);
    expect(sourcePages("")).toEqual([]);
    expect(searchSource("anything", "", 10)).toEqual([]);
  });
  it("does not turn page-like text in a TXT file into physical PDF citations", async () => {
    state.rows.mcp_spec_documents = [source({ name: "Source.txt", mime_type: "text/plain" })];
    const read = (await call({ action: "read", document_id: id })).structuredContent.documents[0];
    expect(read.page_citations_available).toBe(false);
    expect(read.pages[0].page).toBeNull();
    expect(
      (await call({ action: "search", document_id: id, query: "reasonable" })).structuredContent
        .documents[0].hits[0].page,
    ).toBeNull();
  });
  it("caps page response text explicitly while preserving source identity", async () => {
    state.rows.mcp_spec_documents = [source({ body: "[[PDF page 1]]\n" + "a".repeat(40001) })];
    const doc = (await call({ action: "read", document_id: id })).structuredContent.documents[0];
    expect(doc.pages[0].text).toHaveLength(40000);
    expect(doc.pages[0].response_text_truncated).toBe(true);
  });
});

function original(bytes: Uint8Array, body = "[[PDF page 1]]\nCached fragment") {
  state.bytes = new Uint8Array(bytes);
  state.rows.mcp_spec_documents = [
    source({
      body,
      size_bytes: bytes.length,
      file_sha256: createHash("sha256").update(bytes).digest("hex"),
      upload_id: id,
      storage_bucket: "athena-documents",
      storage_path: `alp/job-2710/${id}/Exact source.pdf`,
    }),
  ];
}
describe("original-backed complete page retrieval", () => {
  it("reads and searches beyond a 400,000-character cache without changing bytes", async () => {
    const pdf = new jsPDF({ compress: true });
    pdf.setFontSize(4);
    for (let page = 1; page <= 155; page++) {
      if (page > 1) pdf.addPage();
      for (let line = 0; line < 45; line++)
        pdf.text(`Physical page ${page} source content ` + "x".repeat(65), 8, 8 + line * 5);
      if (page === 149) pdf.text("Late termination clause: seven calendar days", 8, 240);
      if (page === 155) pdf.text("Final physical page verified", 8, 246);
    }
    const bytes = new Uint8Array(pdf.output("arraybuffer"));
    const hash = createHash("sha256").update(bytes).digest("hex");
    const cached = await extractUploadDocument(bytes, "pdf");
    expect(cached.truncated).toBe(true);
    expect(cached.chars).toBe(400000);
    expect(cached.text).not.toContain("Late termination clause");
    original(bytes, cached.text);
    const read = (await call({ action: "read", document_id: id, page: 149 })).structuredContent
      .documents[0];
    expect(read).toMatchObject({
      total_pdf_pages: 155,
      original_matches_record: true,
      text_source: "stored_original",
    });
    expect(read.pages[0].page).toBe(149);
    expect(read.pages[0].text).toContain("Late termination clause");
    const first = (
      await call({ action: "search", document_id: id, query: "Late termination clause" })
    ).structuredContent.documents[0];
    expect(first.hits).toEqual([]);
    expect(first.next_pdf_page).toBe(101);
    expect(first.search_complete).toBe(false);
    const second = (
      await call({
        action: "search",
        document_id: id,
        query: "Late termination clause",
        page: first.next_pdf_page,
      })
    ).structuredContent.documents[0];
    expect(second.hits[0].page).toBe(149);
    expect(second.next_pdf_page).toBeNull();
    const final = (await call({ action: "read", document_id: id, page: 155 })).structuredContent
      .documents[0];
    expect(final.pages[0].text).toContain("Final physical page verified");
    expect(final.next_pdf_page).toBeNull();
    expect(createHash("sha256").update(state.bytes).digest("hex")).toBe(hash);
    expect(JSON.stringify(read)).not.toMatch(/storage_path|storage_object_key|signed_url/);
    expect(
      (await call({ action: "read", document_id: id, page: 156 })).structuredContent.documents[0],
    ).toMatchObject({ pages: [], requested_pages_out_of_range: true });
  }, 30000);
  it("rejects changed originals, denied storage and wrong upload paths; malformed PDFs do not poison the queue", async () => {
    const pdf = new jsPDF();
    pdf.text("Good subsequent source", 10, 20);
    const good = new Uint8Array(pdf.output("arraybuffer"));
    original(good);
    state.bytes = new TextEncoder().encode("different");
    await expect(call({ action: "read", document_id: id })).rejects.toThrow(/bytes do not match/);
    original(good);
    state.storageError = true;
    await expect(call({ action: "search", document_id: id, query: "Good" })).rejects.toThrow(
      /current job access/,
    );
    state.storageError = false;
    state.rows.mcp_spec_documents[0].upload_id = "different-upload";
    state.calls = [];
    await expect(call({ action: "read", document_id: id })).rejects.toThrow(/not associated/);
    expect(state.calls.some((c) => c[0] === "download")).toBe(false);
    original(new TextEncoder().encode("%PDF-malformed"));
    await expect(call({ action: "read", document_id: id })).rejects.toThrow(/could not be parsed/);
    original(good);
    expect(
      (await call({ action: "read", document_id: id })).structuredContent.documents[0].pages[0]
        .text,
    ).toContain("Good subsequent source");
  });
  it("supports dense-page continuation and explicitly limited literal results", async () => {
    const pdf = new jsPDF();
    pdf.setFontSize(0.5);
    for (let i = 0; i < 600; i++)
      pdf.text(`Dense original ${i} ` + "q".repeat(80), 5, 10 + i * 0.4);
    original(new Uint8Array(pdf.output("arraybuffer")));
    const first = (await call({ action: "read", document_id: id })).structuredContent.documents[0];
    expect(first.pages[0].text.length).toBe(40000);
    expect(first.pages[0].next_text_offset).toBe(40000);
    const next = (await call({ action: "read", document_id: id, text_offset: 40000 }))
      .structuredContent.documents[0];
    expect(next.pages[0].text.length).toBeGreaterThan(0);
    expect(next.pages[0].next_text_offset).toBeNull();
    const hits = (
      await call({ action: "search", document_id: id, query: "Dense original", limit: 2 })
    ).structuredContent.documents[0];
    expect(hits.hits).toHaveLength(2);
    expect(hits.matches_truncated).toBe(true);
    expect(hits.search_complete).toBe(false);
  });
  it.skipIf(!process.env.ATHENA_OFFICE_PDF)(
    "retrieves actual Office pages 149 and the final page from the unchanged original",
    async () => {
      const bytes = new Uint8Array(readFileSync(process.env.ATHENA_OFFICE_PDF!));
      expect(bytes.length).toBe(6010652);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        "c1558b6dd96344f6926d760660dfe8ecaefa9c9e7d7cfc932fade08b16462967",
      );
      const cache = await extractUploadDocument(bytes, "pdf");
      expect(cache.chars).toBe(400000);
      expect(cache.truncated).toBe(true);
      expect(sourcePages(cache.text).at(-1)?.page).toBe(148);
      original(bytes, cache.text);
      const p149 = (await call({ action: "read", document_id: id, page: 149 })).structuredContent
        .documents[0];
      expect(p149.pages[0].text).toMatch(/14\.2\.2/);
      expect(p149.pages[0].text).toMatch(/seven/i);
      const p148 = (await call({ action: "read", document_id: id, page: 148 })).structuredContent
        .documents[0];
      expect(p148.pages[0].text.length).toBeGreaterThan(
        sourcePages(cache.text).at(-1)!.text.length,
      );
      const lateSearch = (
        await call({ action: "search", document_id: id, query: "14.2.2", page: 101 })
      ).structuredContent.documents[0];
      expect(lateSearch.hits.some((hit: { page: number }) => hit.page === 149)).toBe(true);
      const independent = await mapPdfiumTextPages(bytes, 149, 1, (text, page) => ({ text, page }));
      expect(p149.pages[0].text).toBe(independent.pages[0].text);
      const last = (await call({ action: "read", document_id: id, page: p149.total_pdf_pages }))
        .structuredContent.documents[0];
      expect(last.pages[0].page).toBe(p149.total_pdf_pages);
      expect(last.next_pdf_page).toBeNull();
      expect(last.pages[0].text).toBe(
        (await mapPdfiumTextPages(bytes, p149.total_pdf_pages, 1, (text) => text)).pages[0],
      );
      const proof = {
        office_bytes: bytes.length,
        cache_chars: cache.chars,
        cache_last_page: 148,
        total_pdf_pages: p149.total_pdf_pages,
        page148_complete_chars: p148.pages[0].text.length,
        page148_cached_chars: sourcePages(cache.text).at(-1)!.text.length,
        page149_chars: p149.pages[0].text.length,
        final_page_chars: last.pages[0].text.length,
        late_search_page149: true,
        original_unchanged:
          createHash("sha256").update(bytes).digest("hex") ===
          "c1558b6dd96344f6926d760660dfe8ecaefa9c9e7d7cfc932fade08b16462967",
      };
      if (process.env.ATHENA_RETRIEVAL_PROOF)
        writeFileSync(process.env.ATHENA_RETRIEVAL_PROOF, JSON.stringify(proof, null, 2));
    },
    30000,
  );
});

it("read and search reuse prepared text without downloading or parsing the PDF", async () => {
  const pdf = new jsPDF();
  pdf.text("Saved persistent notice clause", 10, 20);
  const bytes = new Uint8Array(pdf.output("arraybuffer"));
  original(bytes);
  const source = state.rows.mcp_spec_documents[0] as unknown as ReadableSource;
  const sb = {
    storage: {
      from: () => ({
        download: async (path: string) =>
          state.readable.has(path)
            ? { data: new Blob([state.readable.get(path)! as BlobPart]), error: null }
            : { data: null, error: { message: "missing" } },
        upload: async (path: string, value: Uint8Array) => {
          state.readable.set(path, value);
          return { error: null };
        },
      }),
    },
  } as unknown as Sb;
  await prepareReadable(sb, source, bytes);
  state.calls = [];
  state.bytes = new Uint8Array(); // Original is intentionally unavailable in this fixture.
  const read = (await call({ action: "read", document_id: id })).structuredContent.documents[0];
  expect(read).toMatchObject({
    reused_extraction: true,
    text_source: "saved_readable_document",
    readable_state: "ready",
    total_pdf_pages: 1,
  });
  expect(read.pages[0].text).toContain("Saved persistent notice clause");
  const search = (await call({ action: "search", document_id: id, query: "notice clause" }))
    .structuredContent.documents[0];
  expect(search.hits[0].page).toBe(1);
  expect(search.search_complete).toBe(true);
  expect(
    state.calls
      .filter((c) => c[0] === "download")
      .every((c) => String(c[2]).includes(".athena-readable-")),
  ).toBe(true);
});
