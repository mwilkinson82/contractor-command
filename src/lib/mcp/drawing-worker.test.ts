import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { Miniflare, Log, LogLevel } from "miniflare";
import { jsPDF } from "jspdf";
import { decode } from "fast-png";
import { PDFDocument } from "pdf-lib";
import { expect, it } from "vitest";

it("imports, reopens and marks up a stored drawing in Workers without native canvas or network access", async () => {
  const root = process.cwd();
  const binary = path.resolve(root, "node_modules/@hyzyla/pdfium/dist/pdfium.wasm");
  const bundle = await build({
    entryPoints: [path.resolve(root, "tests/support/drawing-worker.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    external: ["node:*"],
    plugins: [
      {
        name: "bundled-pdfium",
        setup(plugin) {
          plugin.onResolve({ filter: /^@hyzyla\/pdfium$/ }, () => ({
            path: path.resolve(root, "node_modules/@hyzyla/pdfium/dist/index.esm.browser.js"),
          }));
          plugin.onResolve({ filter: /^@hyzyla\/pdfium\/pdfium.wasm\?module$/ }, () => ({
            path: "./pdfium.wasm",
            external: true,
          }));
        },
      },
    ],
  });
  const workerRoot = path.resolve(root, "output/test-worker");
  const worker = new Miniflare({
    modules: [
      { type: "ESModule", path: `${workerRoot}/entry.mjs`, contents: bundle.outputFiles[0].text },
      { type: "CompiledWasm", path: `${workerRoot}/pdfium.wasm`, contents: await readFile(binary) },
    ],
    compatibilityDate: "2025-09-24",
    compatibilityFlags: ["nodejs_compat"],
    log: new Log(LogLevel.ERROR),
    outboundService: () => {
      throw new Error("Drawing rendering must not call an external service.");
    },
  });
  try {
    const pdf = new jsPDF({ unit: "pt", format: [300, 200], orientation: "landscape" });
    pdf.text("S-100 | Fictional job 2701", 10, 20);
    pdf.setDrawColor("#666666");
    pdf.rect(60, 40, 60, 40);
    const response = await worker.dispatchFetch("https://athena.example.com/test", {
      method: "POST",
      body: pdf.output("arraybuffer"),
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      duplicate: boolean;
      sourceUploads: number;
      selectedPage: number;
      originalUnchanged: boolean;
      distinctVersions: boolean;
      correctParents: boolean;
      dates: string[];
      browserGlobalsAbsent: boolean;
      sourcePng: string;
      markupPng: string;
      markupPdf: string;
      outsidePage: null;
    };
    expect(result).toMatchObject({
      duplicate: true,
      sourceUploads: 1,
      selectedPage: 1,
      originalUnchanged: true,
      distinctVersions: true,
      correctParents: true,
      browserGlobalsAbsent: true,
      outsidePage: null,
    });
    expect(result.dates.every((date) => Number.isFinite(Date.parse(date)))).toBe(true);
    const png = decode(Buffer.from(result.markupPng, "base64"));
    const pixels = { blue: 0, red: 0 };
    for (let index = 0; index < png.data.length; index += png.channels) {
      const [red, green, blue] = png.data.slice(index, index + 3);
      if (blue > 150 && red < 80 && green < 140) pixels.blue++;
      if (red > 150 && green < 90 && blue < 90) pixels.red++;
    }
    expect(pixels.blue).toBeGreaterThan(100);
    expect(pixels.red).toBeGreaterThan(10);
    const output = await PDFDocument.load(Buffer.from(result.markupPdf, "base64"));
    expect(output.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(output.getPage(0).getSize()).toEqual({ width: 1224, height: 792 });
    expect(decode(Buffer.from(result.sourcePng, "base64")).width).toBe(600);
  } finally {
    await worker.dispose();
  }
}, 30000);
