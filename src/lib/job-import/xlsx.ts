// Library-free readers for the files members drop into a job import: ZIP bundles and
// Excel workbooks (.xlsx, which are ZIPs of XML). Web-standard APIs only, so the same
// code runs in the Worker runtime and in Node: DataView, TextDecoder and
// DecompressionStream("deflate-raw").
import { ImportInputError } from "./model";

export type ZipEntry = { name: string; bytes: Uint8Array };
export type XlsxSheet = { name: string; rows: string[][] };

const MAX_ROWS = 50_000;
const MAX_COLS = 200;

export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4
  );
}

const damaged = () =>
  new ImportInputError("The ZIP file looks damaged or incomplete. Try exporting it again.");

const isJunk = (name: string) => {
  const base = name.slice(name.lastIndexOf("/") + 1);
  return (
    name.startsWith("__MACOSX/") ||
    name.includes("/__MACOSX/") ||
    base === ".DS_Store" ||
    base.startsWith("._")
  );
};

async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => {});
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        reader.cancel().catch(() => {});
        throw new ImportInputError(
          "A file inside the ZIP is larger than its header says. The ZIP may be damaged or unsafe.",
        );
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof ImportInputError) throw err;
    throw damaged();
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export async function unzip(
  bytes: Uint8Array,
  opts: { maxEntries?: number; maxTotalBytes?: number } = {},
): Promise<ZipEntry[]> {
  const maxEntries = opts.maxEntries ?? 500;
  const maxTotal = opts.maxTotalBytes ?? 60 * 1024 * 1024;
  if (!isZip(bytes) && !(bytes.length >= 22 && bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    throw new ImportInputError("This file isn't a ZIP archive.");
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw damaged();
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  const zip64 =
    (eocd >= 20 && dv.getUint32(eocd - 20, true) === 0x07064b50) ||
    count === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff;
  if (zip64) {
    throw new ImportInputError(
      "This ZIP uses the ZIP64 format, which isn't supported. Split it into smaller ZIPs or upload the files directly.",
    );
  }
  if (dv.getUint16(eocd + 4, true) !== 0 || dv.getUint16(eocd + 6, true) !== 0) {
    throw new ImportInputError("Multi-part (split) ZIP archives aren't supported.");
  }
  if (cdOffset + cdSize > eocd) throw damaged();

  type Pending = { name: string; method: number; comp: number; size: number; local: number };
  const pending: Pending[] = [];
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > eocd || dv.getUint32(p, true) !== 0x02014b50) throw damaged();
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const comp = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    if (p + 46 + nameLen > eocd) throw damaged();
    const raw = bytes.subarray(p + 46, p + 46 + nameLen);
    const name = new TextDecoder(flags & 0x800 ? "utf-8" : "latin1")
      .decode(raw)
      .replace(/\\/g, "/");
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || isJunk(name)) continue;
    if (flags & 1 || method === 99) {
      throw new ImportInputError(
        "This ZIP is password-protected. Remove the password and upload it again.",
      );
    }
    if (comp === 0xffffffff || size === 0xffffffff || local === 0xffffffff) {
      throw new ImportInputError("This ZIP uses the ZIP64 format, which isn't supported.");
    }
    if (method !== 0 && method !== 8) {
      throw new ImportInputError(
        `"${name}" in the ZIP uses a compression method that isn't supported. Re-zip it with standard settings.`,
      );
    }
    if (pending.length >= maxEntries) {
      throw new ImportInputError(
        `This ZIP holds more than ${maxEntries} files. Split it into smaller ZIPs.`,
      );
    }
    total += size;
    if (total > maxTotal) {
      throw new ImportInputError(
        `This ZIP unpacks to more than ${Math.round(maxTotal / 1024 / 1024)} MB. Split it into smaller ZIPs.`,
      );
    }
    pending.push({ name, method, comp, size, local });
  }

  const out: ZipEntry[] = [];
  for (const e of pending) {
    if (e.local + 30 > bytes.length || dv.getUint32(e.local, true) !== 0x04034b50) throw damaged();
    const start =
      e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
    if (start + e.comp > bytes.length) throw damaged();
    const data = bytes.subarray(start, start + e.comp);
    if (e.method === 0) {
      if (e.comp !== e.size) throw damaged();
      out.push({ name: e.name, bytes: data.slice() });
    } else {
      const inflated = await inflateRaw(data, e.size);
      if (inflated.length !== e.size) throw damaged();
      out.push({ name: e.name, bytes: inflated });
    }
  }
  return out;
}

