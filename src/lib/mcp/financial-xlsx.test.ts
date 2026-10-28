import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { assertUploadBytes, extractUploadDocument, uploadMaxBytes } from "./file-upload";
import { isSafeFinancialXlsx } from "./financial-xlsx";

type Entry = { name: string; text: string; flags?: number; method?: number; declaredSize?: number };
const entries: Entry[] = [
  {
    name: "[Content_Types].xml",
    text: '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
  },
  { name: "_rels/.rels", text: "<Relationships/>" },
  { name: "xl/workbook.xml", text: "<workbook/>" },
  { name: "xl/worksheets/sheet1.xml", text: "<worksheet><sheetData/></worksheet>" },
];
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const x of bytes) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function zip(items: Entry[]): Uint8Array {
  const locals: Buffer[] = [],
    central: Buffer[] = [];
  let pos = 0;
  for (const item of items) {
    const name = Buffer.from(item.name),
      plain = Buffer.from(item.text),
      packed = item.method === 8 ? deflateRawSync(plain) : plain;
    const method = item.method ?? 0,
      flags = item.flags ?? 0,
      crc = crc32(plain),
      declared = item.declaredSize ?? plain.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(name.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(flags, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(declared, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(pos, 42);
    const descriptor = flags & 8 ? Buffer.alloc(16) : Buffer.alloc(0);
    if (flags & 8) {
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(packed.length, 8);
      descriptor.writeUInt32LE(declared, 12);
    }
    locals.push(local, name, packed, descriptor);
    central.push(dir, name);
    pos += local.length + name.length + packed.length + descriptor.length;
  }
  const cd = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(pos, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

describe("financial XLSX originals", () => {
  it("accepts a bounded macro-free workbook for financial originals without extracting values", async () => {
    const file = zip(entries);
    expect(isSafeFinancialXlsx(file)).toBe(true);
    expect(
      isSafeFinancialXlsx(
        zip(entries.map((x, i) => (i === 3 ? { ...x, flags: 8, method: 8 } : x))),
      ),
    ).toBe(true);
    expect(assertUploadBytes(file, "estimate.xlsx", "financial_document").mime).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect((await extractUploadDocument(file, "xlsx", "financial_document")).text).toBe("");
    expect(() => assertUploadBytes(file, "estimate.xlsx", "contract")).toThrow();
    expect(uploadMaxBytes("financial_document")).toBe(10 * 1024 * 1024);
    expect(uploadMaxBytes("contract")).toBe(100 * 1024 * 1024);
    expect(uploadMaxBytes("spec")).toBe(100 * 1024 * 1024);
  });
  it("rejects unsupported extensions, malformed structures, encrypted and macro-enabled archives", () => {
    expect(() => assertUploadBytes(zip(entries), "estimate.xlsm", "financial_document")).toThrow(
      /XLSM/,
    );
    expect(() => assertUploadBytes(zip(entries), "estimate.xls", "financial_document")).toThrow(
      /XLS/,
    );
    expect(isSafeFinancialXlsx(zip(entries.slice(0, 3)))).toBe(false);
    expect(
      isSafeFinancialXlsx(zip([...entries, { name: "xl/vbaProject.bin", text: "macro" }])),
    ).toBe(false);
    expect(
      isSafeFinancialXlsx(
        zip(entries.map((x, i) => (i === 0 ? { ...x, text: x.text + " macroEnabled" } : x))),
      ),
    ).toBe(false);
    expect(
      isSafeFinancialXlsx(zip(entries.map((x, i) => (i === 1 ? { ...x, flags: 1 } : x)))),
    ).toBe(false);
    expect(isSafeFinancialXlsx(zip([...entries, { name: "../escape", text: "x" }]))).toBe(false);
    expect(isSafeFinancialXlsx(zip([...entries, entries[0]]))).toBe(false);
    const corrupt = zip(entries);
    corrupt[35] ^= 1;
    expect(isSafeFinancialXlsx(corrupt)).toBe(false);
  });
  it("rejects forged size, excessive expansion and compression ratio", () => {
    expect(
      isSafeFinancialXlsx(
        zip([...entries, { name: "xl/huge.xml", text: "small", declaredSize: 17 * 1024 * 1024 }]),
      ),
    ).toBe(false);
    expect(
      isSafeFinancialXlsx(
        zip([
          ...entries,
          { name: "xl/compressed.xml", text: "x".repeat(2 * 1024 * 1024), method: 8 },
        ]),
      ),
    ).toBe(false);
    expect(
      isSafeFinancialXlsx(
        zip([
          ...entries,
          { name: "xl/forged.xml", text: "x".repeat(20_000), method: 8, declaredSize: 10 },
        ]),
      ),
    ).toBe(false);
  });
});
