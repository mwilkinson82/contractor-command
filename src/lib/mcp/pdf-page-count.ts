// Bounded PDF page count. Walks the trailer, xref, and page-tree dictionaries only.
// A full pdf-lib parse (pdf-pages.ts) is the small-file fallback and is never
// used on a multi-megabyte drawing. Failure returns null; it does not throw.
import { inflateSync } from "node:zlib";
import { pdfPageCount } from "./pdf-pages";

export const MAX_PDF_PAGES = 10_000;
const SMALL_PDF_BYTES = 4 * 1024 * 1024;
const MAX_WINDOW = 768 * 1024;
const MAX_BUDGET = 1_500_000;

export function normalizePageCount(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^[0-9]+$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isInteger(n) || n < 1 || n > MAX_PDF_PAGES) return null;
  return n;
}

export type PdfRead = (start: number, end: number) => Promise<Uint8Array | null>;

/** Page count from absolute ranges. Null when the trailer cannot be read cheaply. */
export async function pageCountFromSource(size: number, read: PdfRead): Promise<number | null> {
  try {
    if (!Number.isFinite(size) || size < 8 || size > 200 * 1024 * 1024) return null;
    let spent = 0;
    const limited: PdfRead = async (start, end) => {
      const n = end - start;
      if (start < 0 || n <= 0 || n > MAX_WINDOW || spent + n > MAX_BUDGET) return null;
      const bytes = await read(start, end);
      if (!bytes || bytes.byteLength > n) return null;
      spent += bytes.byteLength;
      return bytes;
    };
    return await countPages(size, limited);
  } catch {
    return null;
  }
}

/**
 * Count pages in a buffer already in memory. Large drawings stay on the trailer
 * walk. Small drawings that the trailer walk cannot read fall back to pdf-lib.
 */
export async function boundedPdfPageCount(bytes: Uint8Array): Promise<number | null> {
  const counted = await pageCountFromSource(bytes.byteLength, async (start, end) => {
    if (start < 0 || end > bytes.byteLength || end < start) return null;
    return bytes.subarray(start, end);
  });
  if (counted != null) return counted;
  if (bytes.byteLength > SMALL_PDF_BYTES) return null;
  try {
    return await pdfPageCount(bytes);
  } catch {
    return null;
  }
}

type Atom =
  | { k: "num"; v: number }
  | { k: "ref"; n: number; g: number }
  | { k: "name"; v: string }
  | { k: "dict"; v: Map<string, Atom> }
  | { k: "arr"; v: Atom[] }
  | { k: "skip" };

type Entry =
  | { kind: "plain"; offset: number }
  | { kind: "compressed"; obj: number; index: number };

type XRef = { map: Map<number, Entry>; root: number; prev: number | null; encrypt: boolean };

class Stop extends Error {}

type Cur = { b: Uint8Array; i: number; end: number };

const ws = (c: number) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const delim = (c: number) => ws(c) || "()<>[]{}/%".includes(String.fromCharCode(c));

