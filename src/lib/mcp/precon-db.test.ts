// Pre-construction agreements on a local database: the real migration chain, then 20261105233000_athena_precon.
// Members act through their own role; nothing writes the tables directly. All names and numbers are made up.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

const owner = "00000000-0000-4000-8000-000000000f01";
const contracts = "00000000-0000-4000-8000-000000000f02";
const superUser = "00000000-0000-4000-8000-000000000f03";
const outsider = "00000000-0000-4000-8000-000000000f04";
const company = "00000000-0000-4000-8000-000000000f10";
const otherCompany = "00000000-0000-4000-8000-000000000f11";
const job = "00000000-0000-4000-8000-000000000f20";
const job2 = "00000000-0000-4000-8000-000000000f21";
let db: PGlite;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- results are read field by field
type J = any;
const query = (user: string, sql: string, values: unknown[] = []) =>
  asUser(
    db,
    { sub: user, role: "authenticated", email: `${user.slice(-2)}@example.com` },
    (tx) => tx.query(sql, values) as Promise<{ rows: Record<string, unknown>[] }>,
  );
const fn = async (name: string, args: unknown[], user = owner) =>
  (
    await query(
      user,
      `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS data`,
      args.map((a) => (typeof a === "object" && a !== null ? JSON.stringify(a) : a)),
    )
  ).rows[0].data as J;
const get = (user = owner, onJob = job) => fn("mcp_precon_get", [onJob], user);
const save = (p: Record<string, unknown>, user = owner, onJob = job) =>
  fn("mcp_precon_save", [onJob, p], user);
const step = (p: Record<string, unknown>, user = owner, onJob = job) =>
  fn("mcp_precon_step", [onJob, p], user);
const billing = (action: string, p: Record<string, unknown>) =>
  fn("mcp_billing_evidence_record", [job, action, p]);
const invoice = (extra: Record<string, unknown>) => ({
  request_id: crypto.randomUUID(),
  id: crypto.randomUUID(),
  expected_version: 0,
  kind: "invoice",
  status: "submitted",
  invoice_date: "2026-11-09",
  effective_date: "2026-11-09",
  source: "Pre-construction agreement",
  gross_cents: extra.net_due_cents,
  withheld_cents: 0,
  released_cents: 0,
  ...extra,
});

const terms = {
  expected_version: 0,
  design_partner: "Coastline Design Studio",
  design_role: "architect",
  design_fee_cents: 1_000_000,
  design_days: 35,
  hourly_rate_cents: 12_500,
  time_lines: [
    { label: "Design coordination", hours: 16 },
    { label: "Constructability review", hours: 10 },
    { label: "Schedule, materials and lead times", hours: 8 },
    { label: "Estimate from final drawings", hours: 22, note: "Takeoff and pricing" },
  ],
  includes: ["Final drawings you own", "A schedule and a fixed-price estimate"],
  billing: "split",
  credit: true,
  credit_days: 90,
};

