import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sovItemProblems } from "./sov";

type Prop = { type?: string; enum?: string[]; description?: string; items?: { properties?: Record<string, Prop> } };
const manifest = JSON.parse(readFileSync(".lovable/mcp/manifest.json", "utf8")) as { mcp: { tools: { name: string; inputSchema: { properties: Record<string, Prop> } }[] } };
const intake = manifest.mcp.tools.find((tool) => tool.name === "intake")!.inputSchema.properties;

describe("SOV intake schema the AI hosts see", () => {
  it("publishes sov_copy with a description that tells the host when to use the draft", () => {
    expect(intake.sov_copy.enum).toEqual(["official", "draft"]);
    expect(intake.sov_copy.description).toMatch(/"draft"/);
    expect(intake.sov_copy.description).toMatch(/Draft, not official/);
    expect(intake.sov_copy.description).toMatch(/what-if/);
    expect(intake.fee_pct.description).toMatch(/first SOV/);
    expect(intake.sov_lines.items!.properties!.line.description).toMatch(/01\.01 style/);
  });

  it("flags item numbers the SOV report can't build, before anything is saved", () => {
    expect(sovItemProblems(["01.01", "26.06", "03.101"])).toEqual([]);
    expect(sovItemProblems(["1", "Div 1 misc"])).toEqual([
      "Line 1: item numbers use the 01.01 style (division, dot, line).",
      "Line Div 1 misc: item numbers use the 01.01 style (division, dot, line).",
    ]);
  });

  it("checks item numbers at intake ahead of both the official save and the draft copy", () => {
    const src = readFileSync("src/lib/mcp/tools/workflow-tools.ts", "utf8");
    const guard = src.indexOf("sovItemProblems((args.sov_lines");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(src.indexOf('if (args.sov_copy === "draft")'));
    expect(src).toContain(".describe(SOV_COPY_NOTE)");
  });
});
