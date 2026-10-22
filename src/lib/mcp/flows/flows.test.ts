import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { paletteViolations } from "../cards/palette";
import { renderHtml } from "../cards/html";
import { renderMarkdown } from "../cards/markdown";
import { z } from "zod";
import { attachAthenaCard } from "../cards/attach";
import { buildFlowCard, iorDelta } from "./build";
import { job2701FlowData } from "./job-2701";
import { EVENING_STAGES, MORNING_STAGES, PM_MEETING_STAGES, stagesFor, type FlowName } from "./types";

const calls = vi.hoisted(() => ({ rpc: [] as string[] }));
vi.mock("../guard", () => ({
  run: async (_t: string, _c: unknown, _o: unknown, fn: (sb: unknown) => Promise<unknown>) => fn({
    rpc: async (name: string) => { calls.rpc.push(name); return { data: null, error: { message: "unexpected" } }; },
    from: (table: string) => {
      const data = table === "mcp_companies" ? [{ id: "c1", name: "Harbor Electric" }] : [{ job_number: "2701", name: "Harbor Point", company_id: "c1" }];
      const result = Promise.resolve({ data, error: null });
      return { select: () => Object.assign(result, { in: () => result }) };
    },
  }),
  text: (b: string) => ({ content: [{ type: "text", text: b }] }),
}));
vi.mock("../jobs", () => ({
  FULL_ACCESS_MESSAGE: "This needs full access to the job.",
  audit: async () => { calls.rpc.push("audit"); },
  resolveJob: async (_sb: unknown, jobNumber: string) => ({ job_id: "j1", job_number: jobNumber, name: "Harbor Point", company_id: "c1", scope: "full" }),
}));

import { pmEvening, pmMeeting, pmMorning } from "../tools/flow-tools";

type H = (a: Record<string, unknown>, c: unknown) => Promise<{
  content: { type: string; text?: string }[];
  structuredContent: { card: { state: string; title: string }; html: string; stage: string };
  _meta?: Record<string, string>;
}>;
const call = (tool: unknown, args: Record<string, unknown>) => (tool as { handler: H }).handler(args, {});

describe("job 2701 guided flows", () => {
  const data = job2701FlowData();

  it("keeps the PM meeting order and shows schedule, change orders, accounting, and IOR deltas", () => {
    expect([...PM_MEETING_STAGES]).toEqual(["progress", "schedule", "change_orders", "accounting", "ior"]);
    for (const banned of ["closeout", "open_actions", "field_readiness", "financial"]) {
      expect(PM_MEETING_STAGES).not.toContain(banned);
      expect(() => buildFlowCard("pm_meeting", banned, data)).toThrow(/Schedule progress, Schedule, Change orders, Accounting, and IOR delta/);
    }
    const first = buildFlowCard("pm_meeting", PM_MEETING_STAGES[0], data);
    expect(first.state).toBe("progress");
    expect(first.title).toBe("Schedule progress");
    expect(renderMarkdown(first)).toContain("Percent complete");
    expect(renderMarkdown(first)).toContain("46%");
    expect(renderMarkdown(first)).toContain("Activities done since last meeting");
    expect(renderMarkdown(first)).toContain("Critical-path status");
    const schedule = buildFlowCard("pm_meeting", "schedule", data);
    const headings = schedule.sections?.map((s) => s.heading) ?? [];
    expect(headings.indexOf("Locked lookahead")).toBeLessThan(headings.indexOf("Subs, suppliers and crews"));
    expect(schedule.state).toBe("ask");
    expect(schedule.ask?.prompt).toContain("subs, suppliers and crews");
    expect(schedule.alerts?.some((a) => a.level === "delay")).toBe(true);
    const self = buildFlowCard("pm_meeting", "schedule", job2701FlowData({ selfPerform: true }));
    expect(self.ask?.prompt).toContain("self-perform crews and materials");
    const changes = buildFlowCard("pm_meeting", "change_orders", data);
    expect(changes.kpis?.map((k) => k.value)).toEqual(["1", "1", "1"]);
    const books = buildFlowCard("pm_meeting", "accounting", data);
    expect(books.kpis?.find((k) => k.label === "Realistic bill")?.flag).toBe("risk");
    expect(renderMarkdown(books)).toContain("Partial billings on activities");
    expect(renderMarkdown(books)).toContain("$140,000.00");
    const delta = iorDelta(data.iorNow, data.iorPrevious);
    expect(delta.slipped.map((r) => r.id)).toEqual(["r1"]);
    expect(delta.fresh.map((r) => r.id)).toEqual(["r4"]);
    expect(delta.resolved.map((r) => r.id)).toEqual(["r3"]);
    const ior = buildFlowCard("pm_meeting", "ior", data);
    expect(ior.alerts?.map((a) => a.level)).toEqual(["delay", "risk"]);
  });

  it("renders every stage of every meeting as a screenshot-able card on the palette", () => {
    const flows: FlowName[] = ["pm_meeting", "pm_morning", "pm_evening"];
    expect(stagesFor("pm_morning")).toEqual(MORNING_STAGES);
    expect(stagesFor("pm_evening")).toEqual(EVENING_STAGES);
    for (const flow of flows) {
      for (const stage of stagesFor(flow)) {
        const card = buildFlowCard(flow, stage, data);
        const html = renderHtml(card);
        const md = renderMarkdown(card);
        expect(html, `${flow} ${stage}`).toContain("<!doctype html>");
        expect(html, `${flow} ${stage}`).toContain(card.title);
        expect(md, `${flow} ${stage}`).toContain("**Progress:**");
        expect(paletteViolations(html, true), `${flow} ${stage} html`).toEqual([]);
        expect(paletteViolations(md, true), `${flow} ${stage} md`).toEqual([]);
        expect(md).not.toMatch(/⚠|🚚|📋|🚩/);
      }
    }
  });

  it("asks when the evening record is empty", () => {
    const empty = job2701FlowData();
    empty.dailies = [];
    const card = buildFlowCard("pm_evening", "dailies", empty);
    expect(card.state).toBe("ask");
    expect(card.ask?.prompt).toContain("dailies");
  });

  it("the migration is additive", () => {
    const sql = readFileSync("supabase/migrations/20261023030000_athena_guided_sessions.sql", "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.mcp_guided_sessions");
    expect(sql).not.toMatch(/DELETE FROM|DROP TABLE|TRUNCATE/i);
  });
});

