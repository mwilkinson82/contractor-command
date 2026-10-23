import { describe, expect, it, vi } from "vitest";
import { buildFlowCard } from "./build";
import { loadFlowData, saveFlowNote } from "./load";
import { dedupeOpenRows, meetingItem } from "../open-feed";
import { renderHtml } from "../cards/html";
import { paletteViolations } from "../cards/palette";

const job = { job_id: "11111111-1111-4111-8111-111111111111", job_number: "2701", name: "Readiness test", scope: "full" };

function client(items: Record<string, unknown>[] = [], readError = false) {
  const from = vi.fn((table: string) => ({
    select: () => ({ eq: (column: string, value: string) => {
      expect(column).toBe("job_id");
      expect(value).toBe(job.job_id);
      // Even a complete dated lookahead is not a stored lock confirmation.
      const data = table === "mcp_lookaheads"
        ? [{ id: "la", start_date: "2026-10-26", end_date: "2026-11-08" }]
        : items;
      const result = Promise.resolve({ data: readError ? null : data, error: readError ? { message: "Read unavailable" } : null });
      return Object.assign(result, { eq: () => result });
    } }),
  }));
  const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: { found: false }, error: null }));
  return { from, rpc };
}

describe("PM meeting readiness uses evidence, not absence of issues", () => {
  it.each([
    "Subs and crews are not confirmed",
    "Subs and crews aren't confirmed",
    "Subs and crews remain unconfirmed",
    "Confirm subs and crews for Monday",
    "If subs and crews are confirmed, proceed",
    "Subs and crews confirmed except the electrical crew",
    "Are all subs and crews confirmed?",
  ])("keeps the crew item open for %s", (note) => {
    expect(meetingItem(note)).toEqual({ key: "pm:crews", close: false });
  });

  it("passes a negative crew answer to the guarded save as open and preserves meeting deduplication", async () => {
    const sb = client();
    const note = "Subs and crews are not confirmed";
    await saveFlowNote(sb, job.job_id, "pm_meeting", "schedule", note, { note });
    expect(sb.rpc).toHaveBeenCalledWith("mcp_meeting_item_save", {
      _job: job.job_id, _key: "pm:crews", _action: note, _close: false,
    });
    const rows = dedupeOpenRows([
      { id: "old", action: "All subs and crews confirmed", updated_at: "2026-10-20" },
      { id: "new", action: note, updated_at: "2026-10-23" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["new"]);
    expect(meetingItem("All subs, suppliers and crews confirmed")).toEqual({ key: "pm:crews", close: true });
  });

  it("does not confirm crews from an unrelated open item or infer a lock from lookahead dates", async () => {
    const data = await loadFlowData(client([{ id: "a", action: "Confirm owner selections", status: "open" }]), job, false);
    expect(data.items).toHaveLength(1);
    expect(data.lookaheadLocked).toBeNull();
    expect(data.crewsConfirmed).toBeNull();
    expect(data.onSchedule).toBeNull();
    const card = buildFlowCard("pm_meeting", "schedule", data);
    expect(card.state).toBe("ask");
    expect(card.kpis).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Lookahead", value: "Needed" }),
      expect.objectContaining({ label: "On schedule", value: "Needed", flag: null }),
    ]));
    expect(card.sections?.find((s) => s.heading === "Subs, suppliers and crews")?.rows[0].cells[0]).toContain("Needed");
  });

  it("keeps an empty log unknown", async () => {
    const data = await loadFlowData(client(), job, false);
    expect([data.lookaheadLocked, data.crewsConfirmed, data.onSchedule]).toEqual([null, null, null]);
    expect(buildFlowCard("pm_morning", "schedule", data).ask?.prompt).toBe("Are we on schedule against the lookahead?");
  });

  it("does not turn a failed read into an affirmative confirmation", async () => {
    const data = await loadFlowData(client([], true), job, false);
    expect([data.lookaheadLocked, data.crewsConfirmed, data.onSchedule]).toEqual([null, null, null]);
  });

  it("keeps open crew issues unconfirmed and real delay flags red", async () => {
    const data = await loadFlowData(client([
      { id: "crew", action: "Crew delivery unconfirmed", status: "open" },
      { id: "delay", action: "Weather delay", status: "open" },
    ]), job, false);
    expect(data.crewsConfirmed).toBe(false);
    expect(data.onSchedule).toBe(false);
    const card = buildFlowCard("pm_morning", "schedule", data);
    expect(card.kpis?.find((k) => k.label === "On schedule")).toMatchObject({ value: "No", flag: "delay" });
    expect(card.alerts).toContainEqual({ level: "delay", text: "Off the lookahead." });
    const html = renderHtml(card);
    expect(html).toContain("#DC2626");
    expect(paletteViolations(html, true)).toEqual([]);
  });

  it("does not treat a resolved issue as a current PM confirmation", async () => {
    const data = await loadFlowData(client([
      { id: "crew", action: "Subs and crews confirmed", status: "resolved", check_key: "pm:crews" },
      { id: "delay", action: "Old delay", status: "closed" },
    ]), job, true);
    expect(data.items).toEqual([]);
    expect(data.crewsConfirmed).toBeNull();
    expect(data.onSchedule).toBeNull();
  });

  it("preserves current schedule progress, forecast and IOR comparison without writing", async () => {
    const sb = client();
    const current = [{ id: "risk", title: "Drawing conflict", due: "2026-10-29", state: "open" }];
    const previous = [{ ...current[0], due: "2026-10-27" }];
    sb.rpc.mockImplementation(async (fn, args) => ({ data: fn === "mcp_guided_latest"
      ? { found: true, snapshot: { ior: previous } }
      : args._type === "cpm"
        ? { found: true, data: { activities: [{ name: "Foundation", pct_complete: 50, critical: true }] } }
        : args._type === "ior"
          ? { found: true, data: { items: current } }
          : { found: true, contract_total: 1000, data: { billing: { billed_to_date: 200, months: [{ amount: 300, kind: "forecast" }] } } }, error: null }));
    const data = await loadFlowData(sb, job, false);
    expect(data.percentComplete).toBe(50);
    expect(data.money).toMatchObject({ plan: 300, billed: 200, contract: 1000, remaining: 800 });
    expect(data.iorNow).toEqual(current);
    expect(data.iorPrevious).toEqual(previous);
    expect(data.hasSnapshot).toBe(true);
    expect(sb.rpc.mock.calls.every(([fn]) => fn === "mcp_living_report_get" || fn === "mcp_guided_latest")).toBe(true);
  });
});