// ---------- XML scanning ----------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (s.indexOf("&") < 0) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] !== "#") return ENTITIES[e] ?? m;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

// OOXML escapes control characters in strings as _xHHHH_ (e.g. _x000D_ for CR).
const unescapeOoxml = (s: string) =>
  s.indexOf("_x") < 0
    ? s
    : s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

type Tok =
  | { k: "open"; name: string; attrs: Record<string, string>; self: boolean }
  | { k: "close"; name: string }
  | { k: "text"; raw: string; cdata?: boolean };

const localName = (n: string) => n.slice(n.indexOf(":") + 1);
const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const badXml = () =>
  new ImportInputError(
    "The workbook looks damaged (unreadable XML). Try saving it again in Excel.",
  );

function* scan(xml: string): Generator<Tok> {
  let i = 0;
  const len = xml.length;
  while (i < len) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) {
      yield { k: "text", raw: xml.slice(i) };
      return;
    }
    if (lt > i) yield { k: "text", raw: xml.slice(i, lt) };
    if (xml.startsWith("<!--", lt)) {
      const e = xml.indexOf("-->", lt + 4);
      if (e < 0) throw badXml();
      i = e + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const e = xml.indexOf("]]>", lt + 9);
      if (e < 0) throw badXml();
      yield { k: "text", raw: xml.slice(lt + 9, e), cdata: true };
      i = e + 3;
      continue;
    }
    let j = lt + 1;
    let quote = "";
    for (; j < len; j++) {
      const c = xml[j];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    if (j >= len) throw badXml();
    const body = xml.slice(lt + 1, j);
    i = j + 1;
    if (body[0] === "?" || body[0] === "!") continue;
    if (body[0] === "/") {
      yield { k: "close", name: localName(body.slice(1).trim()) };
      continue;
    }
    const self = body.endsWith("/");
    const inner = self ? body.slice(0, -1) : body;
    const nameEnd = inner.search(/\s|$/);
    const attrs: Record<string, string> = {};
    const rest = inner.slice(nameEnd);
    ATTR.lastIndex = 0;
    for (let m = ATTR.exec(rest); m; m = ATTR.exec(rest)) {
      if (m[1] === "xmlns" || m[1].startsWith("xmlns:")) continue;
      attrs[localName(m[1])] = decodeEntities(m[2] ?? m[3] ?? "");
    }
    yield { k: "open", name: localName(inner.slice(0, nameEnd)), attrs, self };
  }
}

const textOf = (t: Tok & { k: "text" }) => (t.cdata ? t.raw : decodeEntities(t.raw));

// Reads the text of a string item (<si> or <is>): plain <t> or rich-text runs <r><t>,
// skipping phonetic hints (<rPh>). Call with the scanner positioned just after the open tag.
function readStringItem(it: Generator<Tok>, end: string): string {
  let out = "";
  let inT = false;
  let rph = 0;
  for (let r = it.next(); !r.done; r = it.next()) {
    const t = r.value;
    if (t.k === "open") {
      if (t.name === "rPh" && !t.self) rph++;
      else if (t.name === "t" && !t.self) inT = true;
    } else if (t.k === "close") {
      if (t.name === end) break;
      if (t.name === "rPh") rph--;
      else if (t.name === "t") inT = false;
    } else if (inT && rph === 0) out += textOf(t);
  }
  return unescapeOoxml(out);
}

// ---------- number and date formatting ----------

const BUILTIN_DATE = (id: number) =>
  (id >= 14 && id <= 22) ||
  (id >= 27 && id <= 36) ||
  (id >= 45 && id <= 47) ||
  (id >= 50 && id <= 58);

export function isDateFormatCode(code: string): boolean {
  const s = code
    .split(";")[0]
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "")
    .replace(/[_*]./g, "")
    .toLowerCase()
    .replace(/am\/pm|a\/p/g, "");
  if (/[dy]/.test(s)) return true;
  return s.includes("m") && !/[hs]/.test(s);
}

export function serialToIsoDate(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) return null;
  const days = Math.floor(serial + 0.5 / 86400);
  const base = date1904
    ? Date.UTC(1904, 0, 1)
    : days < 60
      ? Date.UTC(1899, 11, 31)
      : Date.UTC(1899, 11, 30);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  // 15 significant digits is Excel's own precision: it drops float noise such as
  // 0.30000000000000004 without truncating large dollar amounts or IDs.
  const x = Number(n.toPrecision(15));
  if (x === 0) return "0";
  const abs = Math.abs(x);
  if (abs >= 1e21) return BigInt(Math.round(x)).toString();
  if (abs < 1e-6) {
    const digits = Math.min(100, 14 - Math.floor(Math.log10(abs)));
    return x.toFixed(digits).replace(/\.?0+$/, "");
  }
  return String(x);
}

