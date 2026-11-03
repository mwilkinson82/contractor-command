import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { fakeClient } from "../../../tests/mcp-roles/fake-supabase";

const state = vi.hoisted(() => ({
  client: null as null | { rpc: (n: string, a: Record<string, unknown>) => Promise<unknown> },
  writeCalls: 0,
  jobId: "00000000-0000-4000-8000-000000000920",
  interleave: null as null | ((name: string, args: Record<string, unknown>) => Promise<void>),
}));
vi.mock("./guard", () => ({
  run: async (_n: string, _c: unknown, _o: unknown, fn: (sb: unknown) => unknown) =>
    fn({
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (!state.client) throw new Error("missing fixture");
        if (name === "mcp_estimate_gc_save" || name === "mcp_estimate_requirements_save") {
          state.writeCalls++;
          if (state.interleave) {
            const f = state.interleave;
            state.interleave = null;
            await f(name, args);
          }
        }
        return state.client.rpc(name, args);
      },
      from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }),
    }),
  text: (text: string) => ({ content: [{ type: "text", text }] }),
  dbError: (error: { message: string }) => {
    throw new Error(error.message);
  },
  isMissingFunction: () => false,
}));
vi.mock("./jobs", () => ({
  resolveJob: async () => ({
    job_id: state.jobId,
    job_number: "LOCAL",
    company_id: "00000000-0000-4000-8000-000000000910",
  }),
  named: () => "LOCAL",
  audit: async () => {},
}));
import { estimateGeneralConditions, estimateRequirements } from "./tools/estimate-bid-tools";
const owner = "00000000-0000-4000-8000-000000000901",
  company = "00000000-0000-4000-8000-000000000910",
  job = "00000000-0000-4000-8000-000000000920";
let db: PGlite;
const rpc = async (name: string, args: Record<string, unknown>) => {
  if (!state.client) throw new Error("fixture");
  const r = (await state.client.rpc(name, args)) as {
    data: unknown;
    error: { message: string } | null;
  };
  if (r.error) throw new Error(r.error.message);
  return r.data as Record<string, unknown>;
};
const call = (tool: unknown, args: Record<string, unknown>) =>
  (tool as { handler: (a: unknown, c: unknown) => Promise<unknown> }).handler(
    { job_number: "LOCAL", ...args },
    {},
  );
const item = (ref: string, amount: number) => ({
  ref,
  kind: "permit",
  label: ref,
  source_type: "sheet",
  source_ref: "A1",
  citation: "A1",
  placement: "own_line",
  amount,
  confirmed: true,
  excluded: false,
});
const snap = () => rpc("mcp_estimate_coverage_snapshot", { _job: job });
const getBid = (s: Record<string, unknown>) =>
  s.bid as {
    general_conditions: {
      start_date: string | null;
      finish_date: string | null;
      lines: { key: string; amount: number }[];
    };
    requirements: { ref: string; amount: number }[];
  };
