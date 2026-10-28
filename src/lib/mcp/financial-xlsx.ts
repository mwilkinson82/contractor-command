import { inflateRawSync } from "node:zlib";

const MAX_ENTRIES = 1_000;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_RATIO = 200;
const CONTENT_TYPES_MAX = 128 * 1024;
const U32_MAX = 0xffffffff;
const decoder = new TextDecoder("utf-8", { fatal: true });

// Office XLSX is ZIP/OOXML. Validate its complete central directory and every entry
// before accepting the original; never execute formulas or follow external references.
export function isSafeFinancialXlsx(bytes: Uint8Array): boolean {
  try {
    const b = Buffer.from(bytes);
    if (b.length < 22 || b.readUInt32LE(0) !== 0x04034b50) return false;
    let end = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
      if (b.readUInt32LE(i) === 0x06054b50 && i + 22 + b.readUInt16LE(i + 20) === b.length) {
        end = i;
        break;
      }
    }
    if (end < 0 || b.readUInt16LE(end + 4) !== 0 || b.readUInt16LE(end + 6) !== 0) return false;
    const count = b.readUInt16LE(end + 10);
    const size = b.readUInt32LE(end + 12);
    const offset = b.readUInt32LE(end + 16);
    if (!count || count > MAX_ENTRIES || b.readUInt16LE(end + 8) !== count || offset + size !== end)
      return false;
    const names = new Set<string>();
    const ranges: Array<[number, number]> = [];
    let position = offset;
    let total = 0;
    let contentTypes = "";
    for (let i = 0; i < count; i++) {
      if (position + 46 > end || b.readUInt32LE(position) !== 0x02014b50) return false;
      const flags = b.readUInt16LE(position + 8);
      const method = b.readUInt16LE(position + 10);
      const crc = b.readUInt32LE(position + 16);
      const compressed = b.readUInt32LE(position + 20);
      const uncompressed = b.readUInt32LE(position + 24);
      const nameLen = b.readUInt16LE(position + 28);
      const extraLen = b.readUInt16LE(position + 30);
      const commentLen = b.readUInt16LE(position + 32);
      const disk = b.readUInt16LE(position + 34);
      const local = b.readUInt32LE(position + 42);
      const next = position + 46 + nameLen + extraLen + commentLen;
      if (
        next > end ||
        disk !== 0 ||
        !nameLen ||
        (flags & 0x2041) !== 0 ||
        ![0, 8].includes(method) ||
        [compressed, uncompressed, local].includes(U32_MAX) ||
        uncompressed > MAX_ENTRY_BYTES ||
        (uncompressed > 1024 * 1024 && uncompressed > Math.max(1, compressed) * MAX_RATIO)
      )
        return false;
      if (!safeExtra(b, position + 46 + nameLen, extraLen)) return false;
      const name = decoder.decode(b.subarray(position + 46, position + 46 + nameLen));
      const lower = name.toLowerCase();
      if (
        name.startsWith("/") ||
        name.includes("\\") ||
        name.includes("\0") ||
        name.split("/").some((p) => p === "." || p === "..") ||
        names.has(lower) ||
        /vbaproject|macrosheet|activex|xl\/embeddings\//i.test(name)
      )
        return false;
      names.add(lower);
      total += uncompressed;
      if (
        total > MAX_TOTAL_BYTES ||
        (lower === "[content_types].xml" && uncompressed > CONTENT_TYPES_MAX)
      )
        return false;
      if (
        local + 30 > offset ||
        b.readUInt32LE(local) !== 0x04034b50 ||
        b.readUInt16LE(local + 6) !== flags ||
        b.readUInt16LE(local + 8) !== method
      )
        return false;
      const localNameLen = b.readUInt16LE(local + 26);
      const localExtraLen = b.readUInt16LE(local + 28);
      const body = local + 30 + localNameLen + localExtraLen;
      if (
        body + compressed > offset ||
        !safeExtra(b, local + 30 + localNameLen, localExtraLen) ||
        decoder.decode(b.subarray(local + 30, local + 30 + localNameLen)) !== name
      )
        return false;
      const localCrc = b.readUInt32LE(local + 14),
        localCompressed = b.readUInt32LE(local + 18),
        localUncompressed = b.readUInt32LE(local + 22);
      let rangeEnd = body + compressed;
      if (flags & 8) {
        if (
          ![0, crc].includes(localCrc) ||
          ![0, compressed].includes(localCompressed) ||
          ![0, uncompressed].includes(localUncompressed)
        )
          return false;
        if (rangeEnd + 4 <= offset && b.readUInt32LE(rangeEnd) === 0x08074b50) rangeEnd += 4;
        if (
          rangeEnd + 12 > offset ||
          b.readUInt32LE(rangeEnd) !== crc ||
          b.readUInt32LE(rangeEnd + 4) !== compressed ||
          b.readUInt32LE(rangeEnd + 8) !== uncompressed
        )
          return false;
        rangeEnd += 12;
      } else if (
        localCrc !== crc ||
        localCompressed !== compressed ||
        localUncompressed !== uncompressed
      )
        return false;
      ranges.push([local, rangeEnd]);
      const packed = b.subarray(body, body + compressed);
      const unpacked =
        method === 0
          ? packed
          : inflateRawSync(packed, {
              maxOutputLength: Math.max(1, Math.min(MAX_ENTRY_BYTES, uncompressed + 1)),
            });
      if (unpacked.length !== uncompressed || crc32(unpacked) !== crc) return false;
      if (lower === "[content_types].xml") contentTypes = decoder.decode(unpacked);
      position = next;
    }
    ranges.sort((a, b) => a[0] - b[0]);
    if (ranges.some((r, i) => i > 0 && r[0] < ranges[i - 1][1])) return false;
    return (
      position === end &&
      names.has("[content_types].xml") &&
      names.has("_rels/.rels") &&
      names.has("xl/workbook.xml") &&
      [...names].some((n) => /^xl\/worksheets\/sheet[^/]*\.xml$/.test(n)) &&
      contentTypes.includes(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
      ) &&
      !/macroenabled|vba|macrosheet|activex/i.test(contentTypes)
    );
  } catch {
    return false;
  }
}

function safeExtra(b: Buffer, start: number, length: number): boolean {
  const end = start + length;
  if (end > b.length) return false;
  for (let p = start; p < end; ) {
    if (p + 4 > end) return false;
    const id = b.readUInt16LE(p),
      size = b.readUInt16LE(p + 2);
    if (id === 0x0001 || id === 0x9901 || p + 4 + size > end) return false;
    p += 4 + size;
  }
  return true;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
