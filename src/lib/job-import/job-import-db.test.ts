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
  await db.exec(
    "CREATE SCHEMA IF NOT EXISTS mcp_private; CREATE TABLE mcp_private.residential_selection_boards(job_id uuid PRIMARY KEY, version bigint NOT NULL, body jsonb NOT NULL, updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now());",
  );
  await load("20261105100000_athena_job_logs_part1");
  await load("20261105100100_athena_job_logs_part2");
  await load("20261105100200_athena_job_logs_part3");
  await load("20261105100300_athena_job_logs_part4");
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
      schedule_activities: 2,
      rfis: 1,
      decisions: 0,
      claims: 0,
      inspections: 0,
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
      "SELECT number, revision, status, source FROM mcp_submittals WHERE job_id=$1 AND package_purpose = 'approval' ORDER BY number",
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
    // The RFI is on the RFI log as sent outside Athena: no send receipt, never sent from here.
    const rfi = await rpc<{ records: Record<string, unknown>[] }>("mcp_request_rows", [
      jobId,
      "rfi",
    ]);
    expect(rfi.records).toHaveLength(1);
    expect(rfi.records[0]).toMatchObject({
      number: "RFI-001",
      status: "in_review",
      state: "sent",
      recorded_outside: true,
      submitted_on: "2026-10-05",
    });
    expect((rfi.records[0].request_details as Record<string, unknown>).outside).toMatchObject({
      source: "Overwatch",
      source_number: "RFI-001",
      sent_on: "2026-10-05",
    });
    const mail = await db.query("SELECT count(*)::int AS n FROM mcp_submittal_mail");
    expect(mail.rows[0]).toEqual({ n: 0 });
    // The schedule is CPM version 1, not cost loaded.
    const cpm = await rpc<{
      found: boolean;
      version: number;
      data: { activities: { id: string; value: unknown }[] };
    }>("mcp_living_report_get", [jobId, "cpm", null]);
    expect(cpm).toMatchObject({ found: true, version: 1 });
    expect(cpm.data.activities.map((a) => [a.id, a.value])).toEqual([
      ["A100", null],
      ["A200", null],
    ]);
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
      schedule_activities: 0,
      rfis: 1,
      decisions: 1,
      claims: 1,
      inspections: 3,
    });
    expect(plan.kept.join(" ")).toMatch(/already has a CPM in Athena; kept Athena's/);
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
      schedule_activities: 0,
      rfis: 1,
      decisions: 1,
      claims: 1,
      inspections: 3,
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
    expect(ledger.rows.map((r) => r.kind)).toEqual([
      "archive",
      "claim",
      "decision",
      "inspection",
      "ior",
      "rfi",
    ]);
    // The answered RFI came in answered; the claim links the PCO it came from, with its events;
    // the reinspection points at the failed inspection.
    const rfis = await rpc<{ records: Record<string, unknown>[] }>("mcp_request_rows", [
      jobId,
      "rfi",
    ]);
    expect(rfis.records.map((r) => [r.number, r.state, r.returned_on])).toEqual([
      ["RFI-001", "sent", null],
      ["RFI-002", "answered", "2026-10-06"],
    ]);
    const claims = await rpc<{ records: Record<string, unknown>[] }>("mcp_job_log_rows", [
      jobId,
      "claims",
    ]);
    expect(claims.records).toHaveLength(1);
    expect(claims.records[0]).toMatchObject({
      number: "CL-001",
      status: "submitted",
      money_claimed_cents: 1_250_000,
      change_order_number: "PCO-001",
      exposure_ref: "Owner finish selections late",
    });
    expect((claims.records[0].events as { event_type: string }[]).map((e) => e.event_type)).toEqual(
      ["submitted", "received"],
    );
    const insp = await rpc<{ records: Record<string, unknown>[] }>("mcp_job_log_rows", [
      jobId,
      "inspections",
    ]);
    const failed = insp.records.find((r) => r.result === "fail");
    expect(insp.records.find((r) => r.attempt === 2)).toMatchObject({
      parent_id: failed?.id,
      status: "scheduled",
    });
    const decisions = await rpc<{ records: Record<string, unknown>[] }>("mcp_job_log_rows", [
      jobId,
      "decisions",
    ]);
    expect(decisions.records[0]).toMatchObject({
      number: "D-001",
      status: "open",
      due_on: "2026-11-20",
    });
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

  it("saves a CPM that isn't cost loaded, and ties one that is, to the cent", async () => {
    const x = sample();
    x.project.job_number = "3105";
    x.project.id = "p-5";
    const { batch_id, package_hash } = await stage(x);
    const saved = await rpc<{ job_id: string }>("mcp_job_import_apply", [
      batch_id,
      package_hash,
      true,
    ]);
    const job = saved.job_id;
    const cpm = await rpc<{ version: number; data: { activities: Record<string, unknown>[] } }>(
      "mcp_living_report_get",
      [job, "cpm", null],
    );
    const plain = cpm.data;
    // A plain update, with no values and no contract total, saves.
    await expect(
      rpc("mcp_living_report_save", [
        job,
        "cpm",
        1,
        JSON.stringify(plain),
        "2026-11-04",
        2,
        null,
        null,
        "Plain update",
        null,
        "QA Owner",
      ]),
    ).resolves.toMatchObject({ version: 2 });
    // Partly loaded: one activity carries a value, so the loaded total must tie to the contract.
    const partial = {
      ...plain,
      activities: plain.activities.map((a, i) => ({ ...a, value: i === 0 ? 1000 : null })),
    };
    await expect(
      rpc("mcp_living_report_save", [
        job,
        "cpm",
        2,
        JSON.stringify(partial),
        "2026-11-04",
        2,
        250000,
        1000,
        "Partly loaded",
        null,
        "QA Owner",
      ]),
    ).rejects.toThrow(/doesn't tie/);
    await expect(
      rpc("mcp_living_report_save", [
        job,
        "cpm",
        2,
        JSON.stringify(partial),
        "2026-11-04",
        2,
        null,
        null,
        "Partly loaded",
        null,
        "QA Owner",
      ]),
    ).rejects.toThrow(/doesn't tie/);
    const loaded = {
      ...plain,
      activities: plain.activities.map((a, i) => ({ ...a, value: i === 0 ? 100000 : 150000 })),
    };
    await expect(
      rpc("mcp_living_report_save", [
        job,
        "cpm",
        2,
        JSON.stringify(loaded),
        "2026-11-04",
        2,
        250000,
        250000,
        "Loaded",
        null,
        "QA Owner",
      ]),
    ).resolves.toMatchObject({ version: 3 });
    // A billing forecast always ties.
    await expect(
      rpc("mcp_living_report_save", [
        job,
        "billing_forecast",
        0,
        JSON.stringify({ months: [] }),
        "2026-11-04",
        0,
        null,
        null,
        "Forecast",
        null,
        "QA Owner",
      ]),
    ).rejects.toThrow(/doesn't tie/);
  });

  it("records an RFI sent and answered outside Athena, and still holds Athena's send receipt rule", async () => {
    const rid = () => crypto.randomUUID();
    const sent = await rpc<{ saved_id: string; number: string; state: string }>(
      "mcp_request_record_outside",
      [
        jobId,
        JSON.stringify({
          request_id: rid(),
          title: "Slab edge at grid C",
          question: "Confirm the slab edge offset at grid C.",
          source: "email",
          sent_on: "2026-10-20",
          sent_to: "Example Architects",
        }),
      ],
    );
    expect(sent).toMatchObject({ number: "RFI-003", state: "sent_outside" });
    // Its answer is captured the usual way, against the sent question.
    const before = (
      await rpc<{ records: Record<string, unknown>[] }>("mcp_request_rows", [jobId, "rfi"])
    ).records.find((r) => r.number === "RFI-003")!;
    expect(before).toMatchObject({
      state: "sent",
      recorded_outside: true,
      ball_in_court: "architect_engineer",
    });
    await rpc("mcp_request_record", [
      jobId,
      "rfi",
      "answer",
      JSON.stringify({
        request_id: rid(),
        submittal_id: sent.saved_id,
        expected_version: 1,
        answer: {
          text: "Offset is 2 in.",
          received_from: "Example Architects",
          received_at: "2026-10-24T15:00:00Z",
        },
      }),
    ]);
    const answered = await rpc<{ records: Record<string, unknown>[] }>("mcp_request_rows", [
      jobId,
      "rfi",
    ]);
    expect(answered.records.find((r) => r.number === "RFI-003")).toMatchObject({
      state: "answered",
    });
    // Recorded answered in one step; dates are checked.
    await expect(
      rpc("mcp_request_record_outside", [
        jobId,
        JSON.stringify({
          request_id: rid(),
          title: "T",
          question: "Q?",
          sent_on: "2026-10-20",
          answered_on: "2026-10-19",
          answer_text: "A",
        }),
      ]),
    ).rejects.toThrow(/before the sent date/);
    await expect(
      rpc("mcp_request_record_outside", [
        jobId,
        JSON.stringify({ request_id: rid(), title: "T", question: "Q?", sent_on: "2999-01-01" }),
      ]),
    ).rejects.toThrow(/future/);
    await expect(
      rpc("mcp_request_record_outside", [
        jobId,
        JSON.stringify({ request_id: rid(), title: "T", question: "Q?", answer_text: "A" }),
      ]),
    ).rejects.toThrow(/date it was received/);
    // An RFI made in Athena is a draft until Athena sends it: no answer without a send, and
    // no submitted status without a send receipt.
    const draft = await rpc<{ saved_id: string }>("mcp_request_record", [
      jobId,
      "rfi",
      "create",
      JSON.stringify({
        request_id: rid(),
        title: "Door swing",
        condition: "Door 104 swing conflicts with casework.",
        question: "Which way should door 104 swing?",
        references: [{ kind: "drawing", citation: "A201 detail 3" }],
      }),
    ]);
    await expect(
      rpc("mcp_request_record", [
        jobId,
        "rfi",
        "answer",
        JSON.stringify({
          request_id: rid(),
          submittal_id: draft.saved_id,
          expected_version: 1,
          answer: { text: "In", received_from: "Arch", received_at: "2026-10-24T15:00:00Z" },
        }),
      ]),
    ).rejects.toThrow(/against the sent request/);
    await expect(
      db.query("UPDATE mcp_submittals SET status='submitted' WHERE id=$1", [draft.saved_id]),
    ).rejects.toThrow(/send receipt is required/);
    await expect(
      db.query(
        'UPDATE mcp_submittals SET request_details = request_details || \'{"state":"sent_outside"}\' WHERE id=$1',
        [draft.saved_id],
      ),
    ).rejects.toThrow(/request_content_check/);
    // Nobody but a full-access member records one.
    await expect(
      rpc(
        "mcp_request_record_outside",
        [jobId, JSON.stringify({ request_id: rid(), title: "T", question: "Q?" })],
        outsider,
      ),
    ).rejects.toThrow(/full access/);
  });

  it("keeps a claims register tied to delay events, an inspection log and an owner decision log", async () => {
    const rid = () => crypto.randomUUID();
    const delay = await rpc<{ delay_event_id: string; claim_item: { item_id: string } }>(
      "mcp_delay_event_add",
      [
        jobId,
        JSON.stringify({
          description: "Owner hold on level 2 ceilings",
          start_date: "2026-10-27",
          days: 6,
        }),
        null,
        null,
      ],
    );
    const claim = await rpc<{ saved_id: string; number: string; record_version: number }>(
      "mcp_job_log_record",
      [
        jobId,
        "claims",
        "create",
        JSON.stringify({
          request_id: rid(),
          title: "Level 2 ceiling hold",
          claim_type: "delay",
          delay_event_id: delay.delay_event_id,
          time_claimed_days: 6,
        }),
      ],
    );
    expect(claim.number).toBe("CL-002");
    const row = await db.query<{ claim_item_id: string; status: string }>(
      "SELECT claim_item_id, status FROM mcp_claims WHERE id=$1",
      [claim.saved_id],
    );
    expect(row.rows[0]).toEqual({
      claim_item_id: delay.claim_item.item_id,
      status: "in_preparation",
    });
    // Retries are safe; updates go by record version.
    const again = JSON.stringify({
      request_id: rid(),
      number: "CL-002",
      status: "submitted",
      submitted_on: "2026-11-03",
      expected_version: 1,
    });
    await expect(
      rpc("mcp_job_log_record", [jobId, "claims", "update", again]),
    ).resolves.toMatchObject({ record_version: 2 });
    await expect(
      rpc("mcp_job_log_record", [jobId, "claims", "update", again]),
    ).resolves.toMatchObject({ already_applied: true });
    await expect(
      rpc("mcp_job_log_record", [
        jobId,
        "claims",
        "update",
        JSON.stringify({
          request_id: rid(),
          number: "CL-002",
          status: "resolved",
          expected_version: 1,
        }),
      ]),
    ).rejects.toThrow(/changed/);
    await rpc("mcp_job_log_record", [
      jobId,
      "claims",
      "event",
      JSON.stringify({
        request_id: rid(),
        claim_id: claim.saved_id,
        event_type: "meeting",
        event_date: "2026-11-04",
      }),
    ]);
    // A decision may point at a selection on the job's board; the board is only read.
    const selection = crypto.randomUUID();
    await db.query(
      "INSERT INTO mcp_private.residential_selection_boards(job_id, version, body) VALUES ($1, 3, $2)",
      [jobId, JSON.stringify({ selections: [{ id: selection, name: "Lobby tile" }] })],
    );
    await expect(
      rpc("mcp_job_log_record", [
        jobId,
        "decisions",
        "create",
        JSON.stringify({
          request_id: rid(),
          decision: "Pick lobby tile",
          selection_id: crypto.randomUUID(),
        }),
      ]),
    ).rejects.toThrow(/not on this job's selection board/);
    const dec = await rpc<{ number: string }>("mcp_job_log_record", [
      jobId,
      "decisions",
      "create",
      JSON.stringify({
        request_id: rid(),
        decision: "Pick lobby tile",
        selection_id: selection,
        owner_name: "Example Health",
        due_on: "2026-11-01",
      }),
    ]);
    expect(dec.number).toBe("D-002");
    const board = await db.query(
      "SELECT version, body FROM mcp_private.residential_selection_boards WHERE job_id=$1",
      [jobId],
    );
    expect(board.rows[0]).toEqual({
      version: 3,
      body: { selections: [{ id: selection, name: "Lobby tile" }] },
    });
    const decisions = await rpc<{ records: Record<string, unknown>[] }>("mcp_job_log_rows", [
      jobId,
      "decisions",
    ]);
    expect(decisions.records.find((r) => r.number === "D-002")).toMatchObject({
      selection_id: selection,
      overdue: true,
    });
    await expect(
      rpc("mcp_job_log_record", [
        jobId,
        "decisions",
        "update",
        JSON.stringify({
          request_id: rid(),
          number: "D-002",
          status: "decided",
          expected_version: 1,
        }),
      ]),
    ).rejects.toThrow(/date it was decided/);
    // Reads and writes stay inside the company; tables take no direct writes.
    await expect(rpc("mcp_job_log_rows", [jobId, "claims"], outsider)).rejects.toThrow(
      /MCP_NO_JOB/,
    );
    await expect(
      rpc(
        "mcp_job_log_record",
        [
          jobId,
          "inspections",
          "create",
          JSON.stringify({ request_id: rid(), inspection_type: "Final" }),
        ],
        outsider,
      ),
    ).rejects.toThrow(/full access/);
    await expect(query("DELETE FROM mcp_claims WHERE job_id=$1", [jobId])).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      query("UPDATE mcp_inspections SET status='passed' WHERE job_id=$1", [jobId]),
    ).rejects.toThrow(/permission denied/);
    const theirs = await query(
      "SELECT count(*)::int AS n FROM mcp_claims WHERE job_id=$1",
      [jobId],
      outsider,
    );
    expect(theirs.rows[0]).toEqual({ n: 0 });
  });

  it("lets a Super keep the inspection log, with no cost, and nothing else", async () => {
    const sup = "00000000-0000-4000-8000-000000000a05";
    const rid = () => crypto.randomUUID();
    await db.query("INSERT INTO auth.users(id,email) VALUES ($1,'a5@example.com')", [sup]);
    await db.query("INSERT INTO test_active_members VALUES ($1)", [sup]);
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'super','QA Super')",
      [company, sup],
    );
    await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
      jobId,
      sup,
      owner,
    ]);
    const rows = await rpc<{ records: Record<string, unknown>[]; no_financials: boolean }>(
      "mcp_job_log_rows",
      [jobId, "inspections"],
      sup,
    );
    expect(rows.no_financials).toBe(true);
    expect(rows.records.length).toBeGreaterThan(0);
    expect(rows.records.every((r) => !("cost_impact_cents" in r))).toBe(true);
    await expect(
      rpc(
        "mcp_job_log_record",
        [
          jobId,
          "inspections",
          "create",
          JSON.stringify({
            request_id: rid(),
            inspection_type: "Final electrical",
            status: "requested",
          }),
        ],
        sup,
      ),
    ).resolves.toMatchObject({ already_applied: false });
    await expect(
      rpc(
        "mcp_job_log_record",
        [
          jobId,
          "inspections",
          "create",
          JSON.stringify({ request_id: rid(), inspection_type: "Final", cost_impact_cents: 100 }),
        ],
        sup,
      ),
    ).rejects.toThrow(/Cost impact needs full access/);
    for (const log of ["claims", "decisions"]) {
      await expect(rpc("mcp_job_log_rows", [jobId, log], sup)).rejects.toThrow(/full access/);
      await expect(
        rpc(
          "mcp_job_log_record",
          [jobId, log, "create", JSON.stringify({ request_id: rid(), title: "x", decision: "x" })],
          sup,
        ),
      ).rejects.toThrow(/full access/);
    }
    const direct = await query(
      "SELECT count(*)::int AS n FROM mcp_inspections WHERE job_id=$1",
      [jobId],
      sup,
    );
    expect(direct.rows[0]).toEqual({ n: 0 });
  });

  it("does not let another company read the destination", async () => {
    await expect(
      rpc("mcp_job_import_context", [company, "3101", "overwatch"], outsider),
    ).rejects.toThrow(/MCP_NO_COMPANY/);
    await expect(query("SELECT * FROM mcp_import_batches")).rejects.toThrow(/permission denied/);
  });
});
