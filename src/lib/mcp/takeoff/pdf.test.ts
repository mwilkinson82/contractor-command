import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { PDFDocument, degrees } from "pdf-lib";
import { inspectSheet, renderTile, tileGrid, tilePoint, hasInk, scaleProposals } from "./pdf";
const fixture = () => {
  const doc = new jsPDF({ unit: "pt", format: [2592, 1728], orientation: "landscape" });
  doc.setFontSize(10);
  doc.text('S-100  SCALE 1/4" = 1\'-0"', 30, 30);
  doc.setFillColor("#1E5FED");
  doc.rect(650, 650, 40, 40, "F");
  doc.setDrawColor("#000000");
  doc.line(30, 100, 200, 100);
  return new Uint8Array(doc.output("arraybuffer"));
};
describe("takeoff PDF inspection and clipped native rendering", () => {
  it("covers a 36×24 page at 200dpi in bounded overlapping tiles", () => {
    const tiles = tileGrid(2592, 1728);
    expect(tiles).toHaveLength(48);
    expect(tiles[0]).toMatchObject({
      x: 0,
      y: 0,
      width: 1024,
      height: 1024,
      pageWidth: 7200,
      pageHeight: 4800,
    });
    expect(tiles.at(-1)!.x + tiles.at(-1)!.width).toBe(7200);
    expect(tiles.at(-1)!.y + tiles.at(-1)!.height).toBe(4800);
    expect(Math.max(...tiles.map((t) => t.width * t.height * 4))).toBe(4194304);
  });
  it("extracts text and vector paths and renders only the requested region", async () => {
    const bytes = fixture(),
      original = bytes.slice(),
      inspection = await inspectSheet(bytes, 0);
    expect(inspection.text).toContain("S-100");
    expect(inspection.objects.some((o) => o.kind === "path" && o.points!.length >= 2)).toBe(true);
    const tile = inspection.tiles.find((t) => t.x === 1792 && t.y === 1792)!;
    const image = await renderTile(bytes, 0, tile);
    const p = { x: 670 / 2592, y: 670 / 1728 };
    expect(hasInk(image.rgba, tile, p)).toBe(true);
    expect(hasInk(image.rgba, tile, { x: 790 / 2592, y: 790 / 1728 })).toBe(false);
    expect(image.rgba).toHaveLength(1024 * 1024 * 4);
    expect(tilePoint(tile, { x: 0.5, y: 0.5 })).toEqual({
      x: (1792 + 512) / 7200,
      y: (1792 + 512) / 4800,
    });
    expect(bytes).toEqual(original);
  });
  it("uses displayed PDF rotation for both metadata and tile geometry", async () => {
    const pdf = await PDFDocument.load(fixture());
    pdf.getPage(0).setRotation(degrees(90));
    const bytes = await pdf.save(),
      inspection = await inspectSheet(bytes, 0);
    expect(inspection.width).toBe(1728);
    expect(inspection.height).toBe(2592);
    expect(inspection.tiles[0].pageWidth).toBe(4800);
    expect(inspection.tiles[0].pageHeight).toBe(7200);
    await expect(renderTile(bytes, 0, inspection.tiles[0])).resolves.toHaveProperty("png");
  });
  it("rejects foreign tile coordinates rather than reading a different region", async () => {
    await expect(renderTile(fixture(), 0, { ...tileGrid(2592, 1728)[0], x: 12 })).rejects.toThrow(
      /does not belong/,
    );
  });
  it("never confirms a title-block scale alone, and refuses NTS", () => {
    expect(scaleProposals('SCALE 1/4" = 1\'-0"')).toEqual([
      { label: '1/4" = 1\'-0"', feet_per_point: 1 / 18, confirmed: false },
    ]);
    expect(scaleProposals('1/4" = 1\'-0" NOT TO SCALE')).toEqual([]);
    expect(scaleProposals('1/4" = 1\'-0" N.T.S.')).toEqual([]);
  });
});
