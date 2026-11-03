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
let nextJob = 0;
const j = (n: number) => `00000000-0000-4000-8002-${String(n).padStart(12, "0")}`;
const encode = (value: unknown[] | null) => (value === null ? null : JSON.stringify(value));
const laborA = { ref: "T-1", hourly_rate: 100, confirmed: true };
const laborB = { ref: "T-2", hourly_rate: 110, confirmed: true };
const laborC = { ref: "T-3", hourly_rate: 120, confirmed: true };
const materialA = { ref: "T-1", unit_price: 5, confirmed: true };
const materialB = { ref: "T-2", unit_price: 6, confirmed: true };
const factorA = { source: "rsmeans", carry: true, confirmed: true, location_factor: 1.1 };
const factorB = { source: "neca", carry: false, confirmed: true };

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

describe.sequential("legacy and versioned estimating pricing writes", () => {
  it("keeps the existing legacy signature, initial writes, nulls, reordering and append-only additions", async () => {
    const id = await job();
    await legacy(id, [laborA], [materialA], [factorA]);
    await legacy(id, null, null, null);
    expect(pricing(await snapshot(id))).toMatchObject({
      labor: [laborA],
      material: [materialA],
      rate_sources: [factorA],
    });
    await legacy(id, [laborB, laborA], [materialB, materialA], [factorB, factorA]);
    expect(pricing(await snapshot(id))).toMatchObject({
      labor: [laborB, laborA],
      material: [materialB, materialA],
      rate_sources: [factorB, factorA],
    });
    await legacy(id, [laborB, laborA], [materialB, materialA], [factorB, factorA]);
    expect(pricing(await snapshot(id))).toMatchObject({
      labor: [laborB, laborA],
      material: [materialB, materialA],
      rate_sources: [factorB, factorA],
    });
  });
  it("rejects two stale client interleavings without dropping a different reference", async () => {
    const id = await job();
    await legacy(id, [laborA], [materialA]);
    const staleLabor = [laborA];
    const staleMaterial = [materialA];
    await legacy(id, [laborA, laborB], [materialA, materialB]);
    const before = await snapshot(id);
    await expect(legacy(id, [...staleLabor, laborC], staleMaterial)).rejects.toThrow();
    const after = await snapshot(id);
    expect(after.version).toEqual(before.version);
    expect(pricing(after)).toEqual(pricing(before));
  });
  it("does not let a stale initial create replace a record another client created first", async () => {
    const id = await job();
    const initiallyEmpty = await snapshot(id);
    expect((initiallyEmpty.bid as { pricing: unknown }).pricing).toBeNull();
    await legacy(id, [laborB], [materialB]);
    const before = await snapshot(id);
    await expect(legacy(id, [laborA], [materialA])).rejects.toThrow();
    const after = await snapshot(id);
    expect(after.version).toEqual(before.version);
    expect(pricing(after)).toEqual(pricing(before));
  });
  it("rejects a stale edit to the same reference and preserves a concurrently added revision", async () => {
    const id = await job();
    await legacy(id, [laborA], [materialA]);
    const a = { ...laborA, hourly_rate: 105 };
    const initial = await snapshot(id);
    await versioned(id, initial.version, [a], null);
    const before = await snapshot(id);
    await expect(legacy(id, [laborA], [materialA])).rejects.toThrow();
    const after = await snapshot(id);
    expect(after.version).toEqual(before.version);
    expect(pricing(after).labor).toEqual([a]);
  });
  it("rejects the entire stale request, including an otherwise valid added quote", async () => {
    const id = await job();
    const quoteA = { sub: "A", description: "Paint", amount: 1000, ref: "T-1" };
    const quoteB = { sub: "B", description: "Paint", amount: 1200, ref: "T-1" };
    await rpc("mcp_estimate_pricing_save", [
      id,
      encode([laborA]),
      encode([materialA]),
      encode([quoteA]),
      null,
    ]);
    const initial = await snapshot(id);
    await versioned(id, initial.version, [{ ...laborA, hourly_rate: 125 }], null);
    const before = await snapshot(id);
    await expect(
      rpc("mcp_estimate_pricing_save", [
        id,
        encode([laborA]),
        null,
        encode([quoteA, quoteB]),
        null,
      ]),
    ).rejects.toThrow();
    const after = await snapshot(id);
    expect(after.version).toEqual(before.version);
    expect(after.bid).toEqual(before.bid);
  });
  it("preserves explicit zero as a valid saved value", async () => {
    const id = await job();
    const free = { ref: "T-1", unit_price: 0, confirmed: true };
    await legacy(id, [laborA], [free]);
    await legacy(id, null, [free]);
    expect(pricing(await snapshot(id)).material).toEqual([free]);
  });
  it("rejects changes, deletion and removal of one duplicate object", async () => {
    const id = await job();
    // Model an already-existing legacy record; new legacy duplicate identities
    // are rejected but old duplicates must not disappear silently.
    await db.query(
      "INSERT INTO public.mcp_estimate_pricing(job_id,company_id,labor,material) VALUES($1,$2,$3,$4)",
      [id, company, JSON.stringify([laborA, laborA]), JSON.stringify([materialA, materialA])],
    );
    await legacy(id, [laborA, laborA], [materialA, materialA]);
    const before = await snapshot(id);
    await expect(legacy(id, [laborA], [materialA, materialA])).rejects.toThrow();
    await expect(
      legacy(id, [laborA, laborA], [{ ...materialA, unit_price: 7 }, materialA]),
    ).rejects.toThrow();
    const after = await snapshot(id);
    expect(after.version).toEqual(before.version);
    expect(pricing(after)).toEqual(pricing(before));
  });
  it("rejects new duplicate reference identities even if their objects differ", async () => {
    const id = await job();
    await legacy(id, [laborA], [materialA]);
    const before = await snapshot(id);
    await expect(legacy(id, [laborA, { ...laborA, hourly_rate: 105 }], null)).rejects.toThrow();
    await expect(legacy(id, null, [materialA, materialA])).rejects.toThrow();
    const after = await snapshot(id);
    expect(after.version).toEqual(before.version);
    expect(pricing(after)).toEqual(pricing(before));
  });
  it("protects selected factor source arrays from stale replacement", async () => {
    const id = await job();
    await legacy(id, [], [], [factorA]);
    await legacy(id, null, null, [factorA, factorB]);
    const before = await snapshot(id);
    await expect(legacy(id, null, null, [{ ...factorA, location_factor: 1.2 }])).rejects.toThrow();
    await expect(
      legacy(id, null, null, [factorA, factorB, { ...factorA, carry: false }]),
    ).rejects.toThrow();
    const after = await snapshot(id);
    expect(after.version).toEqual(before.version);
    expect(pricing(after).rate_sources).toEqual([factorA, factorB]);
  });
  it("rejects non-array legacy input without creating pricing or advancing version", async () => {
    const id = await job();
    const before = await snapshot(id);
    await expect(
      rpc("mcp_estimate_pricing_save", [id, JSON.stringify({ ref: "T-1" }), null, null, null]),
    ).rejects.toThrow(/array/i);
    const after = await snapshot(id);
    expect(after.version).toEqual(before.version);
    expect((after.bid as { pricing: unknown }).pricing).toBeNull();
  });
  it("allows matching-version rate corrections and rejects stale versioned writes", async () => {
    const id = await job();
    await legacy(id, [laborA], [materialA], [factorA]);
    const before = await snapshot(id);
    const labor = [{ ...laborA, hourly_rate: 125 }];
    const material = [{ ...materialA, unit_price: 8 }];
    const sources = [{ ...factorA, location_factor: 1.25 }];
    await versioned(id, before.version, labor, material, sources);
    const saved = await snapshot(id);
    expect(pricing(saved)).toMatchObject({ labor, material, rate_sources: sources });
    await expect(
      versioned(id, saved.version, null, null, [sources[0], { ...sources[0], carry: false }]),
    ).rejects.toThrow(/unique/i);
    await expect(versioned(id, before.version, [laborB], [materialB], [factorB])).rejects.toThrow(
      /changed|version|stale/i,
    );
    const after = await snapshot(id);
    expect(after.version).toEqual(saved.version);
    expect(pricing(after)).toEqual(pricing(saved));
  });
  it("keeps existing role guard and anonymous execute restrictions", async () => {
    const id = await job();
    await expect(legacy(id, [laborA], [materialA], null, outsider)).rejects.toThrow();
    const privileges = await db.query<{ anon: boolean; authenticated: boolean }>(
      "SELECT has_function_privilege('anon','public.mcp_estimate_pricing_save(uuid,jsonb,jsonb,jsonb,jsonb)','execute') AS anon,has_function_privilege('authenticated','public.mcp_estimate_pricing_save(uuid,jsonb,jsonb,jsonb,jsonb)','execute') AS authenticated",
    );
    expect(privileges.rows[0]).toEqual({ anon: false, authenticated: true });
    const metadata = await db.query(
      "SELECT pg_get_userbyid(proowner) AS owner,prosecdef,provolatile,proacl::text,proconfig,proargnames FROM pg_proc WHERE oid='public.mcp_estimate_pricing_save(uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure",
    );
    expect(metadata.rows).toEqual(legacyMetadata);
  });
  it("rolls back data and version after an interrupted transaction and accepts an identical legacy retry", async () => {
    const id = await job();
    await legacy(id, [laborA], [materialA]);
    const before = await snapshot(id);
    await expect(
      asUser(
        db,
        { sub: owner, email: "fixture@example.com", role: "authenticated" },
        async (tx) => {
          await tx.query("SELECT public.mcp_estimate_pricing_save($1,$2,$3,NULL,NULL)", [
            id,
            JSON.stringify([laborA, laborB]),
            JSON.stringify([materialA, materialB]),
          ]);
          await tx.query("SELECT 1/0");
        },
      ),
    ).rejects.toThrow();
    const rolledBack = await snapshot(id);
    expect(rolledBack.version).toEqual(before.version);
    expect(pricing(rolledBack)).toEqual(pricing(before));
    await legacy(id, [laborA, laborB], [materialA, materialB]);
    const saved = await snapshot(id);
    await legacy(id, [laborA, laborB], [materialA, materialB]);
    expect(pricing(await snapshot(id))).toEqual(pricing(saved));
  });
});
