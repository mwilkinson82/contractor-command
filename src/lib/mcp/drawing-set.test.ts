import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsPDF } from "jspdf";
import { z } from "zod";
import { bytesToBase64 } from "./estimating-sheet";
import { visibleProblems } from "./visible";
import { FILE_MAX_BYTES } from "./file-share";
import {
  DRAWING_B64_MAX_CHARS,
  DRAWING_BUCKET,
  DRAWING_MAX_BYTES,
  DRAWING_URL_SECONDS,
  attachSheetPages,
  drawingOwned,
  drawingTooBigMessage,
  drawingUploadLimit,
  keepDrawingPaths,
  readDrawingBytes,
  renderPdfPage,
  sheetPageIndex,
  sheetPageLine,
  sheetsForMarkup,
  withDrawingPath,
} from "./drawing-set";
import type { Doc } from "./estimating";

const state = vi.hoisted(() => ({
  companyId: "c1",
  jobId: "j1",
  documents: [] as Record<string, unknown>[],
  lines: [] as Record<string, unknown>[],
  version: 1 as number | null,
  downloads: [] as string[],
  uploads: [] as { bucket: string; path: string; size: number }[],
  buckets: [] as string[],
  signed: [] as string[],
  patches: [] as unknown[],
  pdf: new Uint8Array(),
}));

vi.mock("./guard", () => ({
  run: async (_t: string, _c: unknown, _o: unknown, fn: (sb: unknown) => Promise<unknown>) => fn(fakeSb()),
  text: (b: string) => ({ content: [{ type: "text", text: b }] }),
  dbError: (e: { message?: string }) => {
    throw new Error(e.message ?? "database error");
  },
  isMissingFunction: () => false,
}));
vi.mock("./jobs", () => ({
  FULL_ACCESS_MESSAGE: "This needs full access to the job. Your role can't do it.",
  READ_ONLY_MESSAGE: "Your role has a limited, read-only view of this job (no financials). Ask your owner or PM to make changes.",
  WhichCompanyAsk: class extends Error {},
  audit: async () => {},
  prefix: () => "",
  named: (job: { job_number: string; name?: string | null }) => `${job.job_number} – ${job.name ?? ""}`.trim(),
  resolveJob: async () => ({
    job_id: state.jobId,
    job_number: "CCW-003",
    name: "Crystal Car Wash",
    company_id: state.companyId,
    scope: "full" as const,
  }),
}));

function fakeSb() {
  return {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, bytes: Uint8Array) => {
          state.buckets.push(bucket);
          state.uploads.push({ bucket, path, size: bytes.length });
          return { error: null };
        },
        download: async (path: string) => {
          state.downloads.push(path);
          const bytes = state.pdf;
          return {
            data: {
              arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
            },
            error: null,
          };
        },
        createSignedUrl: async (path: string, seconds: number) => {
          state.signed.push(`${seconds}:${path}`);
          return { data: { signedUrl: `https://files.example/page?sig=1&path=${encodeURIComponent(path)}` }, error: null };
        },
        remove: async () => ({ error: null }),
      }),
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "mcp_drawing_records") return { data: [], error: null };
      if (fn === "mcp_drawing_source_save") return { data: {
        ...(args._record as object), id: "drawing-test", version: 1, created_at: "2026-10-22T12:00:00Z",
      }, error: null };
      if (fn === "mcp_estimate_setup_save") state.patches.push(args._patch);
      if (fn === "mcp_estimate_get") {
        return {
          data: {
            setup: {
              role: "gc",
              trades: ["concrete"],
              documents: state.documents,
              in_scope: ["foundations"],
              out_scope: [],
              assumptions: [],
              sub_bids: [],
            },
            takeoff: state.version
              ? { version: state.version, revision: "Rev 3", lines: state.lines }
              : null,
            gaps: [],
            verdicts: [],
          },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  };
}

import { estimateIntake, estimateTakeoffGet, estimateTakeoffSave } from "./tools/estimate-tools";

type Block = { type: string; text?: string; data?: string; mimeType?: string };
type Result = { content: Block[]; structuredContent?: Record<string, unknown> };
const get = (a: Record<string, unknown>) =>
  (estimateTakeoffGet as unknown as { handler: (a: Record<string, unknown>, c: unknown) => Promise<Result> }).handler(a, {});
const intake = (a: Record<string, unknown>) =>
  (estimateIntake as unknown as { handler: (a: Record<string, unknown>, c: unknown) => Promise<Result> }).handler(a, {});
const saveTakeoff = (a: Record<string, unknown>) =>
  (estimateTakeoffSave as unknown as { handler: (a: Record<string, unknown>, c: unknown) => Promise<Result> }).handler(a, {});

