import { decode, encode } from "fast-png";
import type { Bounds } from "./geometry";

/** Reference-only copy. The clean target tile and immutable PDF are untouched. */
export function markTargetTile(png: Uint8Array, bounds: Bounds): Uint8Array {
  if (
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    bounds.x + bounds.width > 1.000000001 ||
    bounds.y + bounds.height > 1.000000001
  )
    throw new Error("The target tile needs valid page bounds.");
  const image = decode(png);
  if (image.width > 1600 || image.height > 1600 || image.depth !== 8 || image.channels !== 4)
    throw new Error("The sheet reference needs a bounded RGBA preview.");
  const data = image.data as Uint8Array;
  const left = Math.floor(bounds.x * image.width),
    top = Math.floor(bounds.y * image.height);
  const right = Math.min(image.width - 1, Math.ceil((bounds.x + bounds.width) * image.width) - 1);
  const bottom = Math.min(
    image.height - 1,
    Math.ceil((bounds.y + bounds.height) * image.height) - 1,
  );
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++)
      if (x - left < 3 || right - x < 3 || y - top < 3 || bottom - y < 3)
        data.set([30, 95, 237, 255], (y * image.width + x) * 4);
  return encode({ width: image.width, height: image.height, data, channels: 4, depth: 8 });
}
