import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ImportInputError } from "./model";
import { isXlsx, isZip, readXlsx, toCsv, unzip } from "./xlsx";

// ---------- a tiny ZIP writer for fixtures ----------

type FixtureEntry = {
  name: string | Uint8Array;
  data: string | Uint8Array;
  method?: 0 | 8;
  flags?: number;
  declaredSize?: number;
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function zip(entries: FixtureEntry[], tweakEocd?: (eocd: Buffer) => void): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = typeof e.name === "string" ? Buffer.from(e.name, "utf8") : Buffer.from(e.name);
    const data = typeof e.data === "string" ? Buffer.from(e.data, "utf8") : Buffer.from(e.data);
    const method = e.method ?? 0;
    const body = method === 8 ? deflateRawSync(data) : data;
    const flags = e.flags ?? (typeof e.name === "string" ? 0x800 : 0);
    const size = e.declaredSize ?? data.length;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  tweakEocd?.(eocd);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);

async function expectInputError(p: Promise<unknown>, pattern: RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ImportInputError);
  expect((err as Error).message).toMatch(pattern);
}

// ---------- xlsx fixtures ----------

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`;
const ROOT_RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const STYLES = `<?xml version="1.0"?>
<styleSheet ${NS}>
  <numFmts count="3">
    <numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/>
    <numFmt numFmtId="165" formatCode="[h]:mm:ss"/>
    <numFmt numFmtId="166" formatCode="&quot;$&quot;#,##0.00"/>
  </numFmts>
  <cellStyleXfs count="1"><xf numFmtId="14"/></cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0"/>
    <xf numFmtId="14" applyNumberFormat="1"><alignment horizontal="left"/></xf>
    <xf numFmtId="164"/>
    <xf numFmtId="165"/>
    <xf numFmtId="166"/>
  </cellXfs>
</styleSheet>`;

const SHARED = `<?xml version="1.0"?>
<sst ${NS} count="4" uniqueCount="4">
  <si><t>Cost Code</t></si>
  <si><t>Description</t></si>
  <si><r><rPr><b/></rPr><t>Rough </t></r><r><t xml:space="preserve">in &amp; trim</t></r><rPh sb="0" eb="1"><t>ignored</t></rPh></si>
  <si><t>Line1_x000D_
