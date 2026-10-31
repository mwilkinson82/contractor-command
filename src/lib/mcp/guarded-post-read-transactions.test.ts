import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

const owner = "00000000-0000-4000-8000-000000000951";
const outsider = "00000000-0000-4000-8000-000000000952";
const inactive = "00000000-0000-4000-8000-000000000953";
const company = "00000000-0000-4000-8000-000000000954";
const job = "00000000-0000-4000-8000-000000000955";
const upload = "00000000-0000-4000-8000-000000000956";
let submittal = "00000000-0000-4000-8000-000000000957";
const proposal = readFileSync("release-proposals/guarded-post-read-transactions.sql", "utf8");
const targets = [
  { name: "mcp_daily_reminder_status", signature: "text", args: ["SYN-POST"] },
  { name: "mcp_daily_report_get", signature: "uuid,date", args: [job, "2026-10-31"] },
  { name: "mcp_field_board", signature: "uuid", args: [job] },
  { name: "mcp_field_reminder_preview", signature: "uuid", args: [job] },
  { name: "mcp_file_upload_get", signature: "uuid,uuid", args: [upload, job] },
  { name: "mcp_guided_latest", signature: "uuid,text", args: [job, "pm_meeting"] },
  { name: "mcp_living_report_get", signature: "uuid,text,integer", args: [job, "cpm", null] },
  { name: "mcp_morning_brief_card_status", signature: "", args: [] },
  { name: "mcp_morning_brief_feed", signature: "", args: [] },
  {
    name: "mcp_progress_photos_list",
    signature: "uuid,date,date,text,text,boolean",
    args: [job, null, null, null, null, false],
  },
  {
    name: "mcp_project_record_search",
    signature: "uuid,date,date,text,text",
    args: [job, null, null, null, null],
  },
  { name: "mcp_submittal_chase_due", signature: "", args: [] },
  { name: "mcp_submittal_chase_rows", signature: "uuid", args: [job] },
  { name: "mcp_submittal_package_context", signature: "uuid,uuid", args: [job, submittal] },
  { name: "mcp_submittal_rows", signature: "uuid", args: [job] },
] as const;
let db: PGlite;

beforeAll(async () => {
  db = await makeDb();
  await db.exec(
    "CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now()); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;",
  );
  for (const file of [
    "20261020213000_athena_living_reports",
    "20261021000000_athena_file_shares",
    "20261021120000_athena_report_pages",
    "20261021210000_athena_report_pages_lookahead_payapp_briefing",
    "20261022200000_athena_estimating",
    "20261023020000_athena_superintendent",
    "20261023030000_athena_guided_sessions",
    "20261023040000_athena_daily_reminder_card",
    "20261023070000_athena_board_links",
    "20261023200000_athena_morning_brief",
    "20261023220000_athena_submittal_log",
    "20261024010000_athena_submittal_chase",
    "20261024020000_athena_morning_brief_card",
    "20261024180000_athena_brief_once_and_fast",
    "20261028120000_athena_submittal_packages",
    "20261031120000_athena_file_upload",
  ])
    await db.exec(readFileSync(`supabase/migrations/${file}.sql`, "utf8"));
  await db.exec(readFileSync("drizzle/migrations/0053_file_upload_recovery.sql", "utf8"));
  // Current package_context body depends on the record/request/change package chain.
  for (const file of [
    "supabase/migrations/20261029120000_athena_submittal_record_page.sql",
    "drizzle/migrations/0027_athena_request_package_records.sql",
    "drizzle/migrations/0028_athena_change_order_packages.sql",
  ])
    await db.exec(readFileSync(file, "utf8"));
  for (const user of [owner, outsider, inactive])
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'fictional@example.com')", [user]);
  for (const user of [owner, outsider])
    await db.query("INSERT INTO test_active_members VALUES($1)", [user]);
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Fictional Builder',$2)",
    [company, owner],
  );
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Fictional owner')",
    [company, owner],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id) VALUES($1,$2,'Fictional hidden project','SYN-POST',$3)",
    [job, owner, company],
  );
  await asUser(db, { sub: owner, email: "fictional@example.com", role: "authenticated" }, async (tx) => {
    await tx.query("SELECT public.mcp_submittal_log($1,'add',$2::jsonb)", [job, JSON.stringify({ number: "SYN-1", title: "Fictional hidden submittal", spec_section: "26 00 00", submittal_type: "product_data", status: "in_prep", ball_in_court: "gc" })]);
  });
  submittal = (await db.query<{id: string}>("SELECT id FROM mcp_submittals WHERE job_id=$1 AND number='SYN-1'", [job])).rows[0].id;
  await db.query(
    "INSERT INTO mcp_file_uploads(id,company_id,job_id,purpose,filename,mime_type,bucket,storage_path,token_hash,expires_at,created_by) VALUES($1,$2,$3,'spec','Fictional private upload.txt','text/plain','athena-documents','fictional/private.txt',$4,now()+interval '1 hour',$5)",
    [upload, company, job, "a".repeat(64), owner],
  );
  // Model the existing production provisioning gate's row lock without importing private bodies.
  await db.exec(
    "CREATE OR REPLACE FUNCTION public.mcp_gate() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN PERFORM 1 FROM public.test_active_members WHERE user_id=auth.uid() FOR UPDATE; RETURN EXISTS(SELECT 1 FROM public.test_active_members WHERE user_id=auth.uid()); END $$;",
  );
}, 30000);
afterAll(() => db?.close());

