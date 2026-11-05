// Owners sign pre-construction agreements on the client page, on a local database: the real migration chain
// through 20261106120000_athena_precon, then 20261106130000_athena_precon_signing (and its rollback round trip).
// Members act through their own role; the owner acts only through the service-role functions the page server calls.
// All names and numbers are made up.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
import { gbbSql } from "../../../tests/selections/sql";
import { tokenHash } from "./file-share";
import { codeHash } from "../customer-portal/server";
import { portalViewSchema } from "../customer-portal/model";

const owner = "00000000-0000-4000-8000-000000000e01";
const contracts = "00000000-0000-4000-8000-000000000e02";
const superUser = "00000000-0000-4000-8000-000000000e03";
const outsider = "00000000-0000-4000-8000-000000000e04";
const company = "00000000-0000-4000-8000-000000000e10";
const otherCompany = "00000000-0000-4000-8000-000000000e11";
const job = "00000000-0000-4000-8000-000000000e20";
const job2 = "00000000-0000-4000-8000-000000000e21";
let db: PGlite;

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
const fn = (name: string, args: unknown[], user = owner) => call(user, name, args);
const server = (name: string, args: unknown[]) => call(null, name, args);
const get = async () => (await fn("mcp_precon_get", [job])).agreement as J;

const CONSENT =
  "I agree to review and sign this agreement electronically. ALP Construction (test) can send me the agreement, my signed copy and notices about it by email at jordan.hale@example.com and on this page.";
const STATEMENT =
  "I have read the pre-construction agreement from ALP Construction (test) for Hale Residence, $17,000, and I agree to its terms as shown on this page.";
const payments = [
  { amount_cents: 500_000, due: "signing" },
  { amount_cents: 600_000, due: "step", when: "When you approve the schematic design." },
  { amount_cents: 600_000, due: "final_drawings" },
];
const ownTerms = [
  "Design changes after the second design meeting are billed at $150 an hour, and we'll tell you before any of that time is spent.",
  "Either of us can end this agreement with 7 days' written notice.",
];
let access = "";
let sess = "";
let item: J;
const view = async () => server("mcp_portal_view", [access, sess, null, null]);
const sign = (
  it: J,
  decision: string,
  code: string | null,
  extra: Partial<Record<string, string | null>> = {},
) =>
  server("mcp_portal_precon_sign", [
    access,
    sess,
    it.id,
    decision,
    code,
    extra.name ?? "Jordan Hale",
    extra.consent === undefined ? CONSENT : extra.consent,
    extra.statement ?? STATEMENT,
    extra.fingerprint ?? it.fingerprint,
    extra.note ?? null,
    "203.0.113.7",
    "Test browser",
  ]);

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
  // The rollback puts the earlier functions back and keeps the record; the migration then applies again cleanly.
  await db.exec(
    readFileSync("supabase/rollbacks/20261106130000_athena_precon_signing.rollback.sql", "utf8"),
  );
  await load("20261106130000_athena_precon_signing");

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
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name,time_zone) VALUES($1,$2,$3,'2741','Hale Residence','America/Manaus'),($4,$2,$3,'2732','Plain Job','America/Manaus')",
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

