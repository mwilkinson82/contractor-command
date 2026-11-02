import path from "node:path";
import type { Plugin } from "vite";

/** Preview runs in Node; deployment retains the Workers compiled-WASM import. */
export function pdfiumWasmPlugin(): Plugin {
  let preview = false;
  let root = process.cwd();
  return {
    name: "athena-pdfium-wasm",
    enforce: "pre",
    configResolved(config) {
      preview = config.command === "serve";
      root = config.root;
    },
    resolveId(source) {
      if (source !== "@hyzyla/pdfium/pdfium.wasm?module") return;
      if (preview) {
        // The existing Node adapter compiles the installed binary once, without
        // fetching it. It never enters the production renderer or Worker bundle.
        return path.resolve(root, "tests/support/compiled-pdfium-wasm.mjs");
      }
      return {
        id: path.resolve(root, "node_modules/@hyzyla/pdfium/dist/pdfium.wasm") + "?module",
        external: true,
      };
    },
  };
}