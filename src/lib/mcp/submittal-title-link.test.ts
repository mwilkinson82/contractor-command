import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Log row titles open the stable submittal record page in every host.
describe("submittal log title links", () => {
  const src = readFileSync("src/lib/mcp/submittals.ts", "utf8");
  it("links the title cell and the markdown title to the record URL", () => {
    expect(src).toContain("linkCell: 1,");
    expect(src).toContain("[${row.title}](${recordUrl})");
    expect(src).toContain("rowLine(row, input.today, submittalRecordUrl(input.boardUrl, row.number))");
  });
  it("renderers honor linkCell and default to the first cell", () => {
    for (const f of ["markdown.ts", "html.ts"]) expect(readFileSync(`src/lib/mcp/cards/${f}`, "utf8")).toMatch(/linkCell \?\? 0/);
    expect(readFileSync("src/lib/mcp/cards/widget.ts", "utf8")).toContain("i===(r.linkCell||0)");
  });
});
