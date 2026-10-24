import { describe, it, expect } from "vitest";
import { decode, encode } from "fast-png";
import { markTargetTile, scopedTarget, assertReadComplete, referenceFootprint } from "./scope";
import { tileGrid } from "./pdf";
import type { EngineSnapshot, GeometryRevision } from "./state";
const png = encode({
  width: 100,
  height: 50,
  data: new Uint8Array(100 * 50 * 4).fill(255),
  channels: 4,
  depth: 8,
});
describe("same-sheet tile footprint", () => {
  it("maps a partly overlapping tile onto a cropped plan reference without moving drawing geometry", () => {
    expect(
      referenceFootprint(
        { x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
        { x: 0.2, y: 0.2, width: 0.4, height: 0.4 },
      ),
    ).toEqual({ x: 0, y: 0, width: 0.5, height: 0.5 });
    expect(() =>
      referenceFootprint(
        { x: 0, y: 0, width: 0.1, height: 0.1 },
        { x: 0.5, y: 0.5, width: 0.2, height: 0.2 },
      ),
    ).toThrow(/overlap/);
  });
  it("masks excluded areas on a separate target copy, preserving source pixels", () => {
    const tile = tileGrid(36, 36)[0],
      rgba = new Uint8Array(tile.width * tile.height * 4).fill(0);
    const original = rgba.slice();
    const masked = decode(scopedTarget(rgba, tile, { x: 0.5, y: 0, width: 0.5, height: 1 }));
    expect([...masked.data.slice(0, 4)]).toEqual([255, 255, 255, 255]);
    expect([...masked.data.slice((tile.width - 1) * 4, tile.width * 4)]).toEqual([0, 0, 0, 0]);
    expect(rgba).toEqual(original);
  });
  it("blocks acceptance of incomplete or unscoped automatic counts, while permitting reviewed manual pins", () => {
    const row = {
      source_id: "source",
      page: 1,
      shape: { kind: "pins", points: [{ x: 0.2, y: 0.2 }] },
      evidence: { pass_id: "pass" },
    } satisfies Pick<GeometryRevision, "source_id" | "page" | "shape" | "evidence">;
    const state = {
      passes: [
        {
          id: "checkpoint",
          created_at: "2026-10-24T00:00:00Z",
          geometry_revs: [],
          source_id: "source",
          page: 1,
          pass_summary: { pass_id: "pass", complete: false },
        },
      ],
    } as Pick<EngineSnapshot, "passes">;
    expect(() => assertReadComplete(state, row)).toThrow(/partial/);
    state.passes[0].pass_summary.complete = true;
    expect(() => assertReadComplete(state, row)).toThrow(/unscoped/);
    state.passes[0].pass_summary.count_area = {
      confirmed: true,
      bounds: { x: 0, y: 0, width: 0.5, height: 0.5 },
    };
    expect(() => assertReadComplete(state, row)).not.toThrow();
    row.shape = { kind: "pins", points: [{ x: 0.8, y: 0.8 }] };
    expect(() => assertReadComplete(state, row)).toThrow(/outside/);
    expect(() => assertReadComplete(state, { ...row, evidence: {} })).not.toThrow();
  });
  it("marks the exact target region on a reference copy and preserves original pixels", () => {
    const original = png.slice();
    const marked = decode(markTargetTile(png, { x: 0.25, y: 0.2, width: 0.5, height: 0.6 }));
    const pixel = (x: number, y: number) => [
      ...marked.data.slice((y * 100 + x) * 4, (y * 100 + x) * 4 + 4),
    ];
    expect(pixel(25, 10)).toEqual([30, 95, 237, 255]);
    expect(pixel(74, 39)).toEqual([30, 95, 237, 255]);
    expect(pixel(50, 25)).toEqual([255, 255, 255, 255]);
    expect(pixel(20, 10)).toEqual([255, 255, 255, 255]);
    expect(png).toEqual(original);
  });
  it.each([
    { x: -0.1, y: 0, width: 0.5, height: 0.5 },
    { x: 0.8, y: 0, width: 0.5, height: 0.5 },
  ])("rejects a frame outside the source: %j", (bounds) => {
    expect(() => markTargetTile(png, bounds)).toThrow(/page bounds/);
  });
});
