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
        const { readDrawingBytes, indexStoredDrawingSet } = await import('./src/lib/mcp/drawing-set');
        if (new URL(request.url).searchParams.get('operation') === 'index') {
          const buffer = await request.arrayBuffer();
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))).map(n=>n.toString(16).padStart(2,'0')).join('');
          let downloads = 0, uploads = 0;
          const path = 'company/job/drawing-fixture/source.pdf';
          const record = { id:'fictional-source', path, filename:'fictional.pdf', storage_bucket:'athena-drawings', source_key:'file:fictional.pdf', content_hash:hash, sheets:['S-100'], version:1 };
          const sb = { storage:{from:(name)=>{ if(name!=='athena-drawings')throw new Error('Wrong bucket'); return {
            download:async()=>{downloads++;return {data:{arrayBuffer:async()=>buffer},error:null}},
            upload:async()=>{uploads++;throw new Error('Unexpected upload')}
          }}},rpc:async(name,args)=>({data:{...args._record,id:record.id,version:1},error:null}) };
          const result = await indexStoredDrawingSet(sb,{company_id:'company',job_id:'job'},{path,filename:record.filename,sheets:record.sheets,record});
          return Response.json({bytes:buffer.byteLength,duplicate:result.duplicate,downloads,uploads,unchanged:result.record.content_hash===hash});
        }
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
  const large = new Uint8Array(17_612_902);
  large.fill(32);
  large.set(bytes);
  const indexed = await (await worker.dispatchFetch("https://athena.example.com/?operation=index", { method: "POST", body: large })).json();
  assert.deepEqual(indexed, { bytes: large.length, duplicate: true, downloads: 1, uploads: 0, unchanged: true });
  console.log(
    "PASS: real Workers runtime imports the PDF, refuses all five redirects and reindexes a 17.6 MB original with one binary read and no upload; no external network or production storage.",
  );
} finally {
  await worker.dispose();
}
