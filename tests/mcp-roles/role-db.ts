// Only the legacy role harness uses this overlay. Feature fixtures keep the
// shared migration-0024 base and install their own actual prerequisites.
import { readFileSync } from "node:fs";
import { deepStrictEqual } from "node:assert";
import { makeDb } from "./db";

export async function makeRoleDb() {
  const profile = process.env.ATHENA_ROLE_SCHEMA ?? "destination";
  if (!["legacy", "destination"].includes(profile))
    throw new Error("Use ATHENA_ROLE_SCHEMA=legacy or destination for this local fixture");
  const db = await makeDb();
  const timezoneMigration = readFileSync(
    "drizzle/migrations/0026_athena_submittal_display_time_zone.sql",
    "utf8",
  );
  const timezone = timezoneMigration.match(
    /^ALTER TABLE public\.mcp_companies ADD COLUMN time_zone text;$/m,
  )?.[0];
  if (!timezone) throw new Error("Expected exact company timezone prerequisite missing");
  await db.exec(timezone);
  if (profile === "legacy") return db;

  const accessMetadata = async () => ({
    tables: (
      await db.query(
        "SELECT relname,relacl::text,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('mcp_jobs'::regclass,'mcp_companies'::regclass,'mcp_company_members'::regclass,'mcp_job_facts'::regclass) ORDER BY relname",
      )
    ).rows,
    policies: (
      await db.query(
        "SELECT * FROM pg_policies WHERE schemaname='public' AND tablename IN ('mcp_jobs','mcp_companies','mcp_company_members','mcp_job_facts') ORDER BY tablename,policyname",
      )
    ).rows,
    scope: (
      await db.query(
        "SELECT pg_get_functiondef('public.mcp_job_scope(uuid)'::regprocedure) AS definition",
      )
    ).rows,
  });
  const before = await accessMetadata();

  // Current contract_terms reads this existing living-report prerequisite.
  // Install only the exact additive column, not its report tables or writers.
  const livingReports = readFileSync(
    "supabase/migrations/20261020213000_athena_living_reports.sql",
    "utf8",
  );
  const completionColumn = livingReports.match(
    /^ALTER TABLE public\.mcp_jobs ADD COLUMN IF NOT EXISTS contract_completion_date date;$/m,
  )?.[0];
  if (!completionColumn) throw new Error("Expected contract completion prerequisite missing");
  await db.exec(completionColumn);

  // The current source reader selects upload provenance and the spec table.
  // Reuse only the actual table/column/policy statements; this fixture neither
  // provisions Storage nor installs unrelated upload RPCs.
  const uploadSchema = readFileSync(
    "supabase/migrations/20261031120000_athena_file_upload.sql",
    "utf8",
  );
  for (const [start, end] of [
    [
      "ALTER TABLE public.mcp_contract_documents\n",
      "CREATE FUNCTION public.mcp_document_path_scope",
    ],
    ["CREATE TABLE public.mcp_spec_documents (", "CREATE TABLE public.mcp_file_uploads ("],
  ]) {
    const first = uploadSchema.indexOf(start),
      last = uploadSchema.indexOf(end);
    if (first < 0 || last <= first) throw new Error("Expected source-reader schema missing");
    await db.exec(uploadSchema.slice(first, last));
  }

  // The role matrix never creates change-order records. These prerequisite
  // shapes match the existing destination-version fixture; real CO execution
  // is tested separately against its complete migration chain.
  await db.exec(
    "CREATE TABLE mcp_submittals(id uuid PRIMARY KEY,job_id uuid,number text,revision integer); CREATE TABLE mcp_change_orders(submittal_id uuid PRIMARY KEY,job_id uuid,details jsonb);",
  );
  await db.exec(
    "ALTER TABLE mcp_submittals ENABLE ROW LEVEL SECURITY; ALTER TABLE mcp_change_orders ENABLE ROW LEVEL SECURITY; REVOKE ALL ON mcp_submittals,mcp_change_orders FROM PUBLIC,anon,authenticated;",
  );
  for (const file of [
    "supabase/migrations/20261101120001_athena_project_billing_evidence.sql",
    "supabase/migrations/20261030140000_athena_sov_contract_total_guard.sql",
    "supabase/migrations/20261030150000_athena_sov_official_lock.sql",
    "drizzle/migrations/0057_sov_payment_applications.sql",
    "drizzle/migrations/0058_payment_application_contract_basis.sql",
    "release-proposals/estimating-destination-versions.sql",
  ])
    await db.exec(readFileSync(file, "utf8"));
  deepStrictEqual(await accessMetadata(), before, "The fixture must preserve existing role access");
  return db;
}