Line2, "quoted"</t></si>
</sst>`;

function workbook(sheetXml: Record<string, string>, opts: { date1904?: boolean } = {}) {
  const names = Object.keys(sheetXml);
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook ${NS} ${R_NS}>
  <workbookPr${opts.date1904 ? ' date1904="1"' : ""}/>
  <sheets>${names
    .map((n, i) => {
      const hidden = n.startsWith("hidden:") ? ' state="hidden"' : "";
      const name = n.replace(/^hidden:/, "").replace(/&/g, "&amp;");
      return `<sheet name="${name}" sheetId="${i + 1}"${hidden} r:id="rId${i + 1}"/>`;
    })
    .join("")}</sheets>
</workbook>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
    .map((_, i) => {
      // Exercise both relative and absolute targets.
      const target = i === 2 ? `/xl/worksheets/sheet${i + 1}.xml` : `worksheets/sheet${i + 1}.xml`;
      return `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="${target}"/>`;
    })
    .join(
      "",
    )}<Relationship Id="rId90" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId91" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
  return zip([
    { name: "[Content_Types].xml", data: CONTENT_TYPES, method: 8 },
    { name: "_rels/.rels", data: ROOT_RELS, method: 8 },
    { name: "xl/workbook.xml", data: wb, method: 8 },
    { name: "xl/_rels/workbook.xml.rels", data: rels, method: 8 },
    { name: "xl/styles.xml", data: STYLES, method: 8 },
    { name: "xl/sharedStrings.xml", data: SHARED, method: 0 },
    ...Object.values(sheetXml).map((xml, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: xml,
      method: 8 as const,
    })),
  ]);
}

const sheet = (rows: string) =>
  `<?xml version="1.0"?><worksheet ${NS}><dimension ref="A1:G5"/><sheetData>${rows}</sheetData></worksheet>`;

const MAIN = sheet(`
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>
  <row r="2">
    <c r="A2" t="inlineStr"><is><t>01-100</t></is></c>
    <c r="B2" t="s"><v>2</v></c>
    <c r="C2" s="1"><v>45306</v></c>
    <c r="D2" s="4"><v>1234.5</v></c>
    <c r="E2"><v>0.30000000000000004</v></c>
    <c r="F2" t="b"><v>1</v></c>
  </row>
  <row r="3"/>
  <row r="4">
    <c r="A4" t="str"><f>A2&amp;"x"</f><v>01-100x</v></c>
    <c r="B4" t="e"><v>#DIV/0!</v></c>
    <c r="C4" s="2"><v>45306.75</v></c>
    <c r="D4" s="3"><v>1.5</v></c>
    <c r="E4"><v>1.2345E3</v></c>
    <c r="F4" s="1"/>
    <c r="G4" t="s"><v>3</v></c>
  </row>
  <row r="5">
    <c r="A5"><v>123456789.12</v></c>
    <c r="B5" s="0"><v>-0</v></c>
    <c r="C5"><v>1E-7</v></c>
    <c r="D5" t="inlineStr"><is><t>&#169; &#xE9; &lt;tag&gt; &quot;q&quot; &apos;a&apos;</t></is></c>
    <c r="E5" t="b"><v>0</v></c>
    <c r="F5" s="4"></c>
    <c r="Z5" s="1"/>
  </row>
  <row r="7"><c r="B7"><v>2</v></c></row>`);

const PREFIXED = `<?xml version="1.0"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>
<x:row><x:c t="inlineStr"><x:is><x:t>Date</x:t></x:is></x:c><x:c s="1"><x:v>1</x:v></x:c><x:c><x:v>7</x:v></x:c></x:row>
<x:row><x:c r="B2" s="1"><x:v>59</x:v></x:c><x:c s="1"><x:v>61</x:v></x:c></x:row>
</x:sheetData></x:worksheet>`;

describe("isZip / unzip", () => {
  it("recognises the ZIP signature", () => {
    expect(isZip(zip([{ name: "a.txt", data: "a" }]))).toBe(true);
    expect(isZip(new TextEncoder().encode("Cost Code,Amount\n"))).toBe(false);
    expect(isZip(new Uint8Array([0x50, 0x4b]))).toBe(false);
  });

  it("reads stored and deflated entries, skipping folders and macOS junk", async () => {
    const big = "Line item,Amount\n".repeat(2000);
    const bytes = zip([
      { name: "exports/", data: "" },
      { name: "exports/budget.csv", data: big, method: 8 },
      { name: "exports/notes.txt", data: "stored body", method: 0 },
      { name: "__MACOSX/exports/._budget.csv", data: "junk" },
      { name: "exports/.DS_Store", data: "junk" },
      { name: "exports/._notes.txt", data: "junk" },
    ]);
    const entries = await unzip(bytes);
    expect(entries.map((e) => e.name)).toEqual(["exports/budget.csv", "exports/notes.txt"]);
    expect(text(entries[0].bytes)).toBe(big);
    expect(text(entries[1].bytes)).toBe("stored body");
  });

  it("decodes names as UTF-8 when flagged, otherwise as latin1", async () => {
    const entries = await unzip(
      zip([
        { name: "café.csv", data: "x" },
        { name: new Uint8Array([0x6e, 0xe9, 0x2e, 0x63, 0x73, 0x76]), data: "y", flags: 0 },
      ]),
    );
    expect(entries.map((e) => e.name)).toEqual(["café.csv", "né.csv"]);
  });

  it("rejects input that isn't a ZIP", async () => {
    await expectInputError(unzip(new TextEncoder().encode("hello")), /isn't a ZIP/);
  });

  it("rejects truncated archives", async () => {
    const bytes = zip([{ name: "a.csv", data: "a,b\n".repeat(100), method: 8 }]);
    await expectInputError(unzip(bytes.slice(0, bytes.length - 30)), /damaged/);
    // Corrupt the deflate stream itself.
    const broken = zip([{ name: "a.csv", data: "a,b\n".repeat(100), method: 8 }]);
    broken.fill(0xff, 40, 60);
    await expectInputError(unzip(broken), /damaged/);
  });

  it("enforces the entry cap", async () => {
    const bytes = zip([
      { name: "a.csv", data: "1" },
      { name: "b.csv", data: "2" },
      { name: "c.csv", data: "3" },
    ]);
    await expectInputError(unzip(bytes, { maxEntries: 2 }), /more than 2 files/);
    await expect(unzip(bytes, { maxEntries: 3 })).resolves.toHaveLength(3);
  });

  it("enforces the total size cap from the central directory", async () => {
    const bytes = zip([{ name: "a.csv", data: "x".repeat(2 * 1024 * 1024), method: 8 }]);
    await expectInputError(unzip(bytes, { maxTotalBytes: 1024 * 1024 }), /more than 1 MB/);
  });

  it("stops inflating an entry that grows past its declared size (zip bomb)", async () => {
    const bytes = zip([
      { name: "bomb.csv", data: "0".repeat(5_000_000), method: 8, declaredSize: 100 },
    ]);
    await expectInputError(unzip(bytes), /larger than its header says/);
  });

  it("refuses encrypted and ZIP64 archives", async () => {
    await expectInputError(
      unzip(zip([{ name: "a.csv", data: "x", flags: 0x801 }])),
      /password-protected/,
    );
    const zip64 = zip([{ name: "a.csv", data: "x" }], (eocd) => {
      eocd.writeUInt16LE(0xffff, 8);
      eocd.writeUInt16LE(0xffff, 10);
    });
    await expectInputError(unzip(zip64), /ZIP64/);
  });
});

describe("toCsv", () => {
  it("quotes per RFC 4180 with \\n line ends", () => {
    expect(
      toCsv([
        ["Cost Code", "Description", "Amount"],
        ["01-100", 'Rough "in", trim', "1234.5"],
        ["02", "two\nlines", ""],
        ["03", "cr\rhere", "plain"],
      ]),
    ).toBe(
      'Cost Code,Description,Amount\n01-100,"Rough ""in"", trim",1234.5\n02,"two\nlines",\n03,"cr\rhere",plain',
    );
    expect(toCsv([])).toBe("");
  });
});

describe("readXlsx", () => {
  it("reads visible sheets with strings, numbers, dates, booleans and gaps", async () => {
    const bytes = workbook({
      "Budget & SOV": MAIN,
      "hidden:Secret": sheet(`<row r="1"><c r="A1" t="inlineStr"><is><t>secret</t></is></c></row>`),
      Log: PREFIXED,
    });
    expect(isXlsx(await unzip(bytes))).toBe(true);
    expect(await readXlsx(bytes)).toEqual([
      {
        name: "Budget & SOV",
        rows: [
          ["Cost Code", "", "Description"],
          ["01-100", "Rough in & trim", "2024-01-15", "1234.5", "0.3", "TRUE"],
          ["01-100x", "", "2024-01-15", "1.5", "1234.5", "", 'Line1\r\nLine2, "quoted"'],
          ["123456789.12", "0", "0.0000001", "© é <tag> \"q\" 'a'", "FALSE"],
          ["", "2"],
        ],
      },
      {
        name: "Log",
        rows: [
          ["Date", "1900-01-01", "7"],
          ["", "1900-02-28", "1900-03-01"],
        ],
      },
    ]);
  });

  it("honours the 1904 date system", async () => {
    const bytes = workbook(
      {
        Dates: sheet(`<row r="1"><c r="A1" s="1"><v>0</v></c><c r="B1" s="2"><v>366</v></c></row>`),
      },
      { date1904: true },
    );
    expect(await readXlsx(bytes)).toEqual([
      { name: "Dates", rows: [["1904-01-01", "1905-01-01"]] },
    ]);
  });

  it("feeds toCsv cleanly", async () => {
    const [first] = await readXlsx(workbook({ Main: MAIN }));
    expect(toCsv(first.rows).split("\n")[0]).toBe("Cost Code,,Description");
  });

  it("rejects non-workbook input", async () => {
    await expectInputError(readXlsx(new TextEncoder().encode("a,b\n1,2")), /isn't an Excel/);
    await expectInputError(
      readXlsx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
      /older Excel file/,
    );
    await expectInputError(readXlsx(zip([{ name: "a.csv", data: "x" }])), /no workbook found/);
  });

  it("caps rows and columns", async () => {
    const many = Array.from(
      { length: 50_001 },
      (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`,
    ).join("");
    await expectInputError(readXlsx(workbook({ Big: sheet(many) })), /more than 50,000 rows/);

    const wideOk = sheet(`<row r="1"><c r="GR1"><v>1</v></c><c r="XFD1" s="1"/></row>`);
    const [ok] = await readXlsx(workbook({ Wide: wideOk }));
    expect(ok.rows[0]).toHaveLength(200);
    const wide = sheet(`<row r="1"><c r="GS1"><v>1</v></c></row>`);
    await expectInputError(readXlsx(workbook({ Wide: wide })), /column GS/);
  });
});
