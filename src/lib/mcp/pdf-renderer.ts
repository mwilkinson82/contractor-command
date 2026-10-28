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
