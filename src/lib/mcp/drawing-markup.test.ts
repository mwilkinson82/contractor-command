import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { jsPDF } from "jspdf";
import { bytesToBase64 } from "./estimating-sheet";
import { drawingSource, downloadDrawingSource, FILE_MAX_BYTES, sha256Hex, validateFile } from "./file-share";
import { markupColor, renderDrawingMarkup } from "./drawing-markup-render";
import { DRAWING_BUCKET, DRAWING_MAX_BYTES, MARKUP_DELETE_REFUSAL, ORIGINAL_DELETE_REFUSAL, drawingBucket, removeDrawing, storeDrawingSet, storedSheet, type DrawingRecord } from "./drawing-set";
import { attachAthenaCard } from "./cards/attach";

const state = vi.hoisted(() => ({
  records: [] as Record<string, unknown>[],
  documents: [] as Record<string, unknown>[],
  objects: new Map<string, Uint8Array>(),
  objectBuckets: new Map<string, string>(),
  uploaded: [] as string[],
  removed: [] as string[],
  failRecord: false,
  failSetup: false,
  deny: false,
  downloads: [] as string[],
  buckets: [] as string[],
}));
vi.mock("./guard", () => ({
  run: async (_t: string, _c: unknown, _o: unknown, fn: (sb: unknown) => unknown) => fn(fakeSb()),
  text: (text: string) => ({ content: [{ type: "text", text }] }),
  dbError: (error: { message: string }) => {
    throw new Error(error.message);
  },
  isMissingFunction: () => false,
}));
vi.mock("./jobs", () => ({
  named: () => "2701 – Test Construction",
  audit: async () => {},
  WhichCompanyAsk: class extends Error {},
  resolveJob: async () => {
    if (state.deny) throw new Error("This role does not have access to the job.");
    return {
      company_id: "c1",
      job_id: "j1",
      job_number: "2701",
      name: "Test Construction",
      scope: "full",
    };
  },
}));
function fakeSb() {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "mcp_estimate_get")
        return {
          data: {
            setup: { documents: state.documents },
            takeoff: {
              version: 1,
              lines: [
                {
                  line_no: 1,
                  item: "Test footing",
                  qty: 12,
                  unit: "EA",
                  sheet: "S-100",
                  basis: "read",
                  confidence: "high",
                  math: "12 marks",
                  markup_ref: "F1",
                },
              ],
            },
            gaps: [],
            verdicts: [],
          },
          error: null,
        };
      if (name === "mcp_estimate_setup_save") {
        if (state.failSetup) return { data: null, error: { message: "fictional legacy index failure" } };
        state.documents = (args._patch as { documents: Record<string, unknown>[] }).documents;
        return { data: {}, error: null };
      }
      if (name === "mcp_drawing_records")
        return {
          data: state.records
            .filter((r) => r.kind === "source")
            .slice()
            .reverse(),
          error: null,
        };
      if (name === "mcp_takeoff_get") return {data:null,error:null};
      if (state.failRecord) return { data: null, error: { message: "test write failure" } };
      const input = args._record as Record<string, unknown>;
      if (name === "mcp_drawing_source_save") {
        const prior = state.records
          .slice()
          .reverse()
          .find((r) => r.kind === "source" && r.source_key === input.source_key);
        if (
          prior &&
          prior.content_hash === input.content_hash &&
          JSON.stringify(prior.sheets) === JSON.stringify(input.sheets)
        )
          return { data: prior, error: null };
        const r = {
          ...input,
          id: crypto.randomUUID(),
          kind: "source",
          version:
            state.records.filter((r) => r.source_key === input.source_key && r.kind === "source")
              .length + 1,
          created_at: new Date().toISOString(),
        };
        state.records.push(r);
        return { data: r, error: null };
      }
      if (name === "mcp_drawing_markup_save") {
        const r = {
          ...input,
          id: crypto.randomUUID(),
          kind: "markup",
          parent_id: args._source,
          version:
            state.records.filter((r) => r.parent_id === args._source && r.sheet === input.sheet)
              .length + 1,
          created_at: new Date().toISOString(),
        };
        state.records.push(r);
        return { data: r, error: null };
      }
      return { data: {}, error: null };
    },
    storage: {
      from: (bucketName: string) => { state.buckets.push(bucketName); return ({
        upload: async (path: string, bytes: Uint8Array, options: { upsert: boolean }) => {
          expect(options.upsert).toBe(false);
          if (state.objects.has(path)) return { error: { message: "Already exists" } };
          state.uploaded.push(path);
          state.objects.set(path, bytes.slice());
          state.objectBuckets.set(path, bucketName);
          return { error: null };
        },
        download: async (path: string) => {
          state.downloads.push(path);
          const bytes = state.objects.get(path);
          const storedIn = state.objectBuckets.get(path) ?? "athena-files";
          return bytes && storedIn === bucketName
            ? { data: { arrayBuffer: async () => new Uint8Array(bytes).buffer }, error: null }
            : { data: null, error: { message: "not found" } };
        },
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://files.example.com/${path}?signed=1` },
          error: null,
        }),
        remove: async (paths: string[]) => {
          state.removed.push(...paths);
          paths.forEach((p) => {
            state.objects.delete(p);
            state.objectBuckets.delete(p);
          });
          return { error: null };
        },
      }); },
    },
  };
}
import { drawingMarkup, drawingSetImport } from "./tools/estimate-tools";
const call = (tool: unknown, args: Record<string, unknown>) =>
  (
    tool as {
      handler: (
        a: Record<string, unknown>,
        ctx: object,
      ) => Promise<{
        content: { type: string; text?: string; data?: string }[];
        structuredContent: Record<string, unknown>;
      }>;
    }
  ).handler(args, {});
