import { readFileSync, readdirSync } from "node:fs";
export const dailyFixture = {
  company: "54000000-0000-4000-8000-000000000001",
  job: "54000000-0000-4000-8000-000000000002",
  otherJob: "54000000-0000-4000-8000-000000000003",
  owner: "54000000-0000-4000-8000-000000000010",
  super: "54000000-0000-4000-8000-000000000011",
  contracts: "54000000-0000-4000-8000-000000000012",
  outsider: "54000000-0000-4000-8000-000000000013",
  pm: "54000000-0000-4000-8000-000000000014",
};
export async function installDailyCaptureFixture(query) {
  const base = readFileSync("tests/mcp-roles/db.ts", "utf8");
  const boot = base.match(/const BOOT = `([\s\S]*?)`;/)?.[1];
  if (!boot) throw new Error("Canonical role fixture bootstrap unavailable.");
  await query(boot);
  for (const file of readdirSync("drizzle/migrations")
    .filter((f) => f.endsWith(".sql") && f <= "0024_athena_reopen_open_item.sql")
    .sort())
    await query(
      readFileSync(`drizzle/migrations/${file}`, "utf8").replace(/--> statement-breakpoint/g, ""),
    );
  await query(
    `CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE FUNCTION public.mcp_file_path_scope(text) RETURNS text LANGUAGE sql AS $$ SELECT 'full'::text $$;`,
  );
  await query(readFileSync("supabase/migrations/20261023020000_athena_superintendent.sql", "utf8"));
  const def = await query(
    "SELECT pg_get_functiondef('public.mcp_daily_report_save(uuid,date,boolean,text,text,text,text,text,text,text,text,jsonb)'::regprocedure) definition",
  );
  await query(readFileSync("drizzle/migrations/0050_daily_capture_create_only.sql", "utf8"));
  const after = await query(
    "SELECT pg_get_functiondef('public.mcp_daily_report_save(uuid,date,boolean,text,text,text,text,text,text,text,text,jsonb)'::regprocedure) definition",
  );
  if (JSON.stringify(def.rows) !== JSON.stringify(after.rows))
    throw new Error("Canonical assistant save changed.");
  const { company, job, otherJob, owner, super: superUser, contracts, outsider, pm } = dailyFixture;
  for (const uid of [owner, superUser, contracts, outsider, pm]) {
    await query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [
      uid,
      `${uid}@daily-fixture.invalid`,
    ]);
    await query("INSERT INTO test_active_members VALUES($1)", [uid]);
  }
  await query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'SYNTHETIC DAILY',$2)", [
    company,
    owner,
  ]);
  for (const [uid, role] of [
    [owner, "owner"],
    [superUser, "super"],
    [contracts, "contracts"],
    [pm, "pm"],
  ])
    await query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,$3)",
      [company, uid, role],
    );
  await query(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name) VALUES($1,$3,$4,'DAILY-TEST','Synthetic daily'),($2,$3,$4,'DAILY-OTHER','Unassigned synthetic')",
    [job, otherJob, owner, company],
  );
  await query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3),($1,$4,$3)", [
    job,
    superUser,
    owner,
    pm,
  ]);
}
export const dailyLines = (work = "Synthetic conduit") => [
  {
    work,
    sov_item: "26.04",
    activity_id: "E090",
    qty: 20,
    unit: "LF",
    crew: 2,
    hours: 8,
    pct_complete: 25,
  },
];
export const captureSql =
  "SELECT public.mcp_daily_report_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) result";
export const captureArgs = (
  request,
  day,
  work = "Synthetic conduit",
  reviewedAt = new Date().toISOString(),
  job = dailyFixture.job,
  confirmed = true,
) => [
  job,
  day,
  confirmed,
  request,
  reviewedAt,
  "Clear",
  "2 workers 8 hours",
  "None",
  "None",
  "None",
  "None",
  "No incidents",
  JSON.stringify(dailyLines(work)),
];
export const legacySql =
  "SELECT public.mcp_daily_report_save($1,$2,true,'Clear','Crew','None','None','None','None','No incidents',$3,$4::jsonb) result";
