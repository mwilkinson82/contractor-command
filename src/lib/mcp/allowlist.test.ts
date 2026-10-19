import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MCP_ALLOWED_EMAILS, ATHENA_REVIEWER_EMAIL } from "./allowlist";

describe("MCP allowlist", () => {
  it("allows Marshall and the reviewer only", () => expect([...MCP_ALLOWED_EMAILS].sort()).toEqual([ATHENA_REVIEWER_EMAIL, "marshall@marshallwilkinson.com"].sort()));
  it("has one source of truth (start.ts imports it)", () => {
    const start = readFileSync("src/start.ts", "utf8");
    expect(start).toContain('from "./lib/mcp/allowlist"');
    expect(start).not.toMatch(/new Set\(\["marshall@/);
  });
  it("seed script uses the same reviewer email and no literal password", () => {
    const seed = readFileSync("scripts/athena-reviewer/seed-reviewer.mjs", "utf8");
    expect(seed).toContain(ATHENA_REVIEWER_EMAIL);
    expect(seed).toMatch(/process\.env/);
    expect(seed).not.toMatch(/password:\s*["'`]/);
  });
});
