// Takeoff spreadsheet. Stored-zip xlsx so a workbook can be written without another package.

export type SheetRow = {
  group: string;
  ref: string;
  item: string;
  unit: string;
  qty: string;
  basis: string;
  verify: string;
  math: string;
  sheet: string;
  spec: string;
};

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  return b;
}
function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  b[2] = (n >>> 16) & 0xff;
  b[3] = (n >>> 24) & 0xff;
  return b;
}
function concat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
const enc = (s: string) => new TextEncoder().encode(s);

/** Zip with the stored method (no compression). */
export function zipStored(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc(f.name);
    const crc = crc32(f.data);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(f.data.length),
      u32(f.data.length),
      u16(name.length),
      u16(0),
      name,
      f.data,
    ]);
    locals.push(local);
    centrals.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(f.data.length),
        u32(f.data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += local.length;
  }
  const central = concat(centrals);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
  return concat([...locals, central, end]);
}

function xml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cell(col: string, row: number, value: string): string {
  return `<c r="${col}${row}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
}

const COLS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
const HEAD = ["Group", "Item", "Unit", "Qty", "Basis", "Verify", "Math", "Sheet", "Spec", "Ref"];

export function groupedCsv(rows: SheetRow[]): string {
  const lines = ["group,item,unit,qty,basis,verify,math,sheet,spec,ref"];
  for (const r of rows) {
    lines.push(
      [r.group, r.item, r.unit, r.qty, r.basis, r.verify, r.math, r.sheet, r.spec, r.ref]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function takeoffXlsx(rows: SheetRow[]): Uint8Array {
  const body = rows
    .map((r, i) => {
      const n = i + 2;
      const vals = [
        r.group,
        r.item,
        r.unit,
        r.qty,
        r.basis,
        r.verify,
        r.math,
        r.sheet,
        r.spec,
        r.ref,
      ];
      return `<row r="${n}">${vals.map((v, c) => cell(COLS[c], n, v)).join("")}</row>`;
    })
    .join("");
  const header = `<row r="1">${HEAD.map((h, c) => cell(COLS[c], 1, h)).join("")}</row>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${header}${body}</sheetData></worksheet>`;
  const files = [
    {
      name: "[Content_Types].xml",
      data: enc(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: enc(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
      ),
    },
    {
      name: "xl/workbook.xml",
      data: enc(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Takeoff" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: enc(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
      ),
    },
    { name: "xl/worksheets/sheet1.xml", data: enc(sheet) },
  ];
  return zipStored(files);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function takeoffCard(rows: SheetRow[]): string[] {
  if (!rows.length) return ["Takeoff card", "- No lines yet."];
  const lines = ["Takeoff card"];
  let group = "";
  for (const r of rows) {
    if (r.group !== group) {
      group = r.group;
      lines.push(group);
    }
    const qty = r.qty ? `${r.qty} ${r.unit}`.trim() : "blank";
    const verify = r.verify ? ` ${r.verify}.` : "";
    lines.push(`- ${r.ref} ${r.item}. Qty ${qty}. ${r.basis || "No basis"}.${verify}`);
  }
  return lines;
}