const OWNED = "c1/j1/drawing-11111111-1111-4111-8111-111111111111/CCW.pdf";
const FOREIGN = "other-co/other-job/drawing-11111111-1111-4111-8111-111111111111/CCW.pdf";

function twoPagePdf(): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: [220, 140] });
  doc.text("S-001", 24, 40);
  doc.addPage();
  doc.setFillColor(30, 95, 237);
  doc.rect(20, 20, 60, 30, "F");
  doc.text("S-100", 24, 80);
  return new Uint8Array(doc.output("arraybuffer"));
}

const line = (sheet: string, markup: string | null) => ({
  line_no: 201,
  item: "Wall footing",
  qty: 10,
  unit: "LF",
  sheet,
  basis: "measured",
  math: "10",
  confidence: "high",
  markup_ref: markup,
});

beforeEach(() => {
  state.companyId = "c1";
  state.jobId = "j1";
  state.documents = [];
  state.lines = [line("S-100", null)];
  state.version = 1;
  state.downloads = [];
  state.uploads = [];
  state.buckets = [];
  state.signed = [];
  state.patches = [];
  state.pdf = twoPagePdf();
});

describe("drawing set path", () => {
  const prior: Doc[] = [
    {
      name: "CCW.pdf",
      kind: "base",
      revision: "Permit / Revision 3",
      date: "2025-12-17",
      sheets: ["S-001", "S-100"],
    },
  ];

  it("keeps the old document fields and adds a nullable path", () => {
    const next = withDrawingPath(prior, { name: "CCW.pdf", path: OWNED });
    expect(next).toEqual([
      {
        name: "CCW.pdf",
        kind: "base",
        revision: "Permit / Revision 3",
        date: "2025-12-17",
        sheets: ["S-001", "S-100"],
        path: OWNED,
      },
    ]);
    expect(sheetPageIndex(next[0].sheets, "S-100")).toBe(1);
    expect(sheetPageIndex(next[0].sheets, "A-200")).toBeNull();
  });

  it("ignores a path sent by the host and keeps the stored one", () => {
    const kept = keepDrawingPaths(
      [{ ...prior[0], path: FOREIGN }],
      [{ ...prior[0], path: OWNED }],
    );
    expect(kept[0].path).toBe(OWNED);
    expect(drawingOwned(FOREIGN, "c1", "j1")).toBe(false);
    expect(drawingOwned(OWNED, "c1", "j1")).toBe(true);
    expect(drawingOwned(OWNED, "other-co", "j1")).toBe(false);
  });

  it("names the sheets a markup ask should open", () => {
    expect(sheetsForMarkup({ sheet: "S-100", lines: [line("S-101", null)] })).toEqual(["S-100"]);
    expect(sheetsForMarkup({ lines: [line("S-100", "Grid A"), line("S-101", null)] })).toEqual(["S-100"]);
    expect(sheetsForMarkup({ lines: [line("S-100", null)] })).toEqual([]);
  });

  it("tells the host to use the stored page", () => {
    const lineText = sheetPageLine("S-100", 2);
    expect(lineText).toContain('Use this page for "mark up drawing S-100" asks. Do not ask for an attachment.');
    expect(visibleProblems(lineText)).toEqual([]);
  });
});

