import { build } from "esbuild";
import path from "node:path";
await build({
  entryPoints: ["tests/purchase-orders/browser/entry.tsx"],
  outfile: "output/playwright/purchase-orders/app.js",
  bundle: true,
  format: "esm",
  jsx: "automatic",
  alias: {
    "@/hooks/use-auth": path.resolve("tests/purchase-orders/browser/auth.ts"),
    "@/integrations/supabase/client": path.resolve("tests/purchase-orders/browser/client.ts"),
    "@": path.resolve("src"),
  },
  plugins: [
    {
      name: "synthetic-auth-screen",
      setup(b) {
        b.onResolve({ filter: /^\.\/BoardSignIn$/ }, () => ({
          path: path.resolve("tests/purchase-orders/browser/sign-in.tsx"),
        }));
      },
    },
  ],
  define: { "process.env.NODE_ENV": '"development"' },
});
await build({
  entryPoints: ["tests/purchase-orders/browser/server.ts"],
  outfile: "output/playwright/purchase-orders/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
