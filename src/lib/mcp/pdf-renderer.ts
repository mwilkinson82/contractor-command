// The same bundled renderer runs in Node tests and in Workers. No canvas,
// browser globals, network fetch, filesystem access, or runtime WASM compilation.
import { PDFiumLibrary } from "@hyzyla/pdfium";
import wasm from "@hyzyla/pdfium/pdfium.wasm?module";
import { encode } from "fast-png";
import type { PDFiumPage } from "@hyzyla/pdfium";

const MAX_EDGE = 1600;
let library: Promise<PDFiumLibrary> | undefined;
let queue: Promise<void> = Promise.resolve();

function getLibrary(): Promise<PDFiumLibrary> {
  library ??= PDFiumLibrary.init({
    instantiateWasm(imports, ready) {
      const instance = new WebAssembly.Instance(wasm, imports);
      ready(instance, wasm);
      return instance.exports;
    },
  }).catch((error) => {
    library = undefined;
    throw error;
  });
  return library;
}

async function render(bytes: Uint8Array, pageIndex: number): Promise<Uint8Array | null> {
  const engine = await getLibrary();
  const document = await engine.loadDocument(bytes);
  try {
    if (pageIndex >= document.getPageCount()) return null;
    const page = document.getPage(pageIndex);
    try {
      const { originalWidth, originalHeight } = page.getOriginalSize();
      if (![originalWidth, originalHeight].every((value) => Number.isFinite(value) && value > 0))
        throw new Error("The PDF page has invalid dimensions.");
      const scale = Math.min(2, MAX_EDGE / Math.max(originalWidth, originalHeight));
      const width = Math.max(1, Math.min(MAX_EDGE, Math.ceil(originalWidth * scale)));
      const height = Math.max(1, Math.min(MAX_EDGE, Math.ceil(originalHeight * scale)));
      const bitmap = await page.render({
        width,
        height,
        scale: 1,
        colorSpace: "RGBA",
        transparent: false,
        renderFormFields: true,
        render: "bitmap",
      });
      return encode({ width, height, data: bitmap.data, channels: 4, depth: 8 });
    } finally {
      page.close();
    }
  } finally {
    document.destroy();
  }
}

/** Zero-based page index. Keep one native heap operation in flight per isolate. */
export function renderPdfiumPage(bytes: Uint8Array, pageIndex: number): Promise<Uint8Array | null> {
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) return Promise.resolve(null);
  const result = queue.then(() => render(bytes, pageIndex));
  // A malformed drawing must not poison subsequent requests or retain its bytes.
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Shared native heap/queue for inspection and clipped takeoff tiles. The pinned
 * PDFium wrapper is not thread-safe; all operations use this same queue. */
