/** Optional reproducible visual fixtures, never production data or a live-host pass. */
import { it, expect } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { buildSubmittalPdf, type PackageContext } from "./submittal-package";
import { presentSubmittalLog } from "./submittals";
import { renderHtml } from "./cards/html";
import { nativeCardHtml } from "./cards/native";
import { paletteViolations } from "./cards/palette";
it("renders a complete submittal cover and every row through the real native resource", async () => {
  const ctx: PackageContext = {
    job_number: "2701",
    job_name: "Fictional verification only",
    today: "2026-10-23",
    transmittal_number: 27,
    fingerprint: "fixture",
    package: null,
    brand: {
      name: "EXAMPLE CONSTRUCTION",
      contact_phone: "555-0100",
      website: "example.com",
      license_number: "SAMPLE-2701",
    },
    submittal: {
      id: "fictional-submittal",
      company_id: "fictional-company",
      job_id: "fictional-job",
      number: "26 24 16-001",
      revision: 1,
      transmittal_number: 27,
      spec_section: "26 24 16",
      title: "Switchgear product data and shop drawings",
      submittal_type: "product_data",
      status: "in_prep",
      source: "user",
      required: true,
      ball_in_court: "gc",
      ball_in_court_name: "Fictional PM",
      required_by: "2026-10-20",
    },
    items: [
      {
        id: "fictional-cut",
        kind: "product_cut",
        source_party: "Example Manufacturer",
        status: "received",
        required: true,
        file_ref:
          "athena-submittals/fictional-company/fictional-job/pieces/sample/product-data.pdf",
      },
      {
        id: "fictional-shop",
        kind: "shop_drawing",
        source_party: "Example Electrical",
        status: "received",
        required: true,
        file_ref: "athena-submittals/fictional-company/fictional-job/pieces/sample/shop.pdf",
      },
    ],
  };
  const original = await PDFDocument.create(),
    font = await original.embedFont(StandardFonts.Helvetica);
  const page = original.addPage([612, 792]);
  page.drawText("FICTIONAL SOURCE ORIGINAL", {
    x: 50,
    y: 730,
    size: 20,
    font,
    color: rgb(0.118, 0.227, 0.373),
  });
  page.drawText("Product data / shop drawing. pat@example.com", { x: 50, y: 690, size: 12, font });
  const source = await original.save();
  const built = await buildSubmittalPdf(
    ctx,
    ctx.items.map((item, i) => ({
      item,
      name: i ? "shop.pdf" : "product-data.pdf",
      bytes: source,
    })),
  );
  const rows = [
    ctx.submittal,
    {
      ...ctx.submittal,
      id: "fictional-second",
      number: "26 51 00-001",
      transmittal_number: 28,
      title: "Light fixture product data",
      spec_section: "26 51 00",
      revision: 0,
      required_by: "2026-11-04",
    },
  ];
  const card = presentSubmittalLog({
    jobNumber: ctx.job_number,
    jobName: ctx.job_name,
    rows,
    today: ctx.today,
    boardUrl: null,
  }).card;
  const html = renderHtml(card);
  expect(paletteViolations(html, true)).toEqual([]);
  expect(html).toContain("T-27");
  expect(html).toContain("Overdue");
  expect(built.pageCount).toBe(3);
  expect(built.manifest.every((m) => m.sha256 === built.manifest[0].sha256)).toBe(true);
  const dir = process.env.ATHENA_RENDER_PROOF_DIR;
  if (dir) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "submittal-package.pdf"), built.bytes);
    await writeFile(join(dir, "source-original.pdf"), source);
    await writeFile(join(dir, "manifest.json"), JSON.stringify(built.manifest, null, 2));
    const payload = JSON.stringify({ structuredContent: { card, html } }).replace(/</g, "\\u003c");
    const frame = nativeCardHtml();
    const panels = [
      ["Desktop / light", 680, "#f3f4f6"],
      ["Phone / light", 390, "#f3f4f6"],
      ["Desktop / dark host", 680, "#111827"],
      ["Phone / dark host", 390, "#111827"],
    ] as const;
    const harness = `<!doctype html><html><head><title>Athena submittals local render proof</title><style>body{font:14px system-ui;margin:20px;background:#f3f4f6;color:#1e3a5f}.grid{display:grid;grid-template-columns:740px 440px;gap:24px}.panel{padding:18px;border-radius:12px}h1{font-size:22px}iframe{border:0;background:white;height:650px}</style></head><body><h1>LOCAL HARNESS — FICTIONAL DATA — not a live Claude or ChatGPT pass</h1><p>Actual native resource, initialized by a local host with server-generated submittal data.</p><div class="grid">${panels.map(([label, width, bg]) => `<section class="panel" style="background:${bg}"><h2 style="color:${bg === "#111827" ? "white" : "#1e3a5f"}">${label}</h2><iframe title="${label}" sandbox="allow-scripts" style="width:${width}px" srcdoc="${frame.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></iframe></section>`).join("")}</div><script>const output=${payload};window.addEventListener('message',event=>{const frame=Array.from(document.querySelectorAll('iframe')).find(f=>f.contentWindow===event.source);if(!frame)return;const m=event.data;if(m?.method==='ui/initialize')event.source.postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2026-01-26'}},'*');if(m?.method==='ui/notifications/initialized')event.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:output},'*');});</script></body></html>`;
    await writeFile(join(dir, "index.html"), harness);
  }
});
