// The job import save runs against the real Athena writers it calls: job create,
// facts with the official-SOV lock and destination versions, change-order
// records, the submittal log and the daily report save.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
import { fromOverwatch } from "./overwatch";
import { planImport, type ImportContext } from "./plan";
import { readIorModel } from "../ior-model";

const owner = "00000000-0000-4000-8000-000000000a01";
const outsider = "00000000-0000-4000-8000-000000000a02";
const company = "00000000-0000-4000-8000-000000000a03";
const other = "00000000-0000-4000-8000-000000000a04";
let db: PGlite;

const query = (sql: string, values: unknown[] = [], user = owner) =>
  asUser(
    db,
    { sub: user, role: "authenticated", email: `${user.slice(-2)}@example.com` },
    (tx) => tx.query(sql, values) as Promise<{ rows: Record<string, unknown>[] }>,
  );
const rpc = async <T = Record<string, unknown>>(fn: string, values: unknown[], user = owner) =>
  (
    await query(
      `SELECT public.${fn}(${values.map((_, i) => `$${i + 1}`).join(",")}) AS data`,
      values,
      user,
    )
  ).rows[0].data as T;

const sample = () =>
  JSON.parse(readFileSync("src/lib/job-import/fixtures/overwatch-sample.json", "utf8"));
const v2 = () =>
  JSON.parse(readFileSync("src/lib/job-import/fixtures/overwatch-v2-sample.json", "utf8"));
async function stage(exportJson: unknown, user = owner) {
  const imported = fromOverwatch(exportJson);
  const ctx = await rpc<ImportContext>(
    "mcp_job_import_context",
    [company, imported.job.job_number, "overwatch"],
    user,
  );
  const plan = planImport(imported, ctx);
  const staged = await rpc<{ batch_id: string; package_hash: string }>(
    "mcp_job_import_stage",
    [company, imported.job.job_number, JSON.stringify(plan.package)],
    user,
  );
  return { plan, ctx, ...staged };
}

