import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardModel } from "./cards/model";
import type { SavedLookaheadItem } from "./lookahead-card";
import { paletteViolations } from "./cards/palette";
import { nativeCardResponse, nativeCardVisit } from "./native-card-transport";
import { NATIVE_CARD_MIME, NATIVE_CARD_URI } from "./cards/native";

const state = vi.hoisted(() => ({
  job: "10000000-0000-4000-8000-000000000001",
  la: "31be8000-0000-4000-8000-000000000001",
  cpmDate: "2026-10-19" as string | null,
  liveShape: false, failItems: false, foreignLa: false, rows: 6, activityCount: 1, writes: [] as string[], queries: [] as string[], rpcs: [] as string[],
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
    if (fn === "mcp_living_report_get") return { data: state.cpmDate ? { found: true, version: 3, data_date: state.cpmDate, data: { activities: state.activityCount === 1 ? [{ id: "A100", name: "Fictional rough-in", start: "2026-10-26", finish: "2026-11-02" }] : Array.from({ length: state.activityCount }, (_, i) => ({ id: `A${100 + i}`, name: `Fictional lookahead activity ${i + 1}`, start: "2026-10-26", finish: "2026-11-02" })) } } : { found: false }, error: null };
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
beforeEach(() => { state.liveShape = false; state.cpmDate = "2026-10-19"; state.foreignLa = false; state.failItems = false; state.rows = 6; state.activityCount = 1; state.writes = []; state.queries = []; state.rpcs = []; });

describe("normal lookahead read", () => {
  it.each([
    ["claude-ai", true], ["claude-ai", false],
    ["ChatGPT", true], ["ChatGPT", false],
  ])("job 2701 keeps all six items and three overdue in %s's full reply when card available=%s", async (host, cardAvailable) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T16:00:00Z"));
    state.liveShape = true;
    const request = (method: string, params: Record<string, unknown>) => new Request("https://app.meetathena.io/mcp", {
      method: "POST", headers: { "content-type": "application/json", "user-agent": String(host) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: {
        "io.modelcontextprotocol/clientInfo": { name: host, version: "test" },
        "io.modelcontextprotocol/clientCapabilities": { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [NATIVE_CARD_MIME] } } },
      } } }),
    });
    try {
      // Card loading is an independent request. Neither success nor failure may edit tool text.
      const resourceVisit = await nativeCardVisit(request("resources/read", { uri: NATIVE_CARD_URI }));
      const resource = await nativeCardResponse(Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } }, { status: cardAvailable ? 404 : 503 }), resourceVisit);
      expect(resource.status).toBe(cardAvailable ? 200 : 503);
      const fullReply = await call();
      const original = Response.json({ jsonrpc: "2.0", id: 1, result: fullReply });
      const visit = await nativeCardVisit(request("tools/call", { name: "lookahead_get", arguments: { job_number: "2701" } }));
      const response = await nativeCardResponse(original, visit);
      const claude = host === "claude-ai";
      // ChatGPT's reply stays byte-for-byte. Claude keeps every row; the card view draws the HTML.
      if (!claude) expect(response).toBe(original);
      const returned = (await response.json()).result as typeof fullReply;
      if (!claude) expect(returned.content).toEqual(fullReply.content);
      const { assistant_guidance: _g, ...facts } = fullReply.structuredContent as typeof fullReply.structuredContent & { assistant_guidance?: unknown };
      if (claude) expect(returned.structuredContent).toEqual(JSON.parse(JSON.stringify(facts)));
      else expect(returned.structuredContent).toEqual(fullReply.structuredContent);
      expect(returned.structuredContent.items).toHaveLength(6);
      expect(returned.structuredContent.card.kpis).toContainEqual({ label: "Overdue on job", value: "3", flag: "overdue" });
      const body = returned.content.map((block) => block.text).join("\n");
      for (let i = 1; i <= 6; i++) expect(body).toContain(`Fictional construction item ${i}`);
      for (let i = 1; i <= 3; i++) expect(body).toContain(`Job obligation ${i}`);
      expect(body).toContain("Data date: 2026-10-19 (saved CPM v3)");
      expect(body).not.toMatch(/REQUIRED:\s*the data date/i);
      expect(body).not.toMatch(/REQUIRED VIEW/);
      expect(body).not.toMatch(/Card shown/);
      expect(body).not.toMatch(/\bUse it and this window\b/);
      expect(body).toContain("| Saved items |");
      expect(returned.structuredContent.html).toContain("Data date: 2026-10-19 (saved CPM v3)");
      expect(returned.structuredContent.html).not.toContain("REQUIRED: the data date");
      expect(returned.structuredContent.html).toContain("#1E5FED");
      if (claude) {
        expect(body).not.toContain("<!doctype html");
        expect(body).not.toMatch(/sees this result as an Athena card/);
      } else {
        expect(body).toContain("<!doctype html");
        expect(body).toContain(returned.structuredContent.html);
      }
      expect(body).not.toContain("PRIVATE OTHER JOB");
      expect(state.writes).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
  it("generic host gets every lookahead row in markdown and no HTML document", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T16:00:00Z"));
    state.liveShape = true;
    state.activityCount = 6;
    const request = new Request("https://app.meetathena.io/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Grok" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "lookahead_get",
          arguments: { job_number: "2701" },
          _meta: {
            "io.modelcontextprotocol/clientInfo": { name: "Grok", version: "test" },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    try {
      const fullReply = await call();
      const original = Response.json({ jsonrpc: "2.0", id: 1, result: fullReply });
      const visit = await nativeCardVisit(request);
      const response = await nativeCardResponse(original, visit);
      const returned = (await response.json()).result as typeof fullReply & { _meta?: unknown };
      const body = returned.content.map((block) => block.text).join("\n");
      for (let i = 1; i <= 6; i++) {
        expect(body).toContain(`Fictional lookahead activity ${i}`);
        expect(body).toContain(`Fictional construction item ${i}`);
      }
      for (let i = 1; i <= 3; i++) expect(body).toContain(`Job obligation ${i}`);
      expect(body).toContain("## 🔵 14-day lookahead");
      expect(body).toContain("**2701 – Fictional Job**");
      expect(body).toContain("Window: Oct 26 to Nov 6, Rev 2. Data date is Oct 19 (CPM v3).");
      expect(body).toContain("**6 saved items · 4 open · 🔴 3 overdue on the job**");
      expect(body).toContain("due Oct 14");
      expect(body).toContain("due Oct 16");
      expect(body).toContain("due Oct 21");
      expect(body).toContain("### Resolved");
      const headings = ["### 🔴 Overdue", "### Coming up", "### 🔴 Delay / risk notices", "### Schedule in this window"];
      let at = -1;
      for (const heading of headings) {
        const next = body.indexOf(heading);
        expect(next, heading).toBeGreaterThan(at);
        at = next;
      }
      expect(body.indexOf("### Due within 7 days")).toBe(-1);
      expect(body.slice(body.indexOf("### Coming up"), body.indexOf("### 🔴 Delay / risk notices"))).not.toContain("🔴");
      expect(body).not.toMatch(/^\s*\|/m);
      expect(returned.structuredContent.activities).toHaveLength(6);
      expect(returned.structuredContent.items).toHaveLength(6);
      expect(returned.structuredContent.card.kpis).toContainEqual({ label: "Saved items", value: "6" });
      expect(returned.structuredContent.card.kpis).toContainEqual({ label: "Open saved items", value: "4" });
      expect(returned.structuredContent.card.kpis).toContainEqual({ label: "Overdue on job", value: "3", flag: "overdue" });
      expect(body.trim().endsWith("**Athena's next move:** Clear Job obligation 1 with Example PM, overdue since Oct 14.")).toBe(true);
      expect(body).not.toContain("<!doctype");
      expect(body).not.toMatch(/\bREQUIRED\b/);
      expect(body).not.toMatch(/\bDo not\b/i);
      expect(returned.structuredContent.html).toContain("<!doctype html");
      expect(returned.structuredContent.html).toContain("Data date: 2026-10-19 (saved CPM v3)");
      expect(returned.structuredContent.html).not.toContain("REQUIRED: the data date");
      expect(returned.structuredContent).toEqual(fullReply.structuredContent);
      expect(returned._meta).toEqual((fullReply as { _meta?: unknown })._meta);
    } finally { vi.useRealTimers(); }
  });
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
    expect(reply).toContain("Data date: 2026-10-19 (saved CPM v3)");
    expect(reply).not.toMatch(/REQUIRED:\s*the data date/i);
    expect(reply).not.toMatch(/REQUIRED VIEW/);
    expect(reply).not.toMatch(/Card shown/);
    expect(reply).not.toMatch(/Use it and this window everywhere/i);
    expect(reply).toContain("<!doctype html");
    expect(sc.html).toContain("Data date: 2026-10-19 (saved CPM v3)");
    expect(sc.html).not.toContain("REQUIRED: the data date");
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
