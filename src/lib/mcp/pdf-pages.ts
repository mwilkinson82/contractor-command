// Page count for drawing import. pdf.js legacy constructs DOMMatrix as the
// module loads, and this runtime has no canvas package to polyfill it.
import { inflateSync } from "node:zlib";

type Dict = Map<string, Val>;
type Val = null | boolean | number | string | Val[] | { name: string } | { ref: number } | { dict: Dict; stream?: Uint8Array };

type Loc = { off: number } | { stm: number; idx: number };

class PdfReadError extends Error {}

const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

class Reader {
  i = 0;
  constructor(readonly data: Uint8Array) {}

  skip(): void {
    const d = this.data;
    while (this.i < d.length) {
      const c = d[this.i];
      if (c === 37) {
        while (this.i < d.length && d[this.i] !== 10 && d[this.i] !== 13) this.i++;
        continue;
      }
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 12) {
        this.i++;
        continue;
      }
      break;
    }
  }

  starts(word: string): boolean {
    this.skip();
    for (let k = 0; k < word.length; k++) if (this.data[this.i + k] !== word.charCodeAt(k)) return false;
    const next = this.data[this.i + word.length];
    if (word === "<<" || word === ">>" || word === "[" || word === "]" || word === ">" || word === "<" || word === "/") return true;
    return next === undefined || next === 32 || next === 10 || next === 13 || next === 9 || next === 47 || next === 62 || next === 93 || next === 91;
  }

  take(word: string): boolean {
    if (!this.starts(word)) return false;
    this.i += word.length;
    return true;
  }

  expect(word: string): void {
    if (!this.take(word)) throw new PdfReadError("This PDF could not be read.");
  }

  number(): number {
    this.skip();
    const start = this.i;
    if (this.data[this.i] === 43 || this.data[this.i] === 45) this.i++;
    while (this.data[this.i] >= 48 && this.data[this.i] <= 57) this.i++;
    if (this.data[this.i] === 46) {
      this.i++;
      while (this.data[this.i] >= 48 && this.data[this.i] <= 57) this.i++;
    }
    if (start === this.i) throw new PdfReadError("This PDF could not be read.");
    return Number(text(this.data.subarray(start, this.i)));
  }

  value(): Val {
    this.skip();
    const c = this.data[this.i];
    if (c === 47) return { name: this.name() };
    if (this.take("<<")) return { dict: this.dictBody() };
    if (this.take("[")) return this.array();
    if (this.take("null")) return null;
    if (this.take("true")) return true;
    if (this.take("false")) return false;
    if (c === 40) return this.literal();
    if (c === 60) return this.hex();
    if (c === 45 || c === 43 || (c >= 48 && c <= 57) || c === 46) return this.numberOrRef();
    throw new PdfReadError("This PDF could not be read.");
  }

  private name(): string {
    this.expect("/");
    let out = "";
    const d = this.data;
    while (this.i < d.length) {
      const c = d[this.i];
      if (c === 32 || c === 10 || c === 13 || c === 9 || c === 47 || c === 62 || c === 93 || c === 91 || c === 40 || c === 60 || c === 37) break;
      this.i++;
      if (c === 35 && this.i + 1 < d.length) {
        const hex = text(d.subarray(this.i, this.i + 2));
        this.i += 2;
        out += String.fromCharCode(Number.parseInt(hex, 16));
      } else out += String.fromCharCode(c);
    }
    return out;
  }

  private dictBody(): Dict {
    const dict: Dict = new Map();
    while (!this.take(">>")) {
      this.skip();
      if (this.i >= this.data.length) throw new PdfReadError("This PDF could not be read.");
      const key = this.name();
      dict.set(key, this.value());
    }
    return dict;
  }

  private array(): Val[] {
    const out: Val[] = [];
    while (!this.take("]")) out.push(this.value());
    return out;
  }

  private numberOrRef(): Val {
    const n = this.number();
    const save = this.i;
    this.skip();
    if (this.data[this.i] >= 48 && this.data[this.i] <= 57) {
      const gen = this.number();
      this.skip();
      if (this.data[this.i] === 82 && !isWord(this.data[this.i + 1])) {
        this.i++;
        void gen;
        return { ref: n };
      }
    }
    this.i = save;
    return n;
  }

  private literal(): string {
    this.expect("(");
    let out = "";
    let depth = 1;
    while (this.i < this.data.length && depth) {
      const c = this.data[this.i++];
      if (c === 92) {
        const e = this.data[this.i++];
        if (e === 110) out += "\n";
        else if (e === 114) out += "\r";
        else if (e === 116) out += "\t";
        else if (e >= 48 && e <= 55) {
          let oct = String.fromCharCode(e);
          for (let k = 0; k < 2 && this.data[this.i] >= 48 && this.data[this.i] <= 55; k++) oct += String.fromCharCode(this.data[this.i++]);
          out += String.fromCharCode(Number.parseInt(oct, 8));
        } else out += String.fromCharCode(e);
      } else if (c === 40) {
        depth++;
        out += "(";
      } else if (c === 41) {
        depth--;
        if (depth) out += ")";
      } else out += String.fromCharCode(c);
    }
    return out;
  }

  private hex(): string {
    this.expect("<");
    let hex = "";
    while (this.data[this.i] !== 62 && this.i < this.data.length) {
      const c = this.data[this.i++];
      if (c > 32) hex += String.fromCharCode(c);
    }
    this.expect(">");
    if (hex.length % 2) hex += "0";
    let out = "";
    for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(Number.parseInt(hex.slice(k, k + 2), 16));
    return out;
  }
}