beforeAll(async () => {
  db = await makeDb();
  const load = (f: string) => db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  await load("20261020213000_athena_living_reports");
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
  await load("20261030130000_athena_submittal_log_approval_only");
  await load("20261030140000_athena_sov_contract_total_guard");
  await load("20261030150000_athena_sov_official_lock");
  await db.exec(readFileSync("release-proposals/estimating-destination-versions.sql", "utf8"));
  await load("20261023020000_athena_superintendent");
  await db.exec(readFileSync("drizzle/migrations/0074_migration.sql", "utf8"));
  await load("20261104160000_athena_job_import");
  await load("20261105090000_athena_job_import_whole_job");
  // The two copies of the migration must stay identical.
  expect(readFileSync("drizzle/migrations/0079_athena_job_import_whole_job.sql", "utf8")).toBe(
    readFileSync("supabase/migrations/20261105090000_athena_job_import_whole_job.sql", "utf8"),
  );
  for (const user of [owner, outsider]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES ($1,$2)", [
      user,
      `${user.slice(-2)}@example.com`,
    ]);
    await db.query("INSERT INTO test_active_members VALUES ($1)", [user]);
  }
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Fictional Construction',$2),($3,'Other Builder',$4)",
    [company, owner, other, outsider],
  );
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','QA Owner'),($3,$4,'owner','Other Owner')",
    [company, owner, other, outsider],
  );
  await db.query("INSERT INTO test_company_plans VALUES($1,'circle'),($2,'circle')", [
    company,
    other,
  ]);
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe("job import save", () => {
  let jobId = "";

  it("refuses without the yes, with a wrong key, or for someone else", async () => {
    const { batch_id, package_hash } = await stage(sample());
    await expect(rpc("mcp_job_import_apply", [batch_id, package_hash, false])).rejects.toThrow(
      /says yes/,
    );
    await expect(rpc("mcp_job_import_apply", [batch_id, "0".repeat(32), true])).rejects.toThrow(
      /does not match/,
    );
    await expect(
      rpc("mcp_job_import_apply", [batch_id, package_hash, true], outsider),
    ).rejects.toThrow(/not yours/);
    await expect(
      rpc(
        "mcp_job_import_stage",
        [company, "3101", JSON.stringify({ version: 1, source: { system: "overwatch" } })],
        outsider,
      ),
    ).rejects.toThrow();
    const none = await db.query("SELECT count(*)::int AS n FROM mcp_jobs WHERE job_number='3101'");
    expect(none.rows[0]).toEqual({ n: 0 });
  });

  it("saves the whole job in one transaction after the yes", async () => {
    const { batch_id, package_hash } = await stage(sample());
    const result = await rpc<Record<string, unknown>>("mcp_job_import_apply", [
      batch_id,
      package_hash,
      true,
    ]);
    expect(result).toMatchObject({
      job_created: true,
      contract_facts: 6,
      sov_lines: 3,
      opening_balances: 3,
      budget_lines: 3,
      change_orders: 1,
      submittals: 2,
      dailies: 1,
      ior: 0,
      archive_rows: 29,
      already_applied: false,
    });
    jobId = String(result.job_id);
    const facts = await db.query<{ module: string; key: string; value: unknown }>(
      "SELECT module, key, value FROM mcp_job_facts WHERE job_id=$1 ORDER BY module, key",
      [jobId],
    );
    const sov = facts.rows.filter((r) => r.module === "sov");
    expect(sov.map((r) => [r.key, (r.value as { billable_value: number }).billable_value])).toEqual(
      [
        ["01", 50000],
        ["02", 118500],
        ["03", 86000],
      ],
    );
    expect(facts.rows.find((r) => r.key === "contract_value")?.value).toBe(250000);
    const jobRow = await db.query(
      "SELECT sov_fee_pct::float8 AS fee, sov_basis FROM mcp_jobs WHERE id=$1",
      [jobId],
    );
    expect(jobRow.rows[0]).toMatchObject({ fee: 0 });
    const open = await db.query(
      "SELECT sov_key, work_to_date_cents::int AS w, retained_cents::int AS r FROM mcp_import_opening_balances WHERE job_id=$1 ORDER BY sov_key",
      [jobId],
    );
    expect(open.rows).toEqual([
      { sov_key: "01", w: 2_000_000, r: 200_000 },
      { sov_key: "02", w: 3_000_000, r: 350_000 },
      { sov_key: "03", w: 1_000_000, r: 100_000 },
    ]);
    const pco = await db.query(
      "SELECT s.number, s.title, c.details->>'state' AS state, (c.details->>'total_cents')::int AS total FROM mcp_change_orders c JOIN mcp_submittals s ON s.id=c.submittal_id WHERE c.job_id=$1",
      [jobId],
    );
    expect(pco.rows).toEqual([
      { number: "PCO-001", title: "Relocate nurse station wall", state: "priced", total: 875_050 },
    ]);
    const subs = await db.query(
      "SELECT number, revision, status, source FROM mcp_submittals WHERE job_id=$1 AND package_purpose IS DISTINCT FROM 'change_order' ORDER BY number",
      [jobId],
    );
    expect(subs.rows).toEqual([
      { number: "092900-01", revision: 0, status: "approved", source: "imported" },
      { number: "260519-01", revision: 1, status: "revise_and_resubmit", source: "imported" },
    ]);
    const daily = await db.query(
      "SELECT d.report_date::text AS day, w.work, w.crew::int AS crew FROM mcp_daily_reports d JOIN mcp_daily_work_lines w ON w.daily_id=d.id WHERE d.job_id=$1",
      [jobId],
    );
    expect(daily.rows).toEqual([{ day: "2026-11-02", work: "Hang drywall", crew: 6 }]);
  });

  it("returns the first result on a replay of the same batch", async () => {
    const batch = await db.query<{ id: string; package_hash: string }>(
      "SELECT id, package_hash FROM mcp_import_batches WHERE status='applied'",
    );
    const again = await rpc<Record<string, unknown>>("mcp_job_import_apply", [
      batch.rows[0].id,
      batch.rows[0].package_hash,
      true,
    ]);
    expect(again.already_applied).toBe(true);
  });

  it("brings in nothing twice when the same export runs again", async () => {
    const { plan } = await stage(sample());
    expect(Object.values(plan.counts).every((n) => n === 0)).toBe(true);
    expect(plan.kept.join(" ")).toMatch(/already has an SOV/);
  });

  it("rolls back everything when one writer refuses", async () => {
    const x = sample();
    x.project.job_number = "3102";
    const { batch_id, package_hash } = await stage(x);
    await db.query(
      "UPDATE mcp_import_batches SET package = jsonb_set(package, '{dailies,0,lines,0,qty}', '0'::jsonb), package_hash = md5(jsonb_set(package, '{dailies,0,lines,0,qty}', '0'::jsonb)::text) WHERE id=$1",
      [batch_id],
    );
    const hash = (
      await db.query<{ package_hash: string }>(
        "SELECT package_hash FROM mcp_import_batches WHERE id=$1",
        [batch_id],
      )
    ).rows[0].package_hash;
    expect(hash).not.toBe(package_hash);
    await expect(rpc("mcp_job_import_apply", [batch_id, hash, true])).rejects.toThrow(/work line/);
    const none = await db.query("SELECT count(*)::int AS n FROM mcp_jobs WHERE job_number='3102'");
    expect(none.rows[0]).toEqual({ n: 0 });
  });

  it("refuses an expired review and a review replaced by a newer one", async () => {
    const x = sample();
    x.project.job_number = "3103";
    const first = await stage(x);
    const second = await stage(x);
    await expect(
      rpc("mcp_job_import_apply", [first.batch_id, first.package_hash, true]),
    ).rejects.toThrow(/replaced or cancelled/);
    await db.query(
      "UPDATE mcp_import_batches SET expires_at = now() - interval '1 minute' WHERE id=$1",
      [second.batch_id],
    );
    await expect(
      rpc("mcp_job_import_apply", [second.batch_id, second.package_hash, true]),
    ).rejects.toThrow(/expired/);
  });

  it("re-runs a version 2 export onto the job: only the IOR and new archive rows are added", async () => {
    const before = await db.query<{ kind: string; n: number }>(
      "SELECT source_kind AS kind, count(*)::int AS n FROM mcp_import_records WHERE job_id=$1 GROUP BY 1 ORDER BY 1",
      [jobId],
    );
    expect(before.rows.map((r) => r.kind)).toEqual(
      expect.arrayContaining(["job", "change_order", "submittal", "daily", "archive"]),
    );
    const archivedBefore = (
      await db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM mcp_import_archive WHERE job_id=$1",
        [jobId],
      )
    ).rows[0].n;
    const { plan, batch_id, package_hash } = await stage(v2());
    expect(plan.counts).toMatchObject({
      job: 0,
      contract_facts: 0,
      sov_lines: 0,
      opening_balances: 0,
      budget_lines: 0,
      change_orders: 0,
      submittals: 0,
      dailies: 0,
      ior: 1,
    });
    const result = await rpc<Record<string, unknown>>("mcp_job_import_apply", [
      batch_id,
      package_hash,
      true,
    ]);
    expect(result).toMatchObject({
      job_created: false,
      contract_facts: 0,
      sov_lines: 0,
      budget_lines: 0,
      change_orders: 0,
      submittals: 0,
      dailies: 0,
      ior: 1,
      ior_risks: 4,
      archive_rows: plan.counts.archive_rows,
    });
    expect(plan.counts.archive_rows).toBeGreaterThan(0);
    const archivedAfter = (
      await db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM mcp_import_archive WHERE job_id=$1",
        [jobId],
      )
    ).rows[0].n;
    expect(archivedAfter).toBe(archivedBefore + plan.counts.archive_rows);
    // The first copy of a row already archived is kept.
    const co = await db.query<{ row: Record<string, unknown> }>(
      "SELECT row FROM mcp_import_archive WHERE job_id=$1 AND source_table='change_orders' AND source_id='c3'",
      [jobId],
    );
    expect(co.rows[0].row).not.toHaveProperty("cost_amount");
    // Version 1 of the IOR, readable by Athena's IOR page.
    const report = await rpc<{ found: boolean; version: number; data: Record<string, unknown> }>(
      "mcp_living_report_get",
      [jobId, "ior", null],
    );
    expect(report).toMatchObject({ found: true, version: 1 });
    const read = readIorModel(report.data);
    expect(read.problems).toEqual([]);
    expect(read.model?.exposures).toHaveLength(4);
    const ledger = await db.query<{ kind: string; n: number }>(
      "SELECT source_kind AS kind, count(*)::int AS n FROM mcp_import_records WHERE job_id=$1 AND batch_id=$2 GROUP BY 1 ORDER BY 1",
      [jobId, batch_id],
    );
    expect(ledger.rows.map((r) => r.kind)).toEqual(["archive", "ior"]);
    // And once more: nothing new at all.
    const again = await stage(v2());
    expect(Object.values(again.plan.counts).every((n) => n === 0)).toBe(true);
  });

  it("keeps Athena's own IOR when the job already has one", async () => {
    const x = v2();
    x.project.job_number = "3104";
    x.project.id = "p-4";
    const first = await stage(x);
    const made = await rpc<{ job_id: string }>("mcp_job_import_apply", [
      first.batch_id,
      first.package_hash,
      true,
    ]);
    // Simulate a PM's own IOR v2 on the job, then the export runs from scratch on a copy.
    await rpc("mcp_living_report_save", [
      made.job_id,
      "ior",
      1,
      JSON.stringify({ note: "PM's own" }),
      null,
      null,
      null,
      null,
      "PM update",
      null,
      "QA Owner",
    ]);
    await db.query("DELETE FROM mcp_import_records WHERE job_id=$1 AND source_kind='ior'", [
      made.job_id,
    ]);
    const { plan } = await stage(x);
    expect(plan.package.ior ?? null).toBeNull();
    expect(plan.kept.join(" ")).toMatch(/already has an IOR/);
    const latest = await rpc<{ version: number }>("mcp_living_report_get", [
      made.job_id,
      "ior",
      null,
    ]);
    expect(latest.version).toBe(2);
  });

  it("lets full-access members read the archive and nobody write it", async () => {
    const mine = await query("SELECT count(*)::int AS n FROM mcp_import_archive WHERE job_id=$1", [
      jobId,
    ]);
    expect((mine.rows[0] as { n: number }).n).toBeGreaterThan(0);
    const theirs = await query(
      "SELECT count(*)::int AS n FROM mcp_import_archive WHERE job_id=$1",
      [jobId],
      outsider,
    );
    expect(theirs.rows[0]).toEqual({ n: 0 });
    await expect(query("DELETE FROM mcp_import_archive WHERE job_id=$1", [jobId])).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      query("UPDATE mcp_import_archive SET row='{}' WHERE job_id=$1", [jobId]),
    ).rejects.toThrow(/permission denied/);
  });

  it("does not let another company read the destination", async () => {
    await expect(
      rpc("mcp_job_import_context", [company, "3101", "overwatch"], outsider),
    ).rejects.toThrow(/MCP_NO_COMPANY/);
    await expect(query("SELECT * FROM mcp_import_batches")).rejects.toThrow(/permission denied/);
  });
});
