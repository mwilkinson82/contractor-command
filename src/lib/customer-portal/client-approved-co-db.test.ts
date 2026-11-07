// The client-approved change order step on the live definition of the client-page decision: the one service calls
// last wrote (20261106110000), as Lovable has it, not an earlier one. The migration's patch must find its two places
// there, land once each, survive a re-run, and come out cleanly with its rollback.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { gbbSql } from "../../../tests/selections/sql";

const MIGRATION = "supabase/migrations/20261107010000_athena_client_approved_co_joins_contract.sql";
const ROLLBACK =
  "supabase/rollbacks/20261107010000_athena_client_approved_co_joins_contract.rollback.sql";
const CALL = "mcp_private.co_execute_client_approved(s.id)";
let db: PGlite;

beforeAll(async () => {
  db = await makeDb();
  const load = (f: string) => db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  const pages = readFileSync("supabase/migrations/20261021120000_athena_report_pages.sql", "utf8");
  const leaderStart = pages.indexOf("CREATE OR REPLACE FUNCTION public.mcp_is_company_leader");
  await db.exec(
    pages.slice(
      leaderStart,
      pages.indexOf("TO authenticated;", leaderStart) + "TO authenticated;".length,
    ),
  );
  await load("20261023070000_athena_board_links");
  await load("20261023220000_athena_submittal_log");
  await load("20261024010000_athena_submittal_chase");
  await db.exec(
    "CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated; GRANT ALL ON storage.objects TO authenticated;",
  );
  await load("20261021000000_athena_file_shares");
  await load("20261028120000_athena_submittal_packages");
  await load("20261029120000_athena_submittal_record_page");
  await load("20261030120000_athena_package_build_identity");
  const drawings = readFileSync(
    "supabase/migrations/20261027130000_athena_drawing_versions.sql",
    "utf8",
  );
  await db.exec(drawings.slice(0, drawings.indexOf("CREATE FUNCTION public.mcp_drawing_records")));
  await db.exec(
    "CREATE TABLE test_company_plans(company_id uuid PRIMARY KEY,plan text); CREATE FUNCTION public.mcp_company_tier(_company uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT plan FROM test_company_plans WHERE company_id=_company $$;",
  );
  await load("20261025140000_athena_request_package_records");
  await load("20261025150000_athena_change_order_packages");
  await load("20261025153000_athena_change_execution_tie");
  await load("20261022200000_athena_estimating");
  await load("20261022230000_athena_estimating_bid");
  await db.exec("ALTER FUNCTION public.mcp_estimate_guard(uuid) VOLATILE");
  for (const sql of gbbSql()) await db.exec(sql);
  await load("20261020213000_athena_living_reports");
  await load("20261023020000_athena_superintendent");
  await load("20261104130000_athena_progress_photo_remove");
  await load("20261104170000_athena_customer_portal");
  await load("20261104200000_athena_proposal_choice_stage");
  await load("20261104200100_athena_portal_choice_stage");
  await load("20261101120001_athena_project_billing_evidence");
  await load("20261030140000_athena_sov_contract_total_guard");
  for (const f of [
    "0057_sov_payment_applications",
    "0058_payment_application_contract_basis",
    "0059_conversational_payment_drafts",
    "0082_athena_portal_pay_apps",
    "0085_athena_portal_pay_app_client_number",
  ])
    await db.exec(readFileSync(`drizzle/migrations/${f}.sql`, "utf8"));
  await load("20261105150000_athena_gbb_change_terms");
  await db.exec(
    "CREATE FUNCTION public.mcp_role_allowed(_company uuid, _role text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$",
  );
  await load("20261105180000_athena_job_notices");
  await load("20261105200000_athena_notices_owner_fallback");
  await load("20261105181000_athena_portal_messages");
  await load("20261105190000_athena_client_payments");
  await db.exec(readFileSync("drizzle/migrations/0035_accounting_purchase_orders.sql", "utf8"));
  await load("20261105170000_athena_job_contracts");
  await load("20261106110000_athena_service_calls");
  await load("20261106120000_athena_precon");
  await load("20261106130000_athena_precon_signing");
});

afterAll(async () => db?.close());

const decide = async () =>
  (
    await db.query<{ src: string }>(
      "SELECT prosrc AS src FROM pg_proc WHERE proname = 'mcp_portal_decide'",
    )
  ).rows[0].src;
const calls = (src: string) => src.split(CALL).length - 1;

describe.sequential("client-approved change orders join the contract, on the live decision", () => {
  it("patches the change-order approval and the package pick, once each", async () => {
    expect(calls(await decide())).toBe(0);
    await db.exec(readFileSync(MIGRATION, "utf8"));
    const src = await decide();
    expect(calls(src)).toBe(2);
    // One right after a change order's approval is recorded, one before a package pick's change order is reported.
    expect(src).toContain(
      `'portal_decision', did), 'user');\n      IF _decision = 'approved' THEN PERFORM ${CALL}; END IF;`,
    );
    expect(src).toContain(`PERFORM ${CALL};\n        pco := s.number;`);
    const change = (
      await db.query<{ src: string }>(
        "SELECT prosrc AS src FROM pg_proc WHERE proname = 'mcp_change_record'",
      )
    ).rows[0].src;
    expect(change).toContain("executed_total_kept");
  });

  it("applies again without a second copy, and its rollback takes it all back out", async () => {
    await db.exec(readFileSync(MIGRATION, "utf8"));
    expect(calls(await decide())).toBe(2);
    await db.exec(readFileSync(ROLLBACK, "utf8"));
    expect(calls(await decide())).toBe(0);
    const helper = await db.query(
      "SELECT 1 FROM pg_proc WHERE proname = 'co_execute_client_approved'",
    );
    expect(helper.rows).toHaveLength(0);
    await db.exec(readFileSync(MIGRATION, "utf8"));
    expect(calls(await decide())).toBe(2);
  });

  it("keeps the helper out of every client role's reach", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const r = await db.query<{ ok: boolean }>(
        "SELECT has_function_privilege($1, 'mcp_private.co_execute_client_approved(uuid)', 'EXECUTE') AS ok",
        [role],
      );
      expect(r.rows[0].ok).toBe(false);
    }
  });
});
