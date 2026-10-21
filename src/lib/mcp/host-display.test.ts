import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HOST_DISPLAY_BLOCK, finalizeVisible, visibleProblems, withStyleLine } from "./visible";

const FOOTER = "\n\n---\nAthena powered by ALP, construction agents"; // same as guard.ts FOOTER

describe("host-display block", () => {
  it("goes to hidden guidance, never the visible text", () => {
    const r = finalizeVisible({ content: [{ type: "text", text: "Job 2701" }] }, [
      HOST_DISPLAY_BLOCK,
    ]) as unknown as {
      content: { text: string }[];
      structuredContent: { assistant_guidance: string[] };
    };
    expect(r.content[0].text).toBe("Job 2701");
    expect(visibleProblems(r.content[0].text)).toEqual([]);
    expect(r.structuredContent.assistant_guidance).toContain(HOST_DISPLAY_BLOCK);
  });
  it("covers verbatim clauses, the summary offer, and private by default", () => {
    expect(HOST_DISPLAY_BLOCK).toMatch(/section numbers first, wording unchanged/);
    expect(HOST_DISPLAY_BLOCK).toContain(
      "Do you want me to summarize this legal text so you know what it means in plain English?",
    );
    expect(HOST_DISPLAY_BLOCK).toMatch(/Never publish, share or create a public link/);
    expect(HOST_DISPLAY_BLOCK).not.toMatch(/lovable/i);
    expect(HOST_DISPLAY_BLOCK).not.toMatch(/#[0-9A-Fa-f]{3,8}/);
    expect(HOST_DISPLAY_BLOCK).not.toMatch(/Internal guidance|HOUSE STYLE/);
  });
  it("does not restate a palette", () => {
    expect(HOST_DISPLAY_BLOCK).not.toMatch(/#2563EB|orange|terracotta|amber/);
    expect(HOST_DISPLAY_BLOCK).not.toMatch(/never red|no red/i);
  });
  it("does not add a Display line to the visible text", () => {
    const r = withStyleLine(
      finalizeVisible({ content: [{ type: "text", text: "Job 2701" + FOOTER }] }, [
        HOST_DISPLAY_BLOCK,
      ]),
    ) as unknown as { content: { text: string }[] };
    expect(r.content[0].text).toBe("Job 2701" + FOOTER);
    expect(r.content[0].text).not.toMatch(/Display:/);
    expect(visibleProblems(r.content[0].text)).toEqual([]);
  });
  it("guard.run appends it to every tool result", () => {
    expect(readFileSync("src/lib/mcp/guard.ts", "utf8")).toMatch(
      /withStyleLine\(finalizeVisible\([^;]*\[HOST_DISPLAY_BLOCK\]\)\)/,
    );
  });
});
