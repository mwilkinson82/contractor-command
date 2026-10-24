import { decode, encode } from "fast-png";
import type { Bounds } from "./geometry";
import type { Tile } from "./pdf";
import type { EngineSnapshot, GeometryRevision } from "./state";

/** Reference-only copy. The clean target tile and immutable PDF are untouched. */
export function assertScopeBounds(bounds: Bounds): void {
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
}
export function pointInScope(point: { x: number; y: number }, bounds: Bounds): boolean {
  return (
    point.x >= bounds.x - 1e-10 &&
    point.y >= bounds.y - 1e-10 &&
    point.x <= bounds.x + bounds.width + 1e-10 &&
    point.y <= bounds.y + bounds.height + 1e-10
  );
}
export function assertReadComplete(
  state: Pick<EngineSnapshot, "passes">,
  row: Pick<GeometryRevision, "source_id" | "page" | "shape" | "evidence">,
): void {
  if (!row.evidence.pass_id) return; // Estimator-placed geometry is reviewed independently.
  const pass = state.passes.find(
    (p) =>
      p.pass_summary.pass_id === row.evidence.pass_id &&
      p.source_id === row.source_id &&
      p.page === row.page,
  );
  if (!pass || pass.pass_summary.complete !== true)
    throw new Error("Finish Athena's sheet read before accepting its partial quantity.");
  if (row.shape.kind === "pins") {
    const area = pass.pass_summary.count_area as
      { confirmed?: boolean; bounds?: Bounds } | undefined;
    if (!area?.confirmed || !area.bounds)
      throw new Error(
        "Confirm a count area and run a new drawing read before accepting this unscoped count.",
      );
    assertScopeBounds(area.bounds);
    if (!row.shape.points.every((p) => pointInScope(p, area.bounds!)))
      throw new Error("A count pin is outside the confirmed area. Reject it before continuing.");
  }
}
export function scopedTarget(rgba: Uint8Array, tile: Tile, bounds: Bounds): Uint8Array {
  assertScopeBounds(bounds);
  const data = rgba.slice();
  for (let y = 0; y < tile.height; y++)
    for (let x = 0; x < tile.width; x++)
      if (
        !pointInScope(
          { x: (tile.x + x) / tile.pageWidth, y: (tile.y + y) / tile.pageHeight },
          bounds,
        )
      )
        data.set([255, 255, 255, 255], (y * tile.width + x) * 4);
  return encode({ width: tile.width, height: tile.height, data, channels: 4, depth: 8 });
}
export function markTargetTile(png: Uint8Array, bounds: Bounds): Uint8Array {
  assertScopeBounds(bounds);
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
