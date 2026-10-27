import { readFileSync, readdirSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { renderHtml } from "./cards/html";
import { inferCard } from "./cards/infer";
import { renderMarkdown } from "./cards/markdown";
import { cardWidgetHtml } from "./cards/widget";
import { paletteViolations } from "./cards/palette";
import { isDelayNoticeTask } from "./delay-notice";
import { drawingCalloutColor, drawingMarkupCard } from "./drawing-markup";
import { buildMorningBrief, type BriefJob } from "./morning-brief";
import { openItemsCard } from "./open-feed";
import { lookaheadAlert, lookaheadModel, lookaheadView, type LaItem } from "./styled-views";
import { fieldPageHtml } from "./superintendent";
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

const NOTICE = "Send written delay notice (§6.2)";
const TODAY = "2026-10-22";

function paintCard(card: Parameters<typeof renderHtml>[0]) {
  const html = renderHtml(card);
  const markdown = renderMarkdown(card);
  const node = { dataset: {}, innerHTML: "" };
  runInNewContext(cardWidgetHtml().match(/<script>([\s\S]*?)<\/script>/)![1], {
    window: { openai: { toolOutput: { card } } },
    document: { getElementById: () => node },
  });
  return { html, markdown, widget: node.innerHTML };
}

function briefJob(items: BriefJob["items"]): BriefJob {
  return {
    job_id: "27010000-0000-4000-8000-0000000000d1",
    job_number: "2701",
    name: "Harbor",
    company_id: "c1",
    time_zone: "America/Chicago",
    scope: "full",
    seat: "pm",
    activities: [],
    items,
    lookahead: null,
    payApps: [],
    invoices: [],
    links: {},
  };
}

describe("delay notices render red", () => {
  it("classifies a delay-notice obligation without treating every delay as one", () => {
    expect(isDelayNoticeTask({ action: NOTICE })).toBe(true);
    expect(isDelayNoticeTask({ action: "TEST notice of delay" })).toBe(true);
    expect(isDelayNoticeTask({ action: "Send the letter", category: "Delay notice" })).toBe(true);
    expect(isDelayNoticeTask({ action: "Send the letter", check_key: "delay_notice:abc" })).toBe(true);
    expect(isDelayNoticeTask({ action: "Send the letter", type: "delay" })).toBe(true);
    expect(isDelayNoticeTask({ action: "Send the letter", item_type: "deadline", kind: "general" })).toBe(false);
    expect(isDelayNoticeTask({ action: "Weather delay on the slab" })).toBe(false);
    expect(isDelayNoticeTask({ action: "Submit claim notice (§7.4)" })).toBe(false);
    expect(isDelayNoticeTask({ action: "Confirm the conduit" })).toBe(false);
  });

  it("paints a delay notice red, an ordinary task blue, and an overdue task red", () => {
    const card = (action: string, due: string, extra: Record<string, string> = {}) =>
      openItemsCard(
        "2701 – Harbor",
        [{ id: "1", action, needed_by: due, ...extra }],
        { open: 1, overdue: due < TODAY ? 1 : 0, due_in_7_days: 0 },
        TODAY,
      );
    const delay = paintCard(card(NOTICE, "2026-10-30"));
    const ordinary = paintCard(card("Confirm the conduit", "2026-10-30"));
    const overdue = paintCard(card("Confirm the conduit", "2026-10-21"));
    const linked = paintCard(card("Send the letter", "2026-10-30", { category: "Delay notice", check_key: "delay_notice:1" }));

    for (const shown of [delay, linked]) {
      expect(shown.html).toContain('data-alert="delay"');
      expect(shown.html).toContain("#DC2626");
      expect(shown.markdown).toContain("Delay:");
      expect(shown.markdown).not.toMatch(/[🔵🔴⚪]/u);
      expect(shown.widget).toContain('data-alert="delay"');
      expect(paletteViolations(shown.html, true)).toEqual([]);
    }
    expect(ordinary.html).toContain("#1E5FED");
    expect(ordinary.html).not.toContain("#DC2626");
    expect(ordinary.html).not.toContain("data-alert=");
    expect(ordinary.markdown).toContain("Confirm the conduit");
    expect(ordinary.markdown).not.toMatch(/[🔵🔴⚪]/u);
    expect(ordinary.markdown).not.toContain("🔴");
    expect(ordinary.widget).not.toContain("data-alert=");
    expect(paletteViolations(ordinary.html, false)).toEqual([]);
    expect(overdue.html).toContain('data-alert="overdue"');
    expect(overdue.html).toContain("#DC2626");
    expect(overdue.markdown).toContain("Overdue:");
    expect(overdue.markdown).not.toMatch(/[🔵🔴⚪]/u);
    expect(overdue.widget).toContain('data-alert="overdue"');
    expect(paletteViolations(overdue.html, true)).toEqual([]);

    const inferred = inferCard("list_open_items", "2701 – Harbor", {
      items: [
        { action: NOTICE, due: "2026-10-30", overdue: false },
        { action: "Confirm the conduit", due: "2026-10-30", overdue: false },
        { action: "Confirm the conduit", due: "2026-10-21", overdue: true },
      ],
    });
    const flags = inferred.sections?.find((s) => s.heading === "Items")?.rows.map((r) => r.flag);
    expect(flags).toEqual(["delay", null, "overdue"]);
  });

  it("keeps the lookahead, briefing, items page, and field board on the same rule", () => {
    const future: LaItem = { action: NOTICE, severity: "medium", type: "deadline", owner: "Morgan", due: "2026-10-26" };
    const ordinary: LaItem = { action: "Confirm the conduit", severity: "medium", type: "deadline", owner: "Morgan", due: "2026-10-26" };
    const late: LaItem = { action: "Confirm the conduit", severity: "medium", type: "deadline", owner: "Morgan", due: "2026-10-21" };
    const byCategory: LaItem = { action: "Send the letter", category: "Delay notice", severity: "medium", type: "deadline", due: "2026-10-26" };
    expect(lookaheadAlert({ item: future, overdue: false })).toBe("delay");
    expect(lookaheadAlert({ item: ordinary, overdue: false })).toBeNull();
    expect(lookaheadAlert({ item: late, overdue: true })).toBe("overdue");
    expect(lookaheadAlert({ item: byCategory, overdue: false })).toBe("delay");
    expect(page([future])).toContain("border-left:4px solid #DC2626");
    expect(page([ordinary])).toContain("border-left:4px solid #1E5FED");
    expect(page([ordinary])).not.toContain("border-left:4px solid #DC2626");
    expect(page([late])).toContain("border-left:4px solid #DC2626");
    expect(page([byCategory])).toContain("border-left:4px solid #DC2626");
    const viewOf = (item: LaItem) =>
      lookaheadView({ title: "2701", ref: "LA-1", start: input.start, end: input.end, dataDate: input.dataDate, acts, items: [item], today: input.today });
    expect(viewOf(future)).toMatch(/\| 1 \| 🔴 Send written delay notice/);
    expect(viewOf(ordinary)).not.toMatch(/\| 1 \| 🔴 /);
    expect(viewOf(late)).toMatch(/\| 1 \| 🔴 \*\*OVERDUE\*\*/);
    const pdf = (item: LaItem) => Buffer.from(lookaheadPdf({ ...input, items: [item] })).toString("latin1");
    const red = (text: string) => (text.match(/0\.86 0\.15 0\.15 rg/g) ?? []).length;
    expect(red(pdf(future))).toBeGreaterThan(red(pdf(ordinary)));
    expect(red(pdf(late))).toBeGreaterThan(red(pdf(ordinary)));

    const brief = renderReportBody({
      page: "briefing",
      job_number: "2701",
      job_name: "Harbor",
      today: TODAY,
      items: [future, ordinary, { ...late, action: "Price the exposure" }],
    });
    expect(brief).toContain(`color:#DC2626;font-weight:600">${NOTICE}`);
    expect(brief).toContain('color:#1E3A5F;font-weight:600">Confirm the conduit');
    expect(brief).toContain('color:#DC2626;font-weight:600">Price the exposure');

    const itemsPage = renderReportBody({
      page: "items",
      job_number: "2701",
      job_name: "Harbor",
      items: [
        { id: "n", action: NOTICE, owner: "Morgan", due: "2026-10-30" },
        { id: "o", action: "Confirm the conduit", owner: "Morgan", due: "2026-10-30" },
        { id: "c", action: "Send the letter", owner: "Morgan", due: "2026-10-30", category: "Delay notice", check_key: "delay_notice:1" },
      ],
    });
    expect(itemsPage).toContain(`color:#DC2626">${NOTICE}`);
    expect(itemsPage).toContain('color:#1E3A5F">Confirm the conduit');
    expect(itemsPage).toContain('color:#DC2626">Send the letter');

    const field = (action: string, due: string, extra: Record<string, string> = {}) =>
      fieldPageHtml({ today: TODAY, items: [{ id: "1", action, due, owner: "Morgan", ...extra }] });
    expect(field(NOTICE, "2026-10-30")).toContain("#DC2626");
    expect(field("Confirm the conduit", "2026-10-30")).not.toContain("#DC2626");
    expect(field("Confirm the conduit", "2026-10-21")).toContain("#DC2626");
    expect(field("Send the letter", "2026-10-30", { check_key: "delay_notice:9" })).toContain("#DC2626");
  });

  it("flags a delay notice on the morning brief without recoloring an ordinary or overdue row", () => {
    const built = buildMorningBrief({
      jobs: [briefJob([
        { id: "n", action: "Send the letter", check_key: "delay_notice:1", category: "general", due_date: "2026-10-30" },
        { id: "o", action: "Confirm the conduit", due_date: "2026-10-30" },
        { id: "l", action: "Price the exposure", due_date: "2026-10-21" },
      ])],
      hasCompany: true,
      now: new Date("2026-10-22T15:00:00Z"),
    });
    const rows = built.card.sections?.find((s) => s.heading === "Open items")?.rows ?? [];
    const flagOf = (id: string) => rows.find((r) => r.cells.join(" ").includes(id === "n" ? "Send the letter" : id === "o" ? "Confirm the conduit" : "Price the exposure"))?.flag;
    expect(flagOf("n")).toBe("delay");
    expect(flagOf("o")).toBeNull();
    expect(flagOf("l")).toBe("overdue");
    const html = renderHtml(built.card);
    expect(html).toContain('data-alert="delay"');
    expect(html).toContain('data-alert="overdue"');
    expect(paletteViolations(html, true)).toEqual([]);
  });

  it("passes category and check_key through the report reader and keeps the grants revoked", async () => {
    const name = readdirSync("supabase/migrations").find((f) =>
      f.endsWith("_athena_delay_notice_severity.sql"),
    )!;
    const sql = readFileSync(`supabase/migrations/${name}`, "utf8");
    const db = new PGlite();
    try {
      await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
        CREATE TABLE public.mcp_open_items(id int, job_id uuid, action text, accountable text, owner text, needed_by date, due_date date, item_type text, kind text, severity text, status text, internal_only boolean, category text, check_key text);
        INSERT INTO public.mcp_open_items VALUES
          (1,'11111111-1111-4111-8111-111111111111','Send the letter',NULL,'Morgan','2026-10-30',NULL,'deadline','general','medium','open',false,'Delay notice','delay_notice:1'),
          (2,'11111111-1111-4111-8111-111111111111','Confirm the conduit',NULL,'Morgan','2026-10-30',NULL,'deadline','general','medium','open',false,'general','manual:2'),
          (3,'11111111-1111-4111-8111-111111111111','Private risk',NULL,'Morgan',NULL,NULL,'deadline','general','high','open',true,'Risk','manual:3');`);
      await db.exec(sql);
      const rows = await db.query<{ items: { action: string; severity: string; category: string; check_key: string }[] }>(
        "SELECT public.mcp_report_open_items('11111111-1111-4111-8111-111111111111',true) AS items",
      );
      expect(rows.rows[0].items).toHaveLength(2);
      expect(rows.rows[0].items.map((item) => item.action)).toEqual(["Send the letter", "Confirm the conduit"]);
      expect(rows.rows[0].items[0]).toMatchObject({ severity: "medium", category: "Delay notice", check_key: "delay_notice:1" });
      await db.exec("SET ROLE authenticated");
      await expect(
        db.query("SELECT public.mcp_report_open_items('11111111-1111-4111-8111-111111111111',false)"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.close();
    }
  });
});
