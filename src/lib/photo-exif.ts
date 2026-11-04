/**
 * Minimal EXIF reader for the photo viewer: camera date, camera make/model, orientation and whether GPS is present.
 * Reads only JPEG APP1 "Exif" blocks. Anything malformed returns what was read so far; it never throws.
 */
export type PhotoExif = {
  taken_at: string | null;
  camera: string | null;
  orientation: number | null;
  has_gps: boolean;
};

const EMPTY: PhotoExif = { taken_at: null, camera: null, orientation: null, has_gps: false };

export function readPhotoExif(bytes: Uint8Array): PhotoExif {
  try {
    return read(bytes);
  } catch {
    return { ...EMPTY };
  }
}

function read(bytes: Uint8Array): PhotoExif {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return { ...EMPTY };
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > bytes.length) break;
    if (marker === 0xe1 && len > 8 && ascii(bytes, i + 4, 6) === "Exif\0\0")
      return tiff(bytes.subarray(i + 10, i + 2 + len));
    i += 2 + len;
  }
  return { ...EMPTY };
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let k = start; k < start + length && k < bytes.length; k++)
    out += String.fromCharCode(bytes[k]);
  return out;
}

function tiff(t: Uint8Array): PhotoExif {
  const out: PhotoExif = { ...EMPTY };
  if (t.length < 8) return out;
  const little = t[0] === 0x49 && t[1] === 0x49;
  if (!little && !(t[0] === 0x4d && t[1] === 0x4d)) return out;
  const u16 = (o: number) =>
    o + 2 > t.length ? 0 : little ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1];
  const u32 = (o: number) =>
    o + 4 > t.length
      ? 0
      : little
        ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24)) >>> 0
        : ((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]) >>> 0;
  const str = (count: number, valueOffset: number) => {
    const at = count <= 4 ? valueOffset : u32(valueOffset);
    const raw = ascii(t, at, count).replace(/\0+$/, "").trim();
    return raw || null;
  };
  const entries = (offset: number) => {
    const list: { tag: number; type: number; count: number; at: number }[] = [];
    if (offset <= 0 || offset + 2 > t.length) return list;
    const n = Math.min(u16(offset), 200);
    for (let k = 0; k < n; k++) {
      const at = offset + 2 + k * 12;
      if (at + 12 > t.length) break;
      list.push({ tag: u16(at), type: u16(at + 2), count: u32(at + 4), at: at + 8 });
    }
    return list;
  };
  let make: string | null = null;
  let model: string | null = null;
  let modified: string | null = null;
  let exifOffset = 0;
  for (const e of entries(u32(4))) {
    if (e.tag === 0x010f && e.type === 2) make = str(e.count, e.at);
    else if (e.tag === 0x0110 && e.type === 2) model = str(e.count, e.at);
    else if (e.tag === 0x0112) out.orientation = u16(e.at) || null;
    else if (e.tag === 0x0132 && e.type === 2) modified = str(e.count, e.at);
    else if (e.tag === 0x8769) exifOffset = u32(e.at);
    else if (e.tag === 0x8825) out.has_gps = u32(e.at) > 0;
  }
  let original: string | null = null;
  for (const e of entries(exifOffset)) {
    if ((e.tag === 0x9003 || e.tag === 0x9004) && e.type === 2 && !original)
      original = str(e.count, e.at);
  }
  out.taken_at = exifDate(original ?? modified);
  const camera = [
    make,
    model && make && model.startsWith(make) ? model.slice(make.length).trim() : model,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  out.camera = camera || null;
  return out;
}

/** "2026:11:03 14:22:05" -> "2026-11-03 14:22:05" (camera local time, no time zone). */
function exifDate(value: string | null): string | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value ?? "");
  if (!m || m[1] === "0000") return null;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}${m[6] ? `:${m[6]}` : ""}`;
}
