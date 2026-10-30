import { mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ResolvedConfig } from "vite";
import { mcpPluginForNativePaths } from "./mcp-native-paths";

describe("MCP native path adapter", () => {
  it("accepts a slash-normalized Vite root without mutating the shared config", async () => {
    const directory = mkdtempSync(join(tmpdir(), "athena-mcp-path-"));
    try {
      const plugin = mcpPluginForNativePaths();
      const config = { root: directory.replaceAll("\\", "/") } as ResolvedConfig;
      const original = config.root;
      const hook = plugin.configResolved;
      if (typeof hook !== "function") throw new Error("Expected configResolved hook");
      await hook.call({} as never, config);
      expect(plugin.api.mcpEntry).toBe(resolve(directory, "src/lib/mcp/index.ts"));
      expect(config.root).toBe(original);
    } finally {
      rmdirSync(directory);
    }
  });
  it("still rejects routes that escape the project or route directory", () => {
    expect(() => mcpPluginForNativePaths({ routesDir: "../outside" })).toThrow(
      /must resolve under/,
    );
    expect(() =>
      mcpPluginForNativePaths({ routesDir: resolve(process.cwd(), "../sibling") }),
    ).toThrow(/must resolve under/);
    expect(() => mcpPluginForNativePaths({ routeFileName: "../../outside.ts" })).toThrow(
      /must resolve under/,
    );
  });
});