describe.sequential("owners sign pre-construction agreements on the client page", () => {
  it("saves the contractor's own payments and terms, and refuses payments that don't add up", async () => {
    const started = await fn("mcp_precon_save", [
      job,
      {
        expected_version: 0,
        design_partner: "Coastline Design Studio",
        design_role: "architect",
        design_fee_cents: 1_000_000,
        design_days: 35,
        hourly_rate_cents: 12_500,
        time_lines: [{ label: "Design coordination and estimate", hours: 56 }],
        includes: ["Final drawings you own", "A schedule and a fixed-price estimate"],
        billing: "split",
        credit: true,
        credit_days: 90,
      },
    ]);
    expect(started.agreement).toMatchObject({ price_cents: 1_700_000, version: 1 });
    await expect(
      fn("mcp_precon_terms_save", [job, { expected_version: 1, payments: payments.slice(0, 2) }]),
    ).rejects.toThrow(/add up to \$11,000\.00, and the agreement price is \$17,000\.00/);
    await expect(
      fn("mcp_precon_terms_save", [
        job,
        { expected_version: 1, payments: [{ amount_cents: 1_700_000, due: "step", when: "soon" }] },
      ]),
    ).rejects.toThrow(/in a few words the owner reads/);
    await expect(
      fn("mcp_precon_terms_save", [job, { expected_version: 1, payments }], superUser),
    ).rejects.toThrow();
    const r = await fn("mcp_precon_terms_save", [
      job,
      { expected_version: 1, payments, own_terms: ownTerms, construction_line: true },
    ]);
    const a = r.agreement;
    expect(a.version).toBe(2);
    expect(a.own_terms).toEqual(ownTerms);
    expect(a.installments).toEqual([
      { when: "signing", amount_cents: 500_000, on: null, step: null, words: "when you sign" },
      {
        when: "step",
        amount_cents: 600_000,
        on: null,
        step: "when you approve the schematic design",
        words: "when you approve the schematic design",
      },
      {
        when: "final_drawings",
        amount_cents: 600_000,
        on: null,
        step: null,
        words: "when you approve the final drawings",
      },
    ]);
  });

  it("needs an owner on the client page, then puts only the owner's view of the agreement there", async () => {
    await expect(
      fn("mcp_precon_portal_send", [job, { expected_version: 2, due_on: null }]),
    ).rejects.toThrow(/Invite the owner first/);
    const invite = await tokenHash("P".repeat(43));
    const inv = await fn("mcp_portal_invite", [
      job,
      "jordan.hale@example.com",
      "Jordan Hale",
      invite,
      new Date(Date.now() + 86_400_000).toISOString(),
    ]);
    access = inv.access_id;
    sess = await tokenHash("S".repeat(43));
    await db.query(
      "INSERT INTO mcp_portal_sessions(access_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')",
      [access, sess],
    );
    const r = await fn("mcp_precon_portal_send", [job, { expected_version: 2, due_on: null }]);
    expect(r).toMatchObject({ status: "ok", label: "Pre-construction agreement · Hale Residence" });
    expect(r.recipients).toEqual([
      { access_id: access, email: "jordan.hale@example.com", name: "Jordan Hale" },
    ]);
    expect(r.agreement).toMatchObject({
      status: "sent",
      version: 3,
      portal: { item_id: r.item_id },
    });
    const v = await view();
    expect(() => portalViewSchema.parse(v)).not.toThrow();
    item = v.items.find((i: J) => i.kind === "precon_agreement");
    expect(item.view).toEqual({
      title: "Pre-construction agreement · Hale Residence",
      price_cents: 1_700_000,
      design_partner: "Coastline Design Studio",
      design_role: "architect",
      design_days: 35,
      includes: ["Final drawings you own", "A schedule and a fixed-price estimate"],
      payments: [
        { index: 1, amount_cents: 500_000, due: "signing", on: null, when: null },
        {
          index: 2,
          amount_cents: 600_000,
          due: "step",
          on: null,
          when: "when you approve the schematic design",
        },
        { index: 3, amount_cents: 600_000, due: "final_drawings", on: null, when: null },
      ],
      owner_owns_drawings: true,
      credit_days: 90,
      own_terms: ownTerms,
      construction_line: true,
    });
    // The fee build-up never reaches the owner.
    expect(JSON.stringify(v)).not.toMatch(/design_fee|hourly_rate|markup|time_lines/);
  });

  it("a change to the terms takes the agreement off the page until it's sent again", async () => {
    await fn("mcp_precon_terms_save", [
      job,
      { expected_version: 3, own_terms: ownTerms.slice(0, 1) },
    ]);
    expect((await view()).items.filter((i: J) => i.kind === "precon_agreement")).toHaveLength(0);
    expect((await get()).portal).toBeNull();
    expect((await sign(item, "signed", null)).status).toBe("not_open");
    await fn("mcp_precon_terms_save", [job, { expected_version: 4, own_terms: ownTerms }]);
    await fn("mcp_precon_portal_send", [job, { expected_version: 5, due_on: null }]);
    item = (await view()).items.find((i: J) => i.kind === "precon_agreement");
    expect(item.decision).toBeNull();
  });

  it("the owner declines with a note, and the declined copy stays on their page when a new one is sent", async () => {
    expect(
      await sign(item, "declined", null, { note: "Can the design take 30 days?", consent: null }),
    ).toMatchObject({
      status: "ok",
    });
    let a = await get();
    expect(a).toMatchObject({
      status: "sent",
      portal: { decision: { decision: "declined", note: "Can the design take 30 days?" } },
    });
    const records = await db.query("SELECT kind FROM mcp_project_record_events WHERE job_id=$1", [
      job,
    ]);
    expect(records.rows.map((x: J) => x.kind)).toContain("precon_declined");
    await fn("mcp_precon_portal_send", [job, { expected_version: a.version, due_on: null }]);
    const items = (await view()).items.filter((i: J) => i.kind === "precon_agreement");
    expect(items.map((i: J) => i.decision?.decision ?? null).sort()).toEqual(["declined", null]);
    item = items.find((i: J) => !i.decision);
    a = await get();
    expect(a.portal.item_id).toBe(item.id);
  });

  it("signing needs the consent words, a fresh emailed code and the version they saw", async () => {
    expect((await sign(item, "signed", null)).status).not.toBe("ok");
    const code = await codeHash(access, "135790");
    expect(
      (await server("mcp_portal_code_issue", [access, "decide", code, null, sess, item.id])).status,
    ).toBe("ok");
    expect((await sign(item, "signed", code, { consent: null })).status).toBe("invalid");
    expect((await sign(item, "signed", code, { fingerprint: "f".repeat(64) })).status).toBe(
      "changed",
    );
    expect((await sign(item, "signed", await codeHash(access, "000000"))).status).toBe("wrong");
    const r = await sign(item, "signed", code);
    expect(r).toMatchObject({
      status: "ok",
      customer_email: "jordan.hale@example.com",
      bill: { number: "PC-2741-1", amount_cents: 500_000 },
    });
    expect((await sign(item, "signed", code)).status).toBe("not_open");
    const a = await get();
    expect(a).toMatchObject({
      status: "signed",
      phase: "design",
      signed_name: "Jordan Hale",
      signed_via: "client_page",
      signature: {
        typed_name: "Jordan Hale",
        email: "jordan.hale@example.com",
        code_verified: true,
        ip: "203.0.113.7",
        user_agent: "Test browser",
        consent: CONSENT,
        statement: STATEMENT,
        fingerprint: item.fingerprint,
      },
    });
    expect(a.invoices).toHaveLength(1);
    const rec = await db.query(
      "SELECT payload FROM mcp_project_record_events WHERE job_id=$1 AND kind='precon_signed'",
      [job],
    );
    expect((rec.rows[0] as J).payload).toMatchObject({
      consent: CONSENT,
      code_verified: true,
      view: item.view,
    });
    // A signed agreement's terms are fixed, and its page copy stays.
    await expect(
      fn("mcp_precon_terms_save", [job, { expected_version: a.version, own_terms: [] }]),
    ).rejects.toThrow(/signed, so its terms are fixed/);
    const v = await view();
    expect(v.items.find((i: J) => i.id === item.id).decision).toMatchObject({ decision: "signed" });
    const bill = v.items.find((i: J) => i.kind === "service_invoice");
    expect(bill.view).toMatchObject({
      number: "PC-2741-1",
      title: "Pre-construction payment 1 of 3 · Hale Residence",
    });
    expect(v.check_items).toEqual([bill.id]);
    expect(() => portalViewSchema.parse(v)).not.toThrow();
  });

  it("the owner says they're paying by check, and the contractor sets the pickup they see", async () => {
    const bill = (await view()).items.find((i: J) => i.kind === "service_invoice");
    const r = await server("mcp_portal_check_request", [
      access,
      sess,
      bill.id,
      "Weekday mornings",
      null,
      null,
    ]);
    expect(r).toMatchObject({
      status: "ok",
      again: false,
      number: "PC-2741-1",
      amount_cents: 500_000,
      note: "Weekday mornings",
    });
    expect(
      (await server("mcp_portal_check_request", [access, sess, item.id, null, null, null])).status,
    ).toBe("not_open");
    let v = await view();
    expect(v.checks).toEqual([
      expect.objectContaining({ item_id: bill.id, note: "Weekday mornings", pickup_on: null }),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const later = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await expect(
      fn("mcp_precon_check_pickup", [job, { invoice_id: bill.view.number, on: later }]),
    ).rejects.toThrow(/invoice ID/);
    await expect(
      fn("mcp_precon_check_pickup", [job, { invoice_id: bill.id, on: later }], outsider),
    ).rejects.toThrow();
    const p = await fn("mcp_precon_check_pickup", [
      job,
      {
        invoice_id: (await get()).invoices[0].id,
        on: later,
        window: "9:00 to 10:00 AM",
        place: "the job site",
        by: "Sam Ortiz",
      },
    ]);
    expect(p).toMatchObject({
      status: "ok",
      pickup_on: later,
      pickup_by: "Sam Ortiz",
      number: "PC-2741-1",
    });
    v = await view();
    expect(v.checks[0]).toMatchObject({
      pickup_on: later,
      pickup_window: "9:00 to 10:00 AM",
      pickup_place: "the job site",
    });
    expect((await get()).checks[0]).toMatchObject({
      pickup_by: "Sam Ortiz",
      note: "Weekday mornings",
    });
    expect(today <= later).toBe(true);
  });

  it("bills the next payments in order: a named step on the contractor's call, final drawings once approved", async () => {
    let a = await get();
    const two = await fn("mcp_precon_invoice_share", [
      job,
      { expected_version: a.version, due_on: null },
    ]);
    expect(two).toMatchObject({ number: "PC-2741-2", amount_cents: 600_000 });
    a = await get();
    await expect(
      fn("mcp_precon_invoice_share", [job, { expected_version: a.version, due_on: null }]),
    ).rejects.toThrow(/Payment 3 is due when the owner approves the final drawings/);
  });

  it("an agreement signed on paper comes off the client page", async () => {
    // A second job, sent to the client page and then signed on paper.
    await fn("mcp_precon_save", [
      job2,
      {
        expected_version: 0,
        design_partner: "Coastline Design Studio",
        design_role: "architect",
        design_fee_cents: 500_000,
        design_days: 20,
        hourly_rate_cents: 0,
        time_lines: [],
        includes: ["Final drawings you own"],
        billing: "full",
        credit: false,
      },
    ]);
    const inv = await fn("mcp_portal_invite", [
      job2,
      "casey.lane@example.com",
      "Casey Lane",
      await tokenHash("Q".repeat(43)),
      new Date(Date.now() + 86_400_000).toISOString(),
    ]);
    const s = await fn("mcp_precon_portal_send", [job2, { expected_version: 1, due_on: null }]);
    const today = new Date().toISOString().slice(0, 10);
    await fn("mcp_precon_step", [
      job2,
      { action: "signed", expected_version: 2, on: today, name: "Casey Lane", via: "paper" },
    ]);
    const row = await db.query("SELECT withdrawn_at FROM mcp_portal_items WHERE id=$1", [
      s.item_id,
    ]);
    expect((row.rows[0] as J).withdrawn_at).not.toBeNull();
    expect(inv.access_id).toBeTruthy();
  });
});
