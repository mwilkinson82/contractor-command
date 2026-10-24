import { describe, it, expect } from "vitest";
import { PDFDocument, degrees, rgb } from "pdf-lib";
import { decode } from "fast-png";
import { inspectSheet } from "./pdf";
import { measuredPdf, highlightedPreview, displayToPdf, cropPng } from "./render";
import type { StoredPage } from "./service";
import type { EngineSnapshot, GeometryRevision } from "./state";
async function fixture(rotation = 0) {
  const d = await PDFDocument.create(),
    p = d.addPage([720, 360]);
  p.setRotation(degrees(rotation));
  p.drawRectangle({
    x: 100,
    y: 100,
    width: 400,
    height: 100,
    borderColor: rgb(0.4, 0.4, 0.4),
    borderWidth: 1,
  });
  const bytes = await d.save(),
    inspection = await inspectSheet(bytes, 0);
  const page = {
    source: { id: "source", filename: "Fictional.pdf", version: 1, content_hash: "a".repeat(64) },
    page: 1,
    sheet: "S-100",
    space: {
      source_id: "source",
      source_hash: "a".repeat(64),
      page: 1,
      width: inspection.width,
      height: inspection.height,
    },
    inspection,
    bytes,
  } as StoredPage;
  const row = {
    id: "rev-1",
    geometry_id: "geometry",
    version: 1,
    line_id: "line",
    source_id: "source",
    page: 1,
    calibration_id: null,
    shape: {
      kind: "pins",
      points: [
        { x: 0.25, y: 0.3 },
        { x: 0.5, y: 0.6 },
      ],
    },
    status: "accepted",
    measured: 2,
    unit: "EA",
    created_at: "2026-10-23T00:00:00Z",
  } as GeometryRevision;
  const state = {
    lines: [{ id: "line", line_no: 1, item: "Fictional fixtures" }],
    geometry: [row],
    passes: [],
    calibrations: [],
    available: true,
    takeoff_version: 1,
  } as unknown as EngineSnapshot;
  return { page, state };
}
describe("one geometry record drives all derived outputs", () => {
  it.each([0, 90, 180, 270])(
    "renders the actual original sheet at rotation %s with a dated revision key",
    async (r) => {
      const { page, state } = await fixture(r),
        before = page.bytes.slice(),
        pdf = await measuredPdf(page, state, "2026-10-23T12:00:00Z"),
        doc = await PDFDocument.load(pdf);
      expect(doc.getPageCount()).toBe(2);
      expect(doc.getPage(0).getRotation().angle).toBe(r);
      expect(page.bytes).toEqual(before);
      const key = await inspectSheet(pdf, 1);
      expect(key.text).toContain("rev-1");
      expect(key.text).toContain("Original unchanged");
      expect(key.text).toContain("2.0000 EA");
      const png = await highlightedPreview(page, state);
      expect(png).not.toBeNull();
      const image = decode(png!);
      for (const p of [
        { x: 0.25, y: 0.3 },
        { x: 0.5, y: 0.6 },
      ]) {
        const i =
          (Math.round(p.y * image.height) * image.width + Math.round(p.x * image.width)) *
          image.channels;
        expect(Number(image.data[i + 2])).toBeGreaterThan(Number(image.data[i]));
      }
    },
  );
  it("derives a 160px review crop and retains the original raster", async () => {
    const { page, state } = await fixture();
    const png = (await highlightedPreview(page, state))!,
      before = png.slice(),
      crop = cropPng(png, { x: 0.25, y: 0.3 });
    expect(decode(crop).width).toBe(160);
    expect(decode(crop).height).toBe(160);
    expect(png).toEqual(before);
  });
  it("uses the displayed rotation when mapping a corner to PDF coordinates", async () => {
    const d = await PDFDocument.create(),
      p = d.addPage([720, 360]);
    p.setRotation(degrees(90));
    expect(displayToPdf(p, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(displayToPdf(p, { x: 1, y: 1 })).toEqual({ x: 720, y: 360 });
  });
});
