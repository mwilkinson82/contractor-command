import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: [
      {
        find: /^@hyzyla\/pdfium$/,
        replacement: path.resolve(
          process.cwd(),
          "node_modules/@hyzyla/pdfium/dist/index.esm.browser.js",
        ),
      },
      {
        find: "@hyzyla/pdfium/pdfium.wasm?module",
        replacement: path.resolve(process.cwd(), "tests/support/compiled-pdfium-wasm.mjs"),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    globals: false,
  },
});
