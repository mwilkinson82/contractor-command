import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";

const owner = "00000000-0000-4000-8000-000000000711";
const outsider = "00000000-0000-4000-8000-000000000712";
const inactive = "00000000-0000-4000-8000-000000000713";
const company = "00000000-0000-4000-8000-000000000714";
const job = "00000000-0000-4000-8000-000000000715";
let db: PGlite;
const proposal = readFileSync("release-proposals/report-read-compatibility.sql", "utf8");
const metadata = async () =>
  (
    await db.query<{
      name: string;
      volatility: string;
      body: string;
      acl: string;
      owner: string;
      settings: string[];
      definer: boolean;
    }>(
      "select proname name,provolatile volatility,md5(prosrc) body,proacl::text acl,pg_get_userbyid(proowner) owner,proconfig settings,prosecdef definer from pg_proc where oid in ('public.mcp_report_page_get(text,uuid,uuid)'::regprocedure,'public.mcp_report_page_stamp(text,uuid,uuid)'::regprocedure) order by proname",
    )
  ).rows;
async function postgrest(
  fn: "mcp_report_page_get" | "mcp_report_page_stamp",
  user = owner,
  role = "authenticated",
) {
  const volatile = (await metadata()).find((r) => r.name === fn)?.volatility === "v";
  return db.transaction(async (tx) => {
    if (!volatile) await tx.exec("SET TRANSACTION READ ONLY");
    await tx.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: user, role }),
    ]);
    await tx.exec(role === "anon" ? "SET LOCAL ROLE anon" : "SET LOCAL ROLE authenticated");
    return (await tx.query<{ data: unknown }>(`select public.${fn}('field',$1,null) data`, [job]))
      .rows[0].data;
  });
}
beforeAll(async () => {
  db = await makeDb();
  await db.exec(
    "CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;",
  );
  for (const file of [
    "20261020213000_athena_living_reports",
    "20261021000000_athena_file_shares",
    "20261021120000_athena_report_pages",
    "20261021210000_athena_report_pages_lookahead_payapp_briefing",
    "20261022200000_athena_estimating",
    "20261023020000_athena_superintendent",
    "20261023220000_athena_submittal_log",
  ]) {
    let sql = readFileSync(`supabase/migrations/${file}.sql`, "utf8");
    if (file.endsWith("submittal_log"))
      sql = sql.slice(0, sql.indexOf("CREATE OR REPLACE FUNCTION public.mcp_board_link_open"));
    await db.exec(sql);
  }
  for (const id of [owner, outsider, inactive])
    await db.query("insert into auth.users(id,email) values($1,'fictional@example.com')", [id]);
  for (const id of [owner, outsider])
    await db.query("insert into test_active_members values($1)", [id]);
  await db.query(
    "insert into mcp_companies(id,name,created_by) values($1,'Fictional project',$2)",
    [company, owner],
  );
  await db.query(
    "insert into mcp_company_members(company_id,user_id,role,display_name) values($1,$2,'owner','Fictional owner')",
    [company, owner],
  );
  await db.query(
    "insert into mcp_jobs(id,company_id,user_id,job_number,name) values($1,$2,$3,'QA-ONLY','Fictional job')",
    [job, company, owner],
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe("project RPC access mode and expired membership cache", () => {
  it("reproduces the production failure on both STABLE read entry points, then changes metadata only", async () => {
    const before = await metadata();
    expect(before.every((r) => r.volatility === "s")).toBe(true);
    await expect(postgrest("mcp_report_page_get")).rejects.toThrow(/read.only/);
    await expect(postgrest("mcp_report_page_stamp")).rejects.toThrow(/read.only/);
    await db.exec(proposal);
    expect(await metadata()).toEqual(before.map((r) => ({ ...r, volatility: "v" })));
  });
  it("opens the account-linked project on a cold cache and after that cache expires", async () => {
    await db.query("delete from mcp_gate_cache where user_id=$1", [owner]);
    expect(await postgrest("mcp_report_page_get")).toMatchObject({
      page: "field",
      scope: "full",
      job_number: "QA-ONLY",
    });
    await db.query(
      "update mcp_gate_cache set checked_at=now()-interval '10 minutes' where user_id=$1",
      [owner],
    );
    expect(typeof (await postgrest("mcp_report_page_stamp"))).toBe("string");
    expect(await postgrest("mcp_report_page_get")).toMatchObject({ page: "field" });
  });
  it("still denies an entitled user outside the company and an inactive member", async () => {
    await expect(postgrest("mcp_report_page_get", outsider)).rejects.toThrow(/MCP_NO_JOB/);
    await expect(postgrest("mcp_report_page_stamp", outsider)).rejects.toThrow(/MCP_NO_JOB/);
    await expect(postgrest("mcp_report_page_get", inactive)).rejects.toThrow(/MCP_INACTIVE/);
  });
  it("keeps anonymous calls denied and does not change project or financial records", async () => {
    await expect(postgrest("mcp_report_page_get", owner, "anon")).rejects.toThrow(
      /permission denied/,
    );
    const before = (
      await db.query(
        "select md5(jsonb_agg(t)::text) hash from (select to_jsonb(j) r from mcp_jobs j union all select to_jsonb(m) from mcp_company_members m union all select to_jsonb(r) from mcp_living_reports r) t",
      )
    ).rows;
    await postgrest("mcp_report_page_get");
    await postgrest("mcp_report_page_stamp");
    const after = (
      await db.query(
        "select md5(jsonb_agg(t)::text) hash from (select to_jsonb(j) r from mcp_jobs j union all select to_jsonb(m) from mcp_company_members m union all select to_jsonb(r) from mcp_living_reports r) t",
      )
    ).rows;
    expect(after).toEqual(before);
  });
});
