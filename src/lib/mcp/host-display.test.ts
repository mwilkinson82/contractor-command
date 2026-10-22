import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HOST_DISPLAY_BLOCK, VISIBLE_STYLE_LINE, finalizeVisible, visibleProblems, withStyleLine } from "./visible";

const FOOTER = "\n\n---\nAthena powered by ALP, construction agents"; // same as guard.ts FOOTER

describe("host-display block", () => {
  it("goes to hidden guidance, never the visible text", () => {
    const r = finalizeVisible({ content: [{ type: "text", text: "Job 2701" }] }, [HOST_DISPLAY_BLOCK]) as unknown as { content: { text: string }[]; structuredContent: { assistant_guidance: string[] } };
    expect(r.content[0].text).toBe("Job 2701");
    expect(visibleProblems(r.content[0].text)).toEqual([]);
    expect(r.structuredContent.assistant_guidance).toContain(HOST_DISPLAY_BLOCK);
  });
  it("covers verbatim-first cards, the summary offer, the styled default, one caveat and private by default", () => {
    expect(HOST_DISPLAY_BLOCK).toMatch(/Section numbers first, wording unchanged/);
    expect(HOST_DISPLAY_BLOCK).toMatch(/always show them as white cards, never as plain text/);
    expect(HOST_DISPLAY_BLOCK).toMatch(/One card per clause: section number and heading, days, and who it goes to/);
    expect(HOST_DISPLAY_BLOCK).toContain("Do you want me to summarize this legal text so you know what it means in plain English?");
    expect(HOST_DISPLAY_BLOCK).toMatch(/Visual first, by default \(never an opt-in\)/);
    expect(HOST_DISPLAY_BLOCK).toMatch(/Never say Athena built, drew or rendered/);
    expect(HOST_DISPLAY_BLOCK).toMatch(/white cards with light gray panels/);
    expect(HOST_DISPLAY_BLOCK).toMatch(/one plain-English caveat/);
    expect(HOST_DISPLAY_BLOCK).toMatch(/Never publish, share or create a public link/);
    expect(HOST_DISPLAY_BLOCK).not.toMatch(/lovable/i);
  });
  it("one blue accent for charts, KPIs and the action item; no orange, red or amber", () => {
    expect(HOST_DISPLAY_BLOCK).toMatch(/Charts, bars and KPI numbers use blue #2563EB/);
    expect(HOST_DISPLAY_BLOCK).toMatch(/Never orange, terracotta or the host's default chart palette; the alert color only for delays, risks and overdue items/);
    expect(HOST_DISPLAY_BLOCK).toMatch(/Warnings: no amber\. Delays, risks and overdue items get the alert color/);
    expect(HOST_DISPLAY_BLOCK).not.toMatch(/never red|no red/i);
  });
  it("no preview or reworded offer; artifacts use chat data only", () => {
    expect(HOST_DISPLAY_BLOCK).toMatch(/Nothing before or between the clause cards/);
    expect(HOST_DISPLAY_BLOCK).toMatch(/tightest clock/);
    expect(HOST_DISPLAY_BLOCK).toMatch(/Never call Athena \(or any tool\) from inside an artifact/);
  });
  it("a short member-safe style line sits in the visible text, above the footer", () => {
    const r = withStyleLine(finalizeVisible({ content: [{ type: "text", text: "Job 2701" + FOOTER }] }, [HOST_DISPLAY_BLOCK])) as unknown as { content: { text: string }[] };
    expect(r.content[0].text).toBe(`Job 2701\n\n${VISIBLE_STYLE_LINE}\n---\nAthena powered by ALP, construction agents`);
    expect(visibleProblems(r.content[0].text)).toEqual([]);
    expect(VISIBLE_STYLE_LINE).toContain("#1E5FED");
    expect(withStyleLine(r)).toEqual(r);
  });
  it("guard.run appends it to every tool result", () => {
    expect(readFileSync("src/lib/mcp/guard.ts", "utf8")).toMatch(/withStyleLine\(finalizeVisible\([^;]*\[HOST_DISPLAY_BLOCK\]\)\)/);
  });
});
