import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// `const rpc = supabase.rpc as ...` copies the method off the client, so a
// later `rpc(...)` runs without `this` and throws "Cannot read properties of
// undefined (reading 'rest')". Bind it, or call it as `(supabase.rpc as X)(...)`.
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });

describe("supabase.rpc stays bound to the client", () => {
  it("no source file assigns supabase.rpc without binding it", () => {
    const unbound = files(join(process.cwd(), "src")).filter((path) =>
      /=\s*supabase\.rpc\s+as\b/.test(readFileSync(path, "utf8")),
    );
    expect(unbound).toEqual([]);
  });
});
