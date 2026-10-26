import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { jsPDF } from "jspdf";
import { boundedPdfPageCount, pageCountFromSource } from "./pdf-page-count";

function classicPdf(pages: number, streamPad = 0): Uint8Array {
  const parts: string[] = [];
  let len = 0;
  const add = (text: string) => {
    parts.push(text);
    const at = len;
    len += text.length;
    return at;
  };
  add("%PDF-1.4\n");
  const offsets = [0];
  const obj = (body: string) => {
    offsets.push(add(`${offsets.length} 0 obj\n${body}\nendobj\n`));
  };
  const kids: number[] = [];
  obj("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesAt = offsets.length;
  obj("<< /Type /Pages /Count 0 /Kids [] >>");
  for (let n = 0; n < pages; n++) {
    kids.push(offsets.length);
    obj(`<< /Type /Page /Parent ${pagesAt} 0 R /MediaBox [0 0 10 10] >>`);
  }
  if (streamPad > 0) obj(`<< /Length ${streamPad} >>\nstream\n${"A".repeat(streamPad)}\nendstream`);
  const pagesBody = `<< /Type /Pages /Count ${pages} /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] >>`;
  parts[pagesAt] = `${pagesAt} 0 obj\n${pagesBody}\nendobj\n`;
  // Rebuild with corrected pages object so xref offsets stay valid: the pages
  // object was a placeholder of a different length. Build again without a placeholder.
  return classicPdfFixed(pages, streamPad);
}

function classicPdfFixed(pages: number, streamPad = 0): Uint8Array {
  const chunks: { text: string }[] = [];
  const offsets: number[] = [0];
  let len = 0;
  const add = (text: string) => {
    chunks.push({ text });
    const at = len;
    len += text.length;
    return at;
  };
  add("%PDF-1.4\n");
  const pageIds: number[] = [];
  for (let n = 0; n < pages; n++) pageIds.push(n + 3);
  const bodies = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pages} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`,
    ...pageIds.map(() => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>"),
  ];
  if (streamPad > 0) bodies.push(`<< /Length ${streamPad} >>\nstream\n${"A".repeat(streamPad)}\nendstream`);
  bodies.forEach((body, index) => {
    offsets[index + 1] = add(`${index + 1} 0 obj\n${body}\nendobj\n`);
  });
  const xrefAt = len;
  let xref = `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= bodies.length; n++) xref += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  add(xref);
  return new TextEncoder().encode(chunks.map((c) => c.text).join(""));
}

describe("bounded PDF page count", () => {
  it("counts a classic trailer without reading a large unused stream", async () => {
    const bytes = classicPdf(4, 300_000);
    const reads: number[] = [];
    const count = await pageCountFromSource(bytes.length, async (start, end) => {
      reads.push(end - start);
      return bytes.subarray(start, end);
    });
    expect(count).toBe(4);
    expect(Math.max(...reads)).toBeLessThan(300_000);
    expect(reads.reduce((sum, n) => sum + n, 0)).toBeLessThan(bytes.length);
  });

  it("counts a jsPDF drawing and a pdf-lib drawing", async () => {
    const doc = new jsPDF();
    doc.text("Cover", 20, 20);
    doc.addPage();
    doc.text("S-100", 20, 20);
    doc.addPage();
    doc.text("S-101", 20, 20);
    expect(await boundedPdfPageCount(new Uint8Array(doc.output("arraybuffer")))).toBe(3);
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.addPage();
    expect(await boundedPdfPageCount(await pdf.save())).toBe(2);
  });

  it("returns null for a fragment and does not throw", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
    await expect(boundedPdfPageCount(bytes)).resolves.toBeNull();
    await expect(pageCountFromSource(0, async () => null)).resolves.toBeNull();
  });

  it("reads a flate xref stream", async () => {
    const page = "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>\nendobj\n";
    const head = `%PDF-1.5\n${page}`;
    const pageAt = head.indexOf("3 0 obj");
    const catalog = "<< /Type /Catalog /Pages 2 0 R >>";
    const pages = "<< /Type /Pages /Count 1 /Kids [3 0 R] >>";
    const header = `1 0 2 ${catalog.length + 1}\n`;
    const stm = new TextEncoder().encode(header + catalog + "\n" + pages);
    const objStm = `4 0 obj\n<< /Type /ObjStm /N 2 /First ${header.length} /Length ${stm.length} >>\nstream\n${new TextDecoder().decode(stm)}\nendstream\nendobj\n`;
    const body = head + objStm;
    const xrefAt = body.length;
    const row = (type: number, a: number, b: number) => [type, ...be(a, 3), ...be(b, 1)];
    const rows = [row(0, 0, 0), row(2, 4, 0), row(2, 4, 1), row(1, pageAt, 0), row(1, head.length, 0), row(1, xrefAt, 0)];
    const raw = new Uint8Array(rows.length * 5);
    rows.forEach((entry, r) => entry.forEach((v, i) => (raw[r * 5 + i] = v)));
    const z = deflateSync(raw);
    const dict = `5 0 obj\n<< /Type /XRef /Size 6 /Root 1 0 R /W [1 3 1] /Index [0 6] /Filter /FlateDecode /Length ${z.length} >>\nstream\n`;
    const enc = new TextEncoder();
    const tail = enc.encode(`\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`);
    const file = new Uint8Array(body.length + dict.length + z.length + tail.length);
    file.set(enc.encode(body));
    file.set(enc.encode(dict), body.length);
    file.set(z, body.length + dict.length);
    file.set(tail, body.length + dict.length + z.length);
    expect(await boundedPdfPageCount(file)).toBe(1);
  });
});

function be(n: number, width: number): number[] {
  const out = [];
  for (let i = width - 1; i >= 0; i--) out.push((n >> (8 * i)) & 255);
  return out;
}
