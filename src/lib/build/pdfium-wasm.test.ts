import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ResolvedConfig } from "vite";
import { pdfiumWasmPlugin } from "./pdfium-wasm";

function configured(command: "serve" | "build") {
  const plugin = pdfiumWasmPlugin();
  const configure = plugin.configResolved;
  const resolve = plugin.resolveId;
  if (typeof configure !== "function" || typeof resolve !== "function")
    throw new Error("Expected callable PDFium plugin hooks");
  configure.call({} as never, { command, root: process.cwd() } as ResolvedConfig);
  return (source: string) =>
    resolve.call({} as never, source, undefined, { isEntry: false, attributes: {} });
}

describe("PDFium compiled module resolution", () => {
  it("preview supplies the real installed binary as a compiled module", async () => {
    const resolve = configured("serve");
    const resolved = await resolve("@hyzyla/pdfium/pdfium.wasm?module");
    expect(resolved).toBe(path.resolve("tests/support/compiled-pdfium-wasm.mjs"));
    if (typeof resolved !== "string") throw new Error("Expected a Node module path");
    const { default: wasm } = await import(/* @vite-ignore */ resolved);
    expect(wasm).toBeInstanceOf(WebAssembly.Module);
    expect(WebAssembly.Module.exports(wasm).some(({ name }) => name === "FPDF_LoadMemDocument")).toBe(true);
  });

  it("build preserves the external Workers compiled module contract", async () => {
    expect(await configured("build")("@hyzyla/pdfium/pdfium.wasm?module")).toEqual({
      id: path.resolve("node_modules/@hyzyla/pdfium/dist/pdfium.wasm") + "?module",
      external: true,
    });
  });

  it("does not intercept unrelated imports", async () => {
    expect(await configured("serve")("other.wasm?module")).toBeUndefined();
  });
});