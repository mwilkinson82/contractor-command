import { ToolError } from "@lovable.dev/mcp-js";
import { hasInk, renderTile, type Tile } from "./pdf";
import { cropPng } from "./render";
import { type Point, type Shape } from "./geometry";
import type { StoredPage } from "./service";
export function tileForPoint(page: StoredPage, p: Point): Tile {
  const candidates = page.inspection.tiles.filter(
    (t) =>
      p.x >= t.bounds.x &&
      p.y >= t.bounds.y &&
      p.x <= t.bounds.x + t.bounds.width &&
      p.y <= t.bounds.y + t.bounds.height,
  );
  const t = candidates.sort(
    (a, b) =>
      Math.hypot(p.x - a.bounds.x - a.bounds.width / 2, p.y - a.bounds.y - a.bounds.height / 2) -
      Math.hypot(p.x - b.bounds.x - b.bounds.width / 2, p.y - b.bounds.y - b.bounds.height / 2),
  )[0];
  if (!t) throw new ToolError("The point is outside the stored sheet.");
  return t;
}
export async function verifyLocatedShape(page: StoredPage, shape: Shape) {
  const points = [...shape.points, ...(shape.holes ?? []).flat()];
  if (points.length > 200)
    throw new ToolError(
      "Split this geometry into groups of at most 200 vertices for a bounded drawing check.",
    );
  const grouped = new Map<number, Point[]>();
  for (const p of points) {
    const t = tileForPoint(page, p);
    grouped.set(t.index, [...(grouped.get(t.index) ?? []), p]);
  }
  if (grouped.size > 8)
    throw new ToolError(
      "Split this placement into smaller drawing regions so each location can be checked against the sheet.",
    );
  const refs: { tile_index: number; point: Point; edge: number }[] = [];
  for (const [index, locations] of grouped) {
    const tile = page.inspection.tiles[index],
      r = await renderTile(page.bytes, page.page - 1, tile);
    for (const point of locations) {
      if (!hasInk(r.rgba, tile, point))
        throw new ToolError(
          "A supplied pin or vertex falls on blank drawing space. Locate the actual symbol or boundary before saving.",
        );
      refs.push({ tile_index: index, point, edge: 160 });
    }
  }
  return {
    verification: "raster-ink-and-topology",
    source_hash: page.source.content_hash,
    tile_refs: [...grouped.keys()],
    crop_refs: refs,
  };
}
export async function readPointCrop(page: StoredPage, p: Point) {
  const tile = tileForPoint(page, p),
    r = await renderTile(page.bytes, page.page - 1, tile);
  return cropPng(r.png, {
    x: (p.x * tile.pageWidth - tile.x) / tile.width,
    y: (p.y * tile.pageHeight - tile.y) / tile.height,
  });
}
