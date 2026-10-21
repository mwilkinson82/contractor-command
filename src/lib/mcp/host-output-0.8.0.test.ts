import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HOST_DISPLAY_BLOCK } from "./visible";

describe("host output rules (0.8.0, v0.7.8 retest fixes)", () => {
  it("contract output keeps the summary offer and folds missing notices into one line", () => {
    expect(HOST_DISPLAY_BLOCK).toContain("Fold any missing or partial notices into one line");
    expect(HOST_DISPLAY_BLOCK).toContain(
      "Do you want me to summarize this legal text so you know what it means in plain English?",
    );
  });
  it("does not teach filler lines or a style recipe", () => {
    expect(HOST_DISPLAY_BLOCK).not.toContain("Pulling up...");
    expect(HOST_DISPLAY_BLOCK).not.toContain("Priority:");
    expect(HOST_DISPLAY_BLOCK).not.toMatch(/#[0-9A-Fa-f]{3,8}/);
  });
  it("SOV columns stay in the short instruction", () => {
    expect(HOST_DISPLAY_BLOCK).toContain("line no., cost code, division");
    const src = readFileSync(new URL("./tools/workflow-tools.ts", import.meta.url), "utf8");
    expect(src).toContain('sov_view: z.enum(["lines", "divisions"])');
    expect(src).toContain("line_items: sovLineRows(sov)");
  });
  it("palette prose is not sent to the host", () => {
    const rule =
      "blue #2563EB and gray only, never orange, rust or the alert color, including totals";
    expect(HOST_DISPLAY_BLOCK).not.toContain(rule);
    const src = readFileSync(new URL("./tools/workflow-tools.ts", import.meta.url), "utf8");
    expect(src).not.toContain(rule);
    expect(src).toContain("color_rule: _colorRule");
    const sov = readFileSync(new URL("./sov.ts", import.meta.url), "utf8");
    expect(sov).toContain(`color_rule: "${rule}"`);
    expect(sov).not.toMatch(/#C8581E|cream/);
  });
});
