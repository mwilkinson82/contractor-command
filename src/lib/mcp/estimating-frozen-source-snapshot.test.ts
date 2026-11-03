/* eslint-disable @typescript-eslint/no-explicit-any -- SQL RPC responses have different JSON shapes, asserted below. */
/* Local PGlite integration tests: synthetic users and data only. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

const handlerState = vi.hoisted(() => ({
  actor: "00000000-0000-4000-8000-000000000901",
  loseResponse: false,
}));
vi.mock("./guard", () => ({
  run: async (_name: string, _ctx: unknown, _options: unknown, fn: (sb: unknown) => unknown) =>
    fn({
      rpc: async (name: string, args: Record<string, unknown>) => {
        const values =
          name === "mcp_estimate_snapshot_review"
            ? [args._job, args._request, args._expected_version]
            : name === "mcp_estimate_snapshot_save"
              ? [args._job, args._request, args._confirmed]
              : name === "mcp_estimate_coverage_snapshot"
                ? [args._job]
                : [args._job, args._snapshot];
        try {
          const data = await rpc(name, values, handlerState.actor);
          if (name === "mcp_estimate_snapshot_save" && handlerState.loseResponse) {
            handlerState.loseResponse = false;
            return { data: null, error: { message: "Interrupted after commit" } };
          }
          return { data, error: null };
        } catch (error) {
          return {
            data: null,
            error: { message: error instanceof Error ? error.message : String(error) },
          };
        }
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
    company_id: "00000000-0000-4000-8000-000000000910",
    job_number: "COVERAGE",
  }),
  named: () => "COVERAGE",
}));
import { estimateSourceSnapshot } from "./tools/estimate-coverage-tools";

const owner = "00000000-0000-4000-8000-000000000901";
const outsider = "00000000-0000-4000-8000-000000000904";
const company = "00000000-0000-4000-8000-000000000910";
const job = "00000000-0000-4000-8000-000000000920";
const req = (n: number) => `00000000-0000-4000-8001-${String(n).padStart(12, "0")}`;
let db: PGlite;
const rpc = async (name: string, args: unknown[], user = owner) =>
  asUser(
    db,
    { sub: user, email: "fixture@example.com", role: "authenticated" },
    async (tx) =>
      (
        await tx.query(
          `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS data`,
          args,
        )
      ).rows[0].data as any,
  );
const snapshot = () => rpc("mcp_estimate_coverage_snapshot", [job]);
const decisions: Record<string, unknown>[] = [
  {
    quote_index: 0,
    decision: "carry",
    ref: "T-1",
    replace_labor_and_material: true,
    exclusive_to_line: true,
    source_note: "Written quotation",
    scope_note: "Complete line",
    exclusions_note: "None stated",
  },
  { quote_index: 1, decision: "compare", ref: "T-1" },
];
const review = (id: number, version: number, rows = decisions) =>
  rpc("mcp_estimate_coverage_review", [job, req(id), version, JSON.stringify(rows)]);
const save = (id: number, confirmed = true) =>
  rpc("mcp_estimate_coverage_save", [job, req(id), confirmed]);
const pricing = (version: number, quotes: unknown[] | null) =>
  rpc("mcp_estimate_pricing_save_versioned", [
    job,
    version,
    null,
    null,
    quotes === null ? null : JSON.stringify(quotes),
    null,
  ]);
const quotes = [
  { sub: "A", description: "Whole scope", amount: 1200, ref: "T-1" },
  { sub: "B", description: "Comparison", amount: 1300, ref: "T-1" },
];

beforeAll(async () => {
  db = await makeDb();
  await db.exec(readFileSync("supabase/migrations/20261022200000_athena_estimating.sql", "utf8"));
  await db.exec(
    readFileSync("supabase/migrations/20261022230000_athena_estimating_bid.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/migrations/20261023010000_athena_estimating_conventions.sql", "utf8"),
  );
  await db.exec(
    `CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;`,
  );
  for (const migration of [
    "20261031120000_athena_file_upload.sql",
    "20261027130000_athena_drawing_versions.sql",
    "20261024005713_athena_takeoff_engine.sql",
    "20261024160000_athena_takeoff_carry_by_identity.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  await db.exec(readFileSync("release-proposals/estimating-member-read-transactions.sql", "utf8"));
  await db.exec(readFileSync("release-proposals/estimating-quote-coverage.sql", "utf8"));
  await db.exec(readFileSync("release-proposals/estimating-gc-requirements-cas.sql", "utf8"));
  await db.exec(readFileSync("release-proposals/estimating-frozen-source-snapshot.sql", "utf8"));
  await db.exec(readFileSync("release-proposals/estimating-requirement-sources.sql", "utf8"));
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
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id) VALUES($1,$2,'Job','COVERAGE',$3)",
    [job, owner, company],
  );
  await rpc("mcp_estimate_setup_save", [job, JSON.stringify({ role: "gc", trades: ["Finishes"] })]);
  const unscanned = await snapshot();
  await rpc("mcp_estimate_requirements_save", [
    job,
    JSON.stringify({
      expected_version: unscanned.version,
      source_sha256: unscanned.requirement_sources.sha256,
      reviewed_confirmations: [],
      items: [],
    }),
  ]);
  await rpc("mcp_estimate_takeoff_save", [
    job,
    "A",
    "[]",
    JSON.stringify([
      {
        line_no: 1,
        item: "Paint",
        qty: 100,
        unit: "SF",
        sheet: "A1",
        basis: "measured",
        math: "100 SF",
      },
    ]),
  ]);
});
afterAll(async () => db.close());

describe.sequential("immutable source snapshots", () => {
  it("captures source on the server, requires confirmation and saves exactly once", async () => {
    await pricing((await snapshot()).version, quotes);
    const current = await snapshot();
    await review(1, current.version);
    await save(1);
    const s = await snapshot();
    const reviewed = await rpc("mcp_estimate_snapshot_review", [job, req(50), s.version]);
    expect(reviewed).toMatchObject({
      status: "review",
      source_version: s.version,
      current: true,
      snapshot: { bid: { pricing: { quotes } } },
    });
    expect(reviewed.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await rpc("mcp_estimate_snapshot_review", [job, req(50), s.version])).toEqual(reviewed);
    await expect(rpc("mcp_estimate_snapshot_save", [job, req(50), false])).rejects.toThrow(
      /confirm/i,
    );
    const saved = await rpc("mcp_estimate_snapshot_save", [job, req(50), true]);
    expect(await rpc("mcp_estimate_snapshot_save", [job, req(50), true])).toEqual(saved);
    const read = await rpc("mcp_estimate_snapshot_read", [job, saved.snapshot_id]);
    expect(read).toMatchObject({
      snapshot_id: saved.snapshot_id,
      source_version: s.version,
      sha256: reviewed.sha256,
      snapshot: reviewed.snapshot,
    });
    expect(
      (await db.query("SELECT count(*)::int AS n FROM mcp_private.estimate_source_snapshot"))
        .rows[0],
    ).toEqual({ n: 1 });
  });
  it("rejects a stale review and preserves the saved historical source", async () => {
    const prior = await snapshot();
    await rpc("mcp_estimate_snapshot_review", [job, req(51), prior.version]);
    await rpc("mcp_estimate_setup_save", [job, JSON.stringify({ in_scope: ["Changed"] })]);
    await expect(rpc("mcp_estimate_snapshot_save", [job, req(51), true])).rejects.toThrow(
      /changed/i,
    );
    const old = await rpc("mcp_estimate_snapshot_save", [job, req(50), true]);
    expect(old.current).toBe(false);
    const read = await rpc("mcp_estimate_snapshot_read", [job, old.snapshot_id]);
    expect(read.snapshot.estimate.setup.in_scope).not.toEqual(["Changed"]);
  });
  it("rejects wrong job/actor and direct mutation of stored snapshot", async () => {
    const old = await rpc("mcp_estimate_snapshot_save", [job, req(50), true]);
    await expect(
      rpc("mcp_estimate_snapshot_read", [job, old.snapshot_id], outsider),
    ).rejects.toThrow();
    await expect(
      rpc("mcp_estimate_snapshot_save", [job, req(50), true], outsider),
    ).rejects.toThrow();
    await expect(
      db.query(
        "UPDATE mcp_private.estimate_source_snapshot SET source_data='{}'::jsonb WHERE id=$1",
        [old.snapshot_id],
      ),
    ).rejects.toThrow(/cannot be changed/i);
    const privileges = await db.query<{ anon: boolean; authed: boolean }>(
      "SELECT has_function_privilege('anon','public.mcp_estimate_snapshot_read(uuid,uuid)','execute') AS anon,has_table_privilege('authenticated','mcp_private.estimate_source_snapshot','select') AS authed",
    );
    expect(privileges.rows[0]).toEqual({ anon: false, authed: false });
  });
  it("prevents another authorized member from saving or replaying the actor's review", async () => {
    const member = "00000000-0000-4000-8000-000000000906";
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'fixture@example.com')", [member]);
    await db.query("INSERT INTO test_active_members VALUES($1)", [member]);
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'estimating','Member')",
      [company, member],
    );
    await rpc("mcp_estimate_setup_save", [job, JSON.stringify({ in_scope: ["New scope"] })]);
    // The current quote decision became stale; renew it before reviewing the source.
    const before = await snapshot();
    await review(60, before.version);
    await save(60);
    const current = await snapshot();
    await rpc("mcp_estimate_snapshot_review", [job, req(61), current.version]);
    await expect(rpc("mcp_estimate_snapshot_save", [job, req(61), true], member)).rejects.toThrow(
      /review/i,
    );
    await expect(
      rpc("mcp_estimate_snapshot_review", [job, req(61), current.version], member),
    ).rejects.toThrow(/different review/i);
  });
  it("rolls back a source save after interruption and produces the server's exact digest", async () => {
    const current = await snapshot();
    const reviewed = await rpc("mcp_estimate_snapshot_review", [job, req(62), current.version]);
    await expect(
      asUser(
        db,
        { sub: owner, email: "fixture@example.com", role: "authenticated" },
        async (tx) => {
          await tx.query("SELECT public.mcp_estimate_snapshot_save($1,$2,true)", [job, req(62)]);
          await tx.query("SELECT 1/0");
        },
      ),
    ).rejects.toThrow();
    expect(
      (await db.query("SELECT count(*)::int AS n FROM mcp_private.estimate_source_snapshot"))
        .rows[0],
    ).toEqual({ n: 1 });
    const saved = await rpc("mcp_estimate_snapshot_save", [job, req(62), true]);
    const digest = await db.query<{ hash: string }>(
      "SELECT encode(sha256(convert_to(source_data::text,'UTF8')),'hex') AS hash FROM mcp_private.estimate_source_snapshot WHERE id=$1",
      [saved.snapshot_id],
    );
    expect(digest.rows[0].hash).toBe(reviewed.sha256);
  });
  it("rechecks authority after the lock before review, save replay, or read", async () => {
    const current = await snapshot();
    const saved = await rpc("mcp_estimate_snapshot_save", [job, req(62), true]);
    await db.exec(`ALTER FUNCTION mcp_private.estimate_lock(uuid) RENAME TO estimate_lock_original;
      CREATE FUNCTION mcp_private.estimate_lock(_job uuid) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE v bigint; BEGIN v:=mcp_private.estimate_lock_original(_job);
        DELETE FROM public.mcp_company_members WHERE user_id=auth.uid() AND company_id=(SELECT company_id FROM public.mcp_jobs WHERE id=_job); RETURN v; END $$;
      REVOKE ALL ON FUNCTION mcp_private.estimate_lock(uuid) FROM PUBLIC,anon,authenticated;`);
    try {
      await expect(
        rpc("mcp_estimate_snapshot_review", [job, req(70), current.version]),
      ).rejects.toThrow();
      await expect(rpc("mcp_estimate_snapshot_save", [job, req(62), true])).rejects.toThrow();
      await expect(rpc("mcp_estimate_snapshot_read", [job, saved.snapshot_id])).rejects.toThrow();
    } finally {
      await db.exec(
        "DROP FUNCTION mcp_private.estimate_lock(uuid); ALTER FUNCTION mcp_private.estimate_lock_original(uuid) RENAME TO estimate_lock;",
      );
    }
  });
  it("reviews, retries and reads through the actual handler without changing job financial facts", async () => {
    const call = (args: Record<string, unknown>) =>
      (
        estimateSourceSnapshot as unknown as {
          handler: (
            args: unknown,
            ctx: unknown,
          ) => Promise<{ structuredContent: Record<string, unknown> }>;
        }
      ).handler({ job_number: "COVERAGE", ...args }, {});
    const factsBefore = (
      await db.query("SELECT to_jsonb(f) AS row FROM mcp_job_facts f WHERE job_id=$1 ORDER BY id", [
        job,
      ])
    ).rows;
    const now = await snapshot();
    const id = req(75);
    const reviewed = await call({ step: "review", request_id: id, expected_version: now.version });
    expect(reviewed.structuredContent).toMatchObject({
      status: "review",
      source_version: now.version,
    });
    await expect(call({ step: "save", request_id: id })).rejects.toThrow(/confirm/i);
    handlerState.loseResponse = true;
    await expect(call({ step: "save", request_id: id, confirmed: true })).rejects.toThrow(
      /after commit/i,
    );
    const saved = await call({ step: "save", request_id: id, confirmed: true });
    const read = await call({ step: "read", snapshot_id: saved.structuredContent.snapshot_id });
    expect(read.structuredContent).toMatchObject({
      snapshot_id: saved.structuredContent.snapshot_id,
      sha256: reviewed.structuredContent.sha256,
    });
    await call({ step: "review", request_id: req(76), expected_version: now.version });
    await rpc("mcp_estimate_setup_save", [
      job,
      JSON.stringify({ in_scope: ["Changed after review"] }),
    ]);
    await expect(call({ step: "save", request_id: req(76), confirmed: true })).rejects.toThrow(
      /changed/i,
    );
    handlerState.actor = outsider;
    try {
      await expect(
        call({ step: "read", snapshot_id: saved.structuredContent.snapshot_id }),
      ).rejects.toThrow();
    } finally {
      handlerState.actor = owner;
    }
    expect(
      (
        await db.query(
          "SELECT to_jsonb(f) AS row FROM mcp_job_facts f WHERE job_id=$1 ORDER BY id",
          [job],
        )
      ).rows,
    ).toEqual(factsBefore);
  });
});