async function call(
  target: (typeof targets)[number],
  user = owner,
  method: "POST" | "GET" = "POST",
) {
  const identity = `public.${target.name}(${target.signature})`;
  const volatility = (
    await db.query<{ v: string }>(
      "SELECT provolatile::text AS v FROM pg_proc WHERE oid=to_regprocedure($1)",
      [identity],
    )
  ).rows[0].v;
  const args = target.name === "mcp_submittal_package_context" ? [job, submittal] : [...target.args];
  return db.transaction(async (tx) => {
    await tx.exec(
      `SET TRANSACTION ${method === "POST" && volatility === "v" ? "READ WRITE" : "READ ONLY"}`,
    );
    await tx.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: user, email: "fictional@example.com", role: "authenticated" }),
    ]);
    await tx.exec("SET LOCAL ROLE authenticated");
    return (
      await tx.query<{ data: unknown }>(
        `SELECT public.${target.name}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS data`,
        args,
      )
    ).rows[0].data;
  });
}
const metadata = () =>
  db.query(
    "SELECT proname,pg_get_function_identity_arguments(oid) AS args,pg_get_userbyid(proowner) AS owner,prolang,prosrc,proacl::text,prosecdef,proconfig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY($1) ORDER BY proname",
    [targets.map((t) => t.name)],
  );
const snapshot = () =>
  db.query(
    "SELECT md5(jsonb_agg(data ORDER BY data::text)::text) AS hash FROM (SELECT to_jsonb(t) AS data FROM mcp_jobs t UNION ALL SELECT to_jsonb(t) FROM mcp_company_members t UNION ALL SELECT to_jsonb(t) FROM mcp_file_uploads t UNION ALL SELECT to_jsonb(t) FROM mcp_submittals t UNION ALL SELECT to_jsonb(t) FROM mcp_living_reports t UNION ALL SELECT to_jsonb(t) FROM mcp_guided_sessions t) records",
  );

describe.sequential("ordinary guarded POST readers", () => {
  it("keeps the proposal to exactly the fifteen reviewed signatures", () => {
    const alters = [...proposal.matchAll(/ALTER FUNCTION public\.([a-z_]+)\(([^)]*)\) VOLATILE;/g)]
      .map((m) => `${m[1]}(${m[2].replaceAll(" ", "")})`)
      .sort();
    expect(alters).toEqual(targets.map((t) => `${t.name}(${t.signature})`).sort());
    expect(proposal).not.toMatch(/\b(?:GRANT|REVOKE|CREATE|DELETE|INSERT|UPDATE)\b/i);
    expect(proposal).not.toMatch(/^\s*(?:BEGIN|COMMIT)\s*;/m);
  });
  it("uses the current package-context body after its migration prerequisites", async () => {
    const row = (
      await db.query<{ body_md5: string }>(
        "SELECT md5(prosrc) AS body_md5 FROM pg_proc WHERE oid='public.mcp_submittal_package_context(uuid,uuid)'::regprocedure",
      )
    ).rows[0];
    expect(row.body_md5).toBe("bd76f003d7fee53f44ba03c3b030a491");
  });
  it("reproduces the exact read-only row-lock failure at every current POST boundary", async () => {
    for (const target of targets)
      await expect(call(target)).rejects.toMatchObject({
        code: "25006",
        message: "cannot execute SELECT FOR UPDATE in a read-only transaction",
      });
  });
  it("changes only volatility and permits each unchanged actual source reader", async () => {
    const beforeMeta = (await metadata()).rows;
    const beforeData = (await snapshot()).rows;
    expect(beforeMeta).toHaveLength(15);
    await db.exec(proposal);
    expect((await metadata()).rows).toEqual(beforeMeta);
    for (const target of targets) await expect(call(target)).resolves.not.toBeUndefined();
    expect((await snapshot()).rows).toEqual(beforeData);
  });
  it("retains inactive and anonymous protections for all fifteen readers", async () => {
    for (const target of targets)
      await expect(call(target, inactive)).rejects.toThrow("MCP_INACTIVE");
    const meta = (
      await db.query<{ allowed: boolean; v: string }>(
        "SELECT has_function_privilege('anon',oid,'execute') AS allowed,provolatile::text AS v FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY($1)",
        [targets.map((t) => t.name)],
      )
    ).rows;
    expect(meta).toHaveLength(15);
    expect(meta.every((row) => !row.allowed && row.v === "v")).toBe(true);
  });
  it("does not expose the owner's job, submittal or private upload to another entitled user", async () => {
    for (const target of targets) {
      const result = await call(target, outsider).then(
        (data) => JSON.stringify(data),
        (error: Error) => {
          expect(error.message).toMatch(/MCP_NO_JOB|MCP_BAD|role|access/i);
          return "denied";
        },
      );
      for (const secret of [job, "SYN-POST", "Fictional hidden", "Fictional private"])
        expect(result).not.toContain(secret);
    }
  });
  it("does not turn GET into a read/write request", async () => {
    for (const target of targets)
      await expect(call(target, owner, "GET")).rejects.toMatchObject({ code: "25006" });
  });
});
