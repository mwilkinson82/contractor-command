import { beforeEach, describe, expect, it, vi } from "vitest";
import { paletteViolations } from "./cards/palette";

const JOB = "323a040a-7ed1-4726-8f6a-da13fdb5a0eb";

const state = vi.hoisted(() => {
  const box = {
    rows: [] as Record<string, unknown>[],
    writes: [] as string[],
    rpcs: [] as string[],
    filters: [] as { table: string; col: string; val: string }[],
    sb() {
      return {
        from(table: string) {
          let rows: Record<string, unknown>[] =
            table === "mcp_companies"
              ? [{ id: "alp", name: "ALP Construction" }, { id: "aop", name: "AOP Construction" }]
              : table === "mcp_jobs"
                ? [{ id: JOB, job_number: "2701", name: "Harbor Point", company_id: "aop", time_zone: "America/New_York" }]
                : table === "mcp_submittals"
                  ? box.rows
                  : table === "mcp_user_settings"
                    ? [{ current_company: "alp" }]
                    : [];
          const api = {
            select() { return api; },
            eq(col: string, val: string) {
              box.filters.push({ table, col, val });
              rows = rows.filter((row) => row[col] === val);
              return api;
            },
            order() { return api; },
            limit() { return api; },
            in() { return api; },
            maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
            insert() { box.writes.push(`insert ${table}`); return Promise.resolve({ data: null, error: null }); },
            update() { box.writes.push(`update ${table}`); return Promise.resolve({ data: null, error: null }); },
            then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) {
              return Promise.resolve({ data: rows, error: null }).then(ok, bad);
            },
          };
          return api;
        },
        rpc(fn: string, args?: { _company?: string; _job_number?: string }) {
          box.rpcs.push(fn);
          if (fn === "mcp_resolve_job") {
            if (args?._company === "aop" && args._job_number === "2701") {
              return Promise.resolve({ data: { job_id: JOB, job_number: "2701", name: "Harbor Point", company_id: "aop", scope: "full" }, error: null });
            }
            return Promise.resolve({ data: { not_found: true, suggestions: [] }, error: null });
          }
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
  dbError: (e: { message?: string }) => { throw new Error(e?.message ?? "db"); },
  isMissingFunction: () => false,
}));

import { submittalLog, submittalsList } from "./tools/submittal-tools";

type Reply = {
  content: { type: string; text?: string }[];
  structuredContent: { card: { title: string }; html: string; job_id?: string };
};

const list = (args: Record<string, unknown>) =>
  (submittalsList as unknown as { handler: (a: Record<string, unknown>, c: unknown) => Promise<Reply> }).handler(args, {});
const log = (args: Record<string, unknown>) =>
  (submittalLog as unknown as { handler: (a: Record<string, unknown>, c: unknown) => Promise<Reply> }).handler(args, {});

function row(over: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    job_id: JOB,
    number: "001",
    revision: 0,
    spec_section: "26 24 16",
    title: "Switchgear product data",
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

beforeEach(() => {
  state.rows = [row(), row({ id: "22222222-2222-4222-8222-222222222222", number: "002", title: "Lighting shop drawing" })];
  state.writes = [];
  state.rpcs = [];
  state.filters = [];
});

describe("submittal job resolution is the same for every caller", () => {
  it("opens 2701 on the company that has it, from either tool, even when the other company is named", async () => {
    const calls = [
      list({ job_number: "2701", company_id: "alp" }),
      list({ job_number: "2701" }),
      list({ job_number: "2701", company_id: "ALP Construction" }),
      log({ action: "add", job_number: "2701", company_id: "alp" }),
      log({ action: "add", job_number: "2701" }),
    ];
    const results = await Promise.all(calls);
    for (const result of results) {
      expect(result.structuredContent.job_id).toBe(JOB);
      expect(result.structuredContent.card.title).toBe("Submittal log");
      expect(result.content[0].text).toContain("Switchgear product data");
      expect(result.content[0].text).toContain("Lighting shop drawing");
      expect(result.content[0].text).toContain("<!doctype html");
    }
    const reads = state.filters.filter((f) => f.table === "mcp_submittals" && f.col === "job_id");
    expect(reads.length).toBeGreaterThanOrEqual(5);
    expect(new Set(reads.map((f) => f.val))).toEqual(new Set([JOB]));
    expect(state.rpcs).not.toContain("mcp_submittal_log");
    expect(state.rpcs).not.toContain("mcp_submittal_rows");
    // A read mints only the 24-hour board token that signs each row's record link.
    expect(state.writes.filter((w) => w !== "rpc mcp_board_link_create")).toEqual([]);
  });

  it("returns a styled empty card from both tools and writes nothing", async () => {
    state.rows = [];
    state.filters = [];
    state.rpcs = [];
    const listed = await list({ job_number: "2701", company_id: "alp" });
    const logged = await log({ action: "add", job_number: "2701", company_id: "aop" });
    for (const result of [listed, logged]) {
      const text = result.content[0].text ?? "";
      expect(result.structuredContent.card.title).toBe("Submittal log");
      expect(result.structuredContent.job_id).toBe(JOB);
      expect(text).toContain("<!doctype html");
      expect(text).toContain("No submittals on this job yet.");
      expect(text).toContain("log a submittal");
      expect(paletteViolations(result.structuredContent.html, false)).toEqual([]);
    }
    expect(state.writes.filter((w) => w !== "rpc mcp_board_link_create")).toEqual([]);
    expect(state.rpcs).not.toContain("mcp_submittal_log");
  });
});
