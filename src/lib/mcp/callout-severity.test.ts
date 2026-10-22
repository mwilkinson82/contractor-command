import { readFileSync, readdirSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { renderHtml } from "./cards/html";
import { renderMarkdown } from "./cards/markdown";
import { cardWidgetHtml } from "./cards/widget";
import { paletteViolations } from "./cards/palette";
import { drawingCalloutColor, drawingMarkupCard } from "./drawing-markup";
import { lookaheadModel, type LaItem } from "./styled-views";
import { lookaheadPdf } from "./lookahead-pdf";
import { renderReportBody } from "../report-pages";

const acts = [
  {
    id: "A1000",
    name: "Pour footings",
    start: "2026-10-26",
    finish: "2026-10-30",
    duration: 5,
    total_float: 0,
  },
];
const input = {
  title: "2701 Harbor",
  ref: "LA-TEST",
  start: "2026-10-26",
  end: "2026-11-06",
  today: "2026-10-22",
  dataDate: "2026-10-19",
  acts,
};
const routine: LaItem = {
  action: "Confirm A1000 start on 2026-10-29",
  owner: "Morgan",
  due: "2026-10-26",
  severity: "medium",
};
const model = (items: LaItem[]) => lookaheadModel(input.start, input.end, acts, items, input);
const page = (items: LaItem[]) =>
  renderReportBody({
    page: "lookahead",
    job_number: "2701",
    job_name: "Harbor",
    today: input.today,
    lookahead: { id: "la", start_date: input.start, end_date: input.end },
    report: { found: true, data: { activities: acts } },
    items,
  });

describe("ordinary callouts and real alerts", () => {
  it("keeps an S-100 saved markup reference navy/blue in HTML, markdown and the widget", () => {
    const { card, html } = drawingMarkupCard("S-100", [{ label: "Grid A" }]);
    expect(html).toContain('class="callout"');
    expect(html).toContain("color:#1E3A5F;border-left:4px solid #1E5FED");
    expect(html).not.toContain('data-alert="');
    expect(paletteViolations(html, false)).toEqual([]);
    expect(renderMarkdown(card)).not.toContain("🔴");
    const node = { dataset: {}, innerHTML: "" };
    runInNewContext(cardWidgetHtml().match(/<script>([\s\S]*?)<\/script>/)![1], {
      window: { openai: { toolOutput: { card } } },
      document: { getElementById: () => node },
    });
    expect(node.innerHTML).toContain('class="callout"');
    expect(node.innerHTML).toContain("Callout");
    expect(node.innerHTML).not.toContain("Risk");
    for (const flag of ["risk", "delay", "overdue"] as const) {
      expect(drawingCalloutColor(flag)).toBe("#DC2626");
      expect(drawingMarkupCard("S-100", [{ label: "Actual alert", flag }]).html).toContain(
        `data-alert="${flag}"`,
      );
    }
    expect(drawingCalloutColor()).toBe("#1E5FED");
    expect(
      renderHtml({
        ...card,
        sections: [
          {
            heading: "Mixed",
            kind: "list",
            rows: [
              { cells: ["Routine"], flag: "callout" },
              { cells: ["Storm"], flag: "delay" },
            ],
          },
        ],
      }),
    ).toContain(".callout .flag-head{background:#FFFFFF;color:#1E3A5F");
  });

  it("does not count an ordinary linked item or a date check as a risk", () => {
    const calm = model([routine]);
    expect(calm.flagged).toHaveLength(1);
    expect(calm.counts.risks).toBe(0);
    expect(calm.callouts).toHaveLength(1);
    const four = Array.from({ length: 4 }, (_, i) => ({ ...routine, action: `Follow-up ${i + 1} for A1000` }));
    expect(model(four).callouts).toHaveLength(4);
    expect(page(four)).toContain("Follow-up 4 for A1000");
    expect(page(four)).toContain("OPEN FOLLOW-UPS");
    expect(calm.rows.every((r) => r.cells.every((c) => !c.risk))).toBe(true);
    expect(page([routine])).toContain("border-left:4px solid #1E5FED");
    expect(page([routine])).not.toContain("border-left:4px solid #DC2626");
    for (const item of [
      { ...routine, severity: "high" },
      { ...routine, type: "delay" },
      { ...routine, due: "2026-10-21" },
    ]) {
      expect(model([item]).counts.risks).toBe(1);
      expect(page([item])).toContain("border-left:4px solid #DC2626");
    }
    expect(model([{ ...routine, due: input.today }]).counts.overdue).toBe(0);
  });

  it("keeps the PDF priority line blue for a date check and red for a real alert", () => {
    const pdf = (items: LaItem[]) =>
      Buffer.from(lookaheadPdf({ ...input, items })).toString("latin1");
    const red = (text: string) => (text.match(/0\.86 0\.15 0\.15 rg/g) ?? []).length;
    const quiet = pdf([{ ...routine, action: "Confirm A1000 start" }]);
    expect(red(pdf([routine]))).toBe(red(quiet));
    expect(red(pdf([{ ...routine, severity: "high" }]))).toBeGreaterThan(red(quiet));
  });

  it("adds severity to the private page reader without widening its filter or grants", async () => {
    const name = readdirSync("supabase/migrations").find((f) =>
      f.endsWith("_athena_report_item_severity.sql"),
    )!;
    const sql = readFileSync(`supabase/migrations/${name}`, "utf8");
    const db = new PGlite();
    try {
      await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
        CREATE TABLE public.mcp_open_items(id int, job_id uuid, action text, accountable text, owner text, needed_by date, due_date date, item_type text, kind text, severity text, status text, internal_only boolean);
        INSERT INTO public.mcp_open_items VALUES (1,'11111111-1111-4111-8111-111111111111','Pour footings',NULL,'Morgan',NULL,NULL,NULL,'confirm_unknown','medium','open',false), (2,'11111111-1111-4111-8111-111111111111','Private risk',NULL,'Morgan',NULL,NULL,NULL,'deadline','high','open',true);`);
      await db.exec(sql);
      const rows = await db.query<{ items: { severity: string }[] }>(
        "SELECT public.mcp_report_open_items('11111111-1111-4111-8111-111111111111',true) AS items",
      );
      expect(rows.rows[0].items).toHaveLength(1);
      expect(rows.rows[0].items[0].severity).toBe("medium");
      await db.exec("SET ROLE authenticated");
      await expect(
        db.query(
          "SELECT public.mcp_report_open_items('11111111-1111-4111-8111-111111111111',false)",
        ),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.close();
    }
  });
});
