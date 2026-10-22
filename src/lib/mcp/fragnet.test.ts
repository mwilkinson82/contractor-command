import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHtml } from "./cards/html";
import { renderMarkdown } from "./cards/markdown";
import { paletteViolations } from "./cards/palette";
import {
  buildFragnet,
  fragnetCard,
  nextFragnetId,
  scheduleActivities,
  type FragActivity,
  type LogicLink,
} from "./fragnet";

function act(over: Partial<FragActivity> & Pick<FragActivity, "id" | "name" | "duration" | "start" | "finish"> & { predecessors?: LogicLink[] }): FragActivity {
  return {
    total_float: 0,
    critical: false,
    pct_complete: 0,
    value: 0,
    sov_line: null,
    cost_code: null,
    predecessors: [],
    ...over,
  };
}

/** A1040 drives A1070. D1060 is already on the job and is not the critical path. Weekdays only. */
function harbor2701(): FragActivity[] {
  return [
    act({ id: "A1040", name: "Pour footings", duration: 10, start: "2026-10-19", finish: "2026-10-30", total_float: 0, critical: true }),
    act({ id: "A1070", name: "Switchgear install", duration: 10, start: "2026-11-02", finish: "2026-11-13", predecessors: [{ id: "A1040", type: "FS" }], total_float: 0, critical: true }),
    act({ id: "A1080", name: "Interior rough", duration: 5, start: "2026-11-02", finish: "2026-11-06", predecessors: [{ id: "A1040", type: "FS" }], total_float: 5 }),
    act({ id: "D1060", name: "Switchgear delay", duration: 3, start: "2026-11-02", finish: "2026-11-04", predecessors: [{ id: "A1040", type: "FS" }], total_float: 8 }),
    act({ id: "A1300", name: "Substantial completion", duration: 0, start: "2026-11-16", finish: "2026-11-16", predecessors: [{ id: "A1070", type: "FS" }, { id: "A1080", type: "FS" }], total_float: 0, critical: true }),
  ];
}

const supplier = { description: "Supplier delay", duration: 10, successors: ["A1070"], predecessor: "A1040" };

