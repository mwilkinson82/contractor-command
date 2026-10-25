import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(".lovable/mcp/manifest.json", "utf8")) as { mcp: { tools: { name: string; description?: string; inputSchema: { properties: Record<string, { enum?: string[]; description?: string }> } }[] } };
const intake = manifest.mcp.tools.find((t) => t.name === "intake")!;

describe("intake sov_copy draft", () => {
  it("publishes sov_copy draft and says saved only after Athena confirms, in one tool sentence", () => {
    expect(intake.inputSchema.properties.sov_copy.enum).toEqual(["official", "draft"]);
    expect(intake.inputSchema.properties.sov_copy.description).toBeUndefined();
    expect(intake.description).toMatch(/sov_copy set to "draft"/);
    // Grok Bot read "call it with sov_copy" as a tool name and called a missing sov_copy tool.
    expect(intake.description).toMatch(/not a separate tool/);
    expect(intake.description).not.toMatch(/call it with sov_copy/);
    expect(intake.description).toMatch(/never build one yourself/);
    expect(intake.description).toMatch(/say saved only after it returns "Saved in Athena"/);
    const src = readFileSync("src/lib/mcp/tools/workflow-tools.ts", "utf8");
    expect(src).toContain(intake.description!.replace(/"/g, '\\"'));
    expect(src).toContain("Saved in Athena (draft copy only");
  });
});

