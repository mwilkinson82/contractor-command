import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(".lovable/mcp/manifest.json", "utf8")) as { mcp: { tools: { name: string; description?: string; inputSchema: { properties: Record<string, { enum?: string[]; description?: string }> } }[] } };
const intake = manifest.mcp.tools.find((tool) => tool.name === "intake")!;

describe("draft SOV is visible to AI hosts", () => {
  it("publishes sov_copy draft with a description, and says saved only after Athena confirms", () => {
    const copy = intake.inputSchema.properties.sov_copy;
    expect(copy.enum).toEqual(["official", "draft"]);
    expect(copy.description).toMatch(/sov_copy "draft"/);
    expect(copy.description).toMatch(/Never build a draft yourself/);
    expect(intake.description).toMatch(/only after this tool confirms/);
    const src = readFileSync("src/lib/mcp/tools/workflow-tools.ts", "utf8");
    expect(src).toContain(".describe(SOV_COPY_NOTE)");
    expect(src).toContain("Saved in Athena (draft copy only");
  });
});
