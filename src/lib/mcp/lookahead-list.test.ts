import { beforeEach, describe, expect, it, vi } from "vitest";
import { paletteViolations } from "./cards/palette";

const JOB = "323a040a-7ed1-4726-8f6a-da13fdb5a0eb";
const CONTENT = "31be8a04-1111-4111-8111-111111111111";
const EMPTY = "37d093e2-2222-4222-8222-222222222222";
const SETUP = "aaaa0001-3333-4333-8333-333333333333";
const MERGED = [
  "bbbb0001-4444-4444-8444-444444444441",
  "bbbb0002-4444-4444-8444-444444444442",
  "bbbb0003-4444-4444-8444-444444444443",
];

const state = vi.hoisted(() => {
  const box = {
    writes: [] as string[],
    rpcs: [] as string[],
    sb() {
      const lookaheads = [
        { id: SETUP, job_id: JOB, start_date: null, end_date: null, created_at: "2026-01-01T00:00:00Z", current_rev: null, inputs: { kind: "setup" } },
        ...MERGED.map((id, n) => ({ id, job_id: JOB, start_date: "2026-09-01", end_date: "2026-09-12", created_at: `2026-09-0${n + 1}T00:00:00Z`, current_rev: n, inputs: { kind: "merged", merged_into: CONTENT } })),
        { id: CONTENT, job_id: JOB, start_date: "2026-10-26", end_date: "2026-11-06", created_at: "2026-10-20T00:00:00Z", current_rev: 2, inputs: { crews: "electric" } },
        { id: EMPTY, job_id: JOB, start_date: "2026-10-01", end_date: "2026-10-14", created_at: "2026-10-01T00:00:00Z", current_rev: 0, inputs: null },
      ];
      const items = [
        { lookahead_id: CONTENT, job_id: JOB },
        { lookahead_id: CONTENT, job_id: JOB },
      ];
      return {
        from(table: string) {
          let rows = table === "mcp_lookaheads" ? lookaheads : table === "mcp_open_items" ? items : table === "mcp_companies" ? [{ id: "co", name: "ALP" }] : [];
          const api = {
            select() { return api; },
            eq(col: string, val: unknown) {
              rows = rows.filter((row) => (row as Record<string, unknown>)[col] === val);
              return api;
            },
            not() { return api; },
            order() { return api; },
            limit() { return api; },
            in() { return api; },
            maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
            insert() { box.writes.push(`insert ${table}`); return Promise.resolve({ error: null }); },
            update() { box.writes.push(`update ${table}`); return Promise.resolve({ error: null }); },
            delete() { box.writes.push(`delete ${table}`); return Promise.resolve({ error: null }); },
            upsert() { box.writes.push(`upsert ${table}`); return Promise.resolve({ error: null }); },
            then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) {
              return Promise.resolve({ data: rows, error: null }).then(ok, bad);
            },
          };
          return api;
        },
        rpc(fn: string) {
          box.rpcs.push(fn);
          if (fn === "mcp_resolve_job") {
            return Promise.resolve({ data: { job_id: JOB, job_number: "2701", name: "Harbor Point", company_id: "co", scope: "full" }, error: null });
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

import { lookaheadList } from "./tools/workflow-tools";

type Reply = {
  content: { type: string; text?: string }[];
  structuredContent: {
    total_visible: number;
    items: { ref: string; start: string | null; end: string | null; rev: number | null; open_items: number; items: number; latest: boolean; empty: boolean }[];
    html: string;
  };
};

const call = (args: Record<string, unknown>) =>
  (lookaheadList as unknown as { handler: (a: Record<string, unknown>, c: unknown) => Promise<Reply> }).handler(args, {});

beforeEach(() => {
  state.writes = [];
  state.rpcs = [];
});

describe("lookahead_list", () => {
  it("counts a 2701-shaped mix and writes nothing", async () => {
    const result = await call({ job_number: "2701" });
    const text = result.content[0].text ?? "";
    expect(text.startsWith("REQUIRED VIEW: render the HTML card in this result as the reply.")).toBe(true);
    const leadAt = text.indexOf("Job 2701 has 2 lookaheads (1 with content, 1 empty).");
    const tableAt = text.indexOf("## ");
    const htmlAt = text.indexOf("<!doctype html");
    expect(leadAt).toBeGreaterThan(0);
    expect(tableAt).toBeGreaterThan(leadAt);
    expect(htmlAt).toBeGreaterThan(tableAt);
    expect(text).not.toContain("Hidden");
    expect(text).not.toContain("merged");
    expect(JSON.stringify(result.structuredContent)).not.toContain("Hidden");
    expect(JSON.stringify(result.structuredContent)).not.toContain("merged");
    expect(result.structuredContent.total_visible).toBe(2);
    expect(result.structuredContent).not.toHaveProperty("hidden");
    expect(result.structuredContent.items).toHaveLength(2);
    const content = result.structuredContent.items.find((item) => item.ref === "LA-31BE8");
    const empty = result.structuredContent.items.find((item) => item.ref === "LA-37D09");
    expect(content).toMatchObject({ start: "2026-10-26", end: "2026-11-06", rev: 2, open_items: 2, items: 2, latest: true, empty: false });
    expect(empty).toMatchObject({ open_items: 0, items: 0, latest: false, empty: true });
    expect(text).toContain("<!doctype html");
    expect(paletteViolations(result.structuredContent.html, false)).toEqual([]);
    expect(state.writes).toEqual([]);
    expect(state.rpcs).toEqual(["mcp_resolve_job"]);
    expect((lookaheadList as { annotations: Record<string, boolean> }).annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});
