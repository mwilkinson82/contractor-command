import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: { environment: "node", include: ["tests/mcp-roles/**/*.test.ts"], testTimeout: 120_000, hookTimeout: 120_000 },
});