describe("fragnet CPM", () => {
  it("reproduces the saved inclusive dates, then inserts a 10 working-day delay on A1070", () => {
    const saved = harbor2701();
    const baseline = scheduleActivities(saved, []);
    expect(baseline.find((a) => a.id === "A1040")).toMatchObject({ start: "2026-10-19", finish: "2026-10-30", total_float: 0, critical: true });
    expect(baseline.find((a) => a.id === "A1070")).toMatchObject({ start: "2026-11-02", finish: "2026-11-13", total_float: 0, critical: true });
    expect(baseline.find((a) => a.id === "A1080")).toMatchObject({ start: "2026-11-02", finish: "2026-11-06", total_float: 5, critical: false });
    expect(baseline.find((a) => a.id === "D1060")).toMatchObject({ start: "2026-11-02", finish: "2026-11-04", total_float: 8, critical: false });
    expect(baseline.find((a) => a.id === "A1300")).toMatchObject({ start: "2026-11-16", finish: "2026-11-16", total_float: 0, critical: true });

    expect(nextFragnetId(saved, ["A1070"])).toBe("D1070");
    const plan = buildFragnet(saved, supplier, []);
    expect(plan.delayId).toBe("D1070");
    expect(plan.predecessorId).toBe("A1040");
    expect(plan.oldFinish).toBe("2026-11-16");
    expect(plan.newFinish).toBe("2026-11-30");
    expect(plan.impactWd).toBe(10);
    expect(plan.delay).toMatchObject({ start: "2026-11-02", finish: "2026-11-13", duration: 10, total_float: 0, critical: true });
    expect(plan.activities.find((a) => a.id === "A1070")).toMatchObject({ start: "2026-11-16", finish: "2026-11-27", total_float: 0 });
    expect(plan.activities.find((a) => a.id === "A1300")).toMatchObject({ start: "2026-11-30", finish: "2026-11-30", total_float: 0 });
    expect(plan.activities.find((a) => a.id === "A1040")).toMatchObject({ start: "2026-10-19", finish: "2026-10-30" });
    expect(plan.activities.find((a) => a.id === "A1080")).toMatchObject({ start: "2026-11-02", finish: "2026-11-06", total_float: 15, critical: false });
    expect(plan.activities.find((a) => a.id === "D1060")?.start).toBe("2026-11-02");
    expect(plan.criticalPath).toEqual(["A1040", "D1070", "A1070", "A1300"]);
    expect(plan.drivenIds.sort()).toEqual(["A1070", "A1300", "D1070"]);
    expect(plan.moved.map((m) => m.id).sort()).toEqual(["A1070", "A1300", "D1070"]);
    const gear = plan.activities.find((a) => a.id === "A1070")!;
    expect(gear.predecessors.map((p) => p.id)).toEqual(["D1070"]);
    expect(plan.delay.predecessors).toEqual([{ id: "A1040", type: "FS", lag: 0 }]);
  });

  it("infers the driving predecessor and keeps an off-critical delay from moving completion", () => {
    const acts = harbor2701();
    const inferred = buildFragnet(acts, { description: "Supplier delay", duration: 10, successors: ["A1070"] }, []);
    expect(inferred.predecessorId).toBe("A1040");
    expect(inferred.delayId).toBe("D1070");

    const withFloat = [
      ...acts.filter((a) => a.id !== "A1300").map((a) => (a.id === "A1070" ? { ...a, duration: 5, finish: "2026-11-06" } : a)),
      act({ id: "A1090", name: "Long lead path", duration: 15, start: "2026-11-02", finish: "2026-11-20", predecessors: [{ id: "A1040", type: "FS" }] }),
      act({ id: "A1300", name: "Substantial completion", duration: 0, start: "2026-11-23", finish: "2026-11-23", predecessors: [{ id: "A1070", type: "FS" }, { id: "A1090", type: "FS" }] }),
    ];
    const absorbed = buildFragnet(withFloat, { description: "Supplier delay", duration: 10, successors: ["A1070"], predecessor: "A1040" }, []);
    expect(absorbed.oldFinish).toBe("2026-11-23");
    expect(absorbed.newFinish).toBe("2026-11-23");
    expect(absorbed.impactWd).toBe(0);
    expect(absorbed.activities.find((a) => a.id === "A1070")?.start).toBe("2026-11-16");
  });

  it("schedules a start-to-start link on the same working-day calendar", () => {
    const scheduled = scheduleActivities(
      [
        act({ id: "A1000", name: "Layout", duration: 5, start: "2026-10-19", finish: "2026-10-23" }),
        act({ id: "A1010", name: "Follow", duration: 2, start: "2026-10-19", finish: "2026-10-20", predecessors: [{ id: "A1000", type: "SS", lag: 0 }] }),
      ],
      [],
    );
    expect(scheduled.find((a) => a.id === "A1010")).toMatchObject({ start: "2026-10-19", finish: "2026-10-20" });
  });

  it("paints the delay and the path it drives red, and leaves the rest on the normal palette", () => {
    const plan = buildFragnet(harbor2701(), supplier, []);
    const card = fragnetCard(plan, { job: "2701 – Harbor Point", saved: false });
    const html = renderHtml(card);
    const markdown = renderMarkdown(card);
    const schedule = card.sections?.find((s) => s.heading === "Schedule");
    const row = (id: string) => schedule?.rows.find((r) => r.cells[0].includes(id));
    expect(row("D1070")?.flag).toBe("delay");
    expect(row("A1070")?.flag).toBe("delay");
    expect(row("A1300")?.flag).toBe("delay");
    expect(row("A1040")?.flag ?? null).toBeNull();
    expect(row("A1080")?.flag ?? null).toBeNull();
    expect(row("D1060")?.flag ?? null).toBeNull();
    expect(html).toContain("#1E3A5F");
    expect(html).toContain("#1E5FED");
    expect(html).toContain("#6B7280");
    expect(html).toContain("#DC2626");
    expect(html).toContain('data-alert="delay"');
    const scheduleHtml = html.split("<h2>Schedule</h2>")[1]?.split("<h2>")[0] ?? "";
    const rows = scheduleHtml.split("<tr ").slice(1);
    const delayRow = rows.find((part) => part.includes("D1070"));
    const footingRow = rows.find((part) => part.includes("A1040"));
    expect(delayRow).toContain('data-alert="delay"');
    expect(footingRow).not.toContain("data-alert");
    expect(paletteViolations(html, true)).toEqual([]);
    expect(paletteViolations(markdown, true)).toEqual([]);
    expect(markdown).toContain("Old finish");
    expect(markdown).toContain("Nov 16, 2026");
    expect(markdown).toContain("Nov 30, 2026");
    expect(markdown).toContain("+10 working days");
    expect(card.ask?.prompt).toBe("Save this fragnet?");
  });
});

const state = vi.hoisted(() => ({
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  writes: [] as string[],
}));

vi.mock("./guard", () => ({
  run: async (_tool: string, _ctx: unknown, _opts: unknown, fn: (sb: unknown) => Promise<unknown>) => fn(stateSb()),
  text: (body: string) => ({ content: [{ type: "text", text: body }] }),
  dbError: (e: { message?: string }) => {
    throw new Error(e.message ?? "db");
  },
}));

