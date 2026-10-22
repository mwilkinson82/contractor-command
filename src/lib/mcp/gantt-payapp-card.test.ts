import { beforeEach, describe, expect, it, vi } from "vitest";
import { CARD_WIDGET_URI, cardWidgetHtml } from "./cards/widget";
import { CLAUDE_CHAT_CARD_LINE } from "./cards/markdown";
import { CARD_SHOWN } from "./cards/silence";
import { paletteViolations } from "./cards/palette";
import { renderHtml } from "./cards/html";

const JOB = "323a040a-7ed1-4726-8f6a-da13fdb5a0eb";

const state = vi.hoisted(() => ({
  report: { found: false } as Record<string, unknown>,
}));

vi.mock("./guard", () => ({
  run: async (_t: string, _c: unknown, _o: unknown, fn: (sb: unknown) => Promise<unknown>) => fn({
    from(table: string) {
      const rows = table === "mcp_companies" ? [{ id: "co", name: "ALP" }] : table === "mcp_jobs" ? [{ sov_fee_pct: null }] : [];
      const api = {
        select() { return api; },
        eq() { return api; },
        maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
        then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) {
          return Promise.resolve({ data: rows, error: null }).then(ok, bad);
        },
      };
      return api;
    },
    rpc(fn: string) {
      if (fn === "mcp_resolve_job") {
        return Promise.resolve({ data: { job_id: JOB, job_number: "2701", name: "Harbor Point", company_id: "co", scope: "full" }, error: null });
      }
      if (fn === "mcp_living_report_get") return Promise.resolve({ data: state.report, error: null });
      return Promise.resolve({ data: null, error: { message: "no board" } });
    },
  }),
  text: (b: string) => ({ content: [{ type: "text" as const, text: b + "\n\n---\nAthena powered by ALP, construction agents" }] }),
  dbError: (e: { message?: string }) => { throw new Error(e?.message ?? "db"); },
  isMissingFunction: () => false,
}));

import { cpmActivities, livingReportGet } from "./tools/living-tools";

type Reply = {
  content: { type: string; text?: string }[];
  structuredContent: { card: { title: string }; html: string };
  _meta?: Record<string, string>;
};

const call = (tool: unknown, args: Record<string, unknown>) =>
  (tool as { handler: (a: Record<string, unknown>, c: unknown) => Promise<Reply> }).handler(args, {});

function chatText(result: Reply): string {
  return (result.content[0].text ?? "").split("\n\n---\n")[0];
}

beforeEach(() => {
  state.report = { found: false };
});

describe("Grok chat text for the CPM Gantt and the pay app", () => {
  it("cpm_activities is a markdown schedule card, not drawing rules or a bare link", async () => {
    state.report = {
      found: true,
      version: 3,
      data_date: "2026-10-19",
      contract_completion_date: "2027-09-16",
      activity_count: 2,
      data: {
        activities: [
          { id: "A1110", name: "Underground conduit", duration: 10, start: "2026-10-26", finish: "2026-11-06", predecessors: [], total_float: 0, critical: true, pct_complete: 0, value: 35000, sov_line: "26.01", cost_code: "26-010" },
          { id: "D1060", name: "Engineer redesign delay fragnet", duration: 15, start: "2026-11-27", finish: "2026-12-17", predecessors: [], total_float: 0, critical: true, pct_complete: 0, value: 0, sov_line: null, cost_code: null },
        ],
        tia: { fragnet: "D1060", prior_completion: "2026-11-26", updated_completion: "2026-12-17" },
      },
    };
    const result = await call(cpmActivities, { job_number: "2701" });
    const text = chatText(result);
    expect(text.startsWith("## 🔵 Schedule")).toBe(true);
    expect(text).toContain("A1110");
    expect(text).toContain("Underground conduit");
    expect(text).toContain("D1060");
    expect(text).toContain("| ID | Name | Start | Finish | Float | Value |");
    expect(text).toContain(CLAUDE_CHAT_CARD_LINE);
    expect(text.trim().endsWith(CARD_SHOWN)).toBe(true);
    expect(text).not.toContain("<!doctype html");
    expect(text).not.toContain("month columns");
    expect(text).not.toContain("Styled schedule (always current");
    expect(text).not.toMatch(/^https?:\/\//m);
    expect(result.structuredContent.card.title).toBe("Schedule");
    expect(result.structuredContent.html).toBe(renderHtml(result.structuredContent.card));
    expect(result.structuredContent.html.startsWith("<!doctype html>")).toBe(true);
    expect(result.structuredContent.html).toContain("#1E3A5F");
    expect(result.structuredContent.html).toContain("#1E5FED");
    expect(result.structuredContent.html).toContain("#DC2626");
    expect(result._meta?.["openai/outputTemplate"]).toBe(CARD_WIDGET_URI);
    expect(paletteViolations(text, true)).toEqual([]);
    expect(cardWidgetHtml()).toContain("window.openai");
    expect(cardWidgetHtml()).not.toContain(CLAUDE_CHAT_CARD_LINE);
  });

  it("living_report_get pay app is a markdown card, not a link plus draw rules", async () => {
    state.report = {
      found: true,
      version: 2,
      data_date: "2026-10-19",
      forecast_total: 1000,
      data: {
        billing: {
          billed_to_date: 400,
          months: [
            { month: "2026-09", amount: 400, kind: "actual" },
            { month: "2026-10", amount: 600, kind: "forecast" },
          ],
        },
      },
    };
    const result = await call(livingReportGet, { job_number: "2701", report_type: "billing_forecast" });
    const text = chatText(result);
    expect(text.startsWith("## 🔵 Pay app")).toBe(true);
    expect(text).toContain("| Month | Type | Amount | Cumulative |");
    expect(text).toContain("2026-09");
    expect(text).toContain("$400.00");
    expect(text).toContain("$600.00");
    expect(text).toContain(CLAUDE_CHAT_CARD_LINE);
    expect(text.trim().endsWith(CARD_SHOWN)).toBe(true);
    expect(text).not.toContain("<!doctype html");
    expect(text).not.toContain("REQUIRED VIEW – PAY APP");
    expect(text).not.toContain("Styled pay app (always current");
    expect(text).not.toMatch(/^https?:\/\//m);
    expect(result.structuredContent.card.title).toBe("Pay app");
    expect(result.structuredContent.html).toBe(renderHtml(result.structuredContent.card));
    expect(result.structuredContent.html).toContain("#1E3A5F");
    expect(result.structuredContent.html).toContain("#1E5FED");
    expect(result._meta?.["openai/outputTemplate"]).toBe(CARD_WIDGET_URI);
    expect(paletteViolations(result.structuredContent.html, true)).toEqual([]);
  });

  it("an empty pay app is the same card shape and still carries the HTML document", async () => {
    const result = await call(livingReportGet, { job_number: "2701", report_type: "billing_forecast" });
    const text = chatText(result);
    expect(text.startsWith("## 🔵 Pay app")).toBe(true);
    expect(text).toContain("Send the billed-to-date figure");
    expect(text).toContain("Billed to date");
    expect(text).toContain("**Next move:**");
    expect(text).toContain(CLAUDE_CHAT_CARD_LINE);
    expect(text).not.toContain("<!doctype html");
    expect(text).not.toContain("Styled pay app");
    expect(result.structuredContent.html.startsWith("<!doctype html>")).toBe(true);
    expect(paletteViolations(text, false)).toEqual([]);
    expect(paletteViolations(result.structuredContent.html, false)).toEqual([]);
  });
});
