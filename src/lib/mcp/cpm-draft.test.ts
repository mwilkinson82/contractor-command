import { beforeEach, describe, expect, it, vi } from "vitest";
import { livingReportSave } from "./tools/living-tools";
import { DRAFT_NOT_OFFICIAL } from "./record-copy";

const state = vi.hoisted(() => ({
  rpcs: [] as [string, Record<string, unknown>][],
  rpc: {} as Record<string, unknown>,
}));

vi.mock("./guard", () => ({
  run: async (_t: string, _c: unknown, _o: unknown, fn: (sb: unknown) => Promise<unknown>) => fn(fakeSb()),
  text: (b: string) => ({ content: [{ type: "text", text: b }] }),
  dbError: (e: { message?: string }) => {
    throw new Error(e.message ?? "database error");
  },
}));
vi.mock("./jobs", () => ({
  FULL_ACCESS_MESSAGE: "full",
  READ_ONLY_MESSAGE: "read-only",
  audit: async () => {},
  prefix: (j: { job_number: string }) => `${j.job_number} – `,
  named: (j: { job_number: string }) => j.job_number,
  resolveJob: async () => ({
    job_id: "11111111-1111-4111-8111-111111111111",
    job_number: "2701",
    name: "Harbor",
    company_id: "22222222-2222-4222-8222-222222222222",
    scope: "full",
  }),
}));
vi.mock("./visible", async () => {
  const actual = await vi.importActual<typeof import("./visible")>("./visible");
  return { ...actual, guide: (r: unknown, ...lines: string[]) => ({ ...(r as object), guidance: lines.filter(Boolean) }) };
});

function fakeSb() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcs.push([fn, args]);
      return { data: state.rpc[fn] ?? {}, error: null };
    },
  };
}

const activity = {
  id: "W1",
  name: "What-if slab",
  duration: 5,
  start: "2026-10-01",
  finish: "2026-10-07",
  predecessors: [],
  total_float: 0,
  critical: true,
  pct_complete: 0,
  value: 100,
  sov_line: null,
  cost_code: null,
};

const handle = (args: Record<string, unknown>) =>
  (livingReportSave as { handler: (a: Record<string, unknown>, c: unknown) => Promise<{ content: { text: string }[]; structuredContent: Record<string, unknown> }> }).handler(args, {});

beforeEach(() => {
  state.rpcs = [];
  state.rpc = {
    mcp_living_report_get: { found: true, version: 4, data: { activities: [{ id: "A1", name: "Official slab" }] } },
    mcp_cpm_draft_save: { id: "draft-1", version: 1, reused: true, label: DRAFT_NOT_OFFICIAL },
  };
});

describe("living_report_save CPM draft", () => {
  it("writes the view onto the stored draft and leaves the official version untouched", async () => {
    const result = await handle({
      job_number: "2701",
      report_type: "cpm",
      base_version: 2,
      approved: true,
      what_changed: "Compressed the slab",
      activities: [activity],
      copy: "draft",
    });
    const calls = state.rpcs.map(([fn]) => fn);
    expect(calls).toContain("mcp_cpm_draft_save");
    expect(calls).not.toContain("mcp_living_report_save");
    expect(state.rpcs.find(([fn]) => fn === "mcp_cpm_draft_save")?.[1]).toMatchObject({
      _what: "Compressed the slab",
      _data: { activities: [activity] },
    });
    expect(result.content[0].text).toContain(DRAFT_NOT_OFFICIAL);
    expect(result.content[0].text).toContain("Official CPM stays at v4.");
    expect(result.structuredContent).toMatchObject({
      saved: true,
      copy: "draft",
      label: DRAFT_NOT_OFFICIAL,
      official_version: 4,
      reused: true,
    });
  });

  it("refuses a draft copy of any report other than the CPM", async () => {
    await expect(handle({
      job_number: "2701",
      report_type: "billing_forecast",
      base_version: 0,
      approved: true,
      what_changed: "What-if bill",
      copy: "draft",
    })).rejects.toThrow("A draft copy is only for the CPM. Nothing was saved.");
    expect(state.rpcs).toEqual([]);
  });
});
