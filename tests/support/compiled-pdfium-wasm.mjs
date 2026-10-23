// Workers supplies a precompiled WASM import. Node's test runner compiles the
// exact same installed binary here; production never imports this helper.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export default new WebAssembly.Module(readFileSync(require.resolve("@hyzyla/pdfium/pdfium.wasm")));