export function withPdfiumPage<T>(
  bytes: Uint8Array,
  pageIndex: number,
  visit: (page: PDFiumPage) => T | Promise<T>,
): Promise<T> {
  const result = queue.then(async () => {
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0)
      throw new Error("Invalid stored PDF page.");
    const engine = await getLibrary();
    const document = await engine.loadDocument(bytes);
    try {
      if (pageIndex >= document.getPageCount())
        throw new Error("The stored sheet is outside this PDF.");
      const page = document.getPage(pageIndex);
      try {
        return await visit(page);
      } finally {
        page.close();
      }
    } finally {
      document.destroy();
    }
  });
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Text-only document reading shares the existing native queue; no raster or network. */
export function extractPdfiumDocumentText(
  bytes: Uint8Array,
  limits?: { maxPages: number; maxChars: number },
): Promise<string[]> {
  const result = queue.then(async () => {
    const engine = await getLibrary();
    const document = await engine.loadDocument(bytes);
    try {
      const pages: string[] = [];
      if (limits && document.getPageCount() > limits.maxPages)
        throw new Error("PDF exceeds extraction page limit.");
      let chars = 0;
      for (let index = 0; index < document.getPageCount(); index++) {
        const page = document.getPage(index);
        try {
          const value = page.getText();
          chars += value.length;
          if (limits && chars > limits.maxChars)
            throw new Error("PDF exceeds extraction text limit.");
          pages.push(value);
        } finally {
          page.close();
        }
      }
      return pages;
    } finally {
      document.destroy();
    }
  });
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Bounded, one-based physical-page access to the original. Transform each page
 * while it is open so searches need not retain the document's full text. */
export function mapPdfiumTextPages<T>(
  bytes: Uint8Array,
  from: number,
  count: number,
  visit: (text: string, page: number) => T,
): Promise<{ total_pages: number; pages: T[] }> {
  const result = queue.then(async () => {
    if (
      !Number.isSafeInteger(from) ||
      from < 1 ||
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > 100
    )
      throw new Error("Invalid physical PDF page window.");
    const document = await (await getLibrary()).loadDocument(bytes);
    try {
      const total_pages = document.getPageCount();
      const pages: T[] = [];
      for (let index = from - 1; index < Math.min(total_pages, from - 1 + count); index++) {
        const page = document.getPage(index);
        try {
          pages.push(visit(page.getText(), index + 1));
        } finally {
          page.close();
        }
      }
      return { total_pages, pages };
    } finally {
      document.destroy();
    }
  });
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

type NativeTextModule = {
  HEAPU8: Uint8Array;
  wasmExports: { malloc(n: number): number; free(p: number): void };
  [name: `_${string}`]: (...args: number[]) => number;
};

type Box = { x: number; y: number; w: number; h: number };
type TitleBlockRead = { page: number; runs: (Box & { text: string })[]; rulings: Box[] };

// PDFium page object types and the most objects one page may spend on ruling lines.
const PAGEOBJ_PATH = 2;
const PAGEOBJ_FORM = 5;
const MAX_PAGE_OBJECTS = 40_000;
const MAX_RULINGS = 4_000;

/** The straight lines drawn near the title block (the box and its field dividers), in the same
 *  0..1 display coordinates as the text. A rectangle drawn as one path gives its four edges.
 *  Curves and hatching are skipped; objects inside form XObjects carry their form's matrix. */
function readRulings(
  m: NativeTextModule,
  page: number,
  device: (x: number, y: number) => { x: number; y: number } | null,
): Box[] {
  const out: Box[] = [];
  const buf = m.wasmExports.malloc(48);
  let visited = 0;
  try {
    const view = () => new DataView(m.HEAPU8.buffer);
    type Matrix = [number, number, number, number, number, number];
    const apply = (t: Matrix, x: number, y: number) => ({
      x: t[0] * x + t[2] * y + t[4],
      y: t[1] * x + t[3] * y + t[5],
    });
    const compose = (outer: Matrix, inner: Matrix): Matrix => [
      outer[0] * inner[0] + outer[2] * inner[1],
      outer[1] * inner[0] + outer[3] * inner[1],
      outer[0] * inner[2] + outer[2] * inner[3],
      outer[1] * inner[2] + outer[3] * inner[3],
      outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
      outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
    ];
    const push = (box: Box) => {
      const thin = Math.min(box.w, box.h) <= 0.004;
      const long = Math.max(box.w, box.h) >= 0.02;
      const nearBlock = box.x + box.w >= 0.5 || box.y + box.h >= 0.5;
      if (thin && long && nearBlock && out.length < MAX_RULINGS) out.push(box);
    };
    const visit = (obj: number, t: Matrix, depth: number) => {
      if (++visited > MAX_PAGE_OBJECTS) return;
      const type = m._FPDFPageObj_GetType(obj);
      if (type === PAGEOBJ_FORM && depth < 3) {
        if (!m._FPDFPageObj_GetMatrix(obj, buf)) return;
        const v = view();
        const own: Matrix = [0, 4, 8, 12, 16, 20].map((o) => v.getFloat32(buf + o, true)) as Matrix;
        const inner = compose(t, own);
        const count = m._FPDFFormObj_CountObjects(obj);
        for (let i = 0; i < count && visited <= MAX_PAGE_OBJECTS; i++)
          visit(m._FPDFFormObj_GetObject(obj, i), inner, depth + 1);
        return;
      }
      if (type !== PAGEOBJ_PATH) return;
      if (!m._FPDFPageObj_GetBounds(obj, buf, buf + 4, buf + 8, buf + 12)) return;
      const v = view();
      const [l, b, r, tp] = [0, 4, 8, 12].map((o) => v.getFloat32(buf + o, true));
      const corners = [apply(t, l, b), apply(t, r, tp), apply(t, l, tp), apply(t, r, b)]
        .map((c) => device(c.x, c.y))
        .filter((c): c is { x: number; y: number } => !!c);
      if (corners.length < 4) return;
      const x0 = Math.min(...corners.map((c) => c.x)),
        x1 = Math.max(...corners.map((c) => c.x)),
        y0 = Math.min(...corners.map((c) => c.y)),
        y1 = Math.max(...corners.map((c) => c.y));
      const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      if (Math.min(box.w, box.h) <= 0.004) return push(box);
      // A rectangle drawn as one path (re, or move plus three or four lines) gives four edges.
      if (m._FPDFPath_CountSegments(obj) > 6) return;
      push({ x: x0, y: y0, w: box.w, h: 0 });
      push({ x: x0, y: y1, w: box.w, h: 0 });
      push({ x: x0, y: y0, w: 0, h: box.h });
      push({ x: x1, y: y0, w: 0, h: box.h });
    };
    const count = m._FPDFPage_CountObjects(page);
    for (let i = 0; i < count && visited <= MAX_PAGE_OBJECTS; i++)
      visit(m._FPDFPage_GetObject(page, i), [1, 0, 0, 1, 0, 0], 0);
  } finally {
    m.wasmExports.free(buf);
  }
  return out;
}

/** Positioned text runs near each page's title block, read from the PDF's own vector text.
 *  One document load for the whole set, on the shared native queue; no raster, no network.
 *  Coordinates are 0..1 from the displayed top-left, so rotated sheets read the same way.
 *  Stops at maxPages or when the time budget is spent; `pages` then holds only the pages read. */
export function readPdfiumTitleBlockRuns(
  bytes: Uint8Array,
  limits: { maxPages: number; budgetMs: number; maxRunsPerPage?: number },
): Promise<{
  total_pages: number;
  pages: TitleBlockRead[];
}> {
  const result = queue.then(async () => {
    const started = Date.now();
    const document = await (await getLibrary()).loadDocument(bytes);
    try {
      const total_pages = document.getPageCount();
      const pages: TitleBlockRead[] = [];
      for (let index = 0; index < Math.min(total_pages, limits.maxPages); index++) {
        if (Date.now() - started > limits.budgetMs) break;
        const page = document.getPage(index);
        try {
          const native = page as unknown as { module: NativeTextModule; pageIdx: number };
          const m = native.module;
          const { originalWidth: width, originalHeight: height } = page.getOriginalSize();
          const sx = Math.round(width * 1000),
            sy = Math.round(height * 1000);
          if (!(sx > 0 && sy > 0)) {
            pages.push({ page: index + 1, runs: [], rulings: [] });
            continue;
          }
          const scratch = m.wasmExports.malloc(48);
          const textPage = m._FPDFText_LoadPage(native.pageIdx);
          const runs: (Box & { text: string })[] = [];
          let rulings: Box[] = [];
          try {
            const view = () => new DataView(m.HEAPU8.buffer);
            const device = (x: number, y: number) => {
              if (
                !m._FPDF_PageToDevice(
                  native.pageIdx,
                  0,
                  0,
                  sx,
                  sy,
                  0,
                  x,
                  y,
                  scratch + 32,
                  scratch + 36,
                )
              )
                return null;
              return {
                x: view().getInt32(scratch + 32, true) / sx,
                y: view().getInt32(scratch + 36, true) / sy,
              };
            };
            const count = textPage ? m._FPDFText_CountRects(textPage, 0, -1) : 0;
            for (let i = 0; i < count && runs.length < (limits.maxRunsPerPage ?? 4000); i++) {
              if (
                !m._FPDFText_GetRect(textPage, i, scratch, scratch + 8, scratch + 16, scratch + 24)
              )
                continue;
              const v = view();
              const left = v.getFloat64(scratch, true),
                top = v.getFloat64(scratch + 8, true),
                right = v.getFloat64(scratch + 16, true),
                bottom = v.getFloat64(scratch + 24, true);
              const a = device(left, top),
                b = device(right, bottom);
              if (!a || !b) continue;
              const x = Math.min(a.x, b.x),
                y = Math.min(a.y, b.y),
                w = Math.abs(a.x - b.x),
                h = Math.abs(a.y - b.y);
              // Title blocks sit on the right edge or along the bottom.
              if (!(x + w / 2 >= 0.7 || y + h / 2 >= 0.6)) continue;
              const length = m._FPDFText_GetBoundedText(textPage, left, top, right, bottom, 0, 0);
              if (length <= 0 || length > 2000) continue;
              const buf = m.wasmExports.malloc((length + 1) * 2);
              try {
                const got = m._FPDFText_GetBoundedText(
                  textPage,
                  left,
                  top,
                  right,
                  bottom,
                  buf,
                  length + 1,
                );
                const text = new TextDecoder("utf-16le")
                  .decode(m.HEAPU8.slice(buf, buf + Math.max(0, got) * 2))
                  .replace(/\0/g, "")
                  .trim();
                if (text) runs.push({ text, x, y, w, h });
              } finally {
                m.wasmExports.free(buf);
              }
            }
            rulings = readRulings(m, native.pageIdx, device);
          } finally {
            if (textPage) m._FPDFText_ClosePage(textPage);
            m.wasmExports.free(scratch);
          }
          pages.push({ page: index + 1, runs, rulings });
        } finally {
          page.close();
        }
      }
      return { total_pages, pages };
    } finally {
      document.destroy();
    }
  });
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
