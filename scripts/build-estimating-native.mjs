// Build only. This command neither opens a database nor installs dependencies.
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";

await build({
  entryPoints: ["tests/native/estimating-races.ts"],
  outfile: "artifacts/estimating-native/runner.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  plugins: [
    {
      name: "existing-node-verification-inputs",
      setup(builder) {
        builder.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: path.resolve(args.resolveDir, args.path.slice(0, -4)),
          namespace: "text-source",
        }));
        builder.onLoad({ filter: /.*/, namespace: "text-source" }, (args) => ({
          contents: `export default ${JSON.stringify(readFileSync(args.path, "utf8"))};`,
          loader: "js",
        }));
        builder.onResolve({ filter: /^@hyzyla\/pdfium$/ }, () => ({
          path: path.resolve("node_modules/@hyzyla/pdfium/dist/index.esm.browser.js"),
        }));
        builder.onResolve({ filter: /^@hyzyla\/pdfium\/pdfium\.wasm\?module$/ }, () => ({
          path: path.resolve("tests/support/compiled-pdfium-wasm.mjs"),
        }));
      },
    },
  ],
});