const isWord = (c: number | undefined) => c !== undefined && ((c >= 65 && c <= 90) || (c >= 97 && c <= 122));

const isDict = (v: Val | undefined): v is { dict: Dict; stream?: Uint8Array } =>
  !!v && typeof v === "object" && "dict" in v;

const nameOf = (v: Val | undefined) => (v && typeof v === "object" && "name" in v ? v.name : "");

function lastMarker(data: Uint8Array, word: string): number {
  const n = word.length;
  const start = Math.max(0, data.length - 65536);
  outer: for (let i = data.length - n; i >= start; i--) {
    for (let j = 0; j < n; j++) if (data[i + j] !== word.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

function inflate(raw: Uint8Array): Uint8Array {
  try {
    const out = inflateSync(raw);
    if (out.length > 64 * 1024 * 1024) throw new PdfReadError("This PDF could not be read.");
    return out;
  } catch (err) {
    if (err instanceof PdfReadError) throw err;
    throw new PdfReadError("This PDF could not be read.");
  }
}

function paeth(left: number, up: number, ul: number): number {
  const p = left + up - ul;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - ul);
  if (pa <= pb && pa <= pc) return left;
  return pb <= pc ? up : ul;
}

function unfilter(data: Uint8Array, predictor: number, columns: number): Uint8Array {
  if (!predictor || predictor === 1) return data;
  if (predictor < 10) throw new PdfReadError("This PDF uses an unsupported compression predictor.");
  const stride = columns + 1;
  const rows = Math.floor(data.length / stride);
  const out = new Uint8Array(rows * columns);
  let prev = new Uint8Array(columns);
  for (let r = 0; r < rows; r++) {
    const filter = data[r * stride];
    const row = data.subarray(r * stride + 1, r * stride + 1 + columns);
    const dest = out.subarray(r * columns, (r + 1) * columns);
    for (let i = 0; i < columns; i++) {
      const left = i > 0 ? dest[i - 1] : 0;
      const up = prev[i];
      const ul = i > 0 ? prev[i - 1] : 0;
      const x = row[i];
      if (filter === 1) dest[i] = (x + left) & 255;
      else if (filter === 2) dest[i] = (x + up) & 255;
      else if (filter === 3) dest[i] = (x + ((left + up) >> 1)) & 255;
      else if (filter === 4) dest[i] = (x + paeth(left, up, ul)) & 255;
      else if (filter === 0) dest[i] = x;
      else throw new PdfReadError("This PDF uses an unsupported compression predictor.");
    }
    prev = dest;
  }
  return out;
}

function field(bytes: Uint8Array, at: number, width: number): number {
  let n = 0;
  for (let i = 0; i < width; i++) n = n * 256 + bytes[at + i];
  return n;
}

class PdfFile {
  readonly map = new Map<number, Loc>();
  readonly cache = new Map<number, Val>();
  trailer: Dict = new Map();
  private readonly seenXref = new Set<number>();
  private loading = new Set<number>();

  constructor(readonly data: Uint8Array) {}

  loadXref(offset: number): void {
    if (this.seenXref.has(offset)) return;
    this.seenXref.add(offset);
    const head = text(this.data.subarray(offset, offset + 4));
    if (head === "xref") this.classic(offset);
    else this.streamXref(offset);
  }

  private remember(key: string, value: Val): void {
    if (!this.trailer.has(key)) this.trailer.set(key, value);
  }

  private classic(offset: number): void {
    const r = new Reader(this.data);
    r.i = offset;
    r.expect("xref");
    for (;;) {
      r.skip();
      const c = this.data[r.i];
      if (c < 48 || c > 57) break;
      const start = r.number();
      const count = r.number();
      r.skip();
      for (let n = 0; n < count; n++) {
        const row = this.data.subarray(r.i, r.i + 20);
        r.i += 20;
        const flag = String.fromCharCode(row[17] ?? 0);
        if (flag !== "n") continue;
        const obj = start + n;
        if (!this.map.has(obj)) this.map.set(obj, { off: Number(text(row.subarray(0, 10))) });
      }
    }
    r.expect("trailer");
    const dict = r.value();
    if (!isDict(dict)) throw new PdfReadError("This PDF could not be read.");
    for (const [key, value] of dict.dict) this.remember(key, value);
    const prev = dict.dict.get("Prev");
    if (typeof prev === "number") this.loadXref(prev);
  }

  private streamXref(offset: number): void {
    const obj = this.objectAt(offset);
    if (!isDict(obj) || !obj.stream) throw new PdfReadError("This PDF could not be read.");
    for (const [key, value] of obj.dict) if (key === "Root" || key === "Prev" || key === "Encrypt" || key === "Size") this.remember(key, value);
    const wVal = obj.dict.get("W");
    const w = Array.isArray(wVal) && wVal.every((n) => typeof n === "number") ? (wVal as number[]) : [1, 2, 1];
    const size = obj.dict.get("Size");
    const indexVal = obj.dict.get("Index");
    const index = Array.isArray(indexVal) && indexVal.every((n) => typeof n === "number") ? (indexVal as number[]) : [0, typeof size === "number" ? size : 0];
    const bytes = obj.stream;
    const width = w.reduce((sum, n) => sum + n, 0);
    let p = 0;
    for (let i = 0; i < index.length; i += 2) {
      let objNum = index[i];
      for (let k = 0; k < index[i + 1]; k++, objNum++) {
        const row = bytes.subarray(p, p + width);
        p += width;
        const type = w[0] ? field(row, 0, w[0]) : 1;
        const a = w[1] ? field(row, w[0], w[1]) : 0;
        const b = w[2] ? field(row, w[0] + w[1], w[2]) : 0;
        if (this.map.has(objNum) || type === 0) continue;
        if (type === 1) this.map.set(objNum, { off: a });
        else if (type === 2) this.map.set(objNum, { stm: a, idx: b });
      }
    }
    const prev = obj.dict.get("Prev");
    if (typeof prev === "number") this.loadXref(prev);
  }

  private objectAt(offset: number): Val {
    const r = new Reader(this.data);
    r.i = offset;
    r.number();
    r.number();
    r.expect("obj");
    const value = r.value();
    if (isDict(value) && r.take("stream")) {
      if (this.data[r.i] === 13) r.i++;
      if (this.data[r.i] === 10) r.i++;
      const length = this.streamLength(value.dict);
      const raw = this.data.subarray(r.i, r.i + length);
      value.stream = decodeStream(value.dict, raw);
    }
    return value;
  }

  private streamLength(dict: Dict): number {
    const length = dict.get("Length");
    if (typeof length === "number") return length;
    if (length && typeof length === "object" && "ref" in length) {
      const resolved = this.get(length.ref);
      if (typeof resolved === "number") return resolved;
    }
    throw new PdfReadError("This PDF could not be read.");
  }

  get(num: number): Val {
    const hit = this.cache.get(num);
    if (hit !== undefined) return hit;
    if (this.loading.has(num)) throw new PdfReadError("This PDF could not be read.");
    const loc = this.map.get(num);
    if (!loc) throw new PdfReadError("This PDF is missing a page object.");
    this.loading.add(num);
    try {
      const value = "off" in loc ? this.objectAt(loc.off) : this.fromStream(loc.stm, loc.idx);
      this.cache.set(num, value);
      return value;
    } finally {
      this.loading.delete(num);
    }
  }

  private fromStream(stm: number, idx: number): Val {
    const holder = this.get(stm);
    if (!isDict(holder) || !holder.stream) throw new PdfReadError("This PDF could not be read.");
    const count = holder.dict.get("N");
    const first = holder.dict.get("First");
    if (typeof count !== "number" || typeof first !== "number") throw new PdfReadError("This PDF could not be read.");
    const body = new Reader(holder.stream);
    const pairs: { off: number }[] = [];
    for (let n = 0; n < count; n++) {
      body.number();
      pairs.push({ off: body.number() });
    }
    const at = pairs[idx];
    if (!at) throw new PdfReadError("This PDF is missing a page object.");
    const item = new Reader(holder.stream);
    item.i = first + at.off;
    return item.value();
  }
}

function parmNumber(dict: Dict, key: string): number {
  const parms = dict.get("DecodeParms");
  const record = Array.isArray(parms) ? parms[0] : parms;
  if (!isDict(record)) return 0;
  const value = record.dict.get(key);
  return typeof value === "number" ? value : 0;
}

function filtersOf(dict: Dict): string[] {
  const filter = dict.get("Filter");
  if (!filter) return [];
  if (typeof filter === "object" && "name" in filter) return [filter.name];
  if (Array.isArray(filter)) return filter.map(nameOf).filter(Boolean);
  return [];
}

function decodeStream(dict: Dict, raw: Uint8Array): Uint8Array {
  let data = raw;
  for (const filter of filtersOf(dict)) {
    if (filter === "FlateDecode") data = inflate(data);
    else throw new PdfReadError("This PDF uses an unsupported compression filter.");
  }
  const predictor = parmNumber(dict, "Predictor") || 1;
  if (predictor > 1) {
    const columns = parmNumber(dict, "Columns");
    if (!columns) throw new PdfReadError("This PDF could not be read.");
    data = unfilter(data, predictor, columns);
  }
  return data;
}

function resolve(pdf: PdfFile, value: Val | undefined): Val | undefined {
  if (value && typeof value === "object" && "ref" in value) return pdf.get(value.ref);
  return value;
}

function pageLeaves(pdf: PdfFile, node: Val | undefined, seen: Set<number>): number {
  const resolved = resolve(pdf, node);
  if (!isDict(resolved)) return 0;
  const type = nameOf(resolved.dict.get("Type"));
  if (type === "Page") return 1;
  const kids = resolve(pdf, resolved.dict.get("Kids"));
  if (!Array.isArray(kids)) return 0;
  let count = 0;
  for (const kid of kids) {
    const ref = kid && typeof kid === "object" && "ref" in kid ? kid.ref : -1;
    if (ref >= 0) {
      if (seen.has(ref)) continue;
      seen.add(ref);
    }
    count += pageLeaves(pdf, kid, seen);
  }
  return count;
}

/** Number of pages in a PDF, without loading pdf.js. */
export function pdfPageCount(bytes: Uint8Array): number {
  const at = lastMarker(bytes, "startxref");
  if (at < 0) throw new PdfReadError("This PDF could not be read.");
  const r = new Reader(bytes);
  r.i = at + "startxref".length;
  const pdf = new PdfFile(bytes);
  pdf.loadXref(r.number());
  if (pdf.trailer.has("Encrypt")) throw new PdfReadError("This PDF is encrypted and cannot be indexed.");
  const root = resolve(pdf, pdf.trailer.get("Root"));
  if (!isDict(root)) throw new PdfReadError("This PDF has no catalog.");
  const pages = resolve(pdf, root.dict.get("Pages"));
  if (!isDict(pages)) throw new PdfReadError("This PDF has no pages.");
  const count = resolve(pdf, pages.dict.get("Count"));
  if (typeof count === "number" && Number.isFinite(count) && count >= 1) return Math.trunc(count);
  const walked = pageLeaves(pdf, pages, new Set());
  if (walked >= 1) return walked;
  throw new PdfReadError("This PDF has no pages.");
}
