/* Isolated guarded SQL regressions; all users and financial amounts are local fixtures. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

const owner = "00000000-0000-4000-8000-000000000901";
const outsider = "00000000-0000-4000-8000-000000000904";
const company = "00000000-0000-4000-8000-000000000910";
let db: PGlite;
let legacyMetadata: unknown[];
let gcMetadata: unknown[];
let nextJob = 0;
const j = (n: number) => `00000000-0000-4000-8002-${String(n).padStart(12, "0")}`;
const encode = (value: unknown[] | null) => (value === null ? null : JSON.stringify(value));
const laborA = { ref: "T-1", hourly_rate: 100, confirmed: true };
const laborB = { ref: "T-2", hourly_rate: 110, confirmed: true };
const laborC = { ref: "T-3", hourly_rate: 120, confirmed: true };
const materialA = { ref: "T-1", unit_price: 5, confirmed: true };
const materialB = { ref: "T-2", unit_price: 6, confirmed: true };
const factorA = { source: "rsmeans", carry: true, confirmed: true, location_factor: 1.1 };
const factorB = { source: "contractor", carry: false, confirmed: true };

async function rpc(name: string, args: unknown[], user = owner) {
  return asUser(
    db,
    { sub: user, email: "fixture@example.com", role: "authenticated" },
    async (tx) =>
      (
        await tx.query(
          `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS data`,
          args,
        )
      ).rows[0].data as Record<string, unknown>,
  );
}
const snapshot = (job: string) => rpc("mcp_estimate_coverage_snapshot", [job]);
const legacy = (
  job: string,
  labor: unknown[] | null,
  material: unknown[] | null,
  sources: unknown[] | null = null,
  user = owner,
) =>
  rpc(
    "mcp_estimate_pricing_save",
    [job, encode(labor), encode(material), null, encode(sources)],
    user,
  );
const versioned = (
  job: string,
  v: unknown,
  labor: unknown[] | null,
  material: unknown[] | null,
  sources: unknown[] | null = null,
) =>
  rpc("mcp_estimate_pricing_save_versioned", [
    job,
    v,
    encode(labor),
    encode(material),
    null,
    encode(sources),
  ]);
const pricing = (s: Record<string, unknown>) =>
  (s.bid as { pricing: { labor: unknown[]; material: unknown[]; rate_sources: unknown[] } })
    .pricing;
async function job() {
  const id = j(++nextJob);
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id) VALUES($1,$2,'Job',$3,$4)",
    [id, owner, `LEG-${nextJob}`, company],
  );
  return id;
}
beforeAll(async () => {
  db = await makeDb();
  for (const migration of [
    "20261022200000_athena_estimating.sql",
    "20261022230000_athena_estimating_bid.sql",
    "20261023010000_athena_estimating_conventions.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  legacyMetadata = (
    await db.query(
      "SELECT pg_get_userbyid(proowner) AS owner,prosecdef,provolatile,proacl::text,proconfig,proargnames FROM pg_proc WHERE oid='public.mcp_estimate_pricing_save(uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure",
    )
  ).rows;
  gcMetadata = (
    await db.query(
      "SELECT proname,pg_get_userbyid(proowner) AS owner,prosecdef,provolatile,proacl::text,proconfig,proargnames FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY($1) ORDER BY proname",
      [["mcp_estimate_gc_save", "mcp_estimate_requirements_save"]],
    )
  ).rows;
  await db.exec(
    `CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;`,
  );
  for (const migration of [
    "20261027130000_athena_drawing_versions.sql",
    "20261024005713_athena_takeoff_engine.sql",
    "20261024160000_athena_takeoff_carry_by_identity.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  await db.exec(readFileSync("release-proposals/estimating-member-read-transactions.sql", "utf8"));
  await db.exec(readFileSync("release-proposals/estimating-quote-coverage.sql", "utf8"));
  await db.exec(readFileSync("release-proposals/estimating-gc-requirements-cas.sql", "utf8"));
  for (const id of [owner, outsider]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'fixture@example.com')", [id]);
    await db.query("INSERT INTO test_active_members VALUES($1)", [id]);
  }
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Builder',$2)", [
    company,
    owner,
  ]);
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Member')",
    [company, owner],
  );
});
afterAll(() => db.close());

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
const gc = (jobId: string, lines: unknown, v?: unknown) =>
  rpc("mcp_estimate_gc_save", [
    jobId,
    null,
    null,
    10,
    JSON.stringify(v === undefined ? lines : { expected_version: v, lines }),
  ]);
const req = (jobId: string, items: unknown, v?: unknown) =>
  rpc("mcp_estimate_requirements_save", [
    jobId,
    JSON.stringify(v === undefined ? items : { expected_version: v, items }),
  ]);
const bid = (s: Record<string, unknown>) =>
  s.bid as {
    general_conditions: { lines: unknown[] };
    requirements: { ref: string; amount: number }[];
  };

describe.sequential("versioned and legacy general conditions and requirements", () => {
  it("retains the original RPC owner, guard signature and ACL", async () => {
    const metadata = (
      await db.query(
        "SELECT proname,pg_get_userbyid(proowner) AS owner,prosecdef,provolatile,proacl::text,proconfig,proargnames FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY($1) ORDER BY proname",
        [["mcp_estimate_gc_save", "mcp_estimate_requirements_save"]],
      )
    ).rows;
    expect(metadata).toEqual(gcMetadata);
    const rows = await db.query<{ legacy: boolean; anon: boolean }>(
      `SELECT has_function_privilege('authenticated','public.mcp_estimate_gc_save(uuid,date,date,integer,jsonb)','execute') AND has_function_privilege('authenticated','public.mcp_estimate_requirements_save(uuid,jsonb)','execute') AS legacy, has_function_privilege('anon','public.mcp_estimate_gc_save(uuid,date,date,integer,jsonb)','execute') OR has_function_privilege('anon','public.mcp_estimate_requirements_save(uuid,jsonb)','execute') AS anon`,
    );
    expect(rows.rows[0]).toEqual({ legacy: true, anon: false });
  });
  it("prevents both legacy and versioned stale GC replacement", async () => {
    const id = await job();
    const trailer = { key: "trailer", amount: 100, confirmed: true };
    await gc(id, [trailer]);
    const old = await snapshot(id);
    await gc(id, [{ ...trailer, amount: 200 }], old.version);
    const latest = await snapshot(id);
    await expect(gc(id, [trailer, { key: "office", amount: 0, confirmed: true }])).rejects.toThrow(
      /version-checked/i,
    );
    await expect(
      gc(id, [trailer, { key: "office", amount: 0, confirmed: true }], old.version),
    ).rejects.toThrow(/changed/i);
    const after = await snapshot(id);
    expect(after.version).toEqual(latest.version);
    expect(bid(after).general_conditions.lines).toEqual([{ ...trailer, amount: 200 }]);
    await gc(
      id,
      [
        { ...trailer, amount: 200 },
        { key: "office", amount: 0, confirmed: true },
      ],
      latest.version,
    );
    expect(bid(await snapshot(id)).general_conditions.lines).toHaveLength(2);
  });
  it("allows legacy GC create, exact replay and unique append but rejects removals and duplicate keys", async () => {
    const id = await job();
    const a = { key: "trailer", amount: 0, confirmed: true };
    const b = { key: "office", amount: 50, confirmed: true };
    await gc(id, [a]);
    const initial = await snapshot(id);
    await gc(id, [a]);
    expect((await snapshot(id)).version).toEqual(initial.version);
    await gc(id, [a, b]);
    const saved = await snapshot(id);
    await expect(gc(id, [a])).rejects.toThrow(/version-checked/i);
    await expect(gc(id, [a, a], saved.version)).rejects.toThrow(/unique/i);
    expect((await snapshot(id)).version).toEqual(saved.version);
  });
  it("prevents stale requirement writes from deactivating or overwriting later rows", async () => {
    const id = await job();
    const a = item("R-1", 100),
      b = item("R-2", 0);
    await req(id, [a]);
    const old = await snapshot(id);
    await req(id, [a, b], old.version);
    const latest = await snapshot(id);
    await expect(req(id, [{ ...a, amount: 200 }])).rejects.toThrow(/version-checked/i);
    await expect(req(id, [{ ...a, amount: 200 }], old.version)).rejects.toThrow(/changed/i);
    await req(id, []);
    await req(id, [], latest.version);
    const after = await snapshot(id);
    expect(after.version).toEqual(latest.version);
    expect(
      bid(after)
        .requirements.map((r) => r.ref)
        .sort(),
    ).toEqual(["R-1", "R-2"]);
    expect(Number(bid(after).requirements.find((r) => r.ref === "R-2")?.amount)).toBe(0);
    await req(id, [{ ...a, amount: 200 }], latest.version);
    const revised = await snapshot(id);
    expect(Number(bid(revised).requirements.find((r) => r.ref === "R-1")?.amount)).toBe(200);
    expect(
      bid(revised)
        .requirements.map((r) => r.ref)
        .sort(),
    ).toEqual(["R-1", "R-2"]);
  });
  it("does not let a legacy stale reference reactivate or alter an inactive requirement", async () => {
    const id = await job();
    const existing = item("R-1", 100);
    await req(id, [existing]);
    await db.query(
      "UPDATE public.mcp_estimate_requirements SET active=false WHERE job_id=$1 AND ref='R-1'",
      [id],
    );
    const before = await snapshot(id);
    await expect(req(id, [existing])).rejects.toThrow(/inactive requirement/i);
    await expect(req(id, [{ ...existing, amount: 200 }])).rejects.toThrow(/inactive requirement/i);
    const stored = await db.query<{ active: boolean; amount: string }>(
      "SELECT active,amount FROM public.mcp_estimate_requirements WHERE job_id=$1 AND ref='R-1'",
      [id],
    );
    expect(stored.rows[0].active).toBe(false);
    expect(Number(stored.rows[0].amount)).toBe(100);
    expect((await snapshot(id)).version).toEqual(before.version);
    await expect(req(id, [{ ...existing, amount: 200 }], before.version)).rejects.toThrow(
      /inactive requirement/i,
    );
    expect((await snapshot(id)).version).toEqual(before.version);
  });
  it("rejects duplicate requirement refs, invalid envelopes and unauthorized access", async () => {
    const id = await job();
    const before = await snapshot(id);
    const a = item("R-1", 100);
    await expect(req(id, [a, a], before.version)).rejects.toThrow(/unique/i);
    await expect(
      rpc("mcp_estimate_requirements_save", [
        id,
        JSON.stringify({ expected_version: "1", items: [a] }),
      ]),
    ).rejects.toThrow();
    await expect(
      rpc("mcp_estimate_gc_save", [
        id,
        null,
        null,
        10,
        JSON.stringify({ expected_version: before.version, lines: {} }),
      ]),
    ).rejects.toThrow();
    await expect(
      rpc("mcp_estimate_requirements_save", [id, JSON.stringify([a])], outsider),
    ).rejects.toThrow();
    await expect(
      rpc(
        "mcp_estimate_requirements_save",
        [id, JSON.stringify({ expected_version: before.version, items: [a] })],
        outsider,
      ),
    ).rejects.toThrow();
    expect((await snapshot(id)).version).toEqual(before.version);
  });
  it.each([
    { key: "office", amount: 10, confirmed: "false" },
    { key: "office", amount: "10", confirmed: true },
    { key: "office", qty: "3", rate: 2, confirmed: true },
    { key: "office", qty: 3, rate: "2", confirmed: true },
    { key: "office", amount: -1, confirmed: true },
  ])("rejects malformed general condition values in the guarded RPC", async (line) => {
    const id = await job();
    const before = await snapshot(id);
    await expect(gc(id, [line], before.version)).rejects.toThrow(
      /nonnegative numbers and boolean/i,
    );
    expect((await snapshot(id)).version).toEqual(before.version);
  });
  it("rejects unsupported general condition keys instead of silently ignoring their cost", async () => {
    const id = await job();
    const before = await snapshot(id);
    await expect(
      gc(id, [{ key: "other", amount: 100, confirmed: true }], before.version),
    ).rejects.toThrow(/keys/i);
    expect((await snapshot(id)).version).toEqual(before.version);
  });
  it.each([{ confirmed: "true" }, { excluded: "false" }, { amount: "100" }, { amount: -1 }])(
    "rejects malformed requirement decisions and amounts",
    async (invalid) => {
      const id = await job();
      const before = await snapshot(id);
      await expect(req(id, [{ ...item("R-1", 100), ...invalid }], before.version)).rejects.toThrow(
        /nonnegative numbers and confirmations/i,
      );
      expect((await snapshot(id)).version).toEqual(before.version);
    },
  );
  it("rolls back interruption, and rejects a replay of a committed stale version", async () => {
    const id = await job();
    const a = item("R-1", 100);
    const before = await snapshot(id);
    await expect(
      asUser(
        db,
        { sub: owner, email: "fixture@example.com", role: "authenticated" },
        async (tx) => {
          await tx.query("SELECT public.mcp_estimate_requirements_save($1,$2)", [
            id,
            JSON.stringify({ expected_version: before.version, items: [a] }),
          ]);
          await tx.query("SELECT 1/0");
        },
      ),
    ).rejects.toThrow();
    expect((await snapshot(id)).version).toEqual(before.version);
    await req(id, [a], before.version);
    const saved = await snapshot(id);
    await expect(req(id, [a], before.version)).rejects.toThrow(/changed/i);
    const after = await snapshot(id);
    expect(after.version).toEqual(saved.version);
    expect(bid(after).requirements).toHaveLength(1);
  });
});