function stateSb() {
  return {
    from() {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        insert() { state.writes.push("insert"); return Promise.resolve({ data: null, error: null }); },
        update() { state.writes.push("update"); return chain; },
        delete() { state.writes.push("delete"); return chain; },
      };
      return chain;
    },
    rpc(fn: string, args: Record<string, unknown>) {
      state.rpcs.push({ fn, args });
      if (fn === "mcp_living_report_get") {
        return Promise.resolve({
          data: {
            found: true,
            version: 3,
            data_date: "2026-10-19",
            contract_total: 0,
            contract_completion_date: "2026-11-16",
            data: { activities: harbor2701() },
          },
          error: null,
        });
      }
      if (fn === "mcp_living_report_save") return Promise.resolve({ data: { id: "report-1", version: 4 }, error: null });
      if (fn === "mcp_delay_event_add") return Promise.resolve({ data: { delay_event_id: "event-1", start_known: true, notice_item: {}, claim_item: {} }, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

vi.mock("./jobs", () => ({
  FULL_ACCESS_MESSAGE: "This needs full access to the job.",
  audit: async (sb: { rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown> }, _job: unknown, _tool: string, action: string) => {
    await sb.rpc("mcp_audit", { action });
  },
  named: (job: { job_number: string; name?: string }) => `${job.job_number} – ${job.name ?? ""}`.trim(),
  resolveJob: async () => ({
    job_id: "323a040a-7ed1-4726-8f6a-da13fdb5a0eb",
    job_number: "2701",
    name: "Harbor Point",
    company_id: "company",
    scope: "full" as const,
  }),
}));

import { fragnetPreview, fragnetSave } from "./tools/fragnet-tools";

type Reply = {
  content: { type: string; text?: string }[];
  structuredContent: {
    saved: boolean;
    preview: boolean;
    fragnet_id: string;
    old_finish: string;
    new_finish: string;
    impact_workdays: number;
    critical_path: string[];
    activities: FragActivity[];
    version?: number;
    delay_event_id?: string;
    card: { title: string; sections?: { heading: string; rows: { cells: string[]; flag?: string | null }[] }[] };
    html: string;
  };
};

const ask = { job_number: "2701", description: "Supplier delay", duration_workdays: 10, successors: ["A1070"], predecessor: "A1040" };
const callPreview = () => (fragnetPreview as unknown as { handler: (a: typeof ask, c: unknown) => Promise<Reply> }).handler(ask, {});
const callSave = () => (fragnetSave as unknown as { handler: (a: typeof ask & { confirm: true }, c: unknown) => Promise<Reply> }).handler({ ...ask, confirm: true }, {});

describe("fragnet tools", () => {
  beforeEach(() => {
    state.rpcs = [];
    state.writes = [];
  });

  it("previews the 2701 supplier delay and writes nothing", async () => {
    const result = await callPreview();
    const names = state.rpcs.map((r) => r.fn);
    expect(names).toContain("mcp_living_report_get");
    expect(names).not.toContain("mcp_living_report_save");
    expect(names).not.toContain("mcp_delay_event_add");
    expect(state.writes).toEqual([]);
    expect(result.structuredContent.saved).toBe(false);
    expect(result.structuredContent.preview).toBe(true);
    expect(result.structuredContent.fragnet_id).toBe("D1070");
    expect(result.structuredContent.old_finish).toBe("2026-11-16");
    expect(result.structuredContent.new_finish).toBe("2026-11-30");
    expect(result.structuredContent.impact_workdays).toBe(10);
    expect(result.structuredContent.critical_path).toEqual(["A1040", "D1070", "A1070", "A1300"]);
    expect(result.content[0].text).toContain("Nothing is saved yet.");
    expect(result.content[0].text).toContain("#DC2626");
    expect(result.structuredContent.card.title).toBe("Fragnet preview");
  });

  it("saves the fragnet onto the CPM and records a delay event only after confirm", async () => {
    const result = await callSave();
    const save = state.rpcs.find((r) => r.fn === "mcp_living_report_save");
    const event = state.rpcs.find((r) => r.fn === "mcp_delay_event_add");
    expect(save).toBeTruthy();
    expect(event).toBeTruthy();
    const data = save!.args._data as {
      activities: FragActivity[];
      tia: { fragnet: string; prior_completion: string; updated_completion: string };
      delay_analysis: { fragnet: string; delay_workdays: number; completion_impact_workdays: number; predecessor: string };
    };
    expect(save!.args._base_version).toBe(3);
    expect(save!.args._type).toBe("cpm");
    expect(save!.args._replace_completion).toBe(false);
    expect(data.tia).toMatchObject({ fragnet: "D1070", prior_completion: "2026-11-16", updated_completion: "2026-11-30" });
    expect(data.delay_analysis).toMatchObject({ fragnet: "D1070", delay_workdays: 10, completion_impact_workdays: 10, predecessor: "A1040" });
    expect(data.activities.map((a) => a.id)).toEqual(expect.arrayContaining(["A1040", "A1070", "A1080", "D1060", "A1300", "D1070"]));
    expect(data.activities.find((a) => a.id === "A1070")?.predecessors[0].id).toBe("D1070");
    expect(data.activities.find((a) => a.id === "D1060")?.id).toBe("D1060");
    const payload = event!.args._d as { description: string; days: number; start_date: string; activity: string };
    expect(payload.description).toBe("Supplier delay");
    expect(payload.days).toBe(10);
    expect(payload.start_date).toBe("2026-11-02");
    expect(payload.activity).toContain("D1070");
    expect(event!.args._notice).toBeNull();
    expect(result.structuredContent.saved).toBe(true);
    expect(result.structuredContent.version).toBe(4);
    expect(result.structuredContent.delay_event_id).toBe("event-1");
    expect(result.structuredContent.card.title).toBe("Fragnet saved");
    expect(result.content[0].text).toContain("Saved on the schedule");
  });
});
