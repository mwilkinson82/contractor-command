// Client page Home on a local database: the real migration chain through 20261106130000_athena_precon_signing, then
// 20261106230000_athena_client_page_home (and its rollback round trip). The PM's photo and where the money stands reach
// the client page; nothing unapproved does. All names and numbers are made up.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
import { gbbSql } from "../../../tests/selections/sql";
import { tokenHash } from "../mcp/file-share";
import { portalViewSchema } from "./model";

const owner = "00000000-0000-4000-8000-000000000f01";
const pm = "00000000-0000-4000-8000-000000000f02";
const outsider = "00000000-0000-4000-8000-000000000f03";
const company = "00000000-0000-4000-8000-000000000f10";
const otherCompany = "00000000-0000-4000-8000-000000000f11";
const job = "00000000-0000-4000-8000-000000000f20";
let db: PGlite;
let access = "";
let sess = "";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- results are read field by field
type J = any;
const query = (user: string | null, sql: string, values: unknown[] = []) =>
  asUser(
    db,
    user
      ? { sub: user, role: "authenticated", email: `${user.slice(-2)}@example.com` }
      : ({ role: "service_role" } as never),
    (tx) => tx.query(sql, values) as Promise<{ rows: Record<string, unknown>[] }>,
  );
const call = async (user: string | null, name: string, args: unknown[]) =>
  (
    await query(
      user,
      `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS data`,
      args.map((a) => (typeof a === "object" && a !== null ? JSON.stringify(a) : a)),
    )
  ).rows[0]!.data as J;
const view = async () => call(null, "mcp_portal_view", [access, sess, null, null]);
const HOME = "supabase/migrations/20261106230000_athena_client_page_home.sql";
const ROLLBACK = "supabase/rollbacks/20261106230000_athena_client_page_home.rollback.sql";

