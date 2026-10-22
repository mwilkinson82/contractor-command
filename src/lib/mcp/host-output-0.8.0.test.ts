import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HOST_DISPLAY_BLOCK } from "./visible";

describe("host output rules (0.8.0, v0.7.8 retest fixes)", () => {
  it("contract output ends with the exact offer, missing notices folded into one line before it", () => {
    expect(HOST_DISPLAY_BLOCK).toContain("Incomplete terms and the summary question are already inside that card. Nothing after the card.");
  });
  it("bans no-change lines and filler openers", () => {
    expect(HOST_DISPLAY_BLOCK).toContain('Never write \"No changes were made\", \"No items were changed\"');
    expect(HOST_DISPLAY_BLOCK).toContain('\"Pulling up...\"');
  });
  it("dashboards: one caveat line, no Priority block", () => {
    expect(HOST_DISPLAY_BLOCK).toContain('one caveat line at most and never a \"Priority:\" block');
  });
  it("Claude pastes the markdown card in the chat and does not re-read Athena", () => {
    expect(HOST_DISPLAY_BLOCK).toContain("In Claude, paste the styled markdown card into the chat answer itself, exactly as written. Never an artifact or a link.");
    expect(HOST_DISPLAY_BLOCK).toContain("Never call Athena (or any tool) from inside an artifact.");
    expect(HOST_DISPLAY_BLOCK).toContain("Do not rebuild the card as an artifact, and do not re-read Athena.");
  });
  it("SOV is a spreadsheet, line-item view by default", () => {
    expect(HOST_DISPLAY_BLOCK).toContain("present it as a spreadsheet, line-item view by default");
    const src = readFileSync(new URL("./tools/workflow-tools.ts", import.meta.url), "utf8");
    expect(src).toContain('sov_view: z.enum(["lines", "divisions"])');
    expect(src).toContain("line_items: sovLineRows(sov)");
  });
  it("color rule covers charts, tables, totals and highlights everywhere they are styled", () => {
    const rule = "blue #2563EB and gray only, never orange, rust or the alert color, including totals";
    expect(HOST_DISPLAY_BLOCK).toContain(`Charts, tables, totals and highlights: ${rule}`);
    const src = readFileSync(new URL("./tools/workflow-tools.ts", import.meta.url), "utf8");
    expect(src).toContain(`${rule}`);
    const sov = readFileSync(new URL("./sov.ts", import.meta.url), "utf8");
    expect(sov).toContain(`color_rule: "${rule}"`);
    expect(sov).not.toMatch(/#C8581E|cream/);
  });
});
