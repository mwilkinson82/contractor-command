/**
 * Photo file checks shared by the save tool and the photos page upload: type sniffing, pixel size and whether the
 * whole picture is present. Pure functions, safe in the browser.
 */
const starts = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

export function sniffPhoto(
  bytes: Uint8Array,
  filename: string,
): { ext: "jpg" | "png" | "webp"; mime: string } | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext !== "jpg" && ext !== "jpeg" && ext !== "png" && ext !== "webp") return null;
  if (bytes.length < 12 || bytes.length > PHOTO_MAX_BYTES) return null;
  if ((ext === "jpg" || ext === "jpeg") && starts(bytes, [0xff, 0xd8, 0xff]))
    return { ext: "jpg", mime: "image/jpeg" };
  if (ext === "png" && starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { ext: "png", mime: "image/png" };
  if (
    ext === "webp" &&
    starts(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return { ext: "webp", mime: "image/webp" };
  return null;
}

/** Smallest long edge accepted as an original site photo. Chat previews and model-made copies are far smaller. */
export const PHOTO_MIN_EDGE = 640;

export type PhotoImageInfo = { width: number; height: number };

/**
 * Reads the pixel size from the image structure and confirms the file is a whole picture, not just a valid first few
 * bytes. Returns null for a damaged or incomplete file (for example JPEG bytes with no frame, tables or scan data).
 */
export function photoImageInfo(
  bytes: Uint8Array,
  ext: "jpg" | "png" | "webp",
): PhotoImageInfo | null {
  const u16 = (i: number) => (bytes[i] << 8) | bytes[i + 1];
  const u32 = (i: number) =>
    ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3];
  const le16 = (i: number) => bytes[i] | (bytes[i + 1] << 8);
  const le24 = (i: number) => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
  const ok = (width: number, height: number) =>
    width > 0 && height > 0 ? { width, height } : null;
  if (ext === "jpg") {
    if (!starts(bytes, [0xff, 0xd8])) return null;
    let size: PhotoImageInfo | null = null;
    let i = 2;
    while (i + 3 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = u16(i + 2);
      if (len < 2 || i + 2 + len > bytes.length) return null;
      // Start-of-frame markers carry the pixel size (C4 DHT, C8 JPG and CC DAC are not frames).
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        if (len < 8) return null;
        size = ok(u16(i + 7), u16(i + 5));
      }
      // Start of scan: the picture data follows. A frame must come first and real scan data must follow.
      if (marker === 0xda) return size && bytes.length - (i + 2 + len) >= 64 ? size : null;
      if (marker === 0xd9) return null;
      i += 2 + len;
    }
    return null;
  }
  if (ext === "png") {
    if (bytes.length < 33 || !starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      return null;
    if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR") return null;
    // A whole PNG has image data and ends with IEND.
    const tail = String.fromCharCode(...bytes.subarray(bytes.length - 8, bytes.length - 4));
    if (tail !== "IEND") return null;
    return ok(u32(16), u32(20));
  }
  if (bytes.length < 30 || !starts(bytes, [0x52, 0x49, 0x46, 0x46])) return null;
  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a)
    return ok(le16(26) & 0x3fff, le16(28) & 0x3fff);
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const b = bytes.subarray(21, 25);
    return ok(
      1 + (((b[1] & 0x3f) << 8) | b[0]),
      1 + (((b[3] & 0x0f) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)),
    );
  }
  if (chunk === "VP8X") return ok(1 + le24(24), 1 + le24(27));
  return null;
}

/** Why a stored photo would not be the original, or null when it is fine to keep. */
export function photoQualityProblem(info: PhotoImageInfo | null): string | null {
  if (!info)
    return "The photo file is damaged or incomplete, so it can't be shown. Attach the original photo file again. Nothing was saved.";
  if (Math.max(info.width, info.height) < PHOTO_MIN_EDGE)
    return `This is a small preview (${info.width} × ${info.height} pixels), not the original photo. Attach the original photo file from the phone or camera, unchanged. Nothing was saved.`;
  return null;
}
