import { build } from "esbuild";
import { Miniflare, Log, LogLevel } from "miniflare";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const bundle = await build({
  entryPoints: ["tests/support/takeoff-worker.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  external: ["node:*"],
  plugins: [
    {
      name: "pdfium",
      setup(p) {
        p.onResolve({ filter: /^@hyzyla\/pdfium$/ }, () => ({
          path: path.resolve("node_modules/@hyzyla/pdfium/dist/index.esm.browser.js"),
        }));
        p.onResolve({ filter: /^@hyzyla\/pdfium\/pdfium.wasm\?module$/ }, () => ({
          path: "./pdfium.wasm",
          external: true,
        }));
      },
    },
  ],
});
const base = path.resolve("artifacts/takeoff/worker");
const mf = new Miniflare({
  modules: [
    { type: "ESModule", path: base + "/main.mjs", contents: bundle.outputFiles[0].text },
    {
      type: "CompiledWasm",
      path: base + "/pdfium.wasm",
      contents: await readFile("node_modules/@hyzyla/pdfium/dist/pdfium.wasm"),
    },
  ],
  compatibilityDate: "2025-09-24",
  compatibilityFlags: ["nodejs_compat"],
  log: new Log(LogLevel.ERROR),
  outboundService() {
    throw Error("External request forbidden in private verification");
  },
});
const file = process.argv[2];
if (!file)
  throw Error(
    "Usage: node scripts/verify-takeoff-worker.mjs /absolute/path/to/plans.pdf [1-based,page,numbers]",
  );
const pages = (process.argv[3] || "3,15,19").split(",").map((p) => Number(p) - 1);
if (pages.some((p) => !Number.isInteger(p) || p < 0))
  throw Error("Pages must be positive integers");
await mkdir("artifacts/takeoff", { recursive: true });
const hash = (b) => createHash("sha256").update(b).digest("hex");
try {
  const bytes = await readFile(file),
    proof = [];
  for (const page of pages) {
    const r = await mf.dispatchFetch("https://athena.example.com/test?page=" + page, {
      method: "POST",
      body: bytes,
    });
    if (!r.ok) throw Error(await r.text());
    const data = await r.json();
    await writeFile(
      "artifacts/takeoff/ccw-page-" + (page + 1) + "-tile.png",
      Buffer.from(data.png, "base64"),
    );
    delete data.png;
    data.page = page + 1;
    proof.push(data);
    if (
      Math.abs(data.referenceLength - 100) > 0.000001 ||
      data.tile.rawBytes > 4194304 ||
      data.planReference.width > 1600 ||
      data.planReference.height > 1600 ||
      data.hostHandoff !== true ||
      data.backendInference !== false ||
      data.hostFindings !== 0 ||
      data.splitParts !== 4
    )
      throw Error("Worker measurement or bitmap bound failed");
  }
  const result = {
    sourceHash: hash(bytes),
    sourceUnchanged: hash(bytes) === hash(await readFile(file)),
    sheets: proof,
  };
  await writeFile("artifacts/takeoff/worker-proof.json", JSON.stringify(result, null, 2));
  console.log(result);
} finally {
  await mf.dispose();
}
