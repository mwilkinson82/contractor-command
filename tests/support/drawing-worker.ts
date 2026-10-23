import type { DrawingRecord, DrawingStore } from "../../src/lib/mcp/drawing-set";

// Test-only Worker entry. It exercises the real storage/render/version helpers
// with private in-memory objects, never production authentication or storage.
export default {
  async fetch(request: Request) {
    const { storeDrawingSet, storedSheet, renderPdfPage } =
      await import("../../src/lib/mcp/drawing-set");
    const { saveDrawingMarkup } = await import("../../src/lib/mcp/drawing-markup-render");
    const { bytesToBase64 } = await import("../../src/lib/mcp/estimating-sheet");
    const { sha256Hex } = await import("../../src/lib/mcp/file-share");
    const bytes = new Uint8Array(await request.arrayBuffer());
    const hash = await sha256Hex(bytes);
    const sheetIndex = Number(new URL(request.url).searchParams.get("page") ?? 0);
    const objects = new Map<string, Uint8Array>();
    const records: DrawingRecord[] = [];
    const uploads: string[] = [];
    const sb: DrawingStore = {
      storage: {
        from: (bucket) => ({
          upload: async (path, body) => {
            const key = `${bucket}/${path}`;
            if (objects.has(key)) return { error: { message: "Already stored" } };
            objects.set(key, body.slice());
            uploads.push(key);
            return { error: null };
          },
          download: async (path) => {
            const data = objects.get(`${bucket}/${path}`);
            return {
              data: data ? { arrayBuffer: async () => data.slice().buffer } : null,
              error: data ? null : { message: "Missing source" },
            };
          },
          createSignedUrl: async () => ({
            data: { signedUrl: "https://files.example.com/test-only" },
            error: null,
          }),
          remove: async (paths) => {
            paths.forEach((path) => objects.delete(`${bucket}/${path}`));
            return { error: null };
          },
        }),
      },
      rpc: async (name, args) => {
        if (name === "mcp_drawing_records")
          return { data: records.filter((record) => !record.parent_id), error: null };
        const input = args._record as DrawingRecord;
        const record = {
          ...input,
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
          version: records.length + 1,
        };
        if (name === "mcp_drawing_markup_save") record.parent_id = args._source as string;
        else if (name !== "mcp_drawing_source_save")
          throw new Error(`Unexpected test RPC: ${name}`);
        records.push(record);
        return { data: record, error: null };
      },
    };
    const job = {
      company_id: "11111111-1111-4111-8111-111111111111",
      job_id: "22222222-2222-4222-8222-222222222222",
    };
    const sheets = Array.from({ length: sheetIndex + 1 }, (_, index) =>
      index === sheetIndex ? "S-100" : `TEST-${index}`,
    );
    const upload = {
      filename: "test-permit-set.pdf",
      content_base64: bytesToBase64(bytes),
      sheets,
    };
    const first = await storeDrawingSet(sb, job, upload);
    const second = await storeDrawingSet(sb, job, upload);
    const source = await storedSheet(sb, job, [], "S-100");
    const sourceUploads = uploads.length;
    const annotations = [
      {
        label: "TEST-Q1",
        text: "Rendering verification only; supplied geometry, no quantity claim.",
        severity: "callout" as const,
        geometry: {
          kind: "area" as const,
          points: [
            { x: 0.2, y: 0.2 },
            { x: 0.4, y: 0.2 },
            { x: 0.4, y: 0.4 },
            { x: 0.2, y: 0.4 },
          ],
        },
      },
      {
        label: "TEST-R1",
        text: "Fictional risk for rendering verification only.",
        severity: "risk" as const,
        geometry: { kind: "pin" as const, point: { x: 0.6, y: 0.4 } },
      },
    ];
    const one = await saveDrawingMarkup(sb, job, source, annotations);
    const two = await saveDrawingMarkup(sb, job, source, annotations);
    const original = objects.get(`athena-drawings/${first.path}`)!;
    const firstPdf = objects.get(`athena-files/${one.record.path}`)!;
    return Response.json({
      duplicate: second.duplicate,
      sourceUploads,
      selectedPage: source.page,
      originalUnchanged: hash === (await sha256Hex(original)) && hash === (await sha256Hex(bytes)),
      distinctVersions: one.record.path !== two.record.path,
      correctParents:
        one.record.parent_id === first.record.id && two.record.parent_id === first.record.id,
      dates: [one.record.created_at, two.record.created_at],
      browserGlobalsAbsent: ["DOMMatrix", "Path2D", "ImageData"].every(
        (name) => Reflect.get(globalThis, name) === undefined,
      ),
      sourcePng: bytesToBase64(source.png),
      markupPng: bytesToBase64(one.png),
      markupPdf: bytesToBase64(firstPdf),
      outsidePage: await renderPdfPage(bytes, 10000),
    });
  },
};
