/* Real role/RLS fixtures; no live records or external services. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeBuyoutDb, ids } from "../../../tests/buyout/fixture";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

let db: Awaited<ReturnType<typeof makeBuyoutDb>>;
let publicJobAccess: unknown;
const secret = "Internal draft margin strategy";
type Snapshot = {
  version: number;
  draft_terms: { fee_pct: number | null; basis: string | null };
  terms: { fee_pct: number | null; basis: string | null };
};
const query = (actor: string, sql: string, params: unknown[] = []) =>
  asUser(
    db,
    { sub: actor, role: "authenticated", email: "fixture@example.invalid" },
    (tx) => tx.query(sql, params) as Promise<{ rows: Record<string, unknown>[] }>,
  );
const snapshot = async (actor: string) =>
  (await query(actor, "SELECT mcp_estimate_destination_snapshot($1) AS data", [ids.job])).rows[0]
    .data as Snapshot;
const jobAccess = async () => ({
  policies: (
    await db.query(
      "SELECT * FROM pg_policies WHERE schemaname='public' AND tablename='mcp_jobs' ORDER BY policyname",
    )
  ).rows,
  acl: (
    await db.query("SELECT relacl::text AS acl FROM pg_class WHERE oid='public.mcp_jobs'::regclass")
  ).rows,
});

beforeAll(async () => {
  db = await makeBuyoutDb();
  await db.exec(
    "CREATE TABLE mcp_change_orders(submittal_id uuid PRIMARY KEY,job_id uuid,details jsonb)",
  );
  for (const file of [
    "supabase/migrations/20261030140000_athena_sov_contract_total_guard.sql",
    "supabase/migrations/20261030150000_athena_sov_official_lock.sql",
  ])
    await db.exec(readFileSync(file, "utf8"));
  publicJobAccess = await jobAccess();
  await db.exec(readFileSync("release-proposals/estimating-destination-versions.sql", "utf8"));
  await query(
    ids.owner,
    "SELECT mcp_estimate_destination_save($1,0,NULL,NULL,NULL,NULL,NULL,12.3456,$2)",
    [ids.job, secret],
  );
});
afterAll(async () => db.close());

describe.sequential("private draft terms under the existing job access model", () => {
  it.each(["super", "contracts"] as const)(
    "keeps draft terms out of readable job rows and RPC results for %s",
    async (role) => {
      const actor = ids[role];
      expect((await query(actor, "SELECT mcp_job_scope($1) AS scope", [ids.job])).rows).toEqual([
        { scope: role === "super" ? "super" : "contract" },
      ]);
      await expect(snapshot(actor)).rejects.toThrow();
      const jobs = await query(actor, "SELECT to_jsonb(j) AS data FROM mcp_jobs j WHERE id=$1", [
        ids.job,
      ]);
      expect(jobs.rows).toHaveLength(1);
      expect(JSON.stringify(jobs.rows)).not.toContain(secret);
      expect(jobs.rows[0].data).not.toHaveProperty("sov_draft_fee_pct");
      expect(jobs.rows[0].data).not.toHaveProperty("sov_draft_basis");
      await expect(
        query(
          actor,
          "SELECT fee_pct,basis FROM mcp_private.estimate_destination_draft_terms WHERE job_id=$1",
          [ids.job],
        ),
      ).rejects.toThrow(/permission denied/i);
      const version = (await snapshot(ids.owner)).version;
      await expect(
        query(
          actor,
          "SELECT mcp_estimate_destination_save($1,$2,NULL,NULL,NULL,NULL,NULL,1,'Unreviewed')",
          [ids.job, version],
        ),
      ).rejects.toThrow();
    },
  );

  it("lets owner and assigned PM use the guarded unchanged API without direct table access", async () => {
    const before = await snapshot(ids.owner);
    expect(before.draft_terms).toEqual({ fee_pct: 12.3456, basis: secret });
    expect(await snapshot(ids.pm)).toEqual(before);
    for (const actor of [ids.owner, ids.pm])
      await expect(
        query(
          actor,
          "SELECT fee_pct,basis FROM mcp_private.estimate_destination_draft_terms WHERE job_id=$1",
          [ids.job],
        ),
      ).rejects.toThrow(/permission denied/i);
    const response = await query(
      ids.pm,
      "SELECT mcp_estimate_destination_save($1,$2,NULL,NULL,NULL,NULL,NULL,0,$3) AS data",
      [ids.job, before.version, "Reviewed draft basis"],
    );
    const saved = response.rows[0].data as Snapshot;
    expect(saved.version).toBeGreaterThan(before.version);
    expect(saved.draft_terms).toEqual({ fee_pct: 0, basis: "Reviewed draft basis" });
    expect(saved.terms).toEqual(before.terms);
    expect(await snapshot(ids.owner)).toEqual(saved);
    await expect(
      query(
        ids.owner,
        "SELECT mcp_estimate_destination_save($1,$2,NULL,NULL,NULL,NULL,NULL,50,$3)",
        [ids.job, before.version, secret],
      ),
    ).rejects.toThrow(/destination changed/i);
    const repeated = await query(
      ids.pm,
      "SELECT mcp_estimate_destination_save($1,$2,NULL,NULL,NULL,NULL,NULL,0,$3) AS data",
      [ids.job, saved.version, "Reviewed draft basis"],
    );
    expect(repeated.rows[0].data).toEqual(saved);
  });

  it("requires a private write ticket for metadata changes and preserves public jobs policies and grants", async () => {
    const before = await snapshot(ids.owner);
    await expect(
      db.query(
        "UPDATE mcp_private.estimate_destination_draft_terms SET fee_pct=10 WHERE job_id=$1",
        [ids.job],
      ),
    ).rejects.toThrow(/version-checked/i);
    await expect(
      db.query("DELETE FROM mcp_private.estimate_destination_draft_terms WHERE job_id=$1", [
        ids.job,
      ]),
    ).rejects.toThrow(/version-checked/i);
    await expect(
      db.query(
        "INSERT INTO mcp_private.estimate_destination_draft_terms(job_id,fee_pct,basis) VALUES($1,5,'Direct')",
        [ids.job2],
      ),
    ).rejects.toThrow(/version-checked/i);
    expect(await snapshot(ids.owner)).toEqual(before);
    expect(await jobAccess()).toEqual(publicJobAccess);
    const columns = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='mcp_jobs' AND column_name IN ('sov_draft_fee_pct','sov_draft_basis')",
    );
    expect(columns.rows).toEqual([]);
    const privileges = await db.query(
      "SELECT has_table_privilege('authenticated','mcp_private.estimate_destination_draft_terms','SELECT') AS readable,has_table_privilege('authenticated','mcp_private.estimate_destination_draft_terms','INSERT') AS writable",
    );
    expect(privileges.rows).toEqual([{ readable: false, writable: false }]);
  });
});