// ---------- workbook ----------

const decodeXml = (b: Uint8Array) =>
  new TextDecoder(
    b[0] === 0xff && b[1] === 0xfe
      ? "utf-16le"
      : b[0] === 0xfe && b[1] === 0xff
        ? "utf-16be"
        : "utf-8",
  ).decode(b);

function resolvePath(baseDir: string, target: string): string {
  const parts = (target.startsWith("/") ? target.slice(1) : baseDir + target).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part !== "." && part !== "") out.push(part);
  }
  return out.join("/");
}

function readRels(xml: string | undefined, baseDir: string) {
  const rels = new Map<string, { type: string; path: string }>();
  if (!xml) return rels;
  for (const t of scan(xml)) {
    if (t.k === "open" && t.name === "Relationship" && t.attrs.TargetMode !== "External") {
      rels.set(t.attrs.Id, {
        type: t.attrs.Type ?? "",
        path: resolvePath(baseDir, t.attrs.Target ?? ""),
      });
    }
  }
  return rels;
}

export function isXlsx(entries: { name: string }[]): boolean {
  const names = new Set(entries.map((e) => e.name.toLowerCase()));
  return (
    names.has("[content_types].xml") && (names.has("xl/workbook.xml") || names.has("_rels/.rels"))
  );
}

function colIndex(ref: string): number {
  let col = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i) | 0x20;
    if (c < 97 || c > 122) break;
    col = col * 26 + (c - 96);
  }
  return col - 1;
}

const colLetters = (i: number): string =>
  (i >= 26 ? colLetters(Math.floor(i / 26) - 1) : "") + String.fromCharCode(65 + (i % 26));

type Styles = { isDate: boolean[] };

function readSheet(xml: string, name: string, shared: string[], styles: Styles, date1904: boolean) {
  const rows: string[][] = [];
  const it = scan(xml);
  let row: string[] | null = null;
  let col = -1;
  let cell: { type: string; style: number } | null = null;
  let value = "";
  let inline = "";
  let inV = false;
  const finishRow = () => {
    if (!row) return;
    const filled = Array.from(row, (v) => v ?? "");
    while (filled.length && filled[filled.length - 1] === "") filled.pop();
    if (filled.length) {
      if (rows.length >= MAX_ROWS) {
        throw new ImportInputError(
          `Sheet "${name}" has more than ${MAX_ROWS.toLocaleString("en-US")} rows. Split it or remove unused rows.`,
        );
      }
      rows.push(filled);
    }
    row = null;
  };
  const finishCell = () => {
    if (!cell || !row) return;
    const v = value.trim();
    let out = "";
    switch (cell.type) {
      case "s":
        out = shared[parseInt(v, 10)] ?? "";
        break;
      case "inlineStr":
        out = inline;
        break;
      case "str":
        out = unescapeOoxml(value);
        break;
      case "b":
        out = v === "" ? "" : v === "1" || v.toLowerCase() === "true" ? "TRUE" : "FALSE";
        break;
      case "e":
        break;
      case "d":
        out = /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v;
        break;
      default: {
        if (v === "") break;
        const n = Number(v);
        if (!Number.isFinite(n)) out = v;
        else out = (styles.isDate[cell.style] && serialToIsoDate(n, date1904)) || formatNumber(n);
      }
    }
    if (out !== "") {
      if (col >= MAX_COLS) {
        throw new ImportInputError(
          `Sheet "${name}" has data in column ${colLetters(col)}, past the ${MAX_COLS}-column limit.`,
        );
      }
      row[col] = out;
    }
    cell = null;
  };
  for (let r = it.next(); !r.done; r = it.next()) {
    const t = r.value;
    if (t.k === "open") {
      if (t.name === "row") {
        finishRow();
        row = [];
        col = -1;
        if (t.self) finishRow();
      } else if (t.name === "c") {
        if (!row) row = [];
        col = t.attrs.r ? colIndex(t.attrs.r) : col + 1;
        if (col < 0) col = 0;
        cell = { type: t.attrs.t ?? "n", style: parseInt(t.attrs.s ?? "0", 10) || 0 };
        value = "";
        inline = "";
        if (t.self) cell = null;
      } else if (t.name === "v" && cell && !t.self) {
        inV = true;
      } else if (t.name === "is" && cell && !t.self) {
        inline = readStringItem(it, "is");
      }
    } else if (t.k === "close") {
      if (t.name === "v") inV = false;
      else if (t.name === "c") finishCell();
      else if (t.name === "row") finishRow();
      else if (t.name === "sheetData") break;
    } else if (inV) value += textOf(t);
  }
  finishRow();
  return rows;
}