const job = { company_id: "c1", job_id: "j1" };
function pdf(label = "S-100 original"): Uint8Array {
  const d = new jsPDF({ unit: "pt", format: [400, 250] });
  d.text("Cover", 20, 40);
  d.addPage();
  d.setDrawColor("#6B7280");
  d.rect(20, 30, 180, 130);
  d.text(label, 30, 80);
  return new Uint8Array(d.output("arraybuffer"));
}
const legacy = "c1/j1/drawing-legacy/set.pdf";
const source = "https://drive.google.com/file/d/test-pdf/view?resourcekey=read-key";
beforeEach(() => {
  state.records = [];
  state.documents = [];
  state.objects.clear();
  state.objectBuckets.clear();
  state.uploaded = [];
  state.removed = [];
  state.failRecord = false;
  state.failSetup = false;
  state.deny = false;
  state.downloads = [];
  state.buckets = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function seed() {
  const original = pdf();
  state.objects.set(legacy, original);
  state.documents = [{ name: "set.pdf", kind: "base", path: legacy, sheets: ["Cover", "S-100"] }];
  return original;
}

describe("stored drawing markup tool", () => {
  it("stores a new five-sheet PDF without names, asks once, then indexes and marks up by source ID despite a renamed host filename", async () => {
    await seed();
    await call(drawingMarkup, { job_number: "2701", sheet: "S-100", operation: "prepare" });
    const names = ["S-100", "S-101", "A-100", "A-101", "A-200"];
    const doc = new jsPDF();
    names.forEach((name, index) => { if (index) doc.addPage(); doc.text(name, 20, 20); });
    const bytes = new Uint8Array(doc.output("arraybuffer"));
    const stored = await call(drawingSetImport, { job_number: "2701", drawing: { filename: "S100-A200(4).pdf", content_base64: bytesToBase64(bytes) } });
    const source = stored.structuredContent.source as DrawingRecord;
    expect(stored.structuredContent).toMatchObject({ stored: true, sheet_index_required: true, source_id: source.id, page_count: 5, sheet_index_context: { source_id: source.id } });
    const originalSource = JSON.stringify(source);
    // The newly stored, unindexed PDF must block an accidental fallback to the older S-100.
    const blocked = await call(drawingMarkup, { job_number: "2701", sheet: "S-100", operation: "prepare" });
    expect(blocked.structuredContent).toMatchObject({ source_id: source.id, sheet_index_required: true, requested_sheet: "S-100" });
    expect(blocked.content.some((block) => block.type === "image")).toBe(false);
    expect(blocked.content[0].text).toContain("No older drawing was substituted");
    const indexed = await call(drawingSetImport, { job_number: "2701", source_id: source.id, stored_filename: "ChatGPT-renamed-it-again.pdf", sheets: names });
    const indexedSource = indexed.structuredContent.source as DrawingRecord;
    expect(indexed.structuredContent).toMatchObject({ stored: true, duplicate: true, sheet_index_required: false, page_count: 5 });
    expect(indexedSource.sheets).toEqual(names);
    expect(indexedSource.path).toBe(source.path);
    expect(indexedSource.content_hash).toBe(source.content_hash);
    expect(JSON.stringify(source)).toBe(originalSource);
    const read = await call(drawingSetImport, { job_number: "2701", source_id: indexedSource.id });
    expect((read.structuredContent.source as DrawingRecord).id).toBe(indexedSource.id);
    const repeated = await call(drawingSetImport, { job_number: "2701", drawing: { filename: "A200(5).pdf", content_base64: bytesToBase64(bytes) } });
    expect(repeated.structuredContent.duplicate).toBe(true);
    expect(repeated.structuredContent.source_id).toBe(indexedSource.id);
    expect(repeated.structuredContent.sheet_index_required).toBe(false);
    const marked = await call(drawingMarkup, { job_number: "2701", source_id: indexedSource.id, source_filename: "Another-renamed-A200(5).pdf", sheet: "S-100", operation: "save", annotations: [{ label: "Test", text: "Fictional rendering test", severity: "callout", geometry: { kind: "pin", point: { x: .5, y: .22 } } }, { label: "Unlocated", text: "Key only; no position supplied", severity: "callout" }] });
    expect(marked.structuredContent.saved).toBe(true);
    expect(marked.structuredContent.markup).toMatchObject({ parent_id: indexedSource.id, page: 1, sheet: "S-100" });
    expect((marked.structuredContent.card as { kpis: unknown[] }).kpis).toEqual(expect.arrayContaining([{ label: "Callouts", value: "2" }, { label: "Pins on sheet", value: "1" }]));
    expect(state.uploaded).toHaveLength(2); // one original object, one separate markup
    expect(state.objects.get(source.path)).toEqual(bytes);
  });
  it("rejects an incomplete page-order answer without changing the stored index or requesting another upload", async () => {
    const stored = await storeDrawingSet(fakeSb(), job, { filename: "new.pdf", content_base64: bytesToBase64(pdf()) });
    const result = await call(drawingSetImport, { job_number: "2701", source_id: stored.record.id, sheets: ["S-100"] });
    expect(result.structuredContent.stored).toBe(true);
    expect(result.structuredContent.index_error).toContain("2 pages");
    expect(result.structuredContent.upload_context).toBeUndefined();
    expect(result.content[0].text).toContain("2 pages");
    expect(result.content[0].text).toContain("No index was changed; no re-upload is needed");
    expect(state.records).toHaveLength(1);
    expect(state.uploaded).toHaveLength(1);
  });
  it("never resolves an unknown source ID using a supplied valid stored filename", async () => {
    await seed();
    const result = await call(drawingSetImport, { job_number: "2701", source_id: crypto.randomUUID(), stored_filename: "set.pdf", sheets: ["Cover", "S-100"] });
    expect(result.content[0].text).toContain("No other set was selected");
    expect(state.uploaded).toEqual([]);
    expect(state.downloads).toEqual([]);
  });
  it("asks for sheet names on an unindexed stored set without downloading the original PDF", async () => {
    const path = "c1/j1/drawing-unindexed/source.pdf";
    state.objects.set(path, pdf());
    state.objectBuckets.set(path, DRAWING_BUCKET);
    state.records.push({ id: "unindexed-source", kind: "source", filename: "big-set.pdf", path, storage_bucket: DRAWING_BUCKET, source_key: "file:big-set.pdf", content_hash: "f".repeat(64), sheets: [], version: 1 });
    const result = await call(drawingMarkup, { job_number: "2701", source_id: "unindexed-source", sheet: "G-0003", operation: "prepare" });
    expect(result.structuredContent).toMatchObject({ source_id: "unindexed-source", sheet_index_required: true, requested_sheet: "G-0003" });
    expect(result.content.some((block) => block.type === "image")).toBe(false);
    expect(result.content[0].text).toContain("No older drawing was substituted");
    expect(state.downloads).toEqual([]);
    expect(state.uploaded).toEqual([]);
  });
  it("reindexes a 17.6 MB stored original with one binary download and no base64 upload or new object", async () => {
    const bytes = new Uint8Array(17612902); bytes.fill(32); bytes.set(pdf());
    const path = "c1/j1/drawing-large/source.pdf", hash = await sha256Hex(bytes);
    state.objects.set(path, bytes);
    state.records.push({ id: "large-source", kind: "source", filename: "large.pdf", path, storage_bucket: DRAWING_BUCKET, source_key: "file:large.pdf", content_hash: hash, sheets: ["Cover", "S-100"], version: 1 });
    const result = await call(drawingSetImport, { job_number: "2701", stored_filename: "large.pdf", sheets: ["Cover", "S-100"] });
    expect(result.structuredContent.duplicate).toBe(true);
    expect(result.structuredContent.stored).toBe(true);
    expect((result.structuredContent.source as DrawingRecord).id).toBe("large-source");
    expect(state.downloads).toEqual([path]);
    expect(state.uploaded).toEqual([]);
    expect(state.buckets).toEqual([DRAWING_BUCKET]);
    expect(await sha256Hex(state.objects.get(path)!)).toBe(hash);
  });
  it("reports the original as stored when only the legacy index sync fails, and reuses it on retry", async () => {
    state.failSetup = true;
    const args = { job_number: "2701", drawing: { filename: "new.pdf", content_base64: bytesToBase64(pdf()), sheets: ["Cover", "S-100"] } };
    const stored = await call(drawingSetImport, args);
    expect(stored.structuredContent.stored).toBe(true);
    expect(stored.structuredContent.index_synced).toBe(false);
    expect(stored.content[0].text).toContain("source record are stored");
    state.failSetup = false;
    const retry = await call(drawingSetImport, args);
    expect(retry.structuredContent.duplicate).toBe(true);
    expect(retry.structuredContent.index_synced).toBe(true);
    expect(state.uploaded).toHaveLength(1);
  });
  it("turns an unbound save into a named-source preview instead of quietly saving an older set", async () => {
    const original = await seed();
    const preview = await call(drawingMarkup, { job_number: "2701", sheet: "S-100" });
    expect(preview.structuredContent.saved).toBe(false);
    expect(preview.structuredContent.source_selection_required).toBe(true);
    expect(preview.content[0].text).toContain("not an upload whose import failed");
    expect(state.uploaded).toEqual([]);
    const saved = await call(drawingMarkup, { job_number: "2701", sheet: "S-100", source_id: (preview.structuredContent.source as DrawingRecord).id });
    expect(saved.structuredContent.saved).toBe(true);
    expect((saved.structuredContent.markup as DrawingRecord).parent_id).toBe((preview.structuredContent.source as DrawingRecord).id);
    expect(state.objects.get(legacy)).toEqual(original);
  });
  it("opens a direct-upload card without requiring a cloud share link", async () => {
    const result = await call(drawingSetImport, { job_number: "2701" });
    expect(result.structuredContent.upload_context).toEqual({ job_number: "2701", company_id: "c1" });
    expect(result.structuredContent.stored).toBe(false);
    expect(result.content[0].text).toContain("100 MB");
    expect(state.uploaded).toEqual([]);
  });
  it("does not silently substitute the old set when the requested new filename is unavailable", async () => {
    await seed();
    const result = await call(drawingMarkup, { job_number: "2701", sheet: "S-100", source_filename: "new-upload.pdf" });
    expect(result.content[0].text).toContain("not stored");
    expect(result.content[0].text).toContain("no older drawing was substituted");
    expect(result.structuredContent.saved).not.toBe(true);
    expect(state.uploaded).toEqual([]);
  });
  it("refuses a mismatched source identity and exposes real findings for positioning on the original preview", async () => {
    await seed();
    const refused = await call(drawingMarkup, { job_number: "2701", sheet: "S-100", source_id: "another-source" });
    expect(refused.content[0].text).toContain("No other drawing was substituted");
    const prepared = await call(drawingMarkup, { job_number: "2701", sheet: "S-100", operation: "prepare" });
    expect(prepared.structuredContent.drawing_annotations).toEqual(expect.arrayContaining([expect.objectContaining({ label: "L1" })]));
    expect(prepared.content[0].text).toContain("newly shared PDF is not included unless its import succeeded");
    expect(state.uploaded).toEqual([]);
  });
  it.each([
    "https://files.oaiusercontent.com/permit.pdf",
    "https://oaisdmntprbrazilsouth.blob.core.windows.net/fictional/permit.pdf?sig=fictional",
    "https://oaisdmntpreastus2.blob.core.windows.net/fictional/permit.pdf?sig=fictional",
  ])("imports the host attachment once, then opens the stored sheet without another download (%s)", async (download_url) => {
    const bytes = pdf();
    const original = bytes.slice();
    const fetcher = vi.fn(async () => new Response(bytes.slice()));
    vi.stubGlobal("fetch", fetcher);
    const args = {
      job_number: "2701", sheets: ["S-001", "S-100"],
      file: { download_url, file_id: "fictional-file", file_name: "host-permit.pdf" },
    };
    const first = await call(drawingSetImport, args);
    const second = await call(drawingSetImport, args);
    expect(first.structuredContent.duplicate).toBe(false);
    expect(second.structuredContent.duplicate).toBe(true);
    expect(state.uploaded).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const prepared = await call(drawingMarkup, { job_number: "2701", sheet: "S-100", operation: "prepare" });
    expect(prepared.structuredContent.page).toBe(2);
    expect(prepared.content.some((block) => block.type === "image")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(bytes).toEqual(original);
    expect(state.objects.get(state.uploaded[0])).toEqual(original);
  });
  it("pulls S-100 from a #190 stored set without an upload and saves a styled dated copy", async () => {
    const original = await seed();
    const result = await call(drawingMarkup, { job_number: "2701", sheet: "s-100", source_filename: "set.pdf" });
    expect(result.structuredContent.saved, result.content[0].text).toBe(true);
    const r = result.structuredContent.markup as DrawingRecord;
    expect(r.sheet).toBe("S-100");
    expect(r.page).toBe(2);
    expect(r.version).toBe(1);
    expect(r.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.parent_id).toBe((result.structuredContent.source as DrawingRecord).id);
    expect(r.path).toMatch(/drawing-markup-.*\/S-100-markup-\d{4}-.*\.pdf$/);
    expect(state.objects.get(legacy)).toEqual(original);
    expect(state.uploaded).toEqual([r.path]);
    expect(state.removed).toEqual([]);
    expect(result.content.some((c) => c.type === "image" && c.data?.startsWith("iVBOR"))).toBe(
      true,
    );
    expect(result.content[0].text).toContain("Test footing");
    expect(result.content[0].text).toContain("<");
    const card = attachAthenaCard("drawing_markup", result);
    expect(card.structuredContent.html).toContain("#1E5FED");
    expect(card.structuredContent.html).not.toContain("#DC2626");
    expect(card.content[0].text).not.toMatch(/lovable/i);
  });
  it("a second ask saves version 2 with a different object; neither original nor version 1 is overwritten", async () => {
    const original = await seed();
    const first = await call(drawingMarkup, { job_number: "2701", sheet: "S-100", source_filename: "set.pdf" });
    const r1 = first.structuredContent.markup as DrawingRecord;
    const bytes1 = state.objects.get(r1.path)?.slice();
    const second = await call(drawingMarkup, {
      job_number: "2701",
      sheet: "S-100",
      source_id: (first.structuredContent.source as DrawingRecord).id,
      annotations: [
        {
          label: "R1",
          text: "Delay at this footing",
          severity: "delay",
          geometry: { kind: "pin", point: { x: 0.3, y: 0.5 } },
        },
      ],
    });
    const r2 = second.structuredContent.markup as DrawingRecord;
    expect(r2.version).toBe(2);
    expect(r2.path).not.toBe(r1.path);
    expect(state.objects.get(r1.path)).toEqual(bytes1);
    expect(state.objects.get(legacy)).toEqual(original);
    expect(second.structuredContent.html).toContain("#DC2626");
  });
  it("prepare exposes the actual stored page without creating a markup", async () => {
    await seed();
    const result = await call(drawingMarkup, {
      job_number: "2701",
      sheet: "S-100",
      operation: "prepare",
    });
    expect(result.structuredContent.saved).toBe(false);
    expect(state.uploaded).toEqual([]);
    expect(result.structuredContent.page).toBe(2);
    expect(result.structuredContent.drawing_preview).toEqual(result.content.find((c) => c.type === "image"));
    expect(result.structuredContent.drawing_preview).toMatchObject({ type: "image", mimeType: "image/png" });
  });
  it("does not use a foreign-company path or write when access is denied", async () => {
    await seed();
    state.documents[0].path = "other/j2/drawing-legacy/set.pdf";
    const result = await call(drawingMarkup, { job_number: "2701", sheet: "S-100" });
    expect(result.structuredContent.saved).toBeUndefined();
    expect(state.downloads).toEqual([]);
    state.deny = true;
    const denied = await call(drawingMarkup, { job_number: "2701", sheet: "S-100" });
    expect(denied.content[0].text).toContain("does not have access");
    expect(state.uploaded).toEqual([]);
  });
  it("refuses changed bytes under a saved source fingerprint", async () => {
    const original = await seed();
    await storedSheet(fakeSb(), job, state.documents as never, "S-100");
    state.objects.set(legacy, pdf("Changed unexpectedly"));
    await expect(storedSheet(fakeSb(), job, state.documents as never, "S-100")).rejects.toThrow(
      /fingerprint/,
    );
    expect(state.uploaded).toEqual([]);
    expect(await sha256Hex(original)).not.toBe(await sha256Hex(state.objects.get(legacy)!));
  });
  it("never deletes a stored original or a saved markup", async () => {
    const original = await seed();
    state.records.push({
      kind: "source",
      path: "c1/j1/plain/original.pdf",
      storage_bucket: "athena-files",
      filename: "original.pdf",
    });
    await expect(removeDrawing(fakeSb(), legacy)).rejects.toThrow(ORIGINAL_DELETE_REFUSAL);
    await expect(removeDrawing(fakeSb(), "c1/j1/drawing-markup-1/page.pdf", DRAWING_BUCKET)).rejects.toThrow(ORIGINAL_DELETE_REFUSAL);
    await expect(removeDrawing(fakeSb(), "c1/j1/plain/original.pdf")).rejects.toThrow(ORIGINAL_DELETE_REFUSAL);
    await expect(removeDrawing(fakeSb(), "c1/j1/drawing-markup-1/page.pdf")).rejects.toThrow(MARKUP_DELETE_REFUSAL);
    expect(state.removed).toEqual([]);
    expect(state.objects.get(legacy)).toEqual(original);
  });
  it("cleans up only an uncommitted markup if its record fails", async () => {
    await seed();
    await storedSheet(fakeSb(), job, state.documents as never, "S-100");
    state.failRecord = true;
    const result = await call(drawingMarkup, { job_number: "2701", sheet: "S-100", source_filename: "set.pdf" });
    expect(result.structuredContent.saved).toBeUndefined();
    expect(state.removed).toHaveLength(1);
    expect(state.removed[0]).not.toBe(legacy);
    expect(state.objects.has(legacy)).toBe(true);
  });
});

describe("drawing set identity and source revisions", () => {
  it("stores and recognizes a PDF above 10 MiB in the drawing-only bucket while file_share keeps its cap", async () => {
    // Fictional one-page PDF with an unused large stream: no client fixture or
    // benchmark answers are committed. Its bytes exceed the old limit.
    const chunks: Uint8Array[] = [];
    const offsets = [0];
    let length = 0;
    const add = (s: string | Uint8Array) => { const b = typeof s === "string" ? new TextEncoder().encode(s) : s; chunks.push(b); length += b.length; };
    add("%PDF-1.4\n");
    for (const [i, body] of [
      [1, "<< /Type /Catalog /Pages 2 0 R >>"],
      [2, "<< /Type /Pages /Count 1 /Kids [3 0 R] >>"],
      [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 250] >>"],
    ] as const) { offsets.push(length); add(`${i} 0 obj\n${body}\nendobj\n`); }
    offsets.push(length);
    const padding = new Uint8Array(17 * 1024 * 1024).fill(32);
    add(`4 0 obj\n<< /Length ${padding.length} >>\nstream\n`); add(padding); add("\nendstream\nendobj\n");
    const xref = length;
    add(`xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const bytes = new Uint8Array(length);
    let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    expect(bytes.length).toBeGreaterThan(FILE_MAX_BYTES);
    expect(() => validateFile(bytes, "set.pdf")).toThrow(/10 MB/);
    const upload = { filename: "large-set.pdf", content_base64: bytesToBase64(bytes), sheets: ["S-100"] };
    const first = await storeDrawingSet(fakeSb(), job, upload);
    const second = await storeDrawingSet(fakeSb(), job, upload);
    expect(first.record.storage_bucket).toBe(DRAWING_BUCKET);
    expect(second.duplicate).toBe(true);
    expect(second.path).toBe(first.path);
    expect(state.uploaded).toHaveLength(1);
    expect(state.buckets).not.toContain("athena-files");
    expect(await sha256Hex(state.objects.get(first.path)!)).toBe(await sha256Hex(bytes));
  });

  it("cancels a provider body above the drawing cap before storing and rejects unknown buckets", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ "content-length": String(DRAWING_MAX_BYTES + 1) }), body: { cancel } })));
    await expect(storeDrawingSet(fakeSb(), job, { filename: "large.pdf", source_url: source })).rejects.toThrow(/100 MB/);
    expect(cancel).toHaveBeenCalledOnce();
    expect(state.uploaded).toEqual([]);
    expect(() => drawingBucket({ storage_bucket: "public-files" })).toThrow(/invalid storage/);
    expect(drawingBucket()).toBe("athena-files");
  });

  it("indexes an unindexed legacy stored set by filename without an upload, then marks up that sheet", async () => {
    await seed();
    state.documents[0].sheets = [];
    const indexed = await call(drawingSetImport, {
      job_number: "2701",
      stored_filename: "set.pdf",
      sheets: ["Cover", "S-100"],
    });
    expect(indexed.structuredContent.duplicate).toBe(true);
    expect(state.uploaded).toEqual([]);
    const marked = await call(drawingMarkup, { job_number: "2701", sheet: "S-100", source_filename: "set.pdf" });
    expect(marked.structuredContent.saved).toBe(true);
    expect((marked.structuredContent.markup as DrawingRecord).page).toBe(2);
  });
  it("reads an athena-drawings original when a later byte upload is not in the version registry", async () => {
    const original = pdf("CCW-003 stored");
    const path = "c1/j1/drawing-ccw003/source.pdf";
    state.objects.set(path, original);
    state.objectBuckets.set(path, DRAWING_BUCKET);
    const prior = [{ name: "CCW.pdf", kind: "base" as const, path, sheets: ["Cover", "S-100"] }];
    const again = await storeDrawingSet(
      fakeSb(),
      job,
      { filename: "CCW.pdf", content_base64: bytesToBase64(original), sheets: ["Cover", "S-100"] },
      prior,
    );
    expect(again.duplicate).toBe(true);
    expect(again.path).toBe(path);
    expect(again.record.storage_bucket).toBe(DRAWING_BUCKET);
    expect(state.uploaded).toEqual([]);
    const other = pdf("CCW-003 replacement");
    const stored = await storeDrawingSet(
      fakeSb(),
      job,
      { filename: "CCW-new.pdf", content_base64: bytesToBase64(other), sheets: ["Cover", "S-100"] },
      prior,
    );
    expect(stored.duplicate).toBe(false);
    expect(stored.record.storage_bucket).toBe(DRAWING_BUCKET);
    expect(state.uploaded).toHaveLength(1);
  });

  it("still refuses a byte upload when an owned drawing cannot be read from either bucket", async () => {
    const prior = [{ name: "CCW.pdf", kind: "base" as const, path: "c1/j1/drawing-missing/source.pdf", sheets: ["S-100"] }];
    await expect(
      storeDrawingSet(
        fakeSb(),
        job,
        { filename: "CCW.pdf", content_base64: bytesToBase64(pdf()), sheets: ["Cover", "S-100"] },
        prior,
      ),
    ).rejects.toThrow("An existing drawing could not be checked for duplicates. Try again; nothing new was stored.");
    expect(state.uploaded).toEqual([]);
  });

  it("recognizes a re-shared legacy PDF even with another filename; uploads nothing", async () => {
    const original = await seed();
    const result = await storeDrawingSet(
      fakeSb(),
      job,
      { filename: "renamed.pdf", content_base64: bytesToBase64(original) },
      state.documents as never,
    );
    expect(result.duplicate).toBe(true);
    expect(result.path).toBe(legacy);
    expect(state.uploaded).toEqual([]);
  });
  it("imports a changed set without probing an indexed drawing in the legacy bucket", async () => {
    const first = await storeDrawingSet(fakeSb(), job, {
      filename: "new-set.pdf", content_base64: bytesToBase64(pdf("first revision")),
      sheets: ["Cover", "S-100"],
    });
    state.downloads = [];
    const revisedBytes = pdf("changed revision");
    const changed = await storeDrawingSet(fakeSb(), job, {
      filename: "new-set.pdf", content_base64: bytesToBase64(revisedBytes),
      sheets: ["Cover", "S-100"],
    }, [{ name: first.name, kind: "base", path: first.path, sheets: first.sheets }]);
    expect(changed.duplicate).toBe(false);
    expect(changed.record.version).toBe(2);
    expect(changed.path).not.toBe(first.path);
    expect(state.downloads).not.toContain(first.path);
    expect(state.uploaded).toHaveLength(2);
    const repeated = await storeDrawingSet(fakeSb(), job, {
      filename: "renamed.pdf", content_base64: bytesToBase64(revisedBytes),
    });
    expect(repeated.duplicate).toBe(true);
    expect(repeated.path).toBe(changed.path);
    expect(state.uploaded).toHaveLength(2);
  });
  it("hashes new uploads and concurrent identical uploads converge on one object", async () => {
    const bytes = pdf();
    const upload = {
      filename: "set.pdf",
      content_base64: bytesToBase64(bytes),
      sheets: ["Cover", "S-100"],
    };
    const [a, b] = await Promise.all([
      storeDrawingSet(fakeSb(), job, upload),
      storeDrawingSet(fakeSb(), job, { ...upload, filename: "alias.pdf" }),
    ]);
    expect(a.path).toBe(b.path);
    expect(state.uploaded).toHaveLength(1);
    const repeated = await storeDrawingSet(fakeSb(), job, upload);
    expect(repeated.duplicate).toBe(true);
    expect(state.uploaded).toHaveLength(1);
  });
  it("accepts authorized PDF bytes with a private source link without changing permissions or fetching the source", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await call(drawingSetImport, {
      job_number: "2701",
      drawing: {
        filename: "private.pdf",
        content_base64: bytesToBase64(pdf()),
        source_url: source,
        sheets: ["Cover", "S-100"],
      },
    });
    expect((result.structuredContent.source as DrawingRecord).source_url).toBe(source);
    expect(state.uploaded).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects duplicate sheet names and an index longer than the actual PDF", async () => {
    const upload = { filename: "set.pdf", content_base64: bytesToBase64(pdf()) };
    await expect(
      storeDrawingSet(fakeSb(), job, { ...upload, sheets: ["S-100", "s-100"] }),
    ).rejects.toThrow(/unique name/);
    await expect(
      storeDrawingSet(fakeSb(), job, { ...upload, sheets: ["Cover", "S-100", "S-200"] }),
    ).rejects.toThrow(/more sheet names/);
    expect(state.uploaded).toEqual([]);
  });
  it.each([source, "https://www.dropbox.com/scl/fi/token/set.pdf?rlkey=read-key&dl=0"])(
    "imports %s, keeps its source and creates a new revision only when bytes change",
    async (url) => {
      let bytes = pdf();
      const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
        expect(options?.method).toBe("GET");
        return new Response(new Uint8Array(bytes).buffer);
      });
      vi.stubGlobal("fetch", fetchMock);
      const args = {
        job_number: "2701",
        drawing: { filename: "set.pdf", source_url: url, sheets: ["Cover", "S-100"] },
      };
      const first = await call(drawingSetImport, args);
      const r1 = first.structuredContent.source as DrawingRecord;
      expect(r1.source_url).toBe(url);
      expect(r1.version).toBe(1);
      const firstBytes = state.objects.get(r1.path)?.slice();
      const repeat = await call(drawingSetImport, args);
      expect(repeat.structuredContent.duplicate).toBe(true);
      expect(state.uploaded).toHaveLength(1);
      bytes = pdf("Revised S-100");
      const revised = await call(drawingSetImport, args);
      const r2 = revised.structuredContent.source as DrawingRecord;
      expect(r2.version).toBe(2);
      expect(r2.path).not.toBe(r1.path);
      expect(state.objects.get(r1.path)).toEqual(firstBytes);
      expect(state.uploaded).toHaveLength(2);
      const sheet = await storedSheet(fakeSb(), job, state.documents as never, "S-100");
      expect(sheet.record.id).toBe(r2.id);
      expect(fetchMock.mock.calls.every(([, opts]) => opts?.method === "GET")).toBe(true);
    },
  );
});

describe("provider download boundaries", () => {
  it("normalizes Drive and Dropbox links without dropping resource/rl keys", () => {
    expect(drawingSource(source).download).toContain("resourcekey=read-key");
    const dropbox = drawingSource("https://www.dropbox.com/scl/fi/token/set.pdf?rlkey=key&dl=0");
    expect(dropbox.download).toContain("rlkey=key");
    expect(dropbox.download).toContain("dl=1");
    expect(dropbox.key).toBe(
      drawingSource("https://www.dropbox.com/scl/fi/token/set.pdf?rlkey=key&dl=1").key,
    );
  });
  it("follows a provider redirect but rejects an external redirect before fetching it", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://dl.dropboxusercontent.com/s/token/set.pdf" },
        }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array(pdf()).buffer));
    vi.stubGlobal("fetch", mock);
    expect(await downloadDrawingSource("https://www.dropbox.com/s/token/set.pdf")).toBeInstanceOf(
      Uint8Array,
    );
    expect(mock).toHaveBeenCalledTimes(2);
    mock.mockReset().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      }),
    );
    await expect(downloadDrawingSource(source)).rejects.toThrow(/outside/);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it.each([
    "https://drive.google.com.evil.example.com/file/d/id/view",
    "https://user:pass@drive.google.com/file/d/id/view",
    "http://drive.google.com/file/d/id/view",
    "https://www.dropbox.com:444/s/t/a.pdf",
    "https://drive.google.com/drive/folders/id",
  ])("rejects %s before fetching", async (url) => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    await expect(downloadDrawingSource(url)).rejects.toThrow();
    expect(mock).not.toHaveBeenCalled();
  });
  it("rejects oversized streams, non-PDF sign-in pages and redirect loops", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("large", { headers: { "content-length": String(FILE_MAX_BYTES + 1) } }),
      ),
    );
    await expect(downloadDrawingSource(source)).rejects.toThrow(/over/);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(FILE_MAX_BYTES + 1));
                controller.close();
              },
            }),
          ),
      ),
    );
    await expect(downloadDrawingSource(source)).rejects.toThrow(/over/);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>Sign in</html>")),
    );
    await expect(downloadDrawingSource(source)).rejects.toThrow(/sign-in/);
    const mock = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: source } }),
    );
    vi.stubGlobal("fetch", mock);
    await expect(downloadDrawingSource(source)).rejects.toThrow(/could not/);
    expect(mock).toHaveBeenCalledTimes(6);
  });
});

describe("annotation rendering", () => {
  it("uses navy/blue/gray for ordinary findings and only red for risk/delay", async () => {
    expect(markupColor("callout")).toBe("#1E5FED");
    expect(markupColor("risk")).toBe("#DC2626");
    expect(markupColor("delay")).toBe("#DC2626");
    await seed();
    const s = await storedSheet(fakeSb(), job, state.documents as never, "S-100");
    const output = await renderDrawingMarkup(
      s,
      [
        {
          label: "Count",
          text: "Verified pin",
          severity: "callout",
          geometry: { kind: "pin", point: { x: 0.2, y: 0.3 } },
        },
        {
          label: "Line",
          text: "Verified line",
          severity: "callout",
          geometry: {
            kind: "line",
            points: [
              { x: 0.1, y: 0.2 },
              { x: 0.4, y: 0.2 },
            ],
          },
        },
        {
          label: "Area",
          text: "Verified area",
          severity: "callout",
          geometry: {
            kind: "area",
            points: [
              { x: 0.5, y: 0.2 },
              { x: 0.6, y: 0.3 },
              { x: 0.7, y: 0.2 },
            ],
          },
        },
      ],
      "2026-10-22T20:00:00Z",
    );
    expect(new TextDecoder().decode(output.slice(0, 5))).toBe("%PDF-");
  });
});
