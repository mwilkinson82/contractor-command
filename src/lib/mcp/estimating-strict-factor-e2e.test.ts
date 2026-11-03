/* Synthetic isolated PGlite records, actual pricing RPCs and summary handler. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { fakeClient } from "../../../tests/mcp-roles/fake-supabase";

const local = vi.hoisted(() => ({
  client: null as null | { rpc: (name: string, args: Record<string, unknown>) => Promise<unknown> },
  target: "00000000-0000-4000-8000-000000000920",
}));
vi.mock("./guard", () => ({
  run: async (_name: string, _ctx: unknown, _opts: unknown, fn: (sb: unknown) => unknown) =>
    fn(local.client),
  text: (text: string) => ({ content: [{ type: "text", text }] }),
  dbError: (error: { message: string }) => {
    throw new Error(error.message);
  },
  isMissingFunction: () => false,
}));
vi.mock("./jobs", () => ({
  resolveJob: async () => ({
    job_id: local.target,
    job_number: "LOCAL",
    company_id: "00000000-0000-4000-8000-000000000910",
  }),
  named: () => "LOCAL",
  audit: async () => {},
}));
vi.mock("./takeoff/service", () => ({
  viewEngine: async (
    _sb: unknown,
    _job: unknown,
    _state: unknown,
    _page: unknown,
    extra?: { bid_summary?: unknown },
  ) => ({ content: [], structuredContent: extra?.bid_summary ?? { measurement_pending: true } }),
}));
import { estimateBidSummary } from "./tools/estimate-bid-tools";
import { GC_ITEMS } from "./estimating-bid";

const owner = "00000000-0000-4000-8000-000000000901";
const company = "00000000-0000-4000-8000-000000000910";
const job = "00000000-0000-4000-8000-000000000920";
const legacyJob = "00000000-0000-4000-8000-000000000921";
const numericJob = "00000000-0000-4000-8000-000000000922";
let db: PGlite;
const sql = (file: string) => readFileSync(file, "utf8");
async function rpc(name: string, args: Record<string, unknown> = {}) {
  const result = (await local.client!.rpc(name, { _job: job, ...args })) as {
    data: unknown;
    error: { message: string } | null;
  };
  if (result.error) throw new Error(result.error.message);
  return result.data as Record<string, unknown>;
}
const summary = () =>
  (
    estimateBidSummary as unknown as {
      handler: (a: unknown, c: unknown) => Promise<{ structuredContent: Record<string, unknown> }>;
    }
  ).handler({ job_number: "LOCAL" }, {});
const snap = () => rpc("mcp_estimate_coverage_snapshot");
const save = (v: unknown, patch: Record<string, unknown>) =>
  rpc("mcp_estimate_pricing_save_versioned", {
    _expected_version: v,
    _labor: null,
    _material: null,
    _quotes: null,
    _sources: null,
    ...patch,
  });
const legacy = (patch: Record<string, unknown>) =>
  rpc("mcp_estimate_pricing_save", {
    _labor: null,
    _material: null,
    _quotes: null,
    _sources: null,
    ...patch,
  });
const lab = { ref: "T-1", man_hours: 1, hourly_rate: 100, confirmed: true, apply_factor: true };
const mat = { ref: "T-1", unit_price: 0, confirmed: true };

beforeAll(async () => {
  db = await makeDb();
  for (const migration of [
    "20261022200000_athena_estimating.sql",
    "20261022230000_athena_estimating_bid.sql",
    "20261023010000_athena_estimating_conventions.sql",
  ])
    await db.exec(sql(`supabase/migrations/${migration}`));
  await db.exec(
    `CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;`,
  );
  for (const migration of [
    "20261031120000_athena_file_upload.sql",
    "20261027130000_athena_drawing_versions.sql",
    "20261024005713_athena_takeoff_engine.sql",
    "20261024160000_athena_takeoff_carry_by_identity.sql",
  ])
    await db.exec(sql(`supabase/migrations/${migration}`));
  await db.exec(sql("release-proposals/estimating-member-read-transactions.sql"));
  const proposal = sql("release-proposals/estimating-quote-coverage.sql");
  const marker = proposal.indexOf(
    "-- Strict persisted pricing type validation, part of this local proposal.",
  );
  if (marker < 0)
    throw new Error("Strict pricing type validator is missing from the local proposal.");
  // Create historical rows before the new trigger, as they would exist before
  // migration; other tests install the entire proposal in one pass.
  await db.exec(proposal.slice(0, marker));
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
    "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id) VALUES($1,$2,'Job','LOCAL',$3)",
    [job, owner, company],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id) VALUES($1,$2,'Job','LEGACY',$3)",
    [legacyJob, owner, company],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id) VALUES($1,$2,'Job','NUMERIC',$3)",
    [numericJob, owner, company],
  );
  local.client = fakeClient(db, {
    sub: owner,
    email: "fixture@example.com",
    role: "authenticated",
  });
  await rpc("mcp_estimate_setup_save", {
    _patch: {
      role: "gc",
      trades: ["Finishes"],
      in_scope: ["Paint"],
      out_scope: ["Foundation work"],
    },
  });
  await rpc("mcp_estimate_takeoff_save", {
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
    ],
  });
  await rpc("mcp_takeoff_geometry_save", {
    _operation: "not_drawable",
    _expected: 0,
    _record: {
      line_no: 1,
      takeoff_version: 1,
      exception_kind: "schedule_quantity",
      quantity: 100,
      reason: "Schedule quantity confirmed",
    },
  });
  await rpc("mcp_estimate_gc_save", {
    _start: null,
    _finish: null,
    _days: 1,
    _lines: GC_ITEMS.map(({ key }) => ({ key, amount: 0, qty: 1, rate: 0, confirmed: true })),
  });
  await rpc("mcp_estimate_bid_save", { _overhead: 10, _profit: 10 });
  const prior = await snap();
  // Model malformed legacy data that predates the new write-time trigger.
  await save(prior.version, {
    _labor: [lab],
    _material: [mat],
    _sources: [{ source: "rsmeans", carry: "false", confirmed: true, location_factor: 2 }],
  });
  await rpc("mcp_estimate_setup_save", {
    _job: numericJob,
    _patch: {
      role: "gc",
      trades: ["Finishes"],
      in_scope: ["Paint"],
      out_scope: ["Foundation work"],
    },
  });
  await rpc("mcp_estimate_takeoff_save", {
    _job: numericJob,
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
    ],
  });
  await rpc("mcp_takeoff_geometry_save", {
    _job: numericJob,
    _operation: "not_drawable",
    _expected: 0,
    _record: {
      line_no: 1,
      takeoff_version: 1,
      exception_kind: "schedule_quantity",
      quantity: 100,
      reason: "Schedule quantity confirmed",
    },
  });
  await rpc("mcp_estimate_gc_save", {
    _job: numericJob,
    _start: null,
    _finish: null,
    _days: 1,
    _lines: GC_ITEMS.map(({ key }) => ({ key, amount: 0, qty: 1, rate: 0, confirmed: true })),
  });
  await rpc("mcp_estimate_bid_save", { _job: numericJob, _overhead: 10, _profit: 10 });
  const numericPrior = await rpc("mcp_estimate_coverage_snapshot", { _job: numericJob });
  await save(numericPrior.version, {
    _job: numericJob,
    _labor: [{ ...lab, hourly_rate: "100" }],
    _material: [mat],
  });
  await db.exec(proposal.slice(marker));
  for (const name of [
    "estimating-gc-requirements-cas.sql",
    "estimating-frozen-source-snapshot.sql",
    "estimating-requirement-sources.sql",
  ])
    await db.exec(sql(`release-proposals/${name}`));
  const unscanned = await snap();
  await rpc("mcp_estimate_requirements_save", {
    _items: {
      expected_version: unscanned.version,
      source_sha256: (unscanned.requirement_sources as { sha256: string }).sha256,
      reviewed_confirmations: [],
      items: [],
    },
  });
});
afterAll(() => db.close());

describe.sequential("strict stored pricing types through real RPCs and summary", () => {
  it("holds preexisting carry string and does not silently apply its factor", async () => {
    const bid = await summary();
    expect(bid.structuredContent).toMatchObject({ ready: false, total: null });
    expect(JSON.stringify(bid.structuredContent)).toMatch(/invalid choices/i);
  });
  it("gives an actionable review error for malformed historical numeric rates", async () => {
    local.target = numericJob;
    try {
      await expect(summary()).rejects.toThrow(/saved pricing needs review/i);
    } finally {
      local.target = job;
    }
  });
  it("rejects malformed writes through both the versioned and legacy RPC without changing state", async () => {
    const before = await snap();
    for (const item of [
      { _sources: [{ source: "rsmeans", carry: "false", confirmed: true, location_factor: 2 }] },
      { _sources: [{ source: "rsmeans", carry: true, confirmed: "true", location_factor: 2 }] },
      { _sources: [{ source: "rsmeans", carry: true, confirmed: true, location_factor: "2" }] },
      { _sources: [{ source: "rsmeans", carry: true, confirmed: true, location_factor: 0 }] },
      { _labor: [{ ...lab, apply_factor: "false" }] },
      { _labor: [{ ...lab, confirmed: "true" }] },
      { _material: [{ ...mat, unit_price: "0" }] },
      { _material: [{ ...mat, confirmed: null }] },
    ]) {
      await expect(save(before.version, item)).rejects.toThrow();
      await expect(legacy({ ...item, _job: legacyJob })).rejects.toThrow();
      const after = await snap();
      expect(after.version).toBe(before.version);
      expect(after.bid).toEqual(before.bid);
    }
  });
  it("accepts confirmed zero, nullable optional numeric factors, and a valid correction", async () => {
    const before = await snap();
    await save(before.version, {
      _labor: [{ ...lab, apply_factor: false, hourly_rate: 0 }],
      _material: [mat],
      _sources: [{ source: "rsmeans", carry: false, location_factor: null, work_factor: null }],
    });
    const bid = await summary();
    expect(bid.structuredContent, JSON.stringify(bid.structuredContent)).toMatchObject({
      ready: true,
      direct: 0,
      total: 0,
    });
  });
});