/** One bill: the invoice row and its versions, oldest first. */
async function bill(
  id: string,
  kind: "invoice" | "pay_application" | "credit",
  versions: { status: string; gross?: number | null; net: number; certified?: number | null }[],
  creditFor: string | null = null,
) {
  await db.query(
    "INSERT INTO mcp_billing_invoices(id,job_id,company_id,document_number,kind,credit_for,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [id, job, company, `DOC-${id.slice(-4)}`, kind, creditFor, owner],
  );
  for (const [i, v] of versions.entries())
    await db.query(
      `INSERT INTO mcp_billing_invoice_versions(invoice_id,job_id,version,status,invoice_date,effective_date,source,gross_cents,net_due_cents,certified_cents,certified_date,recorded_by)
       VALUES($1,$2,$3,$4,'2026-10-30','2026-10-30','Test',$5,$6,$7,$8,$9)`,
      [
        id,
        job,
        i + 1,
        v.status,
        v.gross ?? null,
        v.net,
        v.certified ?? null,
        v.certified == null ? null : "2026-10-31",
        owner,
      ],
    );
}

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
  // Members' own profiles, as the first Lovable migration made them.
  await db.exec(
    'CREATE TABLE public.profiles(id uuid PRIMARY KEY, email text NOT NULL, full_name text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()); ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY; CREATE POLICY "own profile select" ON public.profiles FOR SELECT USING (auth.uid() = id); GRANT SELECT, UPDATE ON public.profiles TO authenticated;',
  );
  await db.exec(readFileSync(HOME, "utf8"));
  // The rollback puts the earlier client page back; the migration then applies again cleanly.
  await db.exec(readFileSync(ROLLBACK, "utf8"));
  await db.exec(readFileSync(HOME, "utf8"));

  for (const user of [owner, pm, outsider]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES ($1,$2)", [
      user,
      `${user.slice(-2)}@example.com`,
    ]);
    await db.query("INSERT INTO test_active_members VALUES ($1)", [user]);
    await db.query("INSERT INTO public.profiles(id,email,full_name) VALUES ($1,$2,'Test')", [
      user,
      `${user.slice(-2)}@example.com`,
    ]);
  }
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'ALP Construction (test)',$2),($3,'Other Builder',$4)",
    [company, owner, otherCompany, outsider],
  );
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','QA Owner'),($1,$3,'pm','QA PM'),($4,$5,'owner','Other Owner')",
    [company, owner, pm, otherCompany, outsider],
  );
  await db.query("INSERT INTO test_company_plans VALUES($1,'circle'),($2,'circle')", [
    company,
    otherCompany,
  ]);
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name,time_zone,pm_name,pm_email) VALUES($1,$2,$3,'2810','Willow Creek Community Center','America/Manaus','Quinn Park','02@example.com')",
    [job, owner, company],
  );
  const inv = await call(owner, "mcp_portal_invite", [
    job,
    "rosa@example.com",
    "Rosa Delgado",
    await tokenHash("P".repeat(43)),
    new Date(Date.now() + 86_400_000).toISOString(),
  ]);
  access = inv.access_id;
  sess = await tokenHash("S".repeat(43));
  await db.query(
    "INSERT INTO mcp_portal_sessions(access_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [access, sess],
  );
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe.sequential("client page Home", () => {
  it("has no progress until the job has a contract value, and still parses", async () => {
    const v = await view();
    expect(() => portalViewSchema.parse(v)).not.toThrow();
    expect(v.progress).toBeNull();
    expect(v.contractor.pm_photo_path).toBeNull();
  });

  it("counts only certified bills, less posted credits on them, against the contract", async () => {
    await db.query(
      "INSERT INTO mcp_job_facts(job_id,module,key,value,status,source,updated_by) VALUES($1,'contract','contract_value','480000','known','member_answer',$2)",
      [job, owner],
    );
    const certified = "00000000-0000-4000-8000-00000000a001";
    await bill(certified, "invoice", [
      { status: "submitted", gross: 5_000_000, net: 4_500_000 },
      { status: "certified", gross: 4_800_000, net: 4_320_000, certified: 4_320_000 },
    ]);
    await bill(
      "00000000-0000-4000-8000-00000000a002",
      "credit",
      [{ status: "posted", net: 120_000 }],
      certified,
    );
    // Not approved yet, or replaced: none of these count.
    await bill("00000000-0000-4000-8000-00000000a003", "pay_application", [
      { status: "submitted", gross: 5_200_000, net: 4_680_000 },
    ]);
    await bill("00000000-0000-4000-8000-00000000a004", "invoice", [
      { status: "draft", gross: 900_000, net: 900_000 },
    ]);
    await bill("00000000-0000-4000-8000-00000000a005", "invoice", [
      { status: "certified", gross: 700_000, net: 700_000, certified: 700_000 },
      { status: "void", gross: 700_000, net: 700_000 },
    ]);
    const v = await view();
    expect(() => portalViewSchema.parse(v)).not.toThrow();
    expect(v.progress).toEqual({ contract_cents: 48_000_000, approved_cents: 4_680_000 });
  });

  it("shows the PM's own photo, and only for a member of the job's company", async () => {
    // The PM sets their photo; another folder or a bare name is refused.
    await expect(call(pm, "mcp_profile_photo_set", [`${owner}/photo-x.jpg`])).rejects.toThrow(
      /own folder/,
    );
    await expect(call(pm, "mcp_profile_photo_set", ["not-a-path"])).rejects.toThrow(/own folder/);
    expect(await call(pm, "mcp_profile_photo_set", [`${pm}/photo-1.jpg`])).toEqual({
      status: "ok",
      photo_path: `${pm}/photo-1.jpg`,
    });
    // Matched by the job's PM email, with no PM user on the job.
    expect((await view()).contractor.pm_photo_path).toBe(`${pm}/photo-1.jpg`);
    // Someone outside the company with that email never shows.
    await db.query("UPDATE public.profiles SET photo_path=$2 WHERE id=$1", [
      outsider,
      `${outsider}/photo-2.jpg`,
    ]);
    await db.query("UPDATE mcp_jobs SET pm_email='03@example.com' WHERE id=$1", [job]);
    expect((await view()).contractor.pm_photo_path).toBeNull();
    // The job's PM user wins, whatever the email says.
    await db.query("UPDATE mcp_jobs SET pm_user_id=$2 WHERE id=$1", [job, pm]);
    expect((await view()).contractor.pm_photo_path).toBe(`${pm}/photo-1.jpg`);
    // Clearing it shows initials again.
    expect((await call(pm, "mcp_profile_photo_set", [null])).photo_path).toBeNull();
    expect((await view()).contractor.pm_photo_path).toBeNull();
  });

  it("keeps the helpers and the view out of members' direct reach", async () => {
    for (const user of [owner, pm]) {
      await expect(query(user, "SELECT mcp_private.portal_progress($1)", [job])).rejects.toThrow();
      await expect(query(user, "SELECT mcp_private.portal_pm_photo($1)", [job])).rejects.toThrow();
    }
    await expect(call(owner, "mcp_portal_view", [access, sess, null, null])).rejects.toThrow();
  });
});