beforeAll(async () => {
  db = await makeDb();
  for (const name of [
    "20261022200000_athena_estimating.sql",
    "20261022230000_athena_estimating_bid.sql",
    "20261023010000_athena_estimating_conventions.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  await db.exec(
    `CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;`,
  );
  for (const name of [
    "20261031120000_athena_file_upload.sql",
    "20261027130000_athena_drawing_versions.sql",
    "20261024005713_athena_takeoff_engine.sql",
    "20261024160000_athena_takeoff_carry_by_identity.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  await db.exec(readFileSync("release-proposals/estimating-member-read-transactions.sql", "utf8"));
  await db.exec(readFileSync("release-proposals/estimating-quote-coverage.sql", "utf8"));
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
  state.client = fakeClient(db, {
    sub: owner,
    email: "fixture@example.com",
    role: "authenticated",
  });
  await rpc("mcp_estimate_setup_save", { _job: job, _patch: { role: "gc", trades: ["Finishes"] } });
});
afterAll(() => db.close());

describe.sequential("GC and requirements handlers across staged proposal", () => {
  it("fails closed on base schema without writing a JSON envelope into legacy data", async () => {
    const before = await snap();
    state.writeCalls = 0;
    expect((before.capabilities as { gc_requirements_cas: boolean }).gc_requirements_cas).toBe(
      false,
    );
    await expect(
      call(estimateGeneralConditions, {
        lines: [{ key: "trailer", amount: 100, confirmed: true }],
      }),
    ).rejects.toThrow(/unavailable/i);
    await expect(call(estimateRequirements, { findings: [] })).rejects.toThrow(/unavailable/i);
    expect(state.writeCalls).toBe(0);
    expect((await snap()).bid).toEqual(before.bid);
  });
  it("installs private capability and saves GC edits while preserving stored dates", async () => {
    await db.exec(readFileSync("release-proposals/estimating-gc-requirements-cas.sql", "utf8"));
    await db.exec(readFileSync("release-proposals/estimating-frozen-source-snapshot.sql", "utf8"));
    await db.exec(readFileSync("release-proposals/estimating-requirement-sources.sql", "utf8"));
    const marker = await db.query<{ a: boolean; auth: boolean }>(
      "SELECT has_function_privilege('anon','mcp_private.estimate_gc_requirements_cas_marker()','execute') AS a,has_function_privilege('authenticated','mcp_private.estimate_gc_requirements_cas_marker()','execute') AS auth",
    );
    expect(marker.rows[0]).toEqual({ a: false, auth: false });
    expect(
      ((await snap()).capabilities as { gc_requirements_cas: boolean }).gc_requirements_cas,
    ).toBe(true);
    await rpc("mcp_estimate_gc_save", {
      _job: job,
      _start: "2026-01-01",
      _finish: "2026-01-10",
      _days: 10,
      _lines: [{ key: "trailer", amount: 100, confirmed: true }],
    });
    await call(estimateGeneralConditions, {
      lines: [{ key: "office", amount: 0, confirmed: true }],
    });
    const gc = getBid(await snap()).general_conditions;
    expect(gc.start_date).toBe("2026-01-01");
    expect(gc.finish_date).toBe("2026-01-10");
    expect(gc.lines).toContainEqual({ key: "office", amount: 0, confirmed: true });
  });
  it("rejects a handler GC write if another session changes its snapshot", async () => {
    state.interleave = async (_name, args) => {
      const e = args._lines as {
        expected_version: number;
        lines: { key: string; amount: number }[];
      };
      await rpc("mcp_estimate_gc_save", {
        _job: job,
        _start: "2026-01-01",
        _finish: "2026-01-10",
        _days: 10,
        _lines: {
          expected_version: e.expected_version,
          lines: e.lines.map((x) => (x.key === "trailer" ? { ...x, amount: 200 } : x)),
        },
      });
    };
    await expect(
      call(estimateGeneralConditions, { lines: [{ key: "office", amount: 30, confirmed: true }] }),
    ).rejects.toThrow(/changed/i);
    expect(
      getBid(await snap()).general_conditions.lines.find((r) => r.key === "trailer")?.amount,
    ).toBe(200);
  });
  it("retains saved requirements missing from a scan and permits scoped confirmed zero", async () => {
    await rpc("mcp_estimate_requirements_save", {
      _job: job,
      _items: [item("R-1", 100), item("R-2", 150)],
    });
    await call(estimateRequirements, { prices: [{ ref: "R-1", amount: 0, confirmed: true }] });
    const rows = getBid(await snap()).requirements;
    expect(rows.map((r) => r.ref).sort()).toEqual(["R-1", "R-2"]);
    expect(Number(rows.find((r) => r.ref === "R-1")?.amount)).toBe(0);
  });
  it("rejects a handler requirements write when a later requirement was added", async () => {
    state.interleave = async (_name, args) => {
      const e = args._items as { expected_version: number };
      await rpc("mcp_estimate_requirements_save", {
        _job: job,
        _items: {
          expected_version: e.expected_version,
          source_sha256: ((await snap()).requirement_sources as { sha256: string }).sha256,
          reviewed_confirmations: ["R-3"],
          items: [item("R-3", 300)],
        },
      });
    };
    await expect(
      call(estimateRequirements, { prices: [{ ref: "R-1", amount: 25 }] }),
    ).rejects.toThrow(/changed/i);
    expect(
      getBid(await snap())
        .requirements.map((r) => r.ref)
        .sort(),
    ).toEqual(["R-1", "R-2", "R-3"]);
  });
  it("rejects duplicate GC keys and ambiguous requirement prices before saving", async () => {
    const before = await snap();
    state.writeCalls = 0;
    await expect(
      call(estimateGeneralConditions, {
        lines: [
          { key: "office", amount: 10 },
          { key: "office", amount: 20 },
        ],
      }),
    ).rejects.toThrow(/duplicate/i);
    await expect(
      call(estimateRequirements, {
        prices: [
          { ref: "R-1", amount: 10 },
          { ref: "R-1", amount: 20 },
        ],
      }),
    ).rejects.toThrow(/more than one/i);
    expect(state.writeCalls).toBe(0);
    expect((await snap()).bid).toEqual(before.bid);
  });
  it("allocates above inactive history without reactivating an old reference", async () => {
    const other = "00000000-0000-4000-8000-000000000921";
    await db.query(
      "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id) VALUES($1,$2,'Job','OTHER',$3)",
      [other, owner, company],
    );
    await rpc("mcp_estimate_setup_save", {
      _job: other,
      _patch: { role: "gc", trades: ["Finishes"] },
    });
    await rpc("mcp_estimate_requirements_save", { _job: other, _items: [item("R-1", 100)] });
    await db.query(
      "UPDATE public.mcp_estimate_requirements SET active=false WHERE job_id=$1 AND ref='R-1'",
      [other],
    );
    state.jobId = other;
    try {
      await call(estimateRequirements, {
        findings: [
          {
            kind: "permit",
            title: "Permit",
            source_type: "sheet",
            source_ref: "A2",
            citation: "A2",
          },
        ],
      });
      const rows = await db.query<{ ref: string; active: boolean; amount: string }>(
        "SELECT ref,active,amount FROM public.mcp_estimate_requirements WHERE job_id=$1 ORDER BY ref",
        [other],
      );
      expect(rows.rows.map((r) => ({ ref: r.ref, active: r.active }))).toEqual([
        { ref: "R-1", active: false },
        { ref: "R-2", active: true },
      ]);
      expect(Number(rows.rows[0].amount)).toBe(100);
    } finally {
      state.jobId = job;
    }
  });
  it("rejects an unsafe saved requirement sequence", async () => {
    const other = "00000000-0000-4000-8000-000000000922";
    await db.query(
      "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id) VALUES($1,$2,'Job','LARGE',$3)",
      [other, owner, company],
    );
    await rpc("mcp_estimate_setup_save", {
      _job: other,
      _patch: { role: "gc", trades: ["Finishes"] },
    });
    await rpc("mcp_estimate_requirements_save", {
      _job: other,
      _items: [item("R-9007199254740992", 100)],
    });
    state.jobId = other;
    state.writeCalls = 0;
    try {
      await expect(
        call(estimateRequirements, {
          findings: [
            {
              kind: "permit",
              title: "Permit",
              source_type: "sheet",
              source_ref: "A2",
              citation: "A2",
            },
          ],
        }),
      ).rejects.toThrow(/sequence.*out of range/i);
      expect(state.writeCalls).toBe(0);
    } finally {
      state.jobId = job;
    }
  });
});
