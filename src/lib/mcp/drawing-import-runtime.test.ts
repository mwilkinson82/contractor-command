import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { readDrawingBytes } from "./drawing-set";
import { bytesToBase64 } from "./estimating-sheet";

// Loading either renderer during upload must fail this test, even in Node where
// a native canvas happens to be installed. The production upload must not need it.
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => {
  throw new Error("The PDF renderer is unavailable in this upload runtime.");
});
vi.mock("pdfjs-dist/legacy/build/pdf.worker.mjs", () => {
  throw new Error("The PDF worker is unavailable in this upload runtime.");
});

describe("drawing import without a rendering runtime", () => {
  it("accepts indexed pages and preserves source bytes without browser globals", async () => {
    const document = await PDFDocument.create();
    document.addPage();
    document.addPage();
    document.setLanguage("en-US");
    const bytes = await document.save();
    const original = bytes.slice();
    const names = ["DOMMatrix", "Path2D", "ImageData"] as const;
    const descriptors = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    try {
      names.forEach((name) => Reflect.deleteProperty(globalThis, name));
      const imported = await readDrawingBytes({
        filename: "job-2701-drawings.pdf",
        content_base64: bytesToBase64(bytes),
        sheets: ["S-100", "S-101"],
      });
      expect(imported.bytes).toEqual(original);
      expect(bytes).toEqual(original);
      names.forEach((name) => expect(Reflect.get(globalThis, name)).toBeUndefined());
      await expect(
        readDrawingBytes({
          filename: "job-2701-drawings.pdf",
          content_base64: bytesToBase64(bytes),
          sheets: ["S-100", "S-101", "S-102"],
        }),
      ).rejects.toThrow(/more sheet names than PDF pages/);
    } finally {
      names.forEach((name, index) => {
        const descriptor = descriptors[index];
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      });
    }
  });
});
