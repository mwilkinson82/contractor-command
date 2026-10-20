import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HOST_DISPLAY_BLOCK, finalizeVisible, visibleProblems } from "./visible";

describe("host-display block", () => {
  it("goes to hidden guidance, never the visible text", () => {
    const r = finalizeVisible({ content: [{ type: "text", text: "Job 2701" }] }, [HOST_DISPLAY_BLOCK]) as { content: { text: string }[]; structuredContent: { assistant_guidance: string[] } };
    expect(r.content[0].text).toBe("Job 2701");
    expect(visibleProblems(r.content[0].text)).toEqual([]);
    expect(r.structuredContent.assistant_guidance).toContain(HOST_DISPLAY_BLOCK);
  });
  it("covers verbatim-first, the summary offer, the styled default, one caveat and private by default", () => {
    expect(HOST_DISPLAY_BLOCK).toMatch(/section numbers first/);
    expect(HOST_DISPLAY_BLOCK).toContain("Do you want me to summarize this legal text so you know what it means in plain English?");
    expect(HOST_DISPLAY_BLOCK).toMatch(/styled visual by default, never as an opt-in/);
    expect(HOST_DISPLAY_BLOCK).toMatch(/white card background, light gray panels/);
    expect(HOST_DISPLAY_BLOCK).toMatch(/one plain-English caveat/);
    expect(HOST_DISPLAY_BLOCK).toMatch(/Never publish, share or create a public link/);
    expect(HOST_DISPLAY_BLOCK).not.toMatch(/lovable/i);
  });
  it("guard.run appends it to every tool result", () => {
    expect(readFileSync("src/lib/mcp/guard.ts", "utf8")).toMatch(/finalizeVisible\([^;]*\[HOST_DISPLAY_BLOCK\]\)/);
  });
});