function indexOfAscii(bytes: Uint8Array, text: string, from = 0): number {
  const n = text.length;
  outer: for (let i = from; i + n <= bytes.length; i++) {
    for (let j = 0; j < n; j++) if (bytes[i + j] !== text.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

function skip(c: Cur) {
  for (;;) {
    while (c.i < c.end && ws(c.b[c.i])) c.i++;
    if (c.b[c.i] !== 37) return;
    while (c.i < c.end && c.b[c.i] !== 10 && c.b[c.i] !== 13) c.i++;
  }
}

function parseNumber(c: Cur): number | null {
  const s = c.i;
  if (c.b[c.i] === 43 || c.b[c.i] === 45) c.i++;
  let digits = false;
  let dot = false;
  while (c.i < c.end) {
    const ch = c.b[c.i];
    if (ch >= 48 && ch <= 57) {
      digits = true;
      c.i++;
      continue;
    }
    if (ch === 46 && !dot) {
      dot = true;
      c.i++;
      continue;
    }
    break;
  }
  if (!digits) {
    c.i = s;
    return null;
  }
  const n = Number(Buffer.from(c.b.subarray(s, c.i)).toString("latin1"));
  return Number.isFinite(n) ? n : null;
}

function parseName(c: Cur): string {
  c.i++;
  let out = "";
  while (c.i < c.end && !delim(c.b[c.i])) {
    if (c.b[c.i] === 35 && c.i + 2 < c.end) {
      const hex = Buffer.from(c.b.subarray(c.i + 1, c.i + 3)).toString("latin1");
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        c.i += 3;
        continue;
      }
    }
    out += String.fromCharCode(c.b[c.i]);
    c.i++;
  }
  return out;
}

function skipString(c: Cur) {
  c.i++;
  let depth = 1;
  while (c.i < c.end && depth > 0) {
    const ch = c.b[c.i++];
    if (ch === 92) {
      c.i++;
      continue;
    }
    if (ch === 40) depth++;
    else if (ch === 41) depth--;
  }
  if (depth !== 0) throw new Stop();
}

function skipHex(c: Cur) {
  c.i++;
  while (c.i < c.end && c.b[c.i] !== 62) c.i++;
  if (c.b[c.i] !== 62) throw new Stop();
  c.i++;
}

function parseAtom(c: Cur, depth: number): Atom {
  if (depth > 8) throw new Stop();
  skip(c);
  if (c.i >= c.end) throw new Stop();
  const ch = c.b[c.i];
  if (ch === 40) {
    skipString(c);
    return { k: "skip" };
  }
  if (ch === 60) {
    if (c.b[c.i + 1] === 60) return { k: "dict", v: parseDict(c, depth) };
    skipHex(c);
    return { k: "skip" };
  }
  if (ch === 91) return { k: "arr", v: parseArray(c, depth) };
  if (ch === 47) return { k: "name", v: parseName(c) };
  if (ch === 43 || ch === 45 || (ch >= 48 && ch <= 57) || ch === 46) {
    const n = parseNumber(c);
    if (n == null) throw new Stop();
    if (Number.isInteger(n)) {
      const mark = c.i;
      skip(c);
      const gen = c.i < c.end && c.b[c.i] >= 48 && c.b[c.i] <= 57 ? parseNumber(c) : null;
      skip(c);
      if (
        gen != null &&
        Number.isInteger(gen) &&
        c.i < c.end &&
        c.b[c.i] === 82 &&
        (c.i + 1 >= c.end || delim(c.b[c.i + 1]))
      ) {
        c.i++;
        return { k: "ref", n, g: gen };
      }
      c.i = mark;
    }
    return { k: "num", v: n };
  }
  if (Buffer.from(c.b.subarray(c.i, c.i + 4)).toString("latin1") === "true") {
    c.i += 4;
    return { k: "name", v: "true" };
  }
  if (Buffer.from(c.b.subarray(c.i, c.i + 5)).toString("latin1") === "false") {
    c.i += 5;
    return { k: "name", v: "false" };
  }
  if (Buffer.from(c.b.subarray(c.i, c.i + 4)).toString("latin1") === "null") {
    c.i += 4;
    return { k: "skip" };
  }
  throw new Stop();
}

function parseArray(c: Cur, depth: number): Atom[] {
  c.i++;
  const out: Atom[] = [];
  for (;;) {
    skip(c);
    if (c.i >= c.end) throw new Stop();
    if (c.b[c.i] === 93) {
      c.i++;
      return out;
    }
    if (out.length > 20_000) throw new Stop();
    out.push(parseAtom(c, depth + 1));
  }
}

function parseDict(c: Cur, depth: number): Map<string, Atom> {
  if (c.b[c.i] !== 60 || c.b[c.i + 1] !== 60) throw new Stop();
  c.i += 2;
  const map = new Map<string, Atom>();
  for (;;) {
    skip(c);
    if (c.i >= c.end) throw new Stop();
    if (c.b[c.i] === 62 && c.b[c.i + 1] === 62) {
      c.i += 2;
      return map;
    }
    if (c.b[c.i] !== 47) throw new Stop();
    const key = parseName(c);
    map.set(key, parseAtom(c, depth + 1));
    if (map.size > 200) throw new Stop();
  }
}

function dictNum(map: Map<string, Atom>, key: string): number | null {
  const v = map.get(key);
  return v?.k === "num" && Number.isFinite(v.v) ? v.v : null;
}

function dictRef(map: Map<string, Atom>, key: string): number | null {
  const v = map.get(key);
  return v?.k === "ref" ? v.n : null;
}

function dictName(map: Map<string, Atom>, key: string): string | null {
  const v = map.get(key);
  return v?.k === "name" ? v.v : null;
}

function dictNums(map: Map<string, Atom>, key: string): number[] | null {
  const v = map.get(key);
  if (v?.k !== "arr" || v.v.some((item) => item.k !== "num")) return null;
  return v.v.map((item) => (item as { k: "num"; v: number }).v);
}

async function windowAt(read: PdfRead, offset: number, size: number, fileSize: number): Promise<Uint8Array | null> {
  if (offset < 0 || offset >= fileSize) return null;
  const end = Math.min(fileSize, offset + size);
  const bytes = await read(offset, end);
  if (!bytes || bytes.byteLength !== end - offset) return null;
  return bytes;
}

function objectHeader(bytes: Uint8Array): number {
  const c: Cur = { b: bytes, i: 0, end: bytes.length };
  skip(c);
  const n = parseNumber(c);
  skip(c);
  const g = parseNumber(c);
  skip(c);
  if (n == null || g == null || Buffer.from(bytes.subarray(c.i, c.i + 3)).toString("latin1") !== "obj")
    throw new Stop();
  c.i += 3;
  skip(c);
  return c.i;
}

function streamBytes(bytes: Uint8Array, dictEnd: number, length: number): Uint8Array | null {
  let i = dictEnd;
  const rel = indexOfAscii(bytes.subarray(i, Math.min(bytes.length, i + 32)), "stream");
  if (rel < 0) return null;
  i += rel + 6;
  if (bytes[i] === 13) i++;
  if (bytes[i] === 10) i++;
  if (i + length > bytes.length) return null;
  return bytes.subarray(i, i + length);
}

async function readObject(
  read: PdfRead,
  fileSize: number,
  offset: number,
  withStream: boolean,
): Promise<{ dict: Map<string, Atom>; stream: Uint8Array | null } | null> {
  const first = await windowAt(read, offset, 24 * 1024, fileSize);
  if (!first) return null;
  let dictEnd = 0;
  let dict: Map<string, Atom>;
  try {
    const c: Cur = { b: first, i: objectHeader(first), end: first.length };
    const atom = parseAtom(c, 0);
    if (atom.k !== "dict") return null;
    dict = atom.v;
    dictEnd = c.i;
  } catch {
    return null;
  }
  if (!withStream) return { dict, stream: null };
  const length = dictNum(dict, "Length");
  if (length == null || length < 0 || length > MAX_WINDOW) return null;
  const bytes =
    dictEnd + length + 32 <= first.length ? first : await windowAt(read, offset, dictEnd + length + 32, fileSize);
  if (!bytes) return null;
  let end = dictEnd;
  if (bytes !== first) {
    try {
      const c: Cur = { b: bytes, i: objectHeader(bytes), end: bytes.length };
      const atom = parseAtom(c, 0);
      if (atom.k !== "dict") return null;
      end = c.i;
    } catch {
      return null;
    }
  }
  const stream = streamBytes(bytes, end, length);
  return stream ? { dict, stream } : null;
}

function decodeStream(dict: Map<string, Atom>, stream: Uint8Array): Uint8Array | null {
  const filter = dict.get("Filter");
  let raw = stream;
  if (filter?.k === "name") {
    if (filter.v !== "FlateDecode") return null;
    try {
      raw = inflateSync(stream);
    } catch {
      return null;
    }
  } else if (filter?.k === "arr") {
    if (filter.v.length !== 1 || filter.v[0].k !== "name" || filter.v[0].v !== "FlateDecode") return null;
    try {
      raw = inflateSync(stream);
    } catch {
      return null;
    }
  } else if (filter) return null;
  if (raw.byteLength > MAX_WINDOW) return null;
  const parms = dict.get("DecodeParms");
  const predictor = parms?.k === "dict" ? dictNum(parms.v, "Predictor") : null;
  if (predictor == null || predictor <= 1) return raw;
  if (predictor < 10) return null;
  const columns = parms?.k === "dict" ? dictNum(parms.v, "Columns") : null;
  if (columns == null) return null;
  return pngPredict(raw, columns);
}

function pngPredict(data: Uint8Array, columns: number): Uint8Array | null {
  const rowLen = columns + 1;
  if (columns < 1 || data.length % rowLen !== 0) return null;
  const rows = data.length / rowLen;
  const out = new Uint8Array(rows * columns);
  const prior = new Uint8Array(columns);
  for (let r = 0; r < rows; r++) {
    const filter = data[r * rowLen];
    const src = data.subarray(r * rowLen + 1, (r + 1) * rowLen);
    const dst = out.subarray(r * columns, (r + 1) * columns);
    for (let i = 0; i < columns; i++) {
      const left = i > 0 ? dst[i - 1] : 0;
      const up = prior[i];
      const ul = i > 0 ? prior[i - 1] : 0;
      let v = src[i];
      if (filter === 1) v = (v + left) & 255;
      else if (filter === 2) v = (v + up) & 255;
      else if (filter === 3) v = (v + ((left + up) >> 1)) & 255;
      else if (filter === 4) {
        const p = left + up - ul;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - ul);
        const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
        v = (v + pr) & 255;
      } else if (filter !== 0) return null;
      dst[i] = v;
    }
    prior.set(dst);
  }
  return out;
}

function parseClassic(bytes: Uint8Array): XRef | null {
  const text = Buffer.from(bytes).toString("latin1");
  if (!/^\s*xref\b/.test(text)) return null;
  const trailerAt = text.search(/\btrailer\b/);
  if (trailerAt < 0) return null;
  const map = new Map<number, Entry>();
  const lines = text.slice(0, trailerAt).split(/\r?\n/);
  let line = 0;
  while (line < lines.length && lines[line].trim() !== "xref") line++;
  line++;
  while (line < lines.length) {
    const head = /^(\d+)\s+(\d+)\s*$/.exec(lines[line].trim());
    if (!head) break;
    const start = Number(head[1]);
    const count = Number(head[2]);
    line++;
    for (let n = 0; n < count && line < lines.length; n++, line++) {
      const entry = /^(\d+)\s+(\d+)\s+([nf])/.exec(lines[line].trim());
      if (!entry) return null;
      if (entry[3] === "n") map.set(start + n, { kind: "plain", offset: Number(entry[1]) });
    }
  }
  let dict: Map<string, Atom>;
  try {
    const slice = bytes.subarray(trailerAt);
    const c: Cur = { b: slice, i: 0, end: slice.length };
    skip(c);
    if (Buffer.from(slice.subarray(c.i, c.i + 7)).toString("latin1") !== "trailer") return null;
    c.i += 7;
    skip(c);
    const atom = parseAtom(c, 0);
    if (atom.k !== "dict") return null;
    dict = atom.v;
  } catch {
    return null;
  }
  const root = dictRef(dict, "Root");
  if (root == null) return null;
  const prev = dictNum(dict, "Prev");
  return { map, root, prev: prev == null ? null : prev, encrypt: dict.has("Encrypt") };
}

function be(bytes: Uint8Array, at: number, width: number): number {
  let n = 0;
  for (let i = 0; i < width; i++) n = n * 256 + bytes[at + i];
  return n;
}

function parseXRefStream(dict: Map<string, Atom>, decoded: Uint8Array): XRef | null {
  const size = dictNum(dict, "Size");
  const root = dictRef(dict, "Root");
  const w = dictNums(dict, "W");
  if (size == null || root == null || !w || w.length !== 3 || w.some((n) => !Number.isInteger(n) || n < 0 || n > 8))
    return null;
  const width = w[0] + w[1] + w[2];
  if (width < 1 || decoded.length % width !== 0) return null;
  const index = dictNums(dict, "Index") ?? [0, size];
  if (index.length % 2 !== 0) return null;
  const map = new Map<number, Entry>();
  let row = 0;
  for (let p = 0; p < index.length; p += 2) {
    const first = index[p];
    const count = index[p + 1];
    for (let n = 0; n < count; n++, row++) {
      const at = row * width;
      if (at + width > decoded.length) return null;
      const type = w[0] === 0 ? 1 : be(decoded, at, w[0]);
      const a = w[1] === 0 ? 0 : be(decoded, at + w[0], w[1]);
      const b = w[2] === 0 ? 0 : be(decoded, at + w[0] + w[1], w[2]);
      const id = first + n;
      if (type === 1) map.set(id, { kind: "plain", offset: a });
      else if (type === 2) map.set(id, { kind: "compressed", obj: a, index: b });
    }
  }
  const prev = dictNum(dict, "Prev");
  return { map, root, prev: prev == null ? null : prev, encrypt: dict.has("Encrypt") };
}

async function loadXref(read: PdfRead, fileSize: number, offset: number): Promise<XRef | null> {
  const bytes = await windowAt(read, offset, 256 * 1024, fileSize);
  if (!bytes) return null;
  const classic = parseClassic(bytes);
  if (classic) return classic;
  const obj = await readObject(read, fileSize, offset, true);
  if (!obj?.stream) return null;
  if (dictName(obj.dict, "Type") !== "XRef") return null;
  const decoded = decodeStream(obj.dict, obj.stream);
  if (!decoded) return null;
  return parseXRefStream(obj.dict, decoded);
}

async function mergedXref(read: PdfRead, fileSize: number, start: number): Promise<XRef | null> {
  const layers: XRef[] = [];
  let offset: number | null = start;
  for (let n = 0; n < 6 && offset != null; n++) {
    const xref = await loadXref(read, fileSize, offset);
    if (!xref) return layers.length ? null : null;
    if (xref.encrypt) return { ...xref, encrypt: true };
    layers.push(xref);
    offset = xref.prev;
  }
  const map = new Map<number, Entry>();
  for (let i = layers.length - 1; i >= 0; i--) for (const [id, entry] of layers[i].map) map.set(id, entry);
  return { map, root: layers[0].root, prev: null, encrypt: false };
}

async function compressedAtom(
  read: PdfRead,
  fileSize: number,
  xref: XRef,
  entry: Extract<Entry, { kind: "compressed" }>,
): Promise<Atom | null> {
  const holder = xref.map.get(entry.obj);
  if (!holder || holder.kind !== "plain") return null;
  const obj = await readObject(read, fileSize, holder.offset, true);
  if (!obj?.stream) return null;
  const n = dictNum(obj.dict, "N");
  const first = dictNum(obj.dict, "First");
  if (n == null || first == null || entry.index < 0 || entry.index >= n) return null;
  const decoded = decodeStream(obj.dict, obj.stream);
  if (!decoded || first > decoded.length) return null;
  const c: Cur = { b: decoded, i: 0, end: first };
  let at = -1;
  try {
    for (let i = 0; i < n; i++) {
      skip(c);
      const num = parseNumber(c);
      skip(c);
      const off = parseNumber(c);
      if (num == null || off == null) return null;
      if (i === entry.index) at = first + off;
    }
  } catch {
    return null;
  }
  if (at < 0 || at >= decoded.length) return null;
  try {
    const body: Cur = { b: decoded, i: at, end: decoded.length };
    skip(body);
    return parseAtom(body, 0);
  } catch {
    return null;
  }
}

async function resolveDict(
  read: PdfRead,
  fileSize: number,
  xref: XRef,
  id: number,
): Promise<Map<string, Atom> | null> {
  const entry = xref.map.get(id);
  if (!entry) return null;
  if (entry.kind === "plain") {
    const obj = await readObject(read, fileSize, entry.offset, false);
    return obj?.dict ?? null;
  }
  const atom = await compressedAtom(read, fileSize, xref, entry);
  return atom?.k === "dict" ? atom.v : null;
}

async function countPages(fileSize: number, read: PdfRead): Promise<number | null> {
  let tailStart = Math.max(0, fileSize - 64 * 1024);
  let tail = await read(tailStart, fileSize);
  if (!tail || indexOfAscii(tail, "startxref") < 0) {
    tailStart = Math.max(0, fileSize - 256 * 1024);
    tail = await read(tailStart, fileSize);
  }
  if (!tail || indexOfAscii(tail, "startxref") < 0) {
    tailStart = Math.max(0, fileSize - 1024 * 1024);
    tail = await read(tailStart, fileSize);
  }
  if (!tail) return null;
  const starts: number[] = [];
  let from = 0;
  for (;;) {
    const at = indexOfAscii(tail, "startxref", from);
    if (at < 0) break;
    const c: Cur = { b: tail, i: at + 9, end: tail.length };
    skip(c);
    const n = parseNumber(c);
    if (n != null && Number.isInteger(n)) starts.push(n);
    from = at + 9;
  }
  for (let i = starts.length - 1; i >= 0; i--) {
    const xref = await mergedXref(read, fileSize, starts[i]);
    if (!xref || xref.encrypt) continue;
    const catalog = await resolveDict(read, fileSize, xref, xref.root);
    const pagesId = catalog ? dictRef(catalog, "Pages") : null;
    if (pagesId == null) continue;
    const pages = await resolveDict(read, fileSize, xref, pagesId);
    const count = pages ? dictNum(pages, "Count") : null;
    const normalized = normalizePageCount(count);
    if (normalized != null) return normalized;
  }
  return null;
}