export async function readXlsx(bytes: Uint8Array): Promise<XlsxSheet[]> {
  if (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11) {
    throw new ImportInputError(
      "This is an older Excel file (.xls) or a password-protected workbook. Save it as .xlsx or CSV and upload again.",
    );
  }
  if (!isZip(bytes)) throw new ImportInputError("This file isn't an Excel workbook (.xlsx).");
  const entries = await unzip(bytes);
  const files = new Map(entries.map((e) => [e.name.replace(/^\/+/, "").toLowerCase(), e.bytes]));
  const text = (path: string) => {
    const b = files.get(path.toLowerCase());
    return b ? decodeXml(b) : undefined;
  };
  const rootRels = readRels(text("_rels/.rels"), "");
  const docRel = [...rootRels.values()].find((r) => r.type.endsWith("/officeDocument"));
  const wbPath = docRel?.path ?? "xl/workbook.xml";
  const wbXml = text(wbPath);
  if (!wbXml) {
    throw new ImportInputError(
      "This doesn't look like an Excel workbook (.xlsx): no workbook found.",
    );
  }
  const wbDir = wbPath.slice(0, wbPath.lastIndexOf("/") + 1);
  const rels = readRels(text(`${wbDir}_rels/${wbPath.slice(wbDir.length)}.rels`), wbDir);
  const relOfType = (suffix: string) =>
    [...rels.values()].find((r) => r.type.endsWith(suffix))?.path;

  let date1904 = false;
  const sheets: { name: string; id?: string; hidden: boolean }[] = [];
  for (const t of scan(wbXml)) {
    if (t.k !== "open") continue;
    if (t.name === "workbookPr") date1904 = t.attrs.date1904 === "1" || t.attrs.date1904 === "true";
    else if (t.name === "sheet") {
      const state = t.attrs.state ?? "visible";
      sheets.push({ name: t.attrs.name ?? "", id: t.attrs.id, hidden: state !== "visible" });
    }
  }

  const shared: string[] = [];
  const ssXml = text(relOfType("/sharedStrings") ?? `${wbDir}sharedStrings.xml`);
  if (ssXml) {
    const it = scan(ssXml);
    for (let r = it.next(); !r.done; r = it.next()) {
      const t = r.value;
      if (t.k === "open" && t.name === "si") shared.push(t.self ? "" : readStringItem(it, "si"));
    }
  }

  const styles: Styles = { isDate: [] };
  const stXml = text(relOfType("/styles") ?? `${wbDir}styles.xml`);
  if (stXml) {
    const custom = new Map<number, string>();
    let inXfs = false;
    for (const t of scan(stXml)) {
      if (t.k === "open" && t.name === "numFmt") {
        custom.set(parseInt(t.attrs.numFmtId, 10), t.attrs.formatCode ?? "");
      } else if (t.k === "open" && t.name === "cellXfs") inXfs = !t.self;
      else if (t.k === "close" && t.name === "cellXfs") inXfs = false;
      else if (t.k === "open" && t.name === "xf" && inXfs) {
        const id = parseInt(t.attrs.numFmtId ?? "0", 10) || 0;
        const code = custom.get(id);
        styles.isDate.push(code !== undefined ? isDateFormatCode(code) : BUILTIN_DATE(id));
      }
    }
  }

  const out: XlsxSheet[] = [];
  sheets.forEach((s, i) => {
    const rel = s.id ? rels.get(s.id) : undefined;
    if (rel && !rel.type.endsWith("/worksheet")) return; // chartsheets, dialog sheets
    const path = rel?.path ?? `${wbDir}worksheets/sheet${i + 1}.xml`;
    if (s.hidden) return;
    const xml = text(path);
    if (xml === undefined) return;
    out.push({ name: s.name, rows: readSheet(xml, s.name, shared, styles, date1904) });
  });
  return out;
}

export function toCsv(rows: string[][]): string {
  return rows
    .map((row) => row.map((c) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
}
