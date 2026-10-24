import { describe, it, expect } from "vitest";
import { tileGrid } from "./pdf";
import { clipSegment, partitionShape, tileCore, candidateOrder } from "./pass";
import type { StoredPage } from "./service";
const tiles = tileGrid(2592, 1728);
describe("complete bounded sheet coverage", () => {
  it("partitions the whole page without a gap or double length", () => {
    const run = {
      kind: "polyline" as const,
      points: [
        { x: 0, y: 0.2 },
        { x: 1, y: 0.2 },
      ],
    };
    const fragments = tiles.flatMap((t) => partitionShape(run, t, tiles));
    expect(
      fragments.reduce(
        (n, g) => n + Math.hypot(g.points[1].x - g.points[0].x, g.points[1].y - g.points[0].y),
        0,
      ),
    ).toBeCloseTo(1, 10);
  });
  it("assigns an overlap pin to exactly one tile", () => {
    for (const p of [
      { x: 0.13, y: 0.18 },
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0.5, y: 0.5 },
    ])
      expect(
        tiles.flatMap((t) => partitionShape({ kind: "pins", points: [p] }, t, tiles)),
      ).toHaveLength(1);
  });
  it("clips a diagonal without changing its direction or extending it", () => {
    expect(
      clipSegment({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.2, y: 0.2, width: 0.3, height: 0.3 }),
    ).toEqual([
      { x: 0.2, y: 0.2 },
      { x: 0.5, y: 0.5 },
    ]);
    expect(
      clipSegment({ x: 0, y: 0 }, { x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2, width: 0.3, height: 0.3 }),
    ).toBeNull();
  });
  it("prioritizes tag candidates but still reads every tile once", () => {
    const page = {
      inspection: {
        tiles,
        objects: [{ kind: "text", text: "F1 fixture", bounds: tiles.at(-1)!.bounds }],
      },
    } as unknown as StoredPage;
    const order = candidateOrder(page, "F1 fixture");
    expect(order[0]).toBe(tiles.length - 1);
    expect(new Set(order).size).toBe(tiles.length);
    expect([...order].sort((a, b) => a - b)).toEqual(tiles.map((t) => t.index));
  });
  it("does not turn a clipped area into an invented boundary", () => {
    const polygon = {
      kind: "polygon" as const,
      points: [
        { x: 0.12, y: 0.1 },
        { x: 0.14, y: 0.1 },
        { x: 0.14, y: 0.12 },
        { x: 0.12, y: 0.12 },
      ],
    };
    expect(tiles.flatMap((t) => partitionShape(polygon, t, tiles))).toHaveLength(1);
  });
  it("reads every tile covering a confirmed plan region, preserving overlap ownership", () => {
    const page = { inspection: { tiles, objects: [] } } as unknown as StoredPage;
    const region = { x: 0.05, y: 0.73, width: 0.36, height: 0.25 };
    const selected = candidateOrder(page, "Fictional wall", region);
    expect(selected.length).toBeLessThan(tiles.length);
    for (const x of [region.x, region.x + region.width / 2, region.x + region.width])
      for (const y of [region.y, region.y + region.height / 2, region.y + region.height]) {
        const owners = tiles.filter(
          (t) => partitionShape({ kind: "pins", points: [{ x, y }] }, t, tiles).length,
        );
        expect(owners).toHaveLength(1);
        expect(selected).toContain(owners[0].index);
      }
    const run = {
      kind: "polyline" as const,
      points: [
        { x: region.x, y: 0.8 },
        { x: region.x + region.width, y: 0.8 },
      ],
    };
    const length = tiles
      .filter((t) => selected.includes(t.index))
      .flatMap((t) => partitionShape(run, t, tiles))
      .reduce(
        (sum, shape) =>
          sum +
          Math.hypot(shape.points[1].x - shape.points[0].x, shape.points[1].y - shape.points[0].y),
        0,
      );
    expect(length).toBeCloseTo(region.width, 10);
  });
  it("keeps full-sheet coverage when the confirmed region is the whole page", () => {
    const page = { inspection: { tiles, objects: [] } } as unknown as StoredPage;
    expect(
      candidateOrder(page, "Fictional wall", { x: 0, y: 0, width: 1, height: 1 }),
    ).toHaveLength(tiles.length);
  });
});
