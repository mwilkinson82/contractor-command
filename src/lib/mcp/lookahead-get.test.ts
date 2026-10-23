import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardModel } from "./cards/model";
import type { SavedLookaheadItem } from "./lookahead-card";
import { paletteViolations } from "./cards/palette";

const state = vi.hoisted(() => ({
  job: "10000000-0000-4000-8000-000000000001",
  la: "31be8000-0000-4000-8000-000000000001",
  cpmDate: "2026-10-19" as string | null,
  liveShape: false, failItems: false, foreignLa: false, rows: 6, writes: [] as string[], queries: [] as string[], rpcs: [] as string[],
}));
const sb = () => ({
  from(table: string) {
    state.queries.push(table);
    let rows: Record<string, unknown>[] = table === "mcp_companies" ? [{ id: "co", name: "Example Company" }]
      : table === "mcp_jobs" ? [{ id: state.job, time_zone: "UTC" }]
      : table === "mcp_lookaheads" ? [
        { id: state.la, job_id: state.foreignLa ? "other-job" : state.job, current_rev: 2, start_date: "2026-11-02", end_date: "2026-11-13", created_at: "2026-10-01", inputs: {} },
        { id: "fffff000-0000-4000-8000-000000000001", job_id: state.job, current_rev: 0, start_date: "2026-12-01", end_date: "2026-12-14", created_at: "2026-10-02", inputs: {} },
        { id: "aaaaa000-0000-4000-8000-000000000001", job_id: state.job, inputs: { kind: "setup" } },
      ]
      : table === "mcp_open_items" ? [
        ...Array.from({ length: state.rows }, (_, i) => ({ id: `item-${i.toString().padStart(4, "0")}`, job_id: state.job, lookahead_id: state.la,
          action: `Fictional construction item ${i + 1}`, accountable: "Example PM", due_date: i === 0 ? "2020-01-01" : "2099-01-01",
          ...(state.liveShape ? { due_date: "2026-11-02" } : {}),
          status: state.liveShape ? (i < 2 ? "resolved" : "open") : i === 5 ? "resolved" : "open", severity: "low", item_type: i === 1 ? "delay" : "deadline", category: i === 3 ? "delay_notice" : null })),
        ...(state.liveShape ? [
          ...["2026-10-14", "2026-10-16", "2026-10-21"].map((due, i) => ({ id: `job-overdue-${i}`, job_id: state.job, lookahead_id: "other-la", action: `Job obligation ${i + 1}`, status: "open", due_date: due, owner: "Example PM" })),
          { id: "due-today", job_id: state.job, lookahead_id: "other-la", action: "Due today obligation", status: "open", due_date: "2026-10-22" },
          { id: "resolved-overdue", job_id: state.job, lookahead_id: "other-la", action: "Resolved obligation", status: "resolved", due_date: "2026-10-01" },
        ] : []),
        { id: "foreign-item", job_id: "other-job", lookahead_id: state.la, action: "PRIVATE OTHER JOB" },
        { id: "other-lookahead", job_id: state.job, lookahead_id: "other-la", action: "OTHER LOOKAHEAD" },
      ] : [];
    const result = () => ({ data: rows, error: state.failItems && table === "mcp_open_items" ? { message: "Read failed" } : null });
    const api = {
      select: () => api,
      eq(col: string, val: unknown) { rows = rows.filter((r) => r[col] === val); return api; },
      not: () => api, order: () => api, limit: () => api,
      range(start: number, end: number) { rows = rows.slice(start, end + 1); return api; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      insert() { state.writes.push(table); throw new Error("Unexpected write"); },
      update() { state.writes.push(table); throw new Error("Unexpected write"); },
      then(ok: (value: unknown) => unknown) { return Promise.resolve(result()).then(ok); },
    };
    return api;
  },
  async rpc(fn: string) {
    state.rpcs.push(fn);
    if (fn === "mcp_resolve_job") return { data: { job_id: state.job, company_id: "co", job_number: "2701", name: "Fictional Job", scope: "full" }, error: null };
    if (fn === "mcp_living_report_get") return { data: state.cpmDate ? { found: true, version: 3, data_date: state.cpmDate, data: { activities: [{ id: "A100", name: "Fictional rough-in", start: "2026-10-26", finish: "2026-11-02" }] } } : { found: false }, error: null };
    throw new Error(`Unexpected RPC ${fn}`);
  },
});
vi.mock("./guard", () => ({
  run: async (_t: string, _c: unknown, _o: unknown, fn: (s: unknown) => unknown) => fn(sb()),
  text: (text: string) => ({ content: [{ type: "text", text }] }),
  dbError: (e: { message: string }) => { throw new Error(e.message); },
  isMissingFunction: () => false,
}));
import { lookaheadGet } from "./tools/workflow-tools";
const call = (args: Record<string, unknown> = {}) => (lookaheadGet as unknown as { handler: (a: unknown, c: unknown) => Promise<{ content: { text: string }[]; structuredContent: { lookahead_ref: string; items: SavedLookaheadItem[]; window: unknown; activities: unknown[]; revision: number; html: string; card: CardModel } }> }).handler({ job_number: "2701", ...args }, {});
beforeEach(() => { state.liveShape = false; state.cpmDate = "2026-10-19"; state.foreignLa = false; state.failItems = false; state.rows = 6; state.writes = []; state.queries = []; state.rpcs = []; });

describe("normal lookahead read", () => {
  it("keeps six saved rows separate from the existing report's three job-overdue obligations", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T16:00:00Z"));
    state.liveShape = true;
    try {
      const { structuredContent: sc, content } = await call();
      expect(sc.items).toHaveLength(6);
      expect(sc.card.kpis).toEqual([
        { label: "Saved items", value: "6" },
        { label: "Open saved items", value: "4" },
        { label: "Overdue on job", value: "3", flag: "overdue" },
      ]);
      const overdue = sc.card.sections!.find((section) => section.heading.startsWith("Job overdue obligations"))!;
      expect(overdue.rows).toHaveLength(3);
      expect(overdue.rows.every((row) => row.flag === "overdue")).toBe(true);
      expect(content[0].text).toContain("Job obligation 3");
      expect(content[0].text).not.toContain("Due today obligation");
      expect(content[0].text).not.toContain("Resolved obligation");
      expect(content[0].text).not.toContain("PRIVATE OTHER JOB");
      expect(state.writes).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
  it("returns all six saved items, current CPM window, and styled fallback without an export", async () => {
    const result = await call();
    const sc = result.structuredContent;
    expect(sc.lookahead_ref).toBe("LA-31BE8");
    expect(sc.items).toHaveLength(6);
    expect(sc.window).toMatchObject({ start: "2026-10-26", end: "2026-11-06", source: "cpm" });
    expect(sc.activities).toHaveLength(1);
    expect(sc.revision).toBe(2);
    const reply = result.content[0].text;
    for (let i = 1; i <= 6; i++) expect(reply).toContain(`Fictional construction item ${i}`);
    expect(reply).toContain("<!doctype html");
    expect(reply).toContain("#1E5FED");
    expect(reply).not.toContain("PRIVATE OTHER JOB");
    expect(reply).not.toContain("OTHER LOOKAHEAD");
    expect(reply).not.toContain("Hidden");
    expect(paletteViolations(sc.html, true)).toEqual([]);
    const items = sc.card.sections!.at(-1)!.rows;
    expect(items.find((r) => r.refId === "item-0000")!.flag).toBe("overdue");
    expect(items.find((r) => r.refId === "item-0001")!.flag).toBe("delay");
    expect(items.find((r) => r.refId === "item-0002")!.flag).toBe("callout");
    expect(items.find((r) => r.refId === "item-0003")!.flag).toBe("delay");
    expect(items.find((r) => r.refId === "item-0005")!.flag).toBeNull();
    expect(state.writes).toEqual([]);
    expect(state.rpcs).toEqual(["mcp_resolve_job", "mcp_living_report_get"]);
    expect(lookaheadGet.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
  });
  it("returns saved rows without a CPM, using the saved dates", async () => {
    state.cpmDate = null;
    const { structuredContent: sc } = await call({ lookahead_id: "LA-31BE8" });
    expect(sc.items).toHaveLength(6);
    expect(sc.window).toMatchObject({ start: "2026-11-02", end: "2026-11-13", source: "saved" });
    expect(sc.html).toContain("No saved CPM activities yet");
  });
  it("does not silently truncate a lookahead at the database page limit", async () => {
    state.rows = 501;
    const { structuredContent: sc } = await call();
    expect(sc.items).toHaveLength(501);
    expect(sc.html).toContain("Fictional construction item 501");
  });
  it("rejects a lookahead from another job", async () => {
    state.foreignLa = true;
    await expect(call({ lookahead_id: state.la })).rejects.toThrow("doesn't belong");
  });
  it("reports item-read failure instead of returning an empty styled success", async () => {
    state.failItems = true;
    await expect(call({ lookahead_id: state.la })).rejects.toThrow("Read failed");
  });
});