beforeAll(async () => {
  db = await makeDb();
  const load = (f: string) => db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  await db.exec(
    "CREATE TABLE test_company_plans(company_id uuid PRIMARY KEY,plan text); CREATE FUNCTION public.mcp_company_tier(_company uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT plan FROM test_company_plans WHERE company_id=_company $$; CREATE FUNCTION public.get_user_tier(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'circle'::text $$;",
  );
  const pages = readFileSync("supabase/migrations/20261021120000_athena_report_pages.sql", "utf8");
  const leaderStart = pages.indexOf("CREATE OR REPLACE FUNCTION public.mcp_is_company_leader");
  await db.exec(
    pages.slice(
      leaderStart,
      pages.indexOf("TO authenticated;", leaderStart) + "TO authenticated;".length,
    ),
  );
  await load("20261021190000_athena_team_invites");
  await load("20261022120000_athena_account_team_privacy_terms");
  await load("20261023070000_athena_board_links");
  await load("20261023220000_athena_submittal_log");
  await load("20261024010000_athena_submittal_chase");
  await db.exec(
    "CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated; GRANT ALL ON storage.objects TO authenticated;",
  );
  await load("20261021000000_athena_file_shares");
  await load("20261028120000_athena_submittal_packages");
  await load("20261029120000_athena_submittal_record_page");
  await load("20261031120000_athena_file_upload");
  await db.exec(readFileSync("drizzle/migrations/0035_accounting_purchase_orders.sql", "utf8"));
  await load("20261105170000_athena_job_contracts");
  await load("20261101120001_athena_project_billing_evidence");
  await load("20261105233000_athena_precon");

  for (const user of [owner, contracts, superUser, outsider]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES ($1,$2)", [
      user,
      `${user.slice(-2)}@example.com`,
    ]);
    await db.query("INSERT INTO test_active_members VALUES ($1)", [user]);
  }
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'ALP Construction (test)',$2),($3,'Other Builder',$4)",
    [company, owner, otherCompany, outsider],
  );
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','QA Owner'),($1,$3,'contracts','QA Contracts'),($1,$4,'super','QA Super'),($5,$6,'owner','Other Owner')",
    [company, owner, contracts, superUser, otherCompany, outsider],
  );
  await db.query("INSERT INTO test_company_plans VALUES($1,'circle'),($2,'circle')", [
    company,
    otherCompany,
  ]);
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name,time_zone) VALUES($1,$2,$3,'2731','Hartwell Residence','America/Manaus'),($4,$2,$3,'2732','Plain Job','America/Manaus')",
    [job, owner, company, job2],
  );
  await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
    job,
    superUser,
    owner,
  ]);
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe.sequential("pre-construction agreements", () => {
  it("a job without pre-con reads as none, and the table is closed to members", async () => {
    expect(await get(owner, job2)).toMatchObject({ status: "none", job_number: "2732" });
    await expect(query(owner, "SELECT * FROM public.mcp_precon_agreements")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("prices the agreement from the build-up: $10,000 design plus 56 hours at $125 is $17,000", async () => {
    const r = await save(terms);
    const a = r.agreement;
    expect(a).toMatchObject({
      version: 1,
      status: "draft",
      phase: "agreement",
      price_cents: 1_700_000,
      credit: true,
      credit_days: 90,
      credit_until: null,
      owner_owns_drawings: true,
    });
    expect(a.parts).toMatchObject({
      design_cents: 1_000_000,
      time_cents: 700_000,
      markup_cents: 0,
    });
    expect(Number(a.parts.hours)).toBe(56);
    expect(a.installments).toEqual([
      { when: "signing", amount_cents: 850_000 },
      { when: "final_drawings", amount_cents: 850_000 },
    ]);
    expect(a.time_lines[3]).toEqual({
      label: "Estimate from final drawings",
      hours: 22,
      note: "Takeoff and pricing",
    });
  });

  it("checks versions, fields and access", async () => {
    await expect(save({ ...terms, expected_version: 0 })).rejects.toThrow(/changed since/);
    await expect(save({ expected_version: 1, price_cents: 5 })).rejects.toThrow(
      /doesn't keep price cents/,
    );
    await expect(
      save({ expected_version: 1, time_lines: [{ label: "Odd", hours: 1.1 }] }),
    ).rejects.toThrow(/quarter hours/);
    await expect(get(superUser)).rejects.toThrow(/full or contract access/);
    await expect(get(outsider)).rejects.toThrow();
    // Contract access reads and writes; a markup on the design fee moves the price.
    const r = await save({ expected_version: 1, design_markup_bps: 1000 }, contracts);
    expect(r.agreement).toMatchObject({ version: 2, price_cents: 1_800_000 });
    const back = await save({ expected_version: 2, design_markup_bps: 0 });
    expect(back.agreement.price_cents).toBe(1_700_000);
  });

  it("odd cents land on the second installment", async () => {
    const r = await save({ expected_version: 3, hourly_rate_cents: 12_501 });
    expect(r.agreement.price_cents).toBe(1_700_056);
    expect(r.agreement.installments.map((i: J) => i.amount_cents)).toEqual([850_028, 850_028]);
    const r2 = await save({ expected_version: 4, hourly_rate_cents: 12_500, billing: "full" });
    expect(r2.agreement.installments).toEqual([{ when: "signing", amount_cents: 1_700_000 }]);
    await save({ expected_version: 5, billing: "split" });
  });

  it("sends, signs and locks the terms, writing each step to the project record", async () => {
    await expect(step({ action: "drawings_approved", expected_version: 6 })).rejects.toThrow(
      /isn't signed/,
    );
    let r = await step({ action: "sent", expected_version: 6, on: "2026-10-20" });
    expect(r.agreement).toMatchObject({
      status: "sent",
      sent_on: "2026-10-20",
      phase: "agreement",
    });
    await expect(
      step({ action: "signed", expected_version: 7, on: "2026-10-19", name: "Erin Hartwell" }),
    ).rejects.toThrow(/before the agreement was sent/);
    await expect(step({ action: "signed", expected_version: 7, on: "2026-10-22" })).rejects.toThrow(
      /Who signed/,
    );
    r = await step({
      action: "signed",
      expected_version: 7,
      on: "2026-10-22",
      name: "Erin Hartwell",
      via: "client_page",
    });
    expect(r.agreement).toMatchObject({
      status: "signed",
      phase: "design",
      signed_name: "Erin Hartwell",
      signed_via: "client_page",
    });
    await expect(save({ expected_version: 8, design_fee_cents: 1 })).rejects.toThrow(
      /terms are fixed/,
    );
    const rec = await db.query<{ kind: string }>(
      "SELECT kind FROM mcp_project_record_events WHERE job_id=$1 ORDER BY kind",
      [job],
    );
    expect(rec.rows.map((x) => x.kind)).toEqual(
      expect.arrayContaining(["precon_started", "precon_sent", "precon_signed"]),
    );
  });

  it("links the agreement's invoices and shows what was paid", async () => {
    const first = invoice({ document_number: "PC-2731-1", net_due_cents: 850_000 });
    await billing("invoice", first);
    const payApp = invoice({
      kind: "pay_application",
      document_number: "PA-1",
      net_due_cents: 100,
    });
    await billing("invoice", payApp);
    await expect(
      step({ action: "link_invoice", expected_version: 8, invoice_id: payApp.id }),
    ).rejects.toThrow(/agreement's own invoice/);
    let r = await step({ action: "link_invoice", expected_version: 8, invoice_id: first.id });
    expect(r.agreement.invoices).toHaveLength(1);
    expect(r.agreement.invoices[0]).toMatchObject({
      number: "PC-2731-1",
      status: "submitted",
      net_due_cents: 850_000,
      paid_cents: 0,
    });
    r = await step({ action: "link_invoice", expected_version: 9, invoice_id: first.id });
    expect(r.already).toBe(true);
    const receipt = {
      request_id: crypto.randomUUID(),
      id: crypto.randomUUID(),
      receipt_date: "2026-11-08",
      effective_date: "2026-11-08",
      source: "Check 1041 (test)",
      amount_cents: 850_000,
    };
    await billing("receipt", receipt);
    await billing("allocation", {
      request_id: crypto.randomUUID(),
      id: crypto.randomUUID(),
      receipt_id: receipt.id,
      invoice_id: first.id,
      effective_date: "2026-11-08",
      source: "Check 1041 (test)",
      amount_cents: 850_000,
    });
    const g = await get();
    expect(g.agreement.invoices[0].paid_cents).toBe(850_000);
  });

  it("final drawings start the estimate and the 90-day credit window", async () => {
    await step({ action: "hours", expected_version: 9, hours: 41.5 });
    const r = await step({ action: "drawings_approved", expected_version: 10, on: "2026-11-01" });
    expect(r.agreement).toMatchObject({
      phase: "estimate",
      drawings_approved_on: "2026-11-01",
      credit_until: "2027-01-30",
    });
    expect(Number(r.agreement.hours_used)).toBe(41.5);
  });

  it("the prime contract moves the phase to proposal and then contract", async () => {
    const draft = await fn("mcp_job_contract_save", [
      job,
      {
        kind: "prime",
        status: "draft",
        counterparty: "Erin and Paul Hartwell",
        title: "Hartwell Residence construction",
        value_cents: 91_240_000,
      },
    ]);
    expect((await get()).agreement.phase).toBe("proposal");
    const id = draft.contract?.id ?? draft.id;
    expect(id).toBeTruthy();
  });

  it("applies the credit to the first pay application and closes as won", async () => {
    const pa = invoice({
      kind: "pay_application",
      document_number: "Pay App 1",
      invoice_date: "2027-02-01",
      effective_date: "2027-02-01",
      gross_cents: 9_124_000,
      withheld_cents: 912_400,
      released_cents: 0,
      net_due_cents: 8_211_600,
    });
    await billing("invoice", pa);
    const credit = invoice({
      kind: "credit",
      credit_for: pa.id,
      status: "posted",
      document_number: "PC-CREDIT-2731",
      invoice_date: "2027-02-01",
      effective_date: "2027-02-01",
      source: "Pre-construction fee credit",
      net_due_cents: 1_700_000,
      gross_cents: undefined,
      withheld_cents: undefined,
      released_cents: undefined,
    });
    await billing("invoice", credit);
    const r = await step({ action: "link_credit", expected_version: 11, invoice_id: credit.id });
    expect(r.agreement.credit_invoice).toMatchObject({
      number: "PC-CREDIT-2731",
      kind: "credit",
      net_due_cents: 1_700_000,
    });
    const won = await step({ action: "won", expected_version: 12, on: "2026-11-03" });
    expect(won.agreement).toMatchObject({ status: "closed", outcome: "won", phase: "contract" });
    await expect(step({ action: "sent", expected_version: 13 })).rejects.toThrow(/closed/);
    const re = await step({ action: "reopen", expected_version: 13 });
    expect(re.agreement).toMatchObject({ status: "signed", outcome: null });
    const lost = await step({ action: "lost", expected_version: 14 });
    expect(lost.agreement).toMatchObject({ outcome: "lost", phase: "closed" });
  });
});
