// The same bundled renderer runs in Node tests and in Workers. No canvas,
// browser globals, network fetch, filesystem access, or runtime WASM compilation.
import { PDFiumLibrary } from "@hyzyla/pdfium";
import wasm from "@hyzyla/pdfium/pdfium.wasm?module";
import { encode } from "fast-png";

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
