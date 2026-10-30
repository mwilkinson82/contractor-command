// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { execSync } from "node:child_process";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import path from "node:path";
import { loadEnv } from "vite";
import { mcpPluginForNativePaths } from "./src/lib/build/mcp-native-paths";
import { commitFromEnv, normalizeCommit } from "./src/lib/athena-build";

function gitHeadCommit(): string {
  try {
    return normalizeCommit(
      execSync("git rev-parse HEAD", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2000,
      }),
    );
  } catch {
    return "";
  }
}

const serverEnvMode = process.env.NODE_ENV === "production" ? "production" : "development";
Object.assign(process.env, loadEnv(serverEnvMode, process.cwd(), ""));

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    define: {
      __ATHENA_COMMIT__: JSON.stringify(commitFromEnv(process.env) || gitHeadCommit()),
      __ATHENA_BUILT_AT__: JSON.stringify(new Date().toISOString()),
    },
    plugins: [
      mcpPluginForNativePaths(),
      {
        name: "athena-pdfium-wasm",
        enforce: "pre",
        // Preserve the binary import through Vite. Nitro's Workers preset then
        // emits a compiled WASM module alongside the server, never a public URL.
        resolveId(source: string) {
          if (source !== "@hyzyla/pdfium/pdfium.wasm?module") return;
          return {
            id:
              path.resolve(process.cwd(), "node_modules/@hyzyla/pdfium/dist/pdfium.wasm") +
              "?module",
            external: true,
          };
        },
      },
    ],
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
          find: "entities/lib/decode.js",
          replacement: path.resolve(process.cwd(), "node_modules/entities/lib/decode.js"),
        },
        {
          find: "entities/lib/encode.js",
          replacement: path.resolve(process.cwd(), "node_modules/entities/lib/encode.js"),
        },
        { find: "entities", replacement: path.resolve(process.cwd(), "node_modules/entities") },
      ],
    },
  },
});
