import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { VENDOR_RE } from "./security";
import {
  FILE_UPLOAD_CHUNK_CHARS,
  FILE_UPLOAD_DESCRIPTION,
  assertUploadBytes,
  decodeChunk,
  extractUploadText,
  missingChunk,
  sniffUpload,
  uploadFilename,
  uploadPage,
} from "./file-upload";

function zipStored(name: string, data: Uint8Array): Uint8Array {
  const nameBytes = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + nameBytes.length, 12);
  end.writeUInt32LE(30 + nameBytes.length + data.length, 16);
  return Buffer.concat([local, nameBytes, data, central, nameBytes, end]);
}

function flatePdf(text: string): Uint8Array {
  const content = `BT (${text}) Tj ET`;
  const raw = deflateRawSync(Buffer.from(content));
  const dict = `<< /Filter /FlateDecode /Length ${raw.length} >>`;
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n${dict}\nstream\n${raw.toString("latin1")}endstream\nendobj\n%%EOF`,
    "latin1",
  );
}

describe("file upload bytes", () => {
  it("keeps the published description to one sentence and off vendor names", () => {
    const parts = FILE_UPLOAD_DESCRIPTION.split(/[.!]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    expect(parts).toEqual([FILE_UPLOAD_DESCRIPTION.replace(/\.$/, "")]);
    expect(FILE_UPLOAD_DESCRIPTION).not.toMatch(VENDOR_RE);
    expect(FILE_UPLOAD_DESCRIPTION).toMatch(/begin|finish|from_url|chunk|12000/);
  });

  it("accepts pdf, docx, and txt names and reads their text", () => {
    expect(uploadFilename("Section 9.4.pdf").name).toBe("Section 9.4.pdf");
    expect(() => uploadFilename("photo.png")).toThrow(/PDF, Word/);
    const txt = new TextEncoder().encode("notice within 7 calendar days");
    expect(sniffUpload(txt, "txt")).toBe(true);
    expect(extractUploadText(txt, "txt").text).toBe("notice within 7 calendar days");
    const xml = new TextEncoder().encode(`<w:p><w:t>liquidated damages &amp; notice</w:t></w:p>`);
    const docx = zipStored("word/document.xml", xml);
    expect(assertUploadBytes(docx, "Agreement.docx", "contract").ext).toBe("docx");
    expect(extractUploadText(docx, "docx").text).toContain("liquidated damages & notice");
    const pdf = flatePdf("Section 9.4 liquidated damages");
    expect(sniffUpload(pdf, "pdf")).toBe(true);
    expect(extractUploadText(pdf, "pdf").text).toContain("Section 9.4 liquidated damages");
    expect(sniffUpload(pdf, "txt")).toBe(false);
  });

  it("rejects a chunk over the call budget and reports a missing index", () => {
    expect(() => decodeChunk("A".repeat(FILE_UPLOAD_CHUNK_CHARS + 1))).toThrow(/12,000/);
    expect(decodeChunk(Buffer.from("hello").toString("base64")).byteLength).toBe(5);
    expect(missingChunk([])).toBe(0);
    expect(missingChunk([0, 2])).toBe(1);
    expect(missingChunk([0, 1])).toBeNull();
  });

  it("renders an upload page without stack vendor names", () => {
    const html = uploadPage({
      filename: "Agreement.pdf",
      purpose: "Contract",
      until: "2026-10-26 01:00 UTC",
    });
    expect(html).toContain("Agreement.pdf");
    expect(html).toContain('name="file"');
    expect(html).toContain("#1E5FED");
    expect(html.toLowerCase()).not.toMatch(VENDOR_RE);
    expect(uploadPage({ filename: "a.pdf", purpose: "Contract", until: "", done: true })).toContain(
      "File stored",
    );
  });
});
