// Private, deterministic edge-runtime proof. All outbound requests are intercepted.
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare, Log, LogLevel } from "miniflare";
import { PDFDocument } from "pdf-lib";

const root = process.cwd();
const pdf = await PDFDocument.create();
pdf.addPage([100, 100]);
const bytes = await pdf.save();
const requests = [];
const bundle = await build({
  stdin: {
    resolveDir: root,
    contents: `export default { async fetch(request) {
        const { readDrawingBytes } = await import('./src/lib/mcp/drawing-set');
        const status = new URL(request.url).searchParams.get('status') ?? '200';
        try {
          const result = await readDrawingBytes({ filename: 'fictional.pdf', file: {
            file_id: 'fictional-file', download_url: 'https://oaisdmntprbrazilsouth.blob.core.windows.net/fictional/' + status
          }});
          return Response.json({ ok: true, bytes: result.bytes.length });
        } catch (error) { return Response.json({ ok: false, error: error.message }); }
      }};`,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  external: ["node:*"],
  plugins: [
    {
      name: "pdfium",
      setup(plugin) {
        plugin.onResolve({ filter: /^@hyzyla\/pdfium$/ }, () => ({
          path: path.resolve("node_modules/@hyzyla/pdfium/dist/index.esm.browser.js"),
        }));
        plugin.onResolve({ filter: /^@hyzyla\/pdfium\/pdfium.wasm\?module$/ }, () => ({
          path: "./pdfium.wasm",
          external: true,
        }));
      },
    },
  ],
});
const workerRoot = path.join(root, "output/download-worker");
const worker = new Miniflare({
  modules: [
    { type: "ESModule", path: `${workerRoot}/main.mjs`, contents: bundle.outputFiles[0].text },
    {
      type: "CompiledWasm",
      path: `${workerRoot}/pdfium.wasm`,
      contents: await readFile("node_modules/@hyzyla/pdfium/dist/pdfium.wasm"),
    },
  ],
  compatibilityDate: "2025-09-24",
  compatibilityFlags: ["nodejs_compat"],
  log: new Log(LogLevel.ERROR),
  outboundService(request) {
    const url = new URL(request.url);
    assert.equal(url.hostname, "oaisdmntprbrazilsouth.blob.core.windows.net");
    requests.push(url.pathname);
    const status = Number(url.pathname.split("/").at(-1));
    return status === 200
      ? new Response(bytes, { headers: { "content-type": "application/pdf" } })
      : new Response("redirect body", {
          status,
          headers: { location: "https://127.0.0.1/never-fetch" },
        });
  },
});
try {
  for (const status of [200, 301, 302, 303, 307, 308]) {
    const before = requests.length;
    const result = await (
      await worker.dispatchFetch(`https://athena.example.com/?status=${status}`)
    ).json();
    assert.equal(requests.length, before + 1, "each operation makes exactly one request");
    if (status === 200) assert.deepEqual(result, { ok: true, bytes: bytes.length });
    else {
      assert.equal(result.ok, false);
      assert.match(result.error, /redirected to another address/);
      assert.doesNotMatch(result.error, /127\.0\.0\.1|Invalid redirect value/);
    }
  }
  console.log(
    "PASS: real Workers runtime imports the PDF and refuses all five redirects; six intercepted requests, no external network or production storage.",
  );
} finally {
  await worker.dispose();
}
