import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { pdfPageCount } from "./pdf-pages";

const enc = new TextEncoder();

function join(parts: (string | Uint8Array)[]): Uint8Array {
  const bytes = parts.map((part) => (typeof part === "string" ? enc.encode(part) : part));
  const out = new Uint8Array(bytes.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of bytes) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function be(n: number, width: number): number[] {
  const out = [];
  for (let i = width - 1; i >= 0; i--) out.push((n >> (8 * i)) & 255);
  return out;
}

/** One-page PDF whose catalog lives in an object stream and whose xref is flate + predictor 12. */
function compressedPagePdf(): Uint8Array {
  const parts: Uint8Array[] = [];
  let len = 0;
  const add = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? enc.encode(part) : part;
    parts.push(bytes);
    const at = len;
    len += bytes.length;
    return at;
  };
  add("%PDF-1.5\n");
  const pageAt = add("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>\nendobj\n");
  const catalog = "<< /Type /Catalog /Pages 2 0 R >>";
  const pages = "<< /Type /Pages /Count 1 /Kids [3 0 R] >>";
  const header = `1 0 2 ${catalog.length + 1}\n`;
  const stm = enc.encode(header + catalog + "\n" + pages);
  const stmAt = add(`4 0 obj\n<< /Type /ObjStm /N 2 /First ${header.length} /Length ${stm.length} >>\nstream\n`);
  add(stm);
  add("\nendstream\nendobj\n");
  const head = join(parts);
  const xrefAt = head.length;
  const row = (type: number, a: number, b: number) => [type, ...be(a, 4), ...be(b, 2)];
  const rows = [
    row(0, 0, 65535),
    row(2, 4, 0),
    row(2, 4, 1),
    row(1, pageAt, 0),
    row(1, stmAt, 0),
    row(1, xrefAt, 0),
  ];
  let prev = new Uint8Array(7);
  const filtered = new Uint8Array(rows.length * 8);
  rows.forEach((entry, r) => {
    filtered[r * 8] = 2;
    for (let i = 0; i < 7; i++) filtered[r * 8 + 1 + i] = (entry[i] - prev[i]) & 255;
    prev = Uint8Array.from(entry);
  });
  const raw = deflateSync(filtered);
  const dict = `5 0 obj\n<< /Type /XRef /Size 6 /Root 1 0 R /W [1 4 2] /Index [0 6] /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 7 >> /Length ${raw.length} >>\nstream\n`;
  return join([head, dict, raw, `\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`]);
}

describe("pdf page count", () => {
  it("reads a compressed xref and an object stream", () => {
    expect(pdfPageCount(compressedPagePdf())).toBe(1);
  });
});
