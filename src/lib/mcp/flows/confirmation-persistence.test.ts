import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardModel } from "../cards/model";
import { nativeCardResponse, nativeCardVisit } from "../native-card-transport";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  items: [] as Row[], sessions: [] as Row[], calls: [] as { name: string; args: Row }[],
  revision: 2, cpmVersion: 3, failSave: false, failRead: false, scope: "full", haveLookahead: true,
}));
const jobId = "11111111-1111-4111-8111-111111111111";
function valueAt(row: Row, field: string): unknown {
  return field.split(/->>?/).reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Row)[part] : undefined, row);
}
function client() {
  return {
    from(table: string) {
      let data: Row[] = structuredClone(table === "mcp_open_items" ? state.items
        : table === "mcp_guided_sessions" ? state.sessions
          : table === "mcp_lookaheads" && state.haveLookahead ? [{ id: "la-2701", job_id: jobId, current_rev: state.revision, start_date: "2026-10-26", end_date: "2026-11-08", created_at: "2026-10-20", inputs: {} }]
            : []);
      const query = {
        select: () => query,
        eq(field: string, value: unknown) { data = data.filter((row) => String(valueAt(row, field)) === String(value)); return query; },
        not(field: string) { data = data.filter((row) => valueAt(row, field) != null); return query; },
        order(field: string, opts: { ascending: boolean }) { data.sort((a, b) => String(valueAt(a, field)).localeCompare(String(valueAt(b, field))) * (opts.ascending ? 1 : -1)); return query; },
        limit(n: number) { data = data.slice(0, n); return query; },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: state.failRead && table === "mcp_guided_sessions" ? null : data, error: state.failRead && table === "mcp_guided_sessions" ? { message: "Read unavailable" } : null }).then(resolve); },
      };
      return query;
    },
    async rpc(name: string, args: Row) {
      state.calls.push({ name, args: structuredClone(args) });
      if (name === "mcp_living_report_get") return { data: args._type === "cpm" ? { found: true, version: state.cpmVersion, data_date: "2026-10-19", data: { activities: [] } } : { found: false }, error: null };
      if (name === "mcp_guided_latest") return { data: { found: false }, error: null };
      if (name === "mcp_guided_save") {
        if (state.failSave) return { data: null, error: { message: "Save failed" } };
        state.sessions.push({ id: `session-${state.sessions.length}`, job_id: args._job, flow: args._flow, stage: args._stage, snapshot: args._snapshot, created_at: new Date(Date.UTC(2026, 9, 23, 12, 0, state.sessions.length)).toISOString() });
        return { data: { saved: true }, error: null };
      }
      if (name === "mcp_meeting_item_save") {
        const item = state.items.find((row) => row.job_id === args._job && row.check_key === args._key);
        const values = { action: String(args._action), status: args._close ? "resolved" : "open", category: "Meeting" };
        if (item) Object.assign(item, values);
        else state.items.push({ id: `item-${state.items.length}`, job_id: args._job, check_key: args._key, ...values });
        return { data: { closed: args._close }, error: null };
      }
      if (name === "mcp_add_item") return { data: { item_id: "ordinary-note" }, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };
}
vi.mock("../guard", () => ({ run: async (_tool: string, _ctx: unknown, _opts: unknown, fn: (sb: unknown) => unknown) => fn(client()), text: (text: string) => ({ content: [{ type: "text", text }] }) }));
vi.mock("../jobs", () => ({
  FULL_ACCESS_MESSAGE: "This needs full access to the job.", WhichCompanyAsk: class extends Error {}, audit: async () => {},
  resolveJob: async (_sb: unknown, number: string) => ({ job_id: jobId, job_number: number, name: "Fictional job", company_id: "co", scope: state.scope }),
}));
vi.mock("../board-url", () => ({ signedJobPages: async () => ({}) }));
import { pmMeeting, pmMorningMeeting } from "../tools/flow-tools";

type Reply = { content: { text: string }[]; structuredContent: { card: CardModel; html: string; next_stage: string | null; logged: boolean } };
const call = (args: Row = {}, tool: unknown = pmMeeting) => (tool as { handler: (args: Row, ctx: unknown) => Promise<Reply> }).handler({ job_number: "2701", stage: "schedule", ...args }, {});
const crew = (reply: Reply) => reply.structuredContent.card.sections?.find((s) => s.heading === "Subs, suppliers and crews")?.rows[0].cells[0];
const lock = (reply: Reply) => reply.structuredContent.card.kpis?.find((k) => k.label === "Lookahead")?.value;
beforeEach(() => {
  Object.assign(state, { revision: 2, cpmVersion: 3, failSave: false, failRead: false, scope: "full", haveLookahead: true, sessions: [], calls: [] });
  state.items = [{ id: "crew", job_id: jobId, action: "Subs and crews are not confirmed", check_key: "pm:crews", status: "open", lookahead_id: "la-2701" }];
});

