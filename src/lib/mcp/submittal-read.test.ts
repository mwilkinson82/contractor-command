import { beforeEach, describe, expect, it, vi } from "vitest";
import { paletteViolations } from "./cards/palette";
import { runSweep } from "./sweep";

const JOB_2701 = "323a040a-7ed1-4726-8f6a-da13fdb5a0eb";
const JOB_3101 = "a0b31010-0000-4000-8000-000000003101";

const state = vi.hoisted(() => {
  const box = {
    rows: [] as Record<string, unknown>[],
    writes: [] as string[],
    filters: [] as { table: string; col: string; val: string }[],
    rpcs: [] as string[],
    sb() {
      return {
        from(table: string) {
          const chain = {
            select() { return chain; },
            eq(col: string, val: string) { box.filters.push({ table, col, val }); return chain; },
            order() { return chain; },
            limit() { return Promise.resolve({ data: table === "mcp_submittals" ? box.rows : [], error: null }); },
            maybeSingle() { return Promise.resolve({ data: null, error: null }); },
            insert() { box.writes.push(`insert ${table}`); return Promise.resolve({ data: null, error: null }); },
          };
          return chain;
        },
        rpc(fn: string) {
          box.rpcs.push(fn);
          box.writes.push(`rpc ${fn}`);
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  return box;
});

vi.mock("./guard", () => ({
  run: async (_t: string, _c: unknown, _o: unknown, fn: (sb: unknown) => Promise<unknown>) => fn(state.sb()),
  text: (b: string) => ({ content: [{ type: "text", text: b }] }),
  dbError: (e: { message?: string }) => { throw new Error(e.message ?? "db"); },
  isMissingFunction: () => false,
}));

vi.mock("./jobs", () => ({
  FULL_ACCESS_MESSAGE: "This needs full access to the job.",
  audit: async () => {},
  jobTimeZone: async () => "America/New_York",
  prefix: (job: { job_number: string }) => `${job.job_number} – `,
  resolveJob: async (_sb: unknown, jobNumber: string) => ({
    job_id: jobNumber === "3101" ? "a0b31010-0000-4000-8000-000000003101" : "323a040a-7ed1-4726-8f6a-da13fdb5a0eb",
    job_number: jobNumber,
    name: jobNumber === "3101" ? "AOP demo" : "Harbor Point",
    company_id: "company",
    scope: "full" as const,
  }),
}));

vi.mock("./tools/workflow-tools", () => ({
  namedOrSoleJob: async (_sb: unknown, jobNumber?: string) => (jobNumber ? { job_number: jobNumber, company_id: "other-company" } : null),
  listCompaniesAndJobs: async () => "No job named.",
}));

import { submittalsList } from "./tools/submittal-tools";

type Reply = { content: { type: string; text?: string }[]; structuredContent: { card: { title?: string; sections?: { heading: string; columns?: string[]; rows: { cells: string[]; flag?: string | null }[] }[]; kpis?: { label: string; value: string; flag?: string | null }[] }; html: string; job_id?: string } };

const call = (args: Record<string, unknown>) => (submittalsList as unknown as { handler: (a: Record<string, unknown>, c: unknown) => Promise<Reply> }).handler(args, {});

function row(over: Record<string, unknown>) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    revision: 0,
    spec_section: "26 24 16",
    submittal_type: "product_data",
    status: "submitted",
    ball_in_court: "architect_engineer",
    ball_in_court_name: "Bayline",
    source: "user",
    required: true,
    required_by: "2026-10-01",
    submitted_on: "2026-10-01",
    due_back: "2099-01-01",
    returned_on: null,
    review_days: 14,
    ...over,
  };
}

const DEMO_3101 = [
  row({ id: "11111111-1111-4111-8111-111111111101", number: "001", title: "Switchgear product data", due_back: "2020-01-15", returned_on: null }),
  row({ id: "11111111-1111-4111-8111-111111111102", number: "002", title: "Lighting shop drawing", status: "in_prep", ball_in_court: "sub", ball_in_court_name: "Harbor Electric", due_back: "2099-06-01" }),
  row({ id: "11111111-1111-4111-8111-111111111103", number: "003", title: "Floor box sample", status: "approved", ball_in_court: "gc", ball_in_court_name: "ALP Field", due_back: "2020-02-01", returned_on: "2020-02-02" }),
  row({ id: "11111111-1111-4111-8111-111111111104", number: "004", title: "Panelboard warranty", status: "in_review", ball_in_court: "owner", ball_in_court_name: "Harbor Owner", due_back: "2099-03-01" }),
];

beforeEach(() => {
  state.rows = [];
  state.writes = [];
  state.filters = [];
  state.rpcs = [];
});

describe("submittal log read", () => {
  it("reads mcp_submittals for the job id and inserts nothing", async () => {
    state.rows = DEMO_3101;
    const result = await call({ job_number: "3101", company_id: "other-company" });
    const text = result.content[0].text ?? "";
    expect(state.writes).toEqual([]);
    expect(state.rpcs).not.toContain("mcp_living_report_get");
    expect(state.rpcs).not.toContain("mcp_submittal_rows");
    expect(state.rpcs).not.toContain("mcp_add_item");
    expect(state.rpcs).not.toContain("mcp_board_link_create");
    expect(state.filters).toContainEqual({ table: "mcp_submittals", col: "job_id", val: JOB_3101 });
    expect(state.filters.some((f) => f.col === "company_id")).toBe(false);
    expect(result.structuredContent.job_id).toBe(JOB_3101);
    const log = result.structuredContent.card.sections?.find((section) => section.heading === "Log");
    expect(log?.columns).toEqual(["Number", "Title", "Spec section", "Transmittal", "Revision", "Status", "Ball in court", "Due", "Overdue", "Package delivery"]);
    expect(log?.rows).toHaveLength(4);
    for (const title of ["Switchgear product data", "Lighting shop drawing", "Floor box sample", "Panelboard warranty"]) {
      expect(text).toContain(title);
    }
    expect(log?.rows[0].flag).toBe("overdue");
    expect(text).toContain("#1E3A5F");
    expect(text).toContain("#1E5FED");
    expect(paletteViolations(result.structuredContent.html, true)).toEqual([]);
    expect(result.structuredContent.html).toContain("#DC2626");
  });

  it("says the job has no submittals and points at setup", async () => {
    const result = await call({ job_number: "2701", company_id: "other-company" });
    const text = result.content[0].text ?? "";
    expect(state.filters).toContainEqual({ table: "mcp_submittals", col: "job_id", val: JOB_2701 });
    expect(state.writes).toEqual([]);
    expect(text).toContain("No submittals on this job yet.");
    expect(text).toContain("log a submittal");
    expect(text).toContain("<!doctype html");
    expect(result.structuredContent.card.title).toBe("Submittal log");
    expect(text).not.toContain("A1020");
    expect(paletteViolations(result.structuredContent.html, false)).toEqual([]);
  });
});

describe("date sweep on a read", () => {
  it("does not create a lookahead when the job has no time zone", async () => {
    const writes: string[] = [];
    const jobs = [{ id: JOB_2701, job_number: "2701", name: "Harbor Point", time_zone: null, company_id: "company" }];
    const sb = {
      from(table: string) {
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          not() { return chain; },
          in() { return chain; },
          insert() { writes.push(`insert ${table}`); return Promise.resolve({ error: null }); },
          maybeSingle() { return Promise.resolve({ data: table === "mcp_jobs" ? jobs[0] : null, error: null }); },
          then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) {
            return Promise.resolve({ data: table === "mcp_jobs" ? jobs : [], error: null }).then(ok, bad);
          },
        };
        return chain;
      },
      rpc(fn: string) {
        writes.push(fn);
        if (fn === "mcp_job_scope") return Promise.resolve({ data: "full", error: null });
        return Promise.resolve({ data: null, error: null });
      },
    };
    const sweep = await runSweep(sb as never, { jobNumber: "2701" });
    expect(sweep?.text).toContain("2701");
    expect(writes).not.toContain("mcp_add_item");
    expect(writes.some((w) => w.startsWith("insert"))).toBe(false);
  });
});
