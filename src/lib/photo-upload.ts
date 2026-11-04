import {
  PHOTO_MAX_BYTES,
  photoImageInfo,
  photoQualityProblem,
  sniffPhoto,
  type PhotoImageInfo,
} from "./photo-file";

/**
 * The file as picked on the device, checked the same way the chat save checks it. A photo over the 8 MB limit is the
 * only one that's changed: it is scaled down in the browser to fit, which drops its camera details.
 */
export async function preparePhoto(file: File): Promise<
  | {
      ok: true;
      bytes: Uint8Array;
      ext: "jpg" | "png" | "webp";
      mime: string;
      info: PhotoImageInfo;
      scaled: boolean;
    }
  | { ok: false; text: string }
> {
  let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
  let scaled = false;
  if (bytes.length > PHOTO_MAX_BYTES) {
    const smaller = await shrink(file);
    if (!smaller) return { ok: false, text: "It's over 8 MB and couldn't be made smaller here." };
    bytes = smaller;
    scaled = true;
  }
  const sniffed =
    sniffPhoto(bytes, file.name) ??
    sniffPhoto(bytes, "a.jpg") ??
    sniffPhoto(bytes, "a.png") ??
    sniffPhoto(bytes, "a.webp");
  if (!sniffed) return { ok: false, text: "Use a JPEG, PNG or WebP photo." };
  const info = photoImageInfo(bytes, sniffed.ext);
  const problem = photoQualityProblem(info);
  if (problem || !info)
    return {
      ok: false,
      text: info
        ? `It's only ${info.width} × ${info.height} pixels. Pick the original photo, not a screenshot or preview.`
        : "The file is damaged or incomplete.",
    };
  return { ok: true, bytes, ext: sniffed.ext, mime: sniffed.mime, info, scaled };
}

/** Re-encodes a too-large photo as a JPEG with a long edge of at most 4000 pixels. */
async function shrink(file: File): Promise<Uint8Array | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 4000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.9, 0.8, 0.7]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
      if (blob && blob.size <= PHOTO_MAX_BYTES) return new Uint8Array(await blob.arrayBuffer());
    }
    return null;
  } catch {
    return null;
  }
}
