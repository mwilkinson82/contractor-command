import { describe, expect, it } from "vitest";
import { encode } from "fast-png";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { writeFileSync } from "node:fs";
import { applicationFixture } from "./fixtures";
import { calculateApplication } from "./model";
import { applicationPdf } from "./pdf";

// The project's renderer declaration covers canvas rendering only; these
// tests use PDF.js's text geometry API instead.
type TextItem = { str: string; transform: number[]; width: number; height: number };
const parseText = getDocument as unknown as (options: { data: Uint8Array; useSystemFonts: boolean; disableWorker: boolean; isEvalSupported: boolean }) => {
  promise: Promise<{ getPage(n: number): Promise<{ getTextContent(): Promise<{ items: (TextItem | { type: string })[] }> }>; destroy(): Promise<void> }>;
};

function logo(width: number, height: number) {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const xx = x / width, yy = y / height;
    const mark = yy > .18 && yy < .82 && (Math.abs(xx - (.5 - (yy - .18) * .4)) < .05 || Math.abs(xx - (.5 + (yy - .18) * .4)) < .05 || (yy > .57 && yy < .65 && xx > .33 && xx < .67));
    data.set(mark ? [255, 255, 255] : [30, 93, 133], (y * width + x) * 3);
  }
  return encode({ width, height, channels: 3, data });
}
function render(companyName: string, dimensions?: [number, number], invalid = false) {
  const body = applicationFixture();
  body.state = "submitted";
  body.number = "SYN-2810-PA-NOV-2026";
  const saved = { application_id: "00000000-0000-4000-8000-000000000003", version: 3, latest_version: 3,
    body, calculation: calculateApplication(body), billing_version: null, recorded_at: "2026-11-03T12:00:00Z", history: [] };
  const before = JSON.stringify(saved);
  const bytes = applicationPdf({ number: "SYN-2810", name: "Synthetic electrical project" }, saved,
    { companyName, ...(dimensions ? { logo: invalid ? new Uint8Array([1, 2, 3]) : logo(...dimensions), logoFormat: "PNG" as const } : {}) });
  expect(JSON.stringify(saved)).toBe(before);
  return bytes;
}
async function header(bytes: Uint8Array) {
  const pdf = await parseText({ data: new Uint8Array(bytes), useSystemFonts: true, disableWorker: true, isEvalSupported: false }).promise;
  try {
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    return content.items.flatMap(item => "str" in item && item.str.trim() && item.transform[5] > 715
      ? [{ text: item.str, x: item.transform[4], y: 792 - item.transform[5], width: item.width, height: item.height }] : []);
  } finally { await pdf.destroy(); }
}

describe("payment PDF brand geometry", () => {
  it.each([
    ["square", 256, 256, 38], ["wide", 1024, 128, 75], ["tall", 128, 1024, 4.75],
  ] as const)("places the company 10pt after the actual %s logo and centers the unit", async (_shape, w, h, renderedWidth) => {
    const bytes = render("ALP Construction", [w, h]);
    const items = await header(bytes);
    const company = items.find(item => item.text === "ALP Construction");
    expect(company).toBeDefined();
    expect(company?.x).toBeCloseTo(40 + renderedWidth + 10, 4);
    expect(company?.y).toBeCloseTo(57.85, 4);
    expect((company?.x ?? 0) + (company?.width ?? 0)).toBeLessThanOrEqual(315);
    const matrix = Buffer.from(bytes).toString("latin1").match(/([\d.]+) 0 0 ([\d.]+) 40\.  ([\d.]+) cm/)
      ?? Buffer.from(bytes).toString("latin1").match(/([\d.]+) 0 0 ([\d.]+) 40\. ([\d.]+) cm/);
    expect(matrix).not.toBeNull();
    if (matrix) {
      expect(Number(matrix[1])).toBeCloseTo(renderedWidth, 4);
      expect(792 - Number(matrix[3]) - Number(matrix[2]) / 2).toBeCloseTo(54, 4);
    }
    if (_shape === "square" && process.env.ATHENA_PAYMENT_LAYOUT_PDF) writeFileSync(process.env.ATHENA_PAYMENT_LAYOUT_PDF, bytes);
  });
  it.each([false, true])("uses the original text origin when logo is absent or invalid (%s)", async invalid => {
    const items = await header(render("ALP Construction", invalid ? [256, 256] : undefined, invalid));
    const company = items.find(item => item.text === "ALP Construction");
    expect(company?.x).toBe(40);
    expect(company?.y).toBe(45);
  });
  it.each([[256, 256], [1024, 128], [128, 1024]] as [number, number][])("bounds and centers wrapped names for a %sx%s logo, retaining full overflow", async (w, h) => {
    const name = "ALP Construction and Industrial Electrical Infrastructure Services ".repeat(4);
    const bytes = render(name, [w, h]);
    const items = await header(bytes);
    const company = items.filter(item => item.x < 315);
    expect(company).toHaveLength(2);
    expect((company[0].y + company[1].y) / 2).toBeCloseTo(57.85, 4);
    for (const line of company) expect(line.x + line.width).toBeLessThanOrEqual(315.01);
    const reference = items.filter(item => item.x >= 327);
    expect(reference.length).toBeGreaterThan(0);
    for (const line of reference) expect(line.x).toBeGreaterThanOrEqual(327);
    expect(Buffer.from(bytes).toString("latin1")).toContain("ADDITIONAL APPLICATION DETAILS");
  });
});