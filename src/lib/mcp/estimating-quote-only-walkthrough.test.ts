/* End-to-end local fixture: actual handlers and guarded SQL RPCs on PGlite.
 * No network, live records, browser host, or real drawing accuracy is involved. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { fakeClient } from "../../../tests/mcp-roles/fake-supabase";

const state = vi.hoisted(() => ({
  client: null as null | { rpc: (name: string, args: Record<string, unknown>) => Promise<unknown> },
  loseSaveResponse: false,
  failBeforeSave: false,
  injectQuotesBeforeSave: null as null | unknown[],
}));
vi.mock("./guard", () => ({
  run: async (_name: string, _ctx: unknown, _opts: unknown, fn: (sb: unknown) => unknown) =>
    fn({
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (!state.client) throw new Error("Local database unavailable");
        if (name === "mcp_estimate_coverage_save" && state.failBeforeSave) {
          state.failBeforeSave = false;
          return { data: null, error: { message: "Interrupted before save" } };
        }
        if (name === "mcp_estimate_pricing_save_versioned" && state.injectQuotesBeforeSave) {
          const quotes = state.injectQuotesBeforeSave;
          state.injectQuotesBeforeSave = null;
          const concurrent = (await state.client.rpc("mcp_estimate_pricing_save", {
            _job: args._job,
            _labor: null,
            _material: null,
            _quotes: quotes,
            _sources: null,
          })) as { error: { message: string } | null };
          if (concurrent.error) throw new Error(concurrent.error.message);
        }
        const result = await state.client.rpc(name, args);
        if (name === "mcp_estimate_coverage_save" && state.loseSaveResponse) {
          state.loseSaveResponse = false;
          return { data: null, error: { message: "Response interrupted after commit" } };
        }
        return result;
      },
    }),
  text: (text: string) => ({ content: [{ type: "text", text }] }),
  dbError: (error: { message: string }) => {
    throw new Error(error.message);
  },
  isMissingFunction: () => false,
}));
vi.mock("./jobs", () => ({
  resolveJob: async () => ({
    job_id: "00000000-0000-4000-8000-000000000920",
    job_number: "E2E",
    company_id: "00000000-0000-4000-8000-000000000910",
  }),
  named: () => "E2E",
  audit: async () => {},
}));
vi.mock("./takeoff/service", () => ({
  viewEngine: async (
    _sb: unknown,
    _job: unknown,
    _state: unknown,
    _page: unknown,
    extra?: { bid_summary?: unknown },
  ) => ({
    content: [],
    structuredContent: extra?.bid_summary ?? { measurement_pending: true },
  }),
}));

import { estimatePricing, estimateBidSummary } from "./tools/estimate-bid-tools";
import { estimateQuoteCoverage } from "./tools/estimate-coverage-tools";
import { GC_ITEMS } from "./estimating-bid";
import { parseState, settle } from "./estimating";
import { verifiedLines, type EngineSnapshot } from "./takeoff/state";

const owner = "00000000-0000-4000-8000-000000000901";
const company = "00000000-0000-4000-8000-000000000910";
const job = "00000000-0000-4000-8000-000000000920";
const request = "00000000-0000-4000-8001-000000000001";
const request2 = "00000000-0000-4000-8001-000000000002";
let db: PGlite;
type Result = { structuredContent: Record<string, unknown>; content: { text: string }[] };
const call = (tool: unknown, args: Record<string, unknown>) =>
  (tool as { handler: (args: unknown, ctx: unknown) => Promise<Result> }).handler(
    { job_number: "E2E", ...args },
    {},
  );
const dbRpc = async (name: string, args: Record<string, unknown>) => {
  if (!state.client) throw new Error("Local database unavailable");
  const result = (await state.client.rpc(name, args)) as {
    data: unknown;
    error: { message: string } | null;
  };
  if (result.error) throw new Error(result.error.message);
  return result.data as Record<string, unknown>;
};
const decisions = [
  {
    quote_index: 0,
    decision: "carry",
    ref: "T-1",
    replace_labor_and_material: true,
    exclusive_to_line: true,
    source_note: "Written quotation",
    scope_note: "Paint labor and material for this line",
    exclusions_note: "No other line included",
  },
  { quote_index: 1, decision: "compare", ref: "T-1" },
];

beforeAll(async () => {
  db = await makeDb();
  for (const migration of [
    "20261022200000_athena_estimating.sql",
    "20261022230000_athena_estimating_bid.sql",
    "20261023010000_athena_estimating_conventions.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  await db.exec(
    `CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;`,
  );
  await db.exec(readFileSync("supabase/migrations/20261031120000_athena_file_upload.sql", "utf8"));
  for (const migration of [
    "20261027130000_athena_drawing_versions.sql",
    "20261024005713_athena_takeoff_engine.sql",
    "20261024160000_athena_takeoff_carry_by_identity.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  await db.exec(readFileSync("release-proposals/estimating-member-read-transactions.sql", "utf8"));
  await db.exec(readFileSync("release-proposals/estimating-quote-coverage.sql", "utf8"));
  for (const proposal of [
    "estimating-gc-requirements-cas.sql",
    "estimating-frozen-source-snapshot.sql",
    "estimating-requirement-sources.sql",
  ])
    await db.exec(readFileSync(`release-proposals/${proposal}`, "utf8"));
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,'fixture@example.com')", [owner]);
  await db.query("INSERT INTO test_active_members VALUES($1)", [owner]);
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Builder',$2)", [
    company,
    owner,
  ]);
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Member')",
    [company, owner],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id) VALUES($1,$2,'Job','E2E',$3)",
    [job, owner, company],
  );
  state.client = fakeClient(db, {
    sub: owner,
    email: "fixture@example.com",
    role: "authenticated",
  });
  await dbRpc("mcp_estimate_setup_save", {
    _job: job,
    _patch: {
      role: "gc",
      trades: ["Finishes"],
      in_scope: ["Paint and flooring"],
      out_scope: ["Foundation work"],
    },
  });
  await dbRpc("mcp_estimate_takeoff_save", {
    _job: job,
    _revision: "A",
    _scales: [],
    _lines: [
      {
        line_no: 1,
        item: "Paint",
        qty: 100,
        unit: "SF",
        sheet: "A1",
        basis: "measured",
        math: "100 SF",
      },
      {
        line_no: 2,
        item: "Floor",
        qty: 100,
        unit: "SF",
        sheet: "A2",
        basis: "measured",
        math: "100 SF",
      },
    ],
  });
  for (const line_no of [1, 2])
    await dbRpc("mcp_takeoff_geometry_save", {
      _job: job,
      _operation: "not_drawable",
      _expected: 0,
      _record: {
        line_no,
        takeoff_version: 1,
        exception_kind: "schedule_quantity",
        quantity: 100,
        reason: "Schedule quantity confirmed",
      },
    });
  await dbRpc("mcp_estimate_gc_save", {
    _job: job,
    _start: null,
    _finish: null,
    _days: 1,
    _lines: GC_ITEMS.map(({ key }) => ({ key, amount: 0, qty: 1, rate: 0, confirmed: true })),
  });
  await dbRpc("mcp_estimate_bid_save", { _job: job, _overhead: 10, _profit: 10 });
  // Review the actual empty source set rather than bypassing final readiness.
  const source = await dbRpc("mcp_estimate_coverage_snapshot", { _job: job });
  await dbRpc("mcp_estimate_requirements_save", {
    _job: job,
    _items: {
      expected_version: source.version,
      source_sha256: (source.requirement_sources as { sha256: string }).sha256,
      reviewed_confirmations: [],
      items: [],
    },
  });
});
afterAll(async () => db.close());

describe.sequential("independent quote-only walkthrough", () => {
  it("must show the same carried-quote total as the ready summary without invented direct rates", async () => {
    await call(estimatePricing, {
      quotes: [
        { sub: "A", description: "Paint", amount: 1400, ref: "T-1" },
        { sub: "B", description: "Floor", amount: 500, ref: "T-2" },
      ],
    });
    const unreviewed = await call(estimatePricing, {});
    expect(unreviewed.structuredContent.blockers).toEqual(
      expect.arrayContaining([expect.stringMatching(/quote coverage/i)]),
    );
    expect(unreviewed.content[0].text).not.toContain("Nothing was priced");
    const read = await call(estimateQuoteCoverage, { step: "read" });
    await call(estimateQuoteCoverage, {
      step: "review",
      expected_version: read.structuredContent.version,
      request_id: request,
      decisions: [
        decisions[0],
        { ...decisions[0], quote_index: 1, ref: "T-2", scope_note: "Floor labor and material" },
      ],
    });
    await call(estimateQuoteCoverage, { step: "save", request_id: request, confirmed: true });
    const bid = await call(estimateBidSummary, {});
    expect(bid.structuredContent).toMatchObject({ ready: true, direct: 1900, total: 2299 });
    const walkthrough = await call(estimatePricing, {});
    expect(walkthrough.structuredContent).toMatchObject({ direct: 1900, blockers: [] });
    expect(walkthrough.content[0].text).not.toContain("Send labor the same way");
    expect(walkthrough.content[0].text).toContain("Carried subcontract $1,400.00");
  });
  it("asks for uncovered scope only, then holds when the review becomes stale", async () => {
    const read = await call(estimateQuoteCoverage, { step: "read" });
    await call(estimateQuoteCoverage, {
      step: "review",
      expected_version: read.structuredContent.version,
      request_id: request2,
      decisions: [decisions[0], { quote_index: 1, decision: "compare", ref: "T-2" }],
    });
    await call(estimateQuoteCoverage, { step: "save", request_id: request2, confirmed: true });
    const partial = await call(estimatePricing, {});
    const blockers = partial.structuredContent.blockers as string[];
    expect(blockers.join(" ")).toContain("T-2");
    expect(blockers.join(" ")).not.toContain("T-1");
    expect(partial.content[0].text).toContain("Carried subcontract $1,400.00");
    await dbRpc("mcp_estimate_setup_save", { _job: job, _patch: { in_scope: ["Changed scope"] } });
    const stale = await call(estimatePricing, {});
    expect((stale.structuredContent.blockers as string[]).join(" ")).toMatch(/quote coverage/i);
  });
});
