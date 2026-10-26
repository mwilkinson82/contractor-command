// Page counting must work before any drawing is stored, without browser globals
// or a native canvas. Reuse the pure-JavaScript PDF parser already used by Athena.
import { ToolError } from "@lovable.dev/mcp-js";
import { EncryptedPDFError, PDFDocument } from "pdf-lib";

/** Read only: never save, rewrite, or change the original PDF bytes. */
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  try {
    const document = await PDFDocument.load(bytes, {
      updateMetadata: false,
      throwOnInvalidObject: true,
    });
    const count = document.getPageCount();
    if (!Number.isSafeInteger(count) || count < 1) throw new ToolError("This PDF has no pages.");
    return count;
  } catch (error) {
    if (error instanceof EncryptedPDFError)
      throw new ToolError("This PDF is encrypted and cannot be indexed.");
    throw new ToolError(
      "This PDF could not be read. Use an unencrypted drawing PDF with at least one page.",
    );
  }
}
