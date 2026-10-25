import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSov, sovItemProblems, sovLineRows } from "./sov";

type Prop = { type?: string; enum?: string[]; description?: string; items?: { properties?: Record<string, Prop> } };
const manifest = JSON.parse(readFileSync(".lovable/mcp/manifest.json", "utf8")) as { mcp: { tools: { name: string; inputSchema: { properties: Record<string, Prop> } }[] } };
const intakeTool = manifest.mcp.tools.find((tool) => tool.name === "intake")! as { description?: string; inputSchema: { properties: Record<string, Prop> } };
const intake = intakeTool.inputSchema.properties;

describe("SOV intake schema the AI hosts see", () => {
  it("publishes sov_copy with a description that tells the host when to use the draft", () => {
    expect(intake.sov_copy.enum).toEqual(["official", "draft"]);
    expect(intake.sov_copy.description).toMatch(/"draft"/);
    expect(intake.sov_copy.description).toMatch(/Draft, not official/);
    expect(intake.sov_copy.description).toMatch(/what-if/);
    expect(intake.fee_pct.description).toMatch(/first SOV/);
    expect(intake.sov_lines.items!.properties!.line.description).toMatch(/01\.01 style/);
    expect(intake.sov_lines.items!.properties!.drawing_number.type).toBe("string");
    expect(intake.sov_copy.description).toMatch(/Never build a draft yourself/);
    expect(intakeTool.description).toMatch(/sov_copy "draft"/);
    expect(intakeTool.description).toMatch(/only after this tool confirms/);
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

  it("returns every official line with drawing, billing, retainage and CPM columns", () => {
    const sov = buildSov([
      { item_no: "01.01", description: "Mobilization", scheduled_value: 25000, spec_section: "01 50 00", drawing_number: "G-001" },
      { item_no: "03.01", description: "Foundations", scheduled_value: 25000 },
    ], 0, 10);
    const rows = sovLineRows(sov, { "01.01": ["A100 Mobilize"] });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ description: "Mobilization", spec_section: "01 50 00", drawing_number: "G-001", scheduled_value: 25000, work_completed_previous: 0, work_completed_this_period: 0, work_completed_to_date: 0, materials_stored_to_date: 0, total_completed_and_stored: 0, pct_complete: 0, balance_to_finish: 25000, retainage: 0, cpm_activities: ["A100 Mobilize"] });
    const billed = sovLineRows(buildSov([{ item_no: "01.01", description: "Mobilization", scheduled_value: 25000 }], 0, 10, { "01.01": { d: 5000, e: 2500 } }));
    expect(billed[0]).toMatchObject({ work_completed_previous: 5000, work_completed_this_period: 2500, work_completed_to_date: 7500, total_completed_and_stored: 7500, pct_complete: 30, balance_to_finish: 17500, retainage: 750 });
    expect(rows[1]).toMatchObject({ drawing_number: null, cpm_activities: [] });
  });
});
