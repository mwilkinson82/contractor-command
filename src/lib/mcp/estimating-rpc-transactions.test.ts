import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";

const owner = "00000000-0000-4000-8000-000000000901";
const estimator = "00000000-0000-4000-8000-000000000902";
const superId = "00000000-0000-4000-8000-000000000903";
const outsider = "00000000-0000-4000-8000-000000000904";
const inactive = "00000000-0000-4000-8000-000000000905";
const company = "00000000-0000-4000-8000-000000000910";
const job = "00000000-0000-4000-8000-000000000920";
const readers = [
  "mcp_estimate_guard",
  "mcp_estimate_get",
  "mcp_estimate_bid_get",
  "mcp_estimate_profile_get",
];
const proposal = readFileSync("release-proposals/estimating-member-read-transactions.sql", "utf8");
let db: PGlite;

beforeAll(async () => {
  db = await makeDb();
  for (const migration of [
    "20261022200000_athena_estimating.sql",
    "20261022230000_athena_estimating_bid.sql",
    "20261023010000_athena_estimating_conventions.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  for (const user of [owner, estimator, superId, outsider]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'fictional-member@example.com')", [
      user,
    ]);
    await db.query("INSERT INTO test_active_members VALUES($1)", [user]);
  }
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,'fictional-inactive@example.com')", [
    inactive,
  ]);
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Fictional Builder',$2)",
    [company, owner],
  );
  for (const [user, role] of [
    [owner, "owner"],
    [estimator, "estimating"],
    [superId, "super"],
  ])
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,'Fictional member')",
      [company, user, role],
    );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id) VALUES($1,$2,'Fictional Job','SYN-RPC',$3)",
    [job, owner, company],
  );
  await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
    job,
    superId,
    owner,
  ]);
  // Preserve the actual estimating bodies and role checks. Model only the existing gate's
  // lock requirement on synthetic rows: live circle_sync_user -> ensure_circle_company
  // locks its provisioning row even for a warm-cache, already provisioned member.
  await db.exec(
    `CREATE OR REPLACE FUNCTION public.mcp_gate() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN PERFORM 1 FROM public.test_active_members WHERE user_id=auth.uid() FOR UPDATE; RETURN EXISTS(SELECT 1 FROM public.test_active_members WHERE user_id=auth.uid()); END $$;`,
  );
});
afterAll(() => db.close());

async function rpc(
  name: string,
  user = owner,
  method: "POST" | "GET" = "POST",
  args: unknown[] = [job],
) {
  const type = name === "mcp_estimate_takeoff_save" ? "uuid,text,jsonb,jsonb" : "uuid";
  const mode = (
    await db.query<{ volatility: string }>(
      "SELECT provolatile::text AS volatility FROM pg_proc WHERE oid=to_regprocedure($1)",
      [`public.${name}(${type})`],
    )
  ).rows[0].volatility;
  // PostgREST RPC transaction rules: POST + VOLATILE is READ WRITE; every GET,
  // STABLE and IMMUTABLE call is READ ONLY. Ordinary direct SQL tests omit this.
  return db.transaction(async (tx) => {
    await tx.exec(
      `SET TRANSACTION ${method === "POST" && mode === "v" ? "READ WRITE" : "READ ONLY"}`,
    );
    await tx.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: user, role: "authenticated", email: "fictional-member@example.com" }),
    ]);
    await tx.exec("SET LOCAL ROLE authenticated");
    return (
      await tx.query<{ data: unknown }>(
        `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS data`,
        args,
      )
    ).rows[0].data;
  });
}
const metadata = () =>
  db.query(
    "SELECT proname,pg_get_function_identity_arguments(oid) AS args,pg_get_userbyid(proowner) AS owner,prolang,prosrc,proacl::text,prosecdef,proconfig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY($1) ORDER BY proname",
    [readers],
  );
const counts = () =>
  db.query(
    "SELECT (SELECT count(*)::int FROM mcp_estimate_setup) AS setup,(SELECT count(*)::int FROM mcp_estimate_takeoffs) AS takeoffs,(SELECT count(*)::int FROM mcp_estimate_gap_items) AS gaps,(SELECT count(*)::int FROM mcp_estimate_verdicts) AS verdicts",
  );

describe.sequential("estimating RPC transaction classification", () => {
  it("reproduces the exact warm-member row-lock failure on all mislabeled RPC reads", async () => {
    const before = (await counts()).rows;
    for (const name of readers)
      await expect(rpc(name)).rejects.toMatchObject({
        code: "25006",
        message: "cannot execute SELECT FOR UPDATE in a read-only transaction",
      });
    // Takeoff get/save, intake and status all read mcp_estimate_get first. Pricing
    // additionally reads bid_get, and intake/save read profile_get.
    expect((await counts()).rows).toEqual(before);
  });
  it("changes only volatility and allows the same existing member-gated reads", async () => {
    const beforeMeta = (await metadata()).rows;
    const beforeCounts = (await counts()).rows;
    await db.exec(proposal);
    expect((await metadata()).rows).toEqual(beforeMeta);
    for (const user of [owner, estimator]) {
      expect(await rpc(readers[0], user)).toBe(company);
      expect(await rpc(readers[1], user)).toMatchObject({ setup: null, takeoff: null });
      expect(await rpc(readers[2], user)).toMatchObject({ company_id: company });
      expect(await rpc(readers[3], user)).toMatchObject({ found: false });
    }
    expect((await counts()).rows).toEqual(beforeCounts);
  });
  it("preserves inactive, non-member and superintendent denials and anonymous ACLs", async () => {
    for (const name of readers) {
      await expect(rpc(name, inactive)).rejects.toThrow("MCP_INACTIVE");
      await expect(rpc(name, outsider)).rejects.toThrow(/MCP_NO_JOB|role|access/i);
      await expect(rpc(name, superId)).rejects.toThrow(/MCP_NO_JOB|role|access/i);
    }
    const meta = (
      await db.query<{ allowed: boolean; volatility: string }>(
        "SELECT has_function_privilege('anon',oid,'execute') AS allowed,provolatile::text AS volatility FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY($1)",
        [readers],
      )
    ).rows;
    expect(meta.every((r) => !r.allowed && r.volatility === "v")).toBe(true);
  });
  it("does not make GET safe for the existing write-capable gate or bypass HTTP semantics", async () => {
    await expect(rpc("mcp_estimate_get", owner, "GET")).rejects.toMatchObject({ code: "25006" });
  });
  it("supports the existing takeoff save/read sequence after correction without a retry write", async () => {
    expect(await rpc("mcp_estimate_get")).toMatchObject({ takeoff: null });
    expect(await rpc("mcp_estimate_profile_get")).toMatchObject({ found: false });
    const saved = await rpc("mcp_estimate_takeoff_save", owner, "POST", [
      job,
      "Synthetic revision",
      "[]",
      JSON.stringify([
        {
          line_no: 1,
          item: "Synthetic fixture count",
          qty: 2,
          unit: "EA",
          basis: "measured",
          math: "Two fixture locations",
          sheet: "E-1",
        },
      ]),
    ]);
    expect(saved).toMatchObject({ version: 1, lines: 1 });
    const read = (await rpc("mcp_estimate_get")) as {
      takeoff: { version: number; lines: { qty: number }[] };
    };
    expect(read.takeoff.version).toBe(1);
    expect(Number(read.takeoff.lines[0].qty)).toBe(2);
    expect((await counts()).rows[0]).toMatchObject({ takeoffs: 1, gaps: 0, verdicts: 0 });
  });
});
