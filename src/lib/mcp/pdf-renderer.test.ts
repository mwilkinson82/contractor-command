import { jsPDF } from "jspdf";
import { decode } from "fast-png";
import { describe, expect, it } from "vitest";
import { renderPdfiumPage } from "./pdf-renderer";

function fixture() {
  const pdf = new jsPDF({ unit: "pt", format: [200, 100], orientation: "landscape" });
  pdf.setFillColor("#1E5FED");
  pdf.rect(10, 10, 30, 30, "F");
  pdf.addPage();
  pdf.setFillColor("#DC2626");
  pdf.rect(10, 10, 30, 30, "F");
  return new Uint8Array(pdf.output("arraybuffer"));
}

describe("bundled PDF renderer", () => {
  it("returns the selected sheet's pixels and leaves the original unchanged", async () => {
    const pdf = fixture();
    const original = pdf.slice();
    const images = await Promise.all([renderPdfiumPage(pdf, 0), renderPdfiumPage(pdf, 1)]);
    const colors = images.map((png) => {
      const image = decode(png!);
      expect(image.width).toBe(400);
      expect(image.height).toBe(200);
      const offset = (30 * image.width + 30) * image.channels;
      return Array.from(image.data.slice(offset, offset + 3));
    });
    const expected = [
      [30, 95, 237],
      [220, 38, 38],
    ];
    // PDF color components are decimal fractions; permit one byte of rounding.
    colors.forEach((color, page) =>
      color.forEach((component, channel) =>
        expect(Math.abs(component - expected[page][channel])).toBeLessThanOrEqual(1),
      ),
    );
    expect(pdf).toEqual(original);
  });

  it("bounds drawing previews and returns null for an absent page", async () => {
    const pdf = new jsPDF({ unit: "pt", format: [3000, 2000], orientation: "landscape" });
    pdf.text("Large test sheet", 20, 30);
    const bytes = new Uint8Array(pdf.output("arraybuffer"));
    const image = decode((await renderPdfiumPage(bytes, 0))!);
    expect(Math.max(image.width, image.height)).toBe(1600);
    expect(await renderPdfiumPage(bytes, 1)).toBeNull();
    expect(await renderPdfiumPage(bytes, -1)).toBeNull();
    expect(await renderPdfiumPage(bytes, 0.5)).toBeNull();
  });

  it("recovers after a malformed PDF rather than blocking later drawings", async () => {
    await expect(renderPdfiumPage(new TextEncoder().encode("not a PDF"), 0)).rejects.toThrow();
    const image = await renderPdfiumPage(fixture(), 0);
    expect(decode(image!).width).toBe(400);
  });
});
