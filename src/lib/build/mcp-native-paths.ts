import { resolve } from "node:path";
import { mcpPlugin, type McpPluginOptions } from "@lovable.dev/mcp-js/stacks/tanstack/vite";
import type { Plugin } from "vite";

/** Vite normalizes config.root to '/' on Windows, but the MCP plugin compares it
 * with path.resolve() results using the native separator. Normalize the root
 * passed to that plugin only. Its route containment checks remain unchanged.
 * Remove this adapter once the upstream plugin normalizes both sides itself.
 */
export function mcpPluginForNativePaths(options?: McpPluginOptions): Plugin {
  const plugin = mcpPlugin(options);
  const hook = plugin.configResolved;
  if (typeof hook !== "function")
    throw new Error("Unexpected MCP configResolved hook; review path adapter");
  return {
    ...plugin,
    configResolved(config) {
      return hook.call(this, { ...config, root: resolve(config.root) });
    },
  };
}
