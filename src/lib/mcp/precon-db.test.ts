// Pre-construction agreements on a local database: the real migration chain (through service calls), then
// 20261106120000_athena_precon.
// Members act through their own role; nothing writes the tables directly. All names and numbers are made up.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
import { gbbSql } from "../../../tests/selections/sql";
import { serviceInvoiceViewSchema } from "../customer-portal/model";

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
  // The rollback drops what the migration added and keeps the table; the migration then applies again cleanly.
  await db.exec(
    readFileSync("supabase/rollbacks/20261106120000_athena_precon.rollback.sql", "utf8"),
  );
  await load("20261106120000_athena_precon");

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

  it("sends installment 1 to the client page as a bill with no fee build-up, and shows what was paid", async () => {
    const share = (p: Record<string, unknown>) => fn("mcp_precon_invoice_share", [job, p]);
    await expect(share({ expected_version: 7 })).rejects.toThrow(/changed since/);
    await expect(share({ expected_version: 8, due_on: "2020-01-01" })).rejects.toThrow(
      /due date from today/,
    );
    const r = await share({ expected_version: 8 });
    expect(r).toMatchObject({ number: "PC-2731-1", amount_cents: 850_000, recipients: [] });
    expect(r.agreement.version).toBe(9);
    expect(r.agreement.invoices).toEqual([
      expect.objectContaining({ number: "PC-2731-1", status: "submitted", net_due_cents: 850_000 }),
    ]);
    const item = (
      await db.query<{ kind: string; view: J; ref_id: string }>(
        "SELECT kind, view, ref_id FROM mcp_portal_items WHERE job_id=$1",
        [job],
      )
    ).rows;
    expect(item).toHaveLength(1);
    expect(item[0]!.kind).toBe("service_invoice");
    expect(item[0]!.ref_id).toBe(r.invoice_id);
    const view = serviceInvoiceViewSchema.parse(item[0]!.view);
    expect(view).toMatchObject({
      stage: "bill",
      work_order: "Pre-construction agreement",
      totals: { subtotal_cents: 850_000, credit_cents: 0, current_due_cents: 850_000 },
      lines: [
        {
          description: "Pre-construction agreement, payment 1 of 2 (at signing)",
          detail: "Final drawings you own · A schedule and a fixed-price estimate",
          amount_cents: 850_000,
        },
      ],
    });
    expect(view.note).toBe(
      "You own the drawings. If you hire us to build within 90 days of the final drawings, the full $17,000 is credited to the construction contract.",
    );
    // The owner never sees the contractor's cost build-up.
    const shown = JSON.stringify(view);
    for (const hidden of ["Coastline", "Constructability", "125", "10000", "markup"])
      expect(shown).not.toContain(hidden);
    // Installment 2 waits for final drawings.
    await expect(share({ expected_version: 9 })).rejects.toThrow(/due at final drawings/);
    // A pay application can't be linked as the agreement's invoice.
    const payApp = invoice({
      kind: "pay_application",
      document_number: "PA-1",
      net_due_cents: 100,
    });
    await billing("invoice", payApp);
    await expect(
      step({ action: "link_invoice", expected_version: 9, invoice_id: payApp.id }),
    ).rejects.toThrow(/agreement's own invoice/);
    const again = await step({
      action: "link_invoice",
      expected_version: 9,
      invoice_id: r.invoice_id,
    });
    expect(again.already).toBe(true);
    const receipt = {
      request_id: crypto.randomUUID(),
      id: crypto.randomUUID(),
      receipt_date: "2026-11-04",
      effective_date: "2026-11-04",
      source: "Check 1041 (test)",
      amount_cents: 850_000,
    };
    await billing("receipt", receipt);
    await billing("allocation", {
      request_id: crypto.randomUUID(),
      id: crypto.randomUUID(),
      receipt_id: receipt.id,
      invoice_id: r.invoice_id,
      effective_date: "2026-11-04",
      source: "Check 1041 (test)",
      amount_cents: 850_000,
    });
    const g = await get();
    expect(g.agreement.invoices[0].paid_cents).toBe(850_000);
    expect(g.portal_customers).toEqual([]);
  });

  it("final drawings start the estimate, the 90-day credit window and installment 2", async () => {
    await step({ action: "hours", expected_version: 9, hours: 41.5 });
    const r = await step({ action: "drawings_approved", expected_version: 10, on: "2026-11-01" });
    expect(r.agreement).toMatchObject({
      phase: "estimate",
      drawings_approved_on: "2026-11-01",
      credit_until: "2027-01-30",
    });
    expect(Number(r.agreement.hours_used)).toBe(41.5);
    const second = await fn("mcp_precon_invoice_share", [job, { expected_version: 11 }]);
    expect(second).toMatchObject({ number: "PC-2731-2", amount_cents: 850_000 });
    expect(second.agreement.invoices).toHaveLength(2);
    await expect(fn("mcp_precon_invoice_share", [job, { expected_version: 12 }])).rejects.toThrow(
      /already billed/,
    );
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

  it("links the deductive credit change order and closes as won", async () => {
    expect((await get()).agreement).toMatchObject({ contract_sov: false, credit_change: null });
    await db.query(
      "INSERT INTO mcp_job_facts(job_id,module,key,value,status,source,updated_by) VALUES($1,'sov','01-general',$2::jsonb,'known','member_answer',$3)",
      [job, JSON.stringify({ description: "General conditions", billable_value: 912400 }), owner],
    );
    expect((await get()).agreement.contract_sov).toBe(true);
    const wrong = crypto.randomUUID();
    const credit = crypto.randomUUID();
    for (const [id, number, cents, t] of [
      [wrong, "PCO-007", -100_000, 7],
      [credit, "PCO-008", -1_700_000, 8],
    ] as const) {
      const tr = crypto.randomUUID();
      await db.query(
        "INSERT INTO mcp_transmittals(id,company_id,job_id,number) VALUES($1,$2,$3,$4)",
        [tr, company, job, t],
      );
      await db.query(
        "INSERT INTO mcp_submittals(id,company_id,job_id,number,revision,transmittal_id,spec_section,title,submittal_type,status,ball_in_court) VALUES($1,$2,$3,$4,0,$5,'01 26 00','Pre-construction credit','other','submitted','owner')",
        [id, company, job, number, tr],
      );
      await db.query(
        "INSERT INTO mcp_change_orders(submittal_id,job_id,details) VALUES($1,$2,$3::jsonb)",
        [id, job, JSON.stringify({ state: "priced", total_cents: cents })],
      );
    }
    const v = (await get()).agreement.version;
    await expect(
      step({ action: "link_credit", expected_version: v, change_order_id: wrong }),
    ).rejects.toThrow(/should total -\$17,000.00 \(it totals -\$1,000.00\)/);
    await expect(
      step({ action: "link_credit", expected_version: v, change_order_id: crypto.randomUUID() }),
    ).rejects.toThrow(/isn't on this job/);
    const r = await step({ action: "link_credit", expected_version: v, change_order_id: credit });
    expect(r.agreement.credit_change).toMatchObject({
      id: credit,
      number: "PCO-008",
      state: "priced",
      total_cents: -1_700_000,
    });
    await expect(
      step({ action: "link_credit", expected_version: v + 1, change_order_id: wrong }),
    ).rejects.toThrow(/already on change order PCO-008/);
    const won = await step({ action: "won", expected_version: v + 1, on: "2026-11-03" });
    expect(won.agreement).toMatchObject({ status: "closed", outcome: "won", phase: "contract" });
    await expect(step({ action: "sent", expected_version: v + 2 })).rejects.toThrow(/closed/);
    const re = await step({ action: "reopen", expected_version: v + 2 });
    expect(re.agreement).toMatchObject({ status: "signed", outcome: null });
    const lost = await step({ action: "lost", expected_version: v + 3 });
    expect(lost.agreement).toMatchObject({ outcome: "lost", phase: "closed" });
  });
});
