import { describe, it, expect } from "vitest";
import { decode, encode } from "fast-png";
import { markTargetTile } from "./scope";
const png = encode({
  width: 100,
  height: 50,
  data: new Uint8Array(100 * 50 * 4).fill(255),
  channels: 4,
  depth: 8,
});
describe("same-sheet tile footprint", () => {
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
