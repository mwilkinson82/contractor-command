// A member's own photo for the client page. Any phone picture works: the browser shrinks it to a small square JPEG
// before upload, so the only checks here are that it's a picture and not huge.
export const PHOTO_RULE =
  "A clear picture of your face. JPG, PNG, WebP or iPhone photos, up to 20 MB.";
const MAX_BYTES = 20 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export function checkPhotoFile(file: {
  size: number;
  type: string;
}): { ok: true } | { ok: false; error: string } {
  if (!TYPES.has(file.type.toLowerCase()))
    return {
      ok: false,
      error: "That isn't a picture we can use. Choose a JPG, PNG, WebP or iPhone photo.",
    };
  if (file.size < 1 || file.size > MAX_BYTES)
    return { ok: false, error: "That picture is over 20 MB. Choose a smaller one." };
  return { ok: true };
}