describe("sample path on job 2701", () => {
  beforeEach(() => { calls.rpc = []; });

  it("walks each flow end to end without writing", async () => {
    const tools = [
      [pmMeeting, "pm_meeting", PM_MEETING_STAGES],
      [pmMorning, "pm_morning", MORNING_STAGES],
      [pmEvening, "pm_evening", EVENING_STAGES],
    ] as const;
    for (const [tool, name, stages] of tools) {
      for (const stage of stages) {
        const r = await call(tool, { job_number: "2701", stage, sample: true });
        expect(r.structuredContent.stage, name).toBe(stage);
        expect(r.structuredContent.html).toContain("<!doctype html>");
        const text = r.content.find((c) => c.type === "text")?.text ?? "";
        expect(text.startsWith("## 🔵"), name).toBe(true);
        expect(text).toContain("Sample on job 2701");
        expect(text).toContain("REQUIRED VIEW: render this HTML card as-is.");
        expect(r.content[0].type).toBe("resource");
        expect(r._meta?.["openai/outputTemplate"]).toBe("ui://athena/card.html");
        expect(Object.keys(r)[0]).toBe("structuredContent");
      }
    }
    expect(calls.rpc).toEqual([]);
  });

  it("asks which job, as a card, when no job is given", async () => {
    const tools = [
      [pmMeeting, "pm_meeting"],
      [pmMorning, "pm_morning"],
      [pmEvening, "pm_evening"],
    ] as const;
    for (const [tool, name] of tools) {
      const raw = await call(tool, {});
      const carded = attachAthenaCard(name, raw) as unknown as { content: { text?: string }[]; structuredContent: { card: { state: string; title: string } } };
      expect(carded.structuredContent.card.title, name).toBe("Which job?");
      expect(carded.structuredContent.card.state, name).toBe("ask");
      expect(carded.content[0].text?.startsWith("## 🔵 Which job?"), name).toBe(true);
      expect(carded.content[0].text, name).not.toMatch(/^No job named/);
      expect(z.object((tool as { inputSchema: Record<string, z.ZodTypeAny> }).inputSchema).safeParse({}).success).toBe(true);
    }
  });

  it("refuses the sample on any other job", async () => {
    await expect(call(pmMeeting, { job_number: "2801", sample: true })).rejects.toThrow(/only on job 2701/);
  });
});
