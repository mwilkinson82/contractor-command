import { build } from "esbuild";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
const dir = "output/playwright/payment-applications";
mkdirSync(dir, { recursive: true });
await build({
  entryPoints: ["tests/responsive/payment-application-browser.tsx"],
  outfile: `${dir}/interactive.js`,
  bundle: true,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  plugins: [
    {
      name: "isolated-payment-fixture",
      setup(b) {
        b.onResolve({ filter: /^@\/hooks\/use-auth$/ }, () => ({
          path: "auth",
          namespace: "pa-fixture",
        }));
        b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({
          path: "client",
          namespace: "pa-fixture",
        }));
        b.onResolve({ filter: /BoardSignIn$/ }, () => ({
          path: "signin",
          namespace: "pa-fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "pa-fixture" }, ({ path }) => ({
          loader: "js",
          contents:
            path === "auth"
              ? "export const useAuth=()=>({session:{user:{id:'isolated-browser'}},loading:false});"
              : path === "signin"
                ? "export const BoardSignIn=()=>null;"
                : "export const supabase={rpc:(...args)=>window.__fixtureRpc(...args)};",
        }));
        b.onLoad({ filter: /payment-application-browser\.tsx$/ }, ({ path }) => ({
          loader: "tsx",
          contents: readFileSync(path, "utf8").replace(
            "createRoot(document.getElementById",
            "(window as any).__fixtureRpc=fixtureRpc;\ncreateRoot(document.getElementById",
          ),
        }));
      },
    },
  ],
  logLevel: "warning",
});
writeFileSync(
  `${dir}/interactive.html`,
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/interactive.css"><style>body{margin:0;font:15px/1.5 system-ui,sans-serif}*{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/interactive.js"></script></body></html>',
);
