import { writeFileSync, readFileSync } from "node:fs";
import { jsPDF } from "jspdf";
import { PDFDocument } from "pdf-lib";
import { expect, it } from "vitest";
import { extractUploadDocument, extractUploadText } from "./file-upload";

it("reads standard compressed PDF text and retains physical page citations", async () => {
  const pdf = new jsPDF({compress:true});
  pdf.text("Fictional agreement: notify within seven calendar days.",10,20);
  pdf.addPage();pdf.text("Section 01-300: review with reasonable promptness.",10,20);
  const bytes = new Uint8Array(pdf.output("arraybuffer")); const original=bytes.slice();
  const result = await extractUploadDocument(bytes,"pdf");
  expect(result.text).toContain("[[PDF page 1]]");
  expect(result.text).toContain("notify within seven calendar days");
  expect(result.text).toContain("[[PDF page 2]]");
  expect(result.text).toContain("review with reasonable promptness");
  expect(result.truncated).toBe(false);expect(bytes).toEqual(original);
});

it("does not present page markers as readable text in image-only or malformed PDFs", async () => {
  const pdf=await PDFDocument.create();pdf.addPage();
  expect((await extractUploadDocument(await pdf.save(),"pdf")).chars).toBe(0);
  expect((await extractUploadDocument(new TextEncoder().encode("%PDF-invalid"),"pdf")).chars).toBe(0);
});

it.skipIf(!process.env.ATHENA_WESTSIDE_PDF)("reads the authorized actual Westside manual through all 163 pages", async () => {
  const bytes=new Uint8Array(readFileSync(process.env.ATHENA_WESTSIDE_PDF!));
  expect(extractUploadText(bytes,"pdf").chars).toBe(0); // live failure reproduced
  const result=await extractUploadDocument(bytes,"pdf");
  expect(result.text).toContain("[[PDF page 163]]");
  expect(result.text).toContain("TRANSPORTATION BUILDING REMODEL");
  expect(result.text).toMatch(/fourteen.*\(14\)/i);
  expect(result.text).toMatch(/reasonable promptness/i);
  expect(result.chars).toBeGreaterThan(200000);expect(result.truncated).toBe(false);
  if (process.env.ATHENA_PDF_PROOF_DIR) {
    writeFileSync(`${process.env.ATHENA_PDF_PROOF_DIR}/westside-extracted-text.txt`,result.text);
    writeFileSync(`${process.env.ATHENA_PDF_PROOF_DIR}/westside-parser-proof.json`,JSON.stringify({bytes:bytes.length,body_chars:result.chars,truncated:result.truncated,pages:163},null,2));
  }
},30000);
