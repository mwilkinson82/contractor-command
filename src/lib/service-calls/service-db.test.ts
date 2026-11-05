// Service calls on a local database: the real migration chain, the client page and client payments SQL, then the
// service call SQL. Fictional test data only (ALP Construction, Dana Whitfield). Members act through their own role;
// the customer acts only through the service-role functions the page server calls.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
import { gbbSql } from "../../../tests/selections/sql";
import { tokenHash } from "../mcp/file-share";
import { codeHash } from "../customer-portal/server";
import { portalViewSchema, type PortalPage } from "../customer-portal/model";
import { renderPortal, type PortalOpts } from "../customer-portal/render";

const owner = "00000000-0000-4000-8000-000000000d01";
const pm = "00000000-0000-4000-8000-000000000d02";
const outsider = "00000000-0000-4000-8000-000000000d03";
const company = "00000000-0000-4000-8000-000000000d10";
const project = "00000000-0000-4000-8000-000000000d20";
const acct = "acct_1TestALPService";
let db: PGlite;

/** The client page as the customer sees it, from a view and payments read off the database. */
function page(view: unknown, payments: unknown, o: Partial<PortalOpts> = {}): string {
  const v = portalViewSchema.parse(view);
  const p: PortalPage = {
    ...v,
    photos: [],
    access_id: "00000000-0000-4000-8000-0000000000aa",
    csrf: "c".repeat(43),
    payments: payments as PortalPage["payments"],
  };
  return renderPortal(p, { section: "home", ...o });
}
const text = (h: string) =>
  h
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- results are read field by field
type J = any;
const as =
  (user: string | null) =>
  (sql: string, values: unknown[] = []) =>
    asUser(
      db,
      user
        ? { sub: user, role: "authenticated", email: `${user.slice(-2)}@example.com` }
        : ({ role: "service_role" } as never),
      (tx) => tx.query(sql, values) as Promise<{ rows: Row[] }>,
    );
const call = async (user: string | null, fn: string, values: unknown[]) =>
  (
    await as(user)(
      `SELECT public.${fn}(${values.map((_, i) => `$${i + 1}`).join(",")}) AS data`,
      values,
    )
  ).rows[0]!.data as J;
const member = (fn: string, values: unknown[], user = owner) => call(user, fn, values);
const server = (fn: string, values: unknown[]) => call(null, fn, values);
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export async function loadServiceChain(d: PGlite) {
  const load = (f: string) => d.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  const pages = readFileSync("supabase/migrations/20261021120000_athena_report_pages.sql", "utf8");
  const leaderStart = pages.indexOf("CREATE OR REPLACE FUNCTION public.mcp_is_company_leader");
  await d.exec(
    pages.slice(
      leaderStart,
      pages.indexOf("TO authenticated;", leaderStart) + "TO authenticated;".length,
    ),
  );
  await load("20261023070000_athena_board_links");
  await load("20261023220000_athena_submittal_log");
  await load("20261024010000_athena_submittal_chase");
  await d.exec(
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
  await d.exec(drawings.slice(0, drawings.indexOf("CREATE FUNCTION public.mcp_drawing_records")));
  await d.exec(
    "CREATE TABLE test_company_plans(company_id uuid PRIMARY KEY,plan text); CREATE FUNCTION public.mcp_company_tier(_company uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT plan FROM test_company_plans WHERE company_id=_company $$;",
  );
  await load("20261025140000_athena_request_package_records");
  await load("20261025150000_athena_change_order_packages");
  await load("20261025153000_athena_change_execution_tie");
  await load("20261022200000_athena_estimating");
  await load("20261022230000_athena_estimating_bid");
  await d.exec("ALTER FUNCTION public.mcp_estimate_guard(uuid) VOLATILE");
  for (const sql of gbbSql()) await d.exec(sql);
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
    await d.exec(readFileSync(`drizzle/migrations/${f}.sql`, "utf8"));
  await load("20261105150000_athena_gbb_change_terms");
  await d.exec(
    "CREATE FUNCTION public.mcp_role_allowed(_company uuid, _role text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$",
  );
  await load("20261105180000_athena_job_notices");
  await load("20261105200000_athena_notices_owner_fallback");
  await load("20261105181000_athena_portal_messages");
  await load("20261105190000_athena_client_payments");
}
const up = () =>
  readFileSync("supabase/migrations/20261106110000_athena_service_calls.sql", "utf8");
const down = () =>
  readFileSync("supabase/rollbacks/20261106110000_athena_service_calls.rollback.sql", "utf8");

beforeAll(async () => {
  db = await makeDb();
  await loadServiceChain(db);
  await db.exec(up());
  for (const user of [owner, pm, outsider]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES ($1,$2)", [
      user,
      `${user.slice(-2)}@example.com`,
    ]);
    await db.query("INSERT INTO test_active_members VALUES ($1)", [user]);
  }
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'ALP Construction',$2)", [
    company,
    owner,
  ]);
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Jordan Pike'),($1,$3,'pm','Marco Reyes')",
    [company, owner, pm],
  );
  await db.query("INSERT INTO test_company_plans VALUES($1,'circle')", [company]);
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name,time_zone,pm_name,pm_user_id) VALUES($1,$2,$3,'2801','Pinecrest Library','America/Chicago','Jordan Pike',$2)",
    [project, owner, company],
  );
}, 120_000);

