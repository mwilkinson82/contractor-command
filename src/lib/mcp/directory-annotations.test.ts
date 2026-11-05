import { describe, expect, it } from "vitest";
import mcp from "./index";

// OpenAI's plugin directory and Anthropic's connector directory both review every
// tool's annotations: each tool needs a title and explicit readOnlyHint,
// destructiveHint and openWorldHint booleans. A read tool must never be marked destructive.
type Tool = { name?: string; title?: string; annotations?: Record<string, unknown>; config?: Tool };
const tools = ((mcp as unknown as { tools: Tool[] }).tools ?? []).map((t) => t.config ?? t);

describe("directory listing annotations", () => {
  it("registers tools", () => {
    expect(tools.length).toBeGreaterThan(0);
  });
  it.each(tools.map((t) => [t.name ?? "?", t] as const))("%s has a title and all three hints", (_n, t) => {
    expect(typeof t.title).toBe("string");
    expect((t.title ?? "").trim().length).toBeGreaterThan(0);
    for (const k of ["readOnlyHint", "destructiveHint", "openWorldHint"]) {
      expect(typeof t.annotations?.[k], k).toBe("boolean");
    }
    if (t.annotations?.readOnlyHint === true) expect(t.annotations?.destructiveHint).toBe(false);
  });
  it("tool names are unique and at most 64 characters", () => {
    const names = tools.map((t) => t.name ?? "");
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n.length).toBeLessThanOrEqual(64);
  });
});