describe("stored sheet page", () => {
  it("renders one PDF page to a PNG", async () => {
    const png = await renderPdfPage(state.pdf, 1);
    expect(png?.slice(0, 8)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(await renderPdfPage(state.pdf, 5)).toBeNull();
  });

  it("returns the page and a short-lived link when the set is stored for this company", async () => {
    state.documents = [
      { name: "CCW.pdf", kind: "base", revision: "Rev 3", sheets: ["S-001", "S-100"], path: OWNED },
    ];
    const result = await get({ job_number: "CCW-003", sheet: "S-100" });
    const image = result.content.find((block) => block.type === "image");
    expect(image?.mimeType).toBe("image/png");
    expect(image?.data?.startsWith("iVBORw0KGgo")).toBe(true);
    expect(result.content[0].text).toContain('Use this page for "mark up drawing S-100" asks. Do not ask for an attachment.');
    expect(result.content[0].text).toContain("Page link: https://files.example/page?sig=1");
    expect(result.structuredContent?.sheet_pages).toEqual([
      { sheet: "S-100", page: 2, signed_url: expect.stringContaining("https://files.example/page?sig=1") },
    ]);
    expect(state.downloads).toEqual([OWNED]);
    expect(state.signed[0]).toBe(`${DRAWING_URL_SECONDS}:${OWNED}`);
  });

  it("returns the markup sheet when a line names a markup and no sheet was passed", async () => {
    state.documents = [{ name: "CCW.pdf", kind: "base", sheets: ["S-100"], path: OWNED }];
    state.lines = [line("S-100", "Grid A")];
    const result = await get({ job_number: "CCW-003" });
    expect(result.content.some((block) => block.type === "image")).toBe(true);
    expect(result.content[0].text).toContain("mark up drawing S-100");
    expect(result.content[0].text).toContain('class="callout"');
    expect(result.content[0].text).toContain("Grid A");
    const markup = result.structuredContent?.markup as { html: string }[];
    expect(markup[0].html).not.toContain("#DC2626");
    expect(markup[0].html).toContain("#1E5FED");
  });

  it("returns nothing for another company's drawing", async () => {
    state.documents = [{ name: "CCW.pdf", kind: "base", sheets: ["S-100"], path: FOREIGN }];
    const result = await get({ job_number: "CCW-003", sheet: "S-100" });
    expect(result.content.some((block) => block.type === "image")).toBe(false);
    expect(result.content[0].text).not.toContain("mark up drawing");
    expect(result.structuredContent?.sheet_pages).toBeUndefined();
    expect(state.downloads).toEqual([]);
    expect(state.signed).toEqual([]);
  });

  it("leaves the takeoff unchanged when no drawing is stored", async () => {
    state.documents = [{ name: "CCW.pdf", kind: "base", revision: "Rev 3", sheets: ["S-100"] }];
    const plain = await get({ job_number: "CCW-003" });
    const named = await get({ job_number: "CCW-003", sheet: "S-100" });
    expect(plain.content.map((block) => block.type)).toEqual(["text"]);
    expect(named.content.map((block) => block.type)).toEqual(["text"]);
    expect(plain.content[0].text).not.toContain("mark up drawing");
    expect(named.content[0].text).toBe(plain.content[0].text);
    expect(state.downloads).toEqual([]);
    expect(attachSheetPages({ content: [{ type: "text", text: "Same" }] }, [])).toEqual({
      content: [{ type: "text", text: "Same" }],
    });
  });
});

describe("drawing import", () => {
  it("parses a multi-page PDF without createRequire.resolve", async () => {
    const source = readFileSync(new URL("./drawing-set.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/createRequire\s*\(/);
    expect(source).not.toMatch(/\.resolve\s*\(\s*["']pdfjs-dist/);
    const sheets = ["S-100", "S-101", "S-102", "S-103", "A-200"];
    const doc = new jsPDF({ unit: "pt", format: [220, 140] });
    sheets.forEach((sheet, index) => {
      if (index) doc.addPage();
      doc.text(sheet, 24, 40);
    });
    const bytes = new Uint8Array(doc.output("arraybuffer"));
    const filename = "CCW_in_scope_S100-S103_A200.pdf";
    const imported = await readDrawingBytes({ filename, content_base64: bytesToBase64(bytes), sheets });
    expect(imported.filename).toBe(filename);
    expect(imported.bytes).toEqual(bytes);
    const png = await renderPdfPage(imported.bytes, sheets.length - 1);
    expect(png?.slice(0, 8)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await expect(
      readDrawingBytes({ filename, content_base64: bytesToBase64(bytes), sheets: [...sheets, "A-201"] }),
    ).rejects.toThrow(/more sheet names/);
  });
});

describe("sharing a drawing set", () => {
  it("stores the PDF on the company job path and keeps the document entry", async () => {
    state.documents = [
      {
        name: "CCW.pdf",
        kind: "base",
        revision: "Permit / Revision 3",
        date: "2025-12-17",
        sheets: ["S-001", "S-100"],
      },
    ];
    state.lines = [];
    state.version = null;
    const result = await intake({
      job_number: "CCW-003",
      reuse: "reuse",
      drawing: { filename: "CCW.pdf", content_base64: bytesToBase64(state.pdf) },
    });
    expect(state.uploads[0].bucket).toBe(DRAWING_BUCKET);
    expect(state.uploads[0].path).toMatch(/^c1\/j1\/drawing-[0-9a-f]{64}\/source\.pdf$/);
    const patch = state.patches[0] as { documents: Doc[] };
    expect(patch.documents[0]).toMatchObject({
      name: "CCW.pdf",
      kind: "base",
      revision: "Permit / Revision 3",
      date: "2025-12-17",
      sheets: ["S-001", "S-100"],
      path: state.uploads[0].path,
    });
    expect(result.content[0].text).toContain("Drawing set stored: CCW.pdf.");
    expect(estimateTakeoffGet.name).toBe("estimate_takeoff_get");
    expect(estimateIntake.name).toBe("estimate_intake");
  });

  it("stores a ~17.6 MB original in athena-drawings and rejects anything over 50 MB", async () => {
    expect(drawingUploadLimit(DRAWING_BUCKET)).toBe(DRAWING_MAX_BYTES);
    expect(drawingUploadLimit("athena-files")).toBe(FILE_MAX_BYTES);
    expect(FILE_MAX_BYTES).toBe(10 * 1024 * 1024);
    const chunks: Uint8Array[] = [];
    const offsets = [0];
    let length = 0;
    const add = (s: string | Uint8Array) => {
      const b = typeof s === "string" ? new TextEncoder().encode(s) : s;
      chunks.push(b);
      length += b.length;
    };
    add("%PDF-1.4\n");
    for (const [i, body] of [
      [1, "<< /Type /Catalog /Pages 2 0 R >>"],
      [2, "<< /Type /Pages /Count 1 /Kids [3 0 R] >>"],
      [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 250] >>"],
    ] as const) {
      offsets.push(length);
      add(`${i} 0 obj\n${body}\nendobj\n`);
    }
    offsets.push(length);
    const padding = new Uint8Array(17_612_902).fill(32);
    add(`4 0 obj\n<< /Length ${padding.length} >>\nstream\n`);
    add(padding);
    add("\nendstream\nendobj\n");
    const xref = length;
    add(`xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    expect(bytes.length).toBeGreaterThanOrEqual(17_612_902);
    expect(bytes.length).toBeGreaterThan(FILE_MAX_BYTES);
    expect(bytes.length).toBeLessThan(DRAWING_MAX_BYTES);
    const drawing = { filename: "permit-set.pdf", content_base64: bytesToBase64(bytes), sheets: ["S-100"] };
    state.lines = [];
    state.version = null;
    const saved = await intake({ job_number: "CCW-003", reuse: "fresh", drawing });
    expect(saved.content[0].text).toContain("Drawing set stored: permit-set.pdf.");
    expect(state.uploads[0]).toMatchObject({ bucket: DRAWING_BUCKET, size: bytes.length });
    expect(state.buckets).not.toContain("athena-files");
    state.uploads = [];
    state.buckets = [];
    const takeoff = await saveTakeoff({
      job_number: "CCW-003",
      lines: [{ item: "Continuous footing", basis: "measured", sheet: "S-100", value: 12 }],
      drawing: { ...drawing, filename: "permit-takeoff.pdf" },
    });
    expect(takeoff.content[0].text).toContain("Drawing set stored: permit-takeoff.pdf.");
    expect(state.uploads[0]).toMatchObject({ bucket: DRAWING_BUCKET, size: bytes.length });
    expect(state.buckets).not.toContain("athena-files");
    const tooBig = "A".repeat(DRAWING_B64_MAX_CHARS + 1);
    const line = { item: "Continuous footing", basis: "measured" as const, sheet: "S-100", value: 12 };
    for (const tool of [estimateIntake, estimateTakeoffSave]) {
      const parsed = z.object(tool.inputSchema).safeParse({
        job_number: "CCW-003",
        lines: [line],
        drawing: { filename: "over.pdf", content_base64: tooBig },
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues.map((issue) => issue.message).join("\n")).toContain(drawingTooBigMessage());
    }
    state.uploads = [];
    await expect(
      intake({ job_number: "CCW-003", reuse: "fresh", drawing: { filename: "over.pdf", content_base64: tooBig } }),
    ).rejects.toThrow(drawingTooBigMessage());
    const rejected = await saveTakeoff({
      job_number: "CCW-003",
      lines: [{ item: "temp footing", basis: "measured", sheet: "S-100", value: 1 }],
      drawing: { filename: "over.pdf", content_base64: tooBig },
    });
    expect(rejected.content[0].text).toContain(drawingTooBigMessage());
    expect(state.uploads).toEqual([]);
  }, 60_000);

  it("allows contract scope to read and write only drawing objects", () => {
    const sql = readFileSync("supabase/migrations/20261026120000_athena_drawing_sets.sql", "utf8");
    expect(sql).not.toMatch(/\bDROP TABLE\b|\bDELETE FROM\b|\bTRUNCATE\b/i);
    expect(sql).toContain("split_part(name, '/', 3) LIKE 'drawing-%'");
    expect(sql).toContain("public.mcp_file_path_scope(name) IN ('full', 'contract')");
    expect(sql).not.toContain("ALTER TABLE");
  });
});