describe("contract type and change order pricing", () => {
  it("records a project job's contract type as a label, and never on a service call", async () => {
    expect(await member("mcp_job_terms", [project])).toMatchObject({
      job_kind: "project",
      contract_type: null,
    });
    expect(await member("mcp_job_contract_type_set", [project, "time_and_material"])).toMatchObject(
      {
        contract_type: "time_and_material",
        label: "Time and material",
        changed: true,
      },
    );
    await expect(member("mcp_job_contract_type_set", [project, "gmp"])).rejects.toThrow(
      /lump sum, unit price, cost plus or time and material/,
    );
    await expect(
      member("mcp_job_contract_type_set", [project, "lump_sum"], outsider),
    ).rejects.toThrow(/full access/);
    expect(await member("mcp_job_contract_type_set", [project, "lump_sum"])).toMatchObject({
      contract_type: "lump_sum",
    });
    expect(await member("mcp_change_order_pricing_list", [project])).toEqual({});
    await expect(
      member("mcp_change_order_pricing_set", [project, uuid(999), "unit_price"]),
    ).rejects.toThrow(/isn't on this job/);
    await expect(
      member("mcp_change_order_pricing_set", [project, uuid(999), "cost_plus"]),
    ).rejects.toThrow(/lump sum, unit price, time and material, or hourly/);
  });
});

describe("pricing", () => {
  const price = async (basis: string, lines: unknown[], rates: Record<string, unknown>) =>
    (
      await db.query<{ p: J }>("SELECT mcp_private.service_price($1,$2,$3) AS p", [
        basis,
        JSON.stringify(lines),
        JSON.stringify(rates),
      ])
    ).rows[0]!.p;
  it("prices unit price, T&M and hourly work the way the preview shows", async () => {
    const unit = await price(
      "unit_price",
      [
        {
          kind: "item",
          description: "Replace GFCI receptacle",
          quantity: 2,
          unit: "each",
          unit_rate_cents: 26500,
        },
        {
          kind: "item",
          description: "Replace switch",
          quantity: 1,
          unit: "each",
          unit_rate_cents: 9500,
        },
        {
          kind: "item",
          description: "New 20A circuit",
          quantity: 1,
          unit: "each",
          unit_rate_cents: 31000,
        },
      ],
      {},
    );
    // 2 x 265 + 95 + 310: the preview's three lines are one each; here two GFCIs show the quantity math.
    expect(unit.total_cents).toBe(93500);
    expect(unit.lines[0].detail).toBe("2 each x $265.00");
    const tm = await price(
      "time_and_material",
      [
        { kind: "labor", description: "Troubleshoot and repair", hours: 2.5 },
        {
          kind: "material",
          description: "Breaker and wire",
          quantity: 1,
          unit: "lot",
          unit_cost_cents: 20900,
        },
      ],
      { labor_rate_cents: 11800, markup_bps: 1500, overtime_bps: 15000 },
    );
    expect(tm).toMatchObject({
      labor_cents: 29500,
      material_cents: 20900,
      markup_cents: 3135,
      total_cents: 53535,
    });
    const hourly = await price("hourly", [{ kind: "labor", description: "Labor", hours: 2.5 }], {
      hourly_rate_cents: 12500,
    });
    expect(hourly.total_cents).toBe(31250);
    const ot = await price(
      "hourly",
      [{ kind: "labor", description: "After hours", hours: 1, overtime: true }],
      {
        hourly_rate_cents: 12500,
        overtime_bps: 15000,
      },
    );
    expect(ot.total_cents).toBe(18750);
    await expect(
      price("hourly", [{ kind: "labor", description: "Labor", hours: 1 }], {}),
    ).rejects.toThrow(/hourly labor rate first/);
    await expect(
      price("unit_price", [{ kind: "labor", description: "Labor", hours: 1 }], {}),
    ).rejects.toThrow(/item lines only/);
    await expect(
      price(
        "time_and_material",
        [{ kind: "material", description: "Wire", quantity: -1, unit_cost_cents: 1 }],
        {},
      ),
    ).rejects.toThrow(/quantity/);
  });
});

describe("a service call from the phone call to paid", () => {
  let job = "";
  let fee: J;
  let wo = "";
  let access = "";
  let sess = "";
  const sessionToken = "T".repeat(43);

  it("lets the owner set service rates, and nobody else", async () => {
    await expect(
      member("mcp_service_rates_save", [company, { fee_cents: 14900 }], pm),
    ).rejects.toThrow(/owner or an all-access/);
    expect(await member("mcp_service_rates_get", [company], pm)).toMatchObject({
      saved: false,
      can_edit: false,
    });
    const r = await member("mcp_service_rates_save", [
      company,
      {
        fee_cents: 14900,
        fee_credit: true,
        labor_rate_cents: 11800,
        hourly_rate_cents: 12500,
        markup_bps: 1500,
      },
    ]);
    expect(r).toMatchObject({
      saved: true,
      fee_cents: 14900,
      labor_rate_cents: 11800,
      markup_bps: 1500,
      overtime_bps: 15000,
    });
    await expect(
      member("mcp_service_rates_save", [company, { markup_bps: 20000 }]),
    ).rejects.toThrow(/markup up to 100%/);
    await expect(member("mcp_service_rates_save", [company, { trip_cents: 1 }])).rejects.toThrow(
      /Unknown/,
    );
  });

  it("takes the call as a light job numbered SC-1001, once per request", async () => {
    const p = {
      request_id: uuid(1),
      customer_name: "Dana Whitfield",
      customer_phone: "555-0142",
      customer_email: "Dana.Whitfield@example.com",
      site_address: "418 Cedar Lane, Pinecrest",
      issue: "Kitchen outlets dead after a storm; breaker won't reset.",
      urgency: "soon",
      tech_name: "Marco Reyes",
      window_start: "2026-11-06T14:00:00Z",
      window_end: "2026-11-06T16:00:00Z",
      time_zone: "America/Chicago",
    };
    const c = await member("mcp_service_call_create", [company, p], pm);
    expect(c).toMatchObject({
      job_number: "SC-1001",
      number: 1001,
      stage: "scheduled",
      fee_cents: 14900,
      fee_credit: true,
      customer: { name: "Dana Whitfield", email: "dana.whitfield@example.com" },
      already_created: false,
    });
    expect(c.next_step).toMatch(/\$149\.00 service call fee/);
    job = c.job_id;
    expect(await member("mcp_service_call_create", [company, p], pm)).toMatchObject({
      job_id: job,
      already_created: true,
    });
    const j = await db.query<Row>(
      "SELECT job_kind, pm_user_id, pm_name, contract_type FROM mcp_jobs WHERE id=$1",
      [job],
    );
    expect(j.rows[0]).toEqual({
      job_kind: "service",
      pm_user_id: pm,
      pm_name: "Marco Reyes",
      contract_type: null,
    });
    await expect(member("mcp_job_contract_type_set", [job, "lump_sum"])).rejects.toThrow(
      /priced on each work order/,
    );
    await expect(member("mcp_service_call_get", [project])).rejects.toThrow(/isn't a service call/);
    await expect(member("mcp_service_call_get", [job], outsider)).rejects.toThrow(/full access/);
    const list = await member("mcp_service_calls_list", [company, null]);
    expect(list.calls).toHaveLength(1);
    expect(list.calls[0]).toMatchObject({
      job_number: "SC-1001",
      customer: "Dana Whitfield",
      stage: "scheduled",
    });
    await expect(
      member("mcp_service_call_create", [company, { ...p, request_id: uuid(2), site_address: "" }]),
    ).rejects.toThrow(/Where is the service call/);
  });

  it("invites the customer and sends the fee to the client page", async () => {
    const invite = await tokenHash("I".repeat(43));
    const r = await member("mcp_portal_invite", [
      job,
      "dana.whitfield@example.com",
      "Dana Whitfield",
      invite,
      new Date(Date.now() + 86_400_000).toISOString(),
    ]);
    access = r.access_id;
    sess = await tokenHash(sessionToken);
    await db.query(
      "INSERT INTO mcp_portal_sessions(access_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')",
      [access, sess],
    );
    fee = await member("mcp_service_fee_request", [job, null], pm);
    expect(fee).toMatchObject({
      kind: "service_invoice",
      number: "SC-1001-FEE",
      amount_cents: 14900,
      label: "Service call fee · SC-1001",
    });
    expect(fee.recipients).toEqual([
      { access_id: access, email: "dana.whitfield@example.com", name: "Dana Whitfield" },
    ]);
    expect(fee.call.stage).toBe("fee_requested");
    await expect(member("mcp_service_fee_request", [job, null], pm)).rejects.toThrow(
      /already sent/,
    );
    await expect(
      member("mcp_service_call_update", [job, null, { fee_cents: 1 }], pm),
    ).rejects.toThrow(/already sent/);
    const view = await server("mcp_portal_view", [access, sess, null, null]);
    expect(view.job).toMatchObject({ number: "SC-1001" });
    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({
      kind: "service_invoice",
      view: { stage: "fee", totals: { current_due_cents: 14900 } },
    });
    expect(() => portalViewSchema.parse(view)).not.toThrow();
    // The customer's page is a service call's: work orders and billing, no project tabs.
    const home = text(page(view, null));
    expect(home).toContain("Service call SC-1001");
    expect(home).toContain("Work orders");
    expect(home).not.toContain("Change orders");
    expect(home).not.toContain("Selections");
    expect(home).toContain("Service call fee · SC-1001");
    expect(home).toContain("Bill · $149.00 due");
    // A fee is paid, never decided.
    expect(
      (
        await server("mcp_portal_decide", [
          access,
          sess,
          fee.item_id,
          "approved",
          null,
          null,
          "Dana Whitfield",
          "I approve",
          fee.fingerprint,
          null,
          null,
          null,
        ])
      ).status,
    ).toBe("invalid");
    expect((await server("mcp_portal_pay_start", [access, sess, fee.item_id])).status).toBe(
      "not_accepting",
    );
    const label = await member("mcp_portal_list", [job], pm);
    expect(label.items[0]).toMatchObject({
      kind: "service_invoice",
      label: "Service call fee · SC-1001",
    });
  });

  it("records the fee paid by check, then the tech's findings", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await expect(
      member(
        "mcp_service_record_payment",
        [job, fee.invoice_id, uuid(10), "check", 20000, today, "5521", null],
        pm,
      ),
    ).rejects.toThrow(/more than the \$149\.00 left/);
    const paid = await member(
      "mcp_service_record_payment",
      [job, fee.invoice_id, uuid(10), "check", 14900, today, "5521", null],
      pm,
    );
    expect(paid).toMatchObject({ status: "ok", remaining_cents: 0 });
    expect(paid.call.stage).toBe("fee_paid");
    expect(
      await member(
        "mcp_service_record_payment",
        [job, fee.invoice_id, uuid(10), "check", 14900, today, "5521", null],
        pm,
      ),
    ).toMatchObject({ already_recorded: true });
    const state = await server("mcp_portal_payments_state", [access, sess]);
    expect(state.recorded).toEqual([
      expect.objectContaining({ item_id: fee.item_id, amount_cents: 14900, method: "check" }),
    ]);
    const c = await member(
      "mcp_service_call_update",
      [job, null, { findings: "Tripped 20A kitchen breaker; scorched GFCI behind the range." }],
      pm,
    );
    expect(c.stage).toBe("diagnosed");
  });

  it("writes a T&M work order with a not-to-exceed, and the customer approves it with an emailed code", async () => {
    const lines = [
      { kind: "labor", description: "Troubleshoot and repair kitchen circuit", hours: 2.5 },
      {
        kind: "material",
        description: "GFCI, breaker and wire",
        quantity: 1,
        unit: "lot",
        unit_cost_cents: 20900,
      },
    ];
    await expect(
      member(
        "mcp_work_order_save",
        [
          job,
          null,
          null,
          {
            basis: "time_and_material",
            title: "Kitchen circuit repair",
            scope: "Replace",
            lines,
            cap_cents: 50000,
          },
        ],
        pm,
      ),
    ).rejects.toThrow(/below the \$535\.35 estimate/);
    const s = await member(
      "mcp_work_order_save",
      [
        job,
        null,
        null,
        {
          basis: "time_and_material",
          title: "Kitchen circuit repair",
          scope: "Replace the scorched GFCI and the kitchen breaker, test the circuit.",
          lines,
          cap_cents: 65000,
        },
      ],
      pm,
    );
    expect(s).toMatchObject({
      number: "WO-1001",
      version: 1,
      state: "draft",
      estimate_cents: 53535,
      cap_cents: 65000,
    });
    wo = s.work_order_id;
    const sent = await member("mcp_work_order_send", [job, wo, 1, null], pm);
    expect(sent.view).toMatchObject({
      number: "WO-1001",
      basis_label: "Time and material",
      totals: {
        estimate_cents: 53535,
        cap_cents: 65000,
        fee_credit_cents: 14900,
        markup_cents: 3135,
      },
    });
    expect(sent.view.terms).toBe(
      "Billed for the actual time at $118.00/hr and materials at cost plus 15%. The bill won't go over $650.00 without your approval. The $149.00 service call fee you paid is credited toward this work.",
    );
    expect(sent.call.stage).toBe("work_order_sent");
    const view = await server("mcp_portal_view", [access, sess, null, null]);
    const item = view.items.find((i: J) => i.kind === "work_order");
    expect(item.view.lines[0]).toEqual({
      kind: "labor",
      description: "Troubleshoot and repair kitchen circuit",
      detail: "2.5 hr x $118.00/hr",
      amount_cents: 29500,
    });
    expect(() => portalViewSchema.parse(view)).not.toThrow();
    const pays = await server("mcp_portal_payments_state", [access, sess]);
    const detail = text(page(view, pays, { section: "work", item: item.id, step: "confirm" }));
    expect(detail).toContain("Time and material");
    expect(detail).toContain("Won't go over without your approval $650.00");
    expect(detail).toContain(
      "I approve WO-1001 · Kitchen circuit repair from ALP Construction for the actual cost, up to $650.00, as described on this page.",
    );
    // The paid fee no longer waits on the customer; the work order does.
    const home = text(page(view, pays));
    expect(home).toContain("Work order · Time and material · up to $650.00");
    expect(home).not.toContain("Bill · $149.00 due");
    expect((await server("mcp_portal_pay_start", [access, sess, item.id])).status).toBe("invalid");
    // Approving needs a fresh emailed code.
    const decide = (code: string | null) =>
      server("mcp_portal_decide", [
        access,
        sess,
        item.id,
        "approved",
        null,
        code,
        "Dana Whitfield",
        "I approve this work order.",
        item.fingerprint,
        null,
        "1.2.3.4",
        "test",
      ]);
    expect((await decide(null)).status).not.toBe("ok");
    const code = await codeHash(access, "246810");
    expect(
      (await server("mcp_portal_code_issue", [access, "decide", code, null, sess, item.id])).status,
    ).toBe("ok");
    expect(await decide(code)).toMatchObject({ status: "ok" });
    const c = await member("mcp_service_call_get", [job], pm);
    expect(c.stage).toBe("approved");
    expect(c.work_orders[0]).toMatchObject({
      state: "approved",
      decision: { decision: "approved", email_code_verified: true },
    });
    const list = await member("mcp_portal_list", [job], pm);
    expect(list.items.find((i: J) => i.kind === "work_order")).toMatchObject({
      label: "WO-1001 · Kitchen circuit repair",
      decision: { decision: "approved" },
    });
  });

  it("refuses work over the approved amount, then logs the actual work with the customer's sign-off", async () => {
    const over = [
      { kind: "labor", description: "Repair", hours: 4 },
      { kind: "material", description: "Parts", quantity: 1, unit_cost_cents: 20900 },
    ];
    await expect(
      member(
        "mcp_work_order_log",
        [job, wo, null, { lines: over, done: true, signoff_name: "Dana Whitfield" }],
        pm,
      ),
    ).rejects.toThrow(/over the \$650\.00 the customer approved/);
    const actual = [
      { kind: "labor", description: "Troubleshoot and repair kitchen circuit", hours: 2.75 },
      {
        kind: "material",
        description: "GFCI, breaker and wire",
        quantity: 1,
        unit: "lot",
        unit_cost_cents: 20900,
      },
    ];
    await expect(
      member("mcp_work_order_log", [job, wo, null, { lines: actual, done: true }], pm),
    ).rejects.toThrow(/signed off with/);
    const l = await member(
      "mcp_work_order_log",
      [job, wo, null, { lines: actual, done: true, signoff_name: "Dana Whitfield" }],
      pm,
    );
    expect(l).toMatchObject({ state: "done", actual_cents: 56485 });
    await expect(
      member(
        "mcp_work_order_save",
        [
          job,
          wo,
          null,
          {
            basis: "hourly",
            title: "x",
            scope: "x",
            lines: [{ kind: "labor", description: "x", hours: 1 }],
          },
        ],
        pm,
      ),
    ).rejects.toThrow(/can't be revised/);
  });

  it("bills the work less the paid fee, and the customer pays the rest online", async () => {
    const b = await member("mcp_service_bill", [job, wo, null], pm);
    expect(b).toMatchObject({
      number: "INV-1001",
      amount_cents: 56485,
      credit_cents: 14900,
      due_cents: 41585,
    });
    expect(b.view.lines.map((l: J) => l.amount_cents)).toEqual([32450, 20900, 3135]);
    expect(b.view.signoff.name).toBe("Dana Whitfield");
    expect(b.call.stage).toBe("billed");
    await expect(member("mcp_service_bill", [job, wo, null], pm)).rejects.toThrow(/already billed/);
    await server("mcp_client_payments_account_save", [company, "test", acct, "ready", owner]);
    const start = await server("mcp_portal_pay_start", [access, sess, b.item_id]);
    expect(start).toMatchObject({
      status: "ok",
      amount_cents: 41585,
      label: "Invoice INV-1001",
      account_id: acct,
    });
    await server("mcp_portal_pay_opened", [
      b.item_id,
      access,
      "test",
      acct,
      "cs_test_service1",
      ["card"],
      41585,
      1040,
    ]);
    const paid = await server("mcp_portal_pay_update", [
      "cs_test_service1",
      acct,
      "paid",
      "pi_test_service1",
      "ch_test_service1",
      "card",
      41585,
      1040,
      "2026-11-06T18:00:00Z",
    ]);
    expect(paid).toMatchObject({
      status: "changed",
      payment_status: "paid",
      applied: true,
      booked: true,
      label: "Invoice INV-1001",
    });
    const c = await member("mcp_service_call_get", [job], pm);
    expect(c.stage).toBe("paid");
    const view = await server("mcp_portal_view", [access, sess, null, null]);
    const bill = view.items.find((i: J) => i.id === b.item_id);
    const billPage = text(
      page(view, await server("mcp_portal_payments_state", [access, sess]), {
        section: "billing",
        item: bill.id,
      }),
    );
    expect(billPage).toContain("Service call fee you paid −$149.00");
    expect(billPage).toContain("Due $415.85");
    expect(billPage).toContain("Work signed off by Dana Whitfield");
    expect(billPage).toContain("Paid");
    expect(billPage).not.toContain("Pay by card");
    expect(c.work_orders[0].bill).toMatchObject({
      paid: true,
      remaining_cents: 0,
      applied_cents: 41585,
    });
    // Fee plus bill equal the work.
    expect(c.fee.applied_cents + c.work_orders[0].bill.applied_cents).toBe(56485);
    const closed = await member("mcp_service_call_update", [job, null, { status: "closed" }], pm);
    expect(closed.stage).toBe("closed");
    await expect(
      member("mcp_service_call_update", [job, null, { tech_name: "Someone" }], pm),
    ).rejects.toThrow(/Reopen/);
  });

  it("revises a sent work order into a new version the customer must approve again, or records an on-site signature", async () => {
    const c2 = await member(
      "mcp_service_call_create",
      [
        company,
        {
          request_id: uuid(3),
          customer_name: "Dana Whitfield",
          site_address: "418 Cedar Lane, Pinecrest",
          issue: "Porch light out",
          fee_cents: 0,
        },
      ],
      pm,
    );
    expect(c2).toMatchObject({ job_number: "SC-1002", fee_cents: 0, stage: "new" });
    const unit = {
      basis: "unit_price",
      title: "Porch fixture",
      scope: "Replace the porch fixture.",
      lines: [
        {
          kind: "item",
          description: "Porch fixture",
          quantity: 1,
          unit: "each",
          unit_rate_cents: 26500,
        },
      ],
    };
    const s = await member("mcp_work_order_save", [c2.job_id, null, null, unit], pm);
    await member("mcp_work_order_send", [c2.job_id, s.work_order_id, 1, null], pm);
    const r = await member(
      "mcp_work_order_save",
      [
        c2.job_id,
        s.work_order_id,
        1,
        {
          ...unit,
          lines: [
            {
              kind: "item",
              description: "Porch fixture",
              quantity: 2,
              unit: "each",
              unit_rate_cents: 26500,
            },
          ],
        },
      ],
      pm,
    );
    expect(r).toMatchObject({ version: 2, state: "draft", estimate_cents: 53000 });
    const items = await db.query<Row>(
      "SELECT ref_version, withdrawn_at IS NOT NULL AS gone FROM mcp_portal_items WHERE ref_id=$1",
      [s.work_order_id],
    );
    expect(items.rows).toEqual([{ ref_version: 1, gone: true }]);
    const a = await member(
      "mcp_work_order_approve_on_site",
      [c2.job_id, s.work_order_id, 2, "Dana Whitfield", null],
      pm,
    );
    expect(a.stage).toBe("approved");
    expect(a.work_orders[0].decision).toMatchObject({ channel: "on_site", by: "Dana Whitfield" });
    expect(a.next_step).toMatch(/log the actual items/);
  });

  it("keeps service tables and member functions out of reach of the browser roles", async () => {
    for (const t of [
      "mcp_service_calls",
      "mcp_work_orders",
      "mcp_service_rates",
      "mcp_change_order_pricing",
    ])
      await expect(as(owner)(`SELECT * FROM ${t}`)).rejects.toThrow();
    await expect(server("mcp_service_call_get", [job])).rejects.toThrow();
    await expect(
      as(owner)("SELECT mcp_private.service_price('hourly','[]','{}')"),
    ).rejects.toThrow();
  });
});

describe("migration", () => {
  it("applies twice, rolls back cleanly and applies again", async () => {
    const fresh = await makeDb();
    await loadServiceChain(fresh);
    await fresh.exec(`BEGIN; ${up()}; COMMIT;`);
    await fresh.exec(`BEGIN; ${up()}; COMMIT;`);
    await fresh.exec(`BEGIN; ${down()}; COMMIT;`);
    expect(
      (await fresh.query("SELECT to_regclass('public.mcp_service_calls') AS t")).rows[0],
    ).toEqual({ t: null });
    const kinds = await fresh.query<{ d: string }>(
      "SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname='mcp_portal_items_kind_check'",
    );
    expect(kinds.rows[0]!.d).not.toMatch(/work_order/);
    await fresh.exec(`BEGIN; ${up()}; COMMIT;`);
  }, 120_000);
});