describe("meeting confirmation persistence through the real tool handler", () => {
  it.each(["claude-ai", "ChatGPT"])("%s gets the saved crew check immediately and on a later read", async (host) => {
    const before = await call();
    expect(crew(before)).toContain("Not confirmed");
    const saved = await call({ note: "Subs and crews confirmed, no issues" });
    expect(crew(saved)).toBe("Subs, suppliers and crews: Confirmed");
    expect(saved.content[0].text).toContain("Meeting confirmation saved for this lookahead.");
    expect(saved.content[0].text).not.toContain("Filed on the risk log");
    expect(lock(saved)).toBe("Needed");
    expect(saved.structuredContent.card.ask?.prompt).toBe("Is the two-week lookahead locked in?");
    expect(saved.structuredContent.next_stage).toBe("schedule");
    expect(state.calls.some((c) => c.name === "mcp_add_item")).toBe(false);
    const request = new Request("https://app.meetathena.io/mcp", { method: "POST", headers: { "content-type": "application/json", "user-agent": host }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "pm_meeting", _meta: { "io.modelcontextprotocol/clientInfo": { name: host, version: "test" } } } }) });
    const original = Response.json({ jsonrpc: "2.0", id: 1, result: saved });
    const response = await nativeCardResponse(original, await nativeCardVisit(request));
    const returned = (await response.json()).result as typeof saved;
    expect(returned.structuredContent).toEqual(saved.structuredContent);
    expect(returned.content[0].text).toContain("Meeting confirmation saved for this lookahead.");
    if (host === "ChatGPT") expect(returned.content[0].text).not.toMatch(/<!doctype html|<html/i);
    else expect(response).toBe(original);
    expect(crew(await call())).toBe("Subs, suppliers and crews: Confirmed");
    const morning = await call({ stage: "crews" }, pmMorningMeeting);
    expect(morning.structuredContent.card.kpis).toContainEqual({ label: "Locked in", value: "Yes" });
  });

  it("retains crew and lock confirmations independently across later stages", async () => {
    await call({ note: "Subs and crews confirmed, no problems" });
    const locked = await call({ note: "The lookahead is locked in" });
    expect(lock(locked)).toBe("Locked");
    expect(crew(locked)).toBe("Subs, suppliers and crews: Confirmed");
    expect(locked.structuredContent.next_stage).toBe("change_orders");
    await call({ stage: "accounting", note: "Review the planned bill with Example PM." });
    const reopened = await call();
    expect(lock(reopened)).toBe("Locked");
    expect(crew(reopened)).toBe("Subs, suppliers and crews: Confirmed");
  });

  it("records an explicit named confirmation even when the host has advanced to change orders", async () => {
    await call({ stage: "change_orders", note: "Subs and crews confirmed, nothing open" });
    expect(crew(await call())).toBe("Subs, suppliers and crews: Confirmed");
  });

  it("retains an explicit unlock and does not treat a lock request as approval", async () => {
    await call({ note: "The lookahead is locked in" });
    expect(lock(await call())).toBe("Locked");
    await call({ note: "The lookahead is not locked" });
    expect(lock(await call())).toBe("Open");
    await call({ note: "Please confirm the lookahead is locked" });
    expect(lock(await call())).toBe("Open");
    await call({ note: "The lookahead is unlocked" });
    expect(lock(await call())).toBe("Open");
  });

  it("keeps confirmation unknown without an indexed current lookahead", async () => {
    state.haveLookahead = false;
    const reply = await call({ note: "Subs and crews confirmed, no issues" });
    expect(crew(reply)).not.toBe("Subs, suppliers and crews: Confirmed");
    expect(reply.content[0].text).toContain("Could not verify the meeting confirmation. Try again.");
    expect(state.sessions.every((s) => !(s.snapshot as Row).readiness)).toBe(true);
    expect(state.calls.some((c) => c.name === "mcp_meeting_item_save" || c.name === "mcp_guided_save")).toBe(false);
  });

  it.each(["Subs and crews are not confirmed", "Confirm subs and crews for Monday; no issues elsewhere"])("keeps the check open after a later %s", async (note) => {
    await call({ note: "Subs and crews confirmed, no issues" });
    const negative = await call({ note });
    expect(crew(negative)).toContain("Not confirmed");
    expect(crew(await call())).toContain("Not confirmed");
    expect(state.items[0].status).toBe("open");
  });

  it.each(["lookahead", "cpm"])("invalidates confirmation after the %s revision changes", async (kind) => {
    await call({ note: "Subs and crews confirmed, no issues" });
    await call({ note: "The lookahead is locked in" });
    if (kind === "lookahead") state.revision++; else state.cpmVersion++;
    const changed = await call();
    expect(crew(changed)).not.toBe("Subs, suppliers and crews: Confirmed");
    expect(lock(changed)).toBe("Needed");
  });

  it("does not claim or close a confirmation when the guarded snapshot save fails", async () => {
    state.failSave = true;
    const reply = await call({ note: "Subs and crews confirmed, no issues" });
    expect(crew(reply)).toContain("Not confirmed");
    expect(reply.content[0].text).toContain("Could not verify the meeting confirmation. Try again.");
    expect(state.sessions).toHaveLength(0);
    expect(state.calls.some((c) => c.name === "mcp_meeting_item_save")).toBe(false);
  });

  it("requires a successful read-back instead of promoting a successful write alone", async () => {
    state.failRead = true;
    const reply = await call({ note: "Subs and crews confirmed, no issues" });
    expect(state.sessions).toHaveLength(1);
    expect(crew(reply)).not.toBe("Subs, suppliers and crews: Confirmed");
    expect(reply.content[0].text).toContain("Could not verify the meeting confirmation. Try again.");
  });

  it("does not replay another job's confirmation or an unversioned legacy note", async () => {
    await call({ note: "Subs and crews confirmed, no issues" });
    state.sessions[0].job_id = "other-job";
    state.sessions.push({ id: "old", job_id: jobId, snapshot: { note: "Subs and crews confirmed, no issues" }, created_at: "2026-10-23" });
    expect(crew(await call())).not.toBe("Subs, suppliers and crews: Confirmed");
  });

  it("keeps the existing contract-only gate and sample no-write path", async () => {
    state.scope = "contract";
    const denied = await call({ note: "Subs and crews confirmed, no issues" });
    expect(denied.content[0].text).toContain("full access");
    expect(state.calls).toHaveLength(0);
    state.scope = "full";
    await call({ sample: true, note: "Subs and crews confirmed, no issues" });
    expect(state.calls).toHaveLength(0);
  });
});
