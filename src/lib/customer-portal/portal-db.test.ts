// Customer page on a local database: the real migration chain plus the customer page SQL. Members act through
// their own role; the customer acts only through the service-role functions the page server calls.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser, fakeClient } from "../../../tests/mcp-roles/fake-supabase";
import { gbbSql } from "../../../tests/selections/sql";
import { willowCreekTypeE } from "../selections/__fixtures__/willow-creek-type-e";
import { tokenHash } from "../mcp/file-share";
import { codeHash } from "./server";
import { payAppLabel, portalMessagesSchema, portalViewSchema } from "./model";
import { applicationFixture } from "../payment-applications/fixtures";

const who = vi.hoisted(() => ({ user: "", db: null as unknown }));
vi.mock("../mcp/guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../mcp/guard")>();
  return {
    ...actual,
    run: async (_tool: string, _ctx: unknown, _opts: unknown, fn: (sb: unknown) => unknown) =>
      fn(
        fakeClient(who.db as PGlite, {
          sub: who.user,
          email: "member@example.com",
          role: "authenticated",
        }),
      ),
  };
});
import { customerPortal } from "../mcp/tools/customer-portal-tools";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool results are read field by field
type ToolResult = { content: { text: string }[]; structuredContent?: Record<string, any> };
const tool = (args: Record<string, unknown>, user = owner) => {
  who.user = user;
  return (
    customerPortal as unknown as { handler: (a: unknown, c: unknown) => Promise<ToolResult> }
  ).handler({ job_number: "2715", company_id: company, ...args }, {});
};

const owner = "00000000-0000-4000-8000-000000000c01";
const pm = "00000000-0000-4000-8000-000000000c02";
const outsider = "00000000-0000-4000-8000-000000000c03";
const company = "00000000-0000-4000-8000-000000000c10";
const job = "00000000-0000-4000-8000-000000000c20";
// The billing job: its own SOV, contract and customer access, so the change orders above never move its contract.
const job2 = "00000000-0000-4000-8000-000000000c21";
let db: PGlite;

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

const hex = (n: number) => n.toString(16).padStart(64, "0");
const inviteToken = "A".repeat(43);
const sessionToken = "S".repeat(43);
let inviteHash = "";
let sessionHash = "";
let access = "";

beforeAll(async () => {
  db = await makeDb();
  who.db = db;
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
  // Payment applications (billing evidence, then the application chain) and the customer page's pay applications.
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
  // Job notices and client messages. The team invites chain isn't loaded here, so every role counts as allowed.
  await db.exec(
    "CREATE FUNCTION public.mcp_role_allowed(_company uuid, _role text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$",
  );
  await load("20261105180000_athena_job_notices");
  await load("20261105200000_athena_notices_owner_fallback");
  await load("20261105181000_athena_portal_messages");
  await load("20261106160000_athena_portal_page_sign_in");
  await load("20261106233000_athena_portal_code_reuse");

  for (const user of [owner, pm, outsider]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES ($1,$2)", [
      user,
      `${user.slice(-2)}@example.com`,
    ]);
    await db.query("INSERT INTO test_active_members VALUES ($1)", [user]);
  }
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Northline Builders',$2)",
    [company, owner],
  );
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Owner'),($1,$3,'pm','PM')",
    [company, owner, pm],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name,time_zone,pm_name,pm_email,pm_user_id) VALUES($1,$2,$3,'2715','Harbor Point Dental','America/Chicago','Pat Lee','pat@example.com',$4)",
    [job, owner, company, pm],
  );
  await db.query("INSERT INTO test_company_plans VALUES($1,'circle')", [company]);
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name,time_zone,pm_name,pm_email,pm_user_id,sov_fee_pct) VALUES($1,$2,$3,'2716','Harbor Point Garage','America/Chicago','Pat Lee','pat@example.com',$4,0)",
    [job2, owner, company, pm],
  );
  await db.query(
    "INSERT INTO mcp_job_facts(job_id,module,key,value,status,source,updated_by) VALUES($1,'contract','contract_value','100000','known','member_answer',$2)",
    [job2, owner],
  );
  await db.query(
    "INSERT INTO mcp_job_facts(job_id,module,key,value,status,source,updated_by) VALUES($1,'sov','01',$2::jsonb,'known','member_answer',$3)",
    [job2, JSON.stringify({ description: "Construction work", billable_value: 100000 }), owner],
  );
  // Field records: a daily with private notes and two photos, one not customer-safe.
  const d = await db.query<{ id: string }>(
    `INSERT INTO mcp_daily_reports(job_id,company_id,report_date,weather,manpower,subs_on_site,deliveries,issues,delays,safety,transcript)
     VALUES($1,$2,'2026-11-03','Clear, 58F','8','Acme Drywall','Light fixtures','PRIVATE ISSUE','PRIVATE DELAY','PRIVATE SAFETY','PRIVATE TRANSCRIPT') RETURNING id`,
    [job, company],
  );
  await db.query(
    `INSERT INTO mcp_daily_work_lines(daily_id,job_id,company_id,line_no,work,sov_item,activity_id,qty,unit,crew,hours)
     VALUES($1,$2,$3,1,'Hung drywall in exam rooms 1 to 4','09.100','A100',400,'sf',4,8)`,
    [d.rows[0]!.id, job, company],
  );
  await db.query(
    `INSERT INTO mcp_progress_photos(id,job_id,company_id,taken_on,area,work,client_safe,storage_path,mime_type,size_bytes) VALUES
     (gen_random_uuid(),$1,$2,'2026-11-03','Exam room 2','Drywall hung',true,'safe.jpg','image/jpeg',100),
     (gen_random_uuid(),$1,$2,'2026-11-03','Back room','Internal',false,'internal.jpg','image/jpeg',100)`,
    [job, company],
  );
  await db.query(
    `INSERT INTO mcp_living_reports(job_id,report_type,version,data,change_what,updated_by) VALUES($1,'cpm',1,$2,'Baseline',$3)`,
    [
      job,
      JSON.stringify({
        activities: [
          {
            id: "M1",
            name: "Rough-in inspection",
            duration: 0,
            start: "2026-11-10",
            finish: "2026-11-10",
          },
          { id: "A1", name: "Drywall", duration: 5, start: "2026-11-02", finish: "2026-11-06" },
          {
            id: "M2",
            name: "Ready to move in",
            activity_type: "milestone-finish",
            finish: "2026-12-18",
          },
        ],
      }),
      owner,
    ],
  );
  inviteHash = await tokenHash(inviteToken);
  sessionHash = await tokenHash(sessionToken);
});
afterAll(async () => {
  await db?.close();
});

describe.sequential("customer page", () => {
  it("only full-access members invite, and the customer tables stay closed to everyone else", async () => {
    await expect(
      member(
        "mcp_portal_invite",
        [
          job,
          "rosa@example.com",
          "Rosa Delgado",
          inviteHash,
          new Date(Date.now() + 86_400_000).toISOString(),
        ],
        outsider,
      ),
    ).rejects.toThrow();
    const r = await member("mcp_portal_invite", [
      job,
      "Rosa@Example.com",
      "Rosa Delgado",
      inviteHash,
      new Date(Date.now() + 86_400_000).toISOString(),
    ]);
    expect(r).toMatchObject({
      email: "rosa@example.com",
      reinvited: false,
      company: "Northline Builders",
    });
    access = r.access_id;
    for (const t of [
      "mcp_portal_access",
      "mcp_portal_sessions",
      "mcp_portal_codes",
      "mcp_portal_items",
      "mcp_portal_decisions",
    ])
      await expect(as(owner)(`SELECT * FROM public.${t}`)).rejects.toThrow(/permission denied/);
    // Customer-side functions are server-only.
    await expect(member("mcp_portal_invite_open", [inviteHash])).rejects.toThrow(
      /permission denied/,
    );
    await expect(member("mcp_portal_view", [access, sessionHash, null, null])).rejects.toThrow(
      /permission denied/,
    );
  });

  it("signs in only with the emailed code, and locks a code after five wrong tries", async () => {
    expect(await server("mcp_portal_invite_open", [hex(1)])).toEqual({ status: "unknown" });
    expect(await server("mcp_portal_invite_open", [inviteHash])).toMatchObject({
      status: "ok",
      access_id: access,
      job_number: "2715",
    });
    expect(
      await server("mcp_portal_sign_in", [
        inviteHash,
        hex(2),
        sessionHash,
        false,
        "203.0.113.5",
        "test",
      ]),
    ).toEqual({ status: "expired" });
    const good = await codeHash(access, "123456");
    expect(
      (await server("mcp_portal_code_issue", [access, "sign_in", good, hex(9), null, null])).status,
    ).toBe("unknown");
    expect(
      (await server("mcp_portal_code_issue", [access, "sign_in", good, inviteHash, null, null]))
        .status,
    ).toBe("ok");
    for (let i = 0; i < 4; i++)
      expect(
        (await server("mcp_portal_sign_in", [inviteHash, hex(3), sessionHash, false, null, null]))
          .status,
      ).toBe("wrong");
    expect(
      (await server("mcp_portal_sign_in", [inviteHash, hex(3), sessionHash, false, null, null]))
        .status,
    ).toBe("locked");
    expect(
      (await server("mcp_portal_sign_in", [inviteHash, good, sessionHash, false, null, null]))
        .status,
    ).toBe("locked");
    const fresh = await codeHash(access, "654321");
    await server("mcp_portal_code_issue", [access, "sign_in", fresh, inviteHash, null, null]);
    expect(
      (
        await server("mcp_portal_sign_in", [
          inviteHash,
          fresh,
          sessionHash,
          true,
          "203.0.113.5",
          "test",
        ])
      ).status,
    ).toBe("ok");
    // A used code doesn't work twice.
    expect(
      (
        await server("mcp_portal_sign_in", [
          inviteHash,
          fresh,
          await tokenHash("x".repeat(43)),
          false,
          null,
          null,
        ])
      ).status,
    ).toBe("expired");
  });

  it("rate-limits codes", async () => {
    // 2 issued above; 3 more fit in 15 minutes, the next is refused.
    for (let i = 0; i < 3; i++)
      expect(
        (
          await server("mcp_portal_code_issue", [
            access,
            "sign_in",
            hex(100 + i),
            inviteHash,
            null,
            null,
          ])
        ).status,
      ).toBe("ok");
    expect(
      (await server("mcp_portal_code_issue", [access, "sign_in", hex(200), inviteHash, null, null]))
        .status,
    ).toBe("slow_down");
    await db.query(
      "UPDATE mcp_portal_codes SET created_at = now() - interval '1 hour' WHERE access_id = $1",
      [access],
    );
  });

  it("shows only what is shared, with no private daily fields or unsafe photos", async () => {
    expect(await server("mcp_portal_view", [access, hex(4), null, null])).toEqual({
      status: "signed_out",
    });
    await member("mcp_portal_post_update", [
      job,
      "2026-11-02",
      "Drywall is going up",
      "Exam rooms 1 to 4 are hung.",
    ]);
    const v = await server("mcp_portal_view", [access, sessionHash, "203.0.113.5", "test"]);
    expect(portalViewSchema.safeParse(v).success).toBe(true);
    const s = JSON.stringify(v);
    for (const secret of ["PRIVATE", "internal.jpg", "Acme Drywall", "Light fixtures"])
      expect(s).not.toContain(secret);
    expect(v.photos.map((p: J) => p.storage_path)).toEqual(["safe.jpg"]);
    expect(v.dailies[0]).toEqual({
      date: "2026-11-03",
      weather: "Clear, 58F",
      manpower: "8",
      work: ["Hung drywall in exam rooms 1 to 4"],
    });
    expect(v.milestones.map((m: J) => m.name)).toEqual(["Rough-in inspection", "Ready to move in"]);
    expect(v.updates[0].title).toBe("Drywall is going up");
    expect(v.contractor).toEqual({
      name: "Northline Builders",
      pm_name: "Pat Lee",
      pm_title: null,
      pm_email: "pat@example.com",
    });
  });

  let submittal = "";
  let item = "";
  it("shares a priced change order without cost lines, and approval needs a fresh decision code", async () => {
    const created = await member("mcp_change_record", [
      job,
      "create",
      JSON.stringify({
        request_id: crypto.randomUUID(),
        title: "Exam room light upgrade",
        condition: "Owner asked for brighter exam lights.",
        scope: "Swap 12 exam room fixtures for 5000 lumen models.",
        references: [{ kind: "condition", citation: "Owner email Nov 2" }],
        recipient_name: "Rosa Delgado",
        recipient_email: "rosa@example.com",
        origin: "owner",
        schedule_days: 2,
      }),
    ]);
    submittal = created.saved_id;
    await expect(member("mcp_portal_share_change_order", [job, submittal, 1])).rejects.toThrow(
      /priced/,
    );
    await member("mcp_change_record", [
      job,
      "price",
      JSON.stringify({
        request_id: crypto.randomUUID(),
        submittal_id: submittal,
        expected_version: 1,
        lines: [
          {
            category: "material",
            description: "SECRET FIXTURE COST",
            quantity: 12,
            unit: "EA",
            unit_rate_cents: 30000,
            source: "Quote 7",
          },
          {
            category: "markup",
            description: "SECRET MARKUP",
            rate_basis_points: 3500,
            source: "Contract 7",
          },
        ],
      }),
    ]);
    await expect(member("mcp_portal_share_change_order", [job, submittal, 1])).rejects.toThrow(
      /changed/,
    );
    const shared = await member("mcp_portal_share_change_order", [job, submittal, 2]);
    item = shared.item_id;
    expect(shared.view).toEqual({
      number: "PCO-001",
      title: "Exam room light upgrade",
      why: "Owner asked for brighter exam lights.",
      scope: "Swap 12 exam room fixtures for 5000 lumen models.",
      price_cents: 486000,
      schedule_days: 2,
      due_on: null,
    });
    expect(shared.recipients).toEqual([
      { access_id: access, email: "rosa@example.com", name: "Rosa Delgado" },
    ]);
    const v = await server("mcp_portal_view", [access, sessionHash, null, null]);
    expect(JSON.stringify(v)).not.toContain("SECRET");
    expect(v.items[0]).toMatchObject({
      id: item,
      kind: "change_order",
      decision: null,
      fingerprint: shared.fingerprint,
    });

    const approve = (code: string | null, fp = shared.fingerprint) =>
      server("mcp_portal_decide", [
        access,
        sessionHash,
        item,
        "approved",
        null,
        code,
        "Rosa Delgado",
        "I approve PCO-001.",
        fp,
        null,
        "203.0.113.5",
        "test",
      ]);
    expect((await approve(null)).status).toBe("expired");
    const code = await codeHash(access, "111111");
    expect(
      (await server("mcp_portal_code_issue", [access, "decide", code, null, hex(5), item])).status,
    ).toBe("signed_out");
    expect(
      (await server("mcp_portal_code_issue", [access, "decide", code, null, sessionHash, item]))
        .status,
    ).toBe("ok");
    expect((await approve(code, hex(6))).status).toBe("changed");
    const ok = await approve(code);
    expect(ok).toMatchObject({
      status: "ok",
      pm_email: "pat@example.com",
      label: "PCO-001 · Exam room light upgrade",
    });
    expect((await approve(code)).status).toBe("not_open");

    const co = (
      await db.query<{ details: J }>(
        "SELECT details FROM mcp_change_orders WHERE submittal_id=$1",
        [submittal],
      )
    ).rows[0]!.details;
    expect(co.state).toBe("approved");
    expect(co.co_number).toBe("CO-001");
    expect(co.record_version).toBe(3);
    expect(co.decision).toMatchObject({
      by: "Rosa Delgado <rosa@example.com>",
      channel: "customer_page",
      reference: `Customer page decision ${ok.decision_id}`,
      email_code_verified: true,
      fingerprint: shared.fingerprint,
    });
    const hist = await db.query<{ action: string; actor_id: string }>(
      "SELECT action, actor_id FROM mcp_change_history WHERE submittal_id=$1 ORDER BY record_version",
      [submittal],
    );
    expect(hist.rows.at(-1)).toEqual({ action: "approve", actor_id: owner });
    const listed = await member("mcp_portal_list", [job]);
    expect(listed.items[0].decision).toMatchObject({
      decision: "approved",
      typed_name: "Rosa Delgado",
      email: "rosa@example.com",
    });
  });

  it("hides a shared change order once it is edited, and a decline needs no code", async () => {
    const created = await member("mcp_change_record", [
      job,
      "create",
      JSON.stringify({
        request_id: crypto.randomUUID(),
        title: "Add outlet",
        condition: "Owner asked.",
        scope: "One outlet.",
        references: [{ kind: "condition", citation: "Owner call" }],
        origin: "owner",
      }),
    ]);
    await member("mcp_change_record", [
      job,
      "price",
      JSON.stringify({
        request_id: crypto.randomUUID(),
        submittal_id: created.saved_id,
        expected_version: 1,
        lines: [
          {
            category: "material",
            description: "Outlet",
            quantity: 1,
            unit: "EA",
            unit_rate_cents: 20000,
            source: "Quote",
          },
        ],
      }),
    ]);
    const shared = await member("mcp_portal_share_change_order", [job, created.saved_id, 2]);
    let v = await server("mcp_portal_view", [access, sessionHash, null, null]);
    expect(v.items.map((i: J) => i.id)).toContain(shared.item_id);
    await member("mcp_change_record", [
      job,
      "price",
      JSON.stringify({
        request_id: crypto.randomUUID(),
        submittal_id: created.saved_id,
        expected_version: 2,
        lines: [
          {
            category: "material",
            description: "Outlet",
            quantity: 2,
            unit: "EA",
            unit_rate_cents: 20000,
            source: "Quote",
          },
        ],
      }),
    ]);
    v = await server("mcp_portal_view", [access, sessionHash, null, null]);
    expect(v.items.map((i: J) => i.id)).not.toContain(shared.item_id);
    expect(
      (
        await server("mcp_portal_decide", [
          access,
          sessionHash,
          shared.item_id,
          "declined",
          null,
          null,
          "Rosa Delgado",
          "I decline.",
          shared.fingerprint,
          null,
          null,
          null,
        ])
      ).status,
    ).toBe("changed");
    const again = await member("mcp_portal_share_change_order", [job, created.saved_id, 3]);
    const declined = await server("mcp_portal_decide", [
      access,
      sessionHash,
      again.item_id,
      "declined",
      null,
      null,
      "Rosa Delgado",
      "I decline.",
      again.fingerprint,
      "Too pricey",
      null,
      null,
    ]);
    expect(declined.status).toBe("ok");
    const co = (
      await db.query<{ details: J }>(
        "SELECT details FROM mcp_change_orders WHERE submittal_id=$1",
        [created.saved_id],
      )
    ).rows[0]!.details;
    expect(co.state).toBe("rejected");
    expect(co.co_number).toBeUndefined();
    expect(co.decision.email_code_verified).toBe(false);
  });

  it("shares the Good, Better, Best proposal and records the customer's choice on the board", async () => {
    const saved = await member("mcp_residential_selections_save", [
      job,
      0,
      JSON.stringify(willowCreekTypeE(true)),
    ]);
    const shared = await member("mcp_portal_share_selection", [job, saved.version]);
    expect(shared.view.proposal.packages).toHaveLength(3);
    expect(JSON.stringify(shared.view)).not.toMatch(/cost_cents|found_price|assumptions/);
    const code = await codeHash(access, "222222");
    // Sign-in codes never block a choice: five today don't count against this item's codes.
    await db.query(
      "INSERT INTO mcp_portal_codes(access_id,purpose,code_hash,expires_at) SELECT $1,'sign_in',$2,now() FROM generate_series(1,5)",
      [access, hex(300)],
    );
    const pending = () => server("mcp_portal_code_pending", [access, sessionHash, shared.item_id]);
    expect((await pending()).status).toBe("none");
    for (let i = 0; i < 5; i++)
      expect(
        (
          await server("mcp_portal_code_issue", [
            access,
            "decide",
            hex(310 + i),
            null,
            sessionHash,
            shared.item_id,
          ])
        ).status,
      ).toBe("ok");
    // A code is still good, so the page reuses it; another session never sees it.
    expect(await pending()).toMatchObject({ status: "ok" });
    expect((await server("mcp_portal_code_pending", [access, hex(5), shared.item_id])).status).toBe(
      "none",
    );
    // The sixth code for the same item in 15 minutes waits, and says for how long.
    const slow = await server("mcp_portal_code_issue", [
      access,
      "decide",
      hex(320),
      null,
      sessionHash,
      shared.item_id,
    ]);
    expect(slow.status).toBe("slow_down");
    expect(slow.retry_minutes).toBeGreaterThanOrEqual(14);
    expect(slow.retry_minutes).toBeLessThanOrEqual(15);
    await db.query(
      "UPDATE mcp_portal_codes SET created_at = now() - interval '2 days' WHERE access_id = $1",
      [access],
    );
    await server("mcp_portal_code_issue", [
      access,
      "decide",
      code,
      null,
      sessionHash,
      shared.item_id,
    ]);
    const r = await server("mcp_portal_decide", [
      access,
      sessionHash,
      shared.item_id,
      "chosen",
      "better",
      code,
      "Rosa Delgado",
      "I choose Better.",
      shared.fingerprint,
      null,
      null,
      null,
    ]);
    expect(r.status).toBe("ok");
    // No contract value on file: the choice is a proposal approval, never a change order.
    expect(r.under_contract).toBe(false);
    expect(r.change_order_number).toBeNull();
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM mcp_change_orders WHERE job_id=$1 AND details ? 'customer_choice'",
          [job],
        )
      ).rows[0],
    ).toMatchObject({ n: 0 });
    const board = await member("mcp_residential_selections_get", [job]);
    expect(board.board.accepted).toMatchObject({ tier: "better" });
    expect(board.board.accepted.evidence).toContain("customer page");
    const v = await server("mcp_portal_view", [access, sessionHash, null, null]);
    expect(v.items.find((i: J) => i.id === shared.item_id).decision).toMatchObject({
      decision: "chosen",
      choice: "better",
      code_verified: true,
    });
  });

  it("under contract, a package pick approves the change order for the signed price and time", async () => {
    await db.query(
      "INSERT INTO mcp_job_facts(job_id,module,key,value,status,source,updated_by) VALUES($1,'contract','contract_value','1250000','known','member_answer',$2)",
      [job, owner],
    );
    // Test setup only: clear the earlier test's recorded choice so the same board can be chosen again.
    await db.query(
      "UPDATE mcp_private.residential_selection_boards SET body = jsonb_set(body, '{accepted}', 'null') WHERE job_id=$1",
      [job],
    );
    const before = await member("mcp_residential_selections_get", [job]);
    const board = willowCreekTypeE(true) as J;
    board.proposal.change_terms = {
      good: { schedule_days: 0, added_cents: 0, added_note: "" },
      better: { schedule_days: 0, added_cents: 0, added_note: "" },
      best: {
        schedule_days: 2,
        added_cents: 15000,
        added_note: "Extra blocking for heavier fixtures",
      },
      reviewed_on: "2026-11-05",
    };
    const saved = await member("mcp_residential_selections_save", [
      job,
      before.version,
      JSON.stringify(board),
    ]);
    const shared = await member("mcp_portal_share_selection", [job, saved.version]);
    const v0 = await server("mcp_portal_view", [access, sessionHash, null, null]);
    expect(v0.job.under_contract).toBe(true);
    const code = await codeHash(access, "333333");
    await server("mcp_portal_code_issue", [
      access,
      "decide",
      code,
      null,
      sessionHash,
      shared.item_id,
    ]);
    const r = await server("mcp_portal_decide", [
      access,
      sessionHash,
      shared.item_id,
      "chosen",
      "best",
      code,
      "Rosa Delgado",
      "I choose Best.",
      shared.fingerprint,
      null,
      null,
      null,
    ]);
    expect(r).toMatchObject({ status: "ok", under_contract: true, schedule_days: 2 });
    const best = shared.view.proposal.packages.find((k: J) => k.tier === "best");
    expect(best).toMatchObject({ schedule_days: 2, added_cents: 15000 });
    expect(r.difference_cents).toBe(best.difference_cents);
    expect(r.change_order_number).toMatch(/^PCO-\d{3}$/);
    expect(r.co_number).toMatch(/^CO-\d{3}$/);
    const co = (
      await db.query<{ details: J }>(
        "SELECT details FROM mcp_change_orders WHERE submittal_id=$1",
        [r.change_order_id],
      )
    ).rows[0]!.details as J;
    // One approval: the signed pick is the change order approval, for the signed price and the stated time.
    expect(co).toMatchObject({
      state: "approved",
      origin: "owner",
      co_number: r.co_number,
      schedule_days: 2,
      total_cents: best.difference_cents,
      decision: { by: expect.stringContaining("Rosa Delgado"), email_code_verified: true },
      customer_choice: {
        tier: "best",
        schedule_days: 2,
        added_cents: 15000,
        by: expect.stringContaining("Rosa Delgado"),
        email_code_verified: true,
      },
    });
    expect(co.scope).toContain("The additional time necessary for this change is 2 days.");
    expect(co.lines.reduce((t: number, l: J) => t + l.amount_cents, 0)).toBe(best.difference_cents);
    expect(co.lines.at(-1)).toMatchObject({
      category: "other",
      description: "Extra blocking for heavier fixtures",
      amount_cents: 15000,
    });
    expect(co.customer_choice.difference_cents).toBe(best.difference_cents);
    expect(JSON.stringify(co)).not.toMatch(/cost_cents|found_price|assumptions/);
    const hist = await db.query("SELECT action FROM mcp_change_history WHERE submittal_id=$1", [
      r.change_order_id,
    ]);
    expect(hist.rows).toEqual([{ action: "approve" }]);
  });

  it("signs in on the page with the invited email and a code, with no invite link", async () => {
    const pageSession = await tokenHash("Q1".repeat(21) + "z");
    // Server-only, like every customer function.
    await expect(
      member("mcp_portal_page_code_issue", [access, "rosa@example.com", hex(40), null, null]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      member("mcp_portal_page_sign_in", [access, hex(40), pageSession, false, null, null]),
    ).rejects.toThrow(/permission denied/);
    // Another address gets no code, and the try is logged.
    expect(
      await server("mcp_portal_page_code_issue", [access, "eve@example.com", hex(40), null, null]),
    ).toEqual({ status: "mismatch" });
    const before = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM mcp_portal_codes WHERE access_id=$1",
      [access],
    );
    // The invited address, in any case, gets one.
    const code = "246802";
    expect(
      await server("mcp_portal_page_code_issue", [
        access,
        " Rosa@Example.com ",
        await codeHash(access, code),
        null,
        null,
      ]),
    ).toMatchObject({ status: "ok", email: "rosa@example.com", job_name: "Harbor Point Dental" });
    const after = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM mcp_portal_codes WHERE access_id=$1",
      [access],
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n + 1);
    expect(
      (
        await server("mcp_portal_page_sign_in", [
          access,
          await codeHash(access, "000000"),
          pageSession,
          false,
          null,
          null,
        ])
      ).status,
    ).toBe("wrong");
    expect(
      await server("mcp_portal_page_sign_in", [
        access,
        await codeHash(access, code),
        pageSession,
        false,
        "1.2.3.4",
        "test",
      ]),
    ).toMatchObject({ status: "ok", access_id: access });
    expect((await server("mcp_portal_view", [access, pageSession, null, null])).status).toBe("ok");
    // A used code doesn't work twice.
    expect(
      (
        await server("mcp_portal_page_sign_in", [
          access,
          await codeHash(access, code),
          hex(41),
          false,
          null,
          null,
        ])
      ).status,
    ).toBe("expired");
  });

  it("closes the page when the inviter loses full access, and when access is revoked", async () => {
    await db.query("UPDATE mcp_company_members SET role='estimating' WHERE user_id=$1", [owner]);
    expect(await server("mcp_portal_view", [access, sessionHash, null, null])).toEqual({
      status: "closed",
    });
    expect(await server("mcp_portal_invite_open", [inviteHash])).toEqual({ status: "closed" });
    await db.query("UPDATE mcp_company_members SET role='owner' WHERE user_id=$1", [owner]);
    expect((await server("mcp_portal_view", [access, sessionHash, null, null])).status).toBe("ok");
    await expect(member("mcp_portal_revoke", [job, access], outsider)).rejects.toThrow();
    await member("mcp_portal_revoke", [job, access]);
    expect(await server("mcp_portal_view", [access, sessionHash, null, null])).toEqual({
      status: "signed_out",
    });
    expect(await server("mcp_portal_invite_open", [inviteHash])).toEqual({ status: "revoked" });
  });
});

describe.sequential("customer page pay applications", () => {
  const invite2 = "B".repeat(43);
  const session2 = "T".repeat(43);
  let inviteHash2 = "";
  let sessionHash2 = "";
  let access2 = "";
  const app = crypto.randomUUID();
  let version = 0;
  const billing = (action: string, p: Record<string, unknown>, user = owner) =>
    member("mcp_billing_evidence_record", [job2, action, JSON.stringify(p)], user);
  // Every private field carries SECRET, so a leak shows in the customer's JSON.
  const body = async (state: string, reason = "") => {
    const ctx = await billing("payment_application_read", {});
    const a = applicationFixture();
    a.snapshot = ctx.snapshot;
    return {
      ...a,
      number: "7",
      state,
      reason,
      source: "SECRET SOURCE progress walk",
      retainage_basis: "SECRET RETAINAGE TERMS",
      lines: a.lines.map((l) => ({ ...l, stored_basis: "SECRET STORED BASIS" })),
    };
  };
  const save = async (state: string, reason = "") => {
    const p = {
      id: app,
      request_id: crypto.randomUUID(),
      expected_version: version,
      application: await body(state, reason),
    };
    const r = await billing("payment_application_review", p);
    const saved = await billing("payment_application_save", { ...p, review_key: r.review_key });
    version = saved.version;
    return saved;
  };
  const due = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const share = (expected: number | null, dueOn: string | null = due, user = owner) =>
    member("mcp_portal_share_pay_app", [job2, null, "7", expected, dueOn], user);
  const decide = (item: string, decision: string, code: string | null, fp: string) =>
    server("mcp_portal_decide", [
      access2,
      sessionHash2,
      item,
      decision,
      null,
      code,
      "Rosa Delgado",
      decision === "approved"
        ? "I approve Payment Application 7."
        : "I decline Payment Application 7.",
      fp,
      decision === "declined" ? "Retainage looks high" : null,
      "203.0.113.9",
      "test",
    ]);
  const view = () => server("mcp_portal_view", [access2, sessionHash2, null, null]);

  beforeAll(async () => {
    inviteHash2 = await tokenHash(invite2);
    sessionHash2 = await tokenHash(session2);
    const r = await member("mcp_portal_invite", [
      job2,
      "rosa@example.com",
      "Rosa Delgado",
      inviteHash2,
      new Date(Date.now() + 86_400_000).toISOString(),
    ]);
    access2 = r.access_id;
    const code = await codeHash(access2, "246810");
    await server("mcp_portal_code_issue", [access2, "sign_in", code, inviteHash2, null, null]);
    expect(
      (await server("mcp_portal_sign_in", [inviteHash2, code, sessionHash2, false, null, null]))
        .status,
    ).toBe("ok");
  });

  let shared: J;
  it("shares only a finished, current pay application, by its number, to full-access members", async () => {
    await save("draft");
    await expect(share(null)).rejects.toThrow(/ready or submitted/);
    await save("submitted", "SECRET REASON: issue to owner");
    expect(version).toBe(2);
    await expect(share(1)).rejects.toThrow(/changed/);
    await expect(share(null, "2001-01-01")).rejects.toThrow(/approve-by/);
    await expect(share(null, due, outsider)).rejects.toThrow();
    await expect(member("mcp_portal_share_pay_app", [job, app, null, null, null])).rejects.toThrow(
      /not on this job/,
    );
    shared = await share(2);
    expect(shared).toMatchObject({
      kind: "pay_app",
      application_id: app,
      version: 2,
      label: "Payment Application 7",
      due_on: due,
      company: "Northline Builders",
      job_name: "Harbor Point Garage",
    });
    expect(shared.recipients).toEqual([
      { access_id: access2, email: "rosa@example.com", name: "Rosa Delgado" },
    ]);
    // The whole frozen view, field for field: nothing else from the application reaches the owner.
    expect(shared.view).toEqual({
      number: "Payment Application 7",
      period_start: "2026-01-01",
      period_end: "2026-01-31",
      original_contract_cents: 10000000,
      approved_changes_cents: 0,
      contract_total_cents: 10000000,
      lines: [
        {
          item: "01",
          description: "Construction work",
          scheduled_cents: 10000000,
          previous_cents: 0,
          this_period_cents: 1000000,
          stored_cents: 500000,
          completed_to_date_cents: 1500000,
          percent_complete: 15,
        },
      ],
      totals: {
        completed_and_stored_cents: 1500000,
        retainage_percent: 10,
        retainage_cents: 150000,
        previous_certified_cents: 0,
        current_due_cents: 1350000,
      },
    });
  });

  it("shows the pay application to the customer with no private field", async () => {
    const v = await view();
    expect(portalViewSchema.safeParse(v).success).toBe(true);
    const item = v.items.find((i: J) => i.id === shared.item_id);
    expect(item).toMatchObject({
      kind: "pay_app",
      due_on: due,
      fingerprint: shared.fingerprint,
      decision: null,
    });
    const s = JSON.stringify(v);
    for (const secret of [
      "SECRET",
      "fee_pct",
      "provenance",
      "working_intent",
      "sov_facts",
      "bps",
      "evidence",
      owner,
    ])
      expect(s, secret).not.toContain(secret);
    expect((await member("mcp_portal_list", [job2])).items[0]).toMatchObject({
      kind: "pay_app",
      label: "Payment Application 7",
    });
  });

  it("refuses a view with an extra field, in the database and on the page", async () => {
    await expect(
      db.query("SELECT mcp_private.portal_pay_app_view_check($1::jsonb)", [
        JSON.stringify({ ...shared.view, fee_pct: 10 }),
      ]),
    ).rejects.toThrow(/whitelist/);
    const line = { ...shared.view.lines[0], cost_cents: 1 };
    await expect(
      db.query("SELECT mcp_private.portal_pay_app_view_check($1::jsonb)", [
        JSON.stringify({ ...shared.view, lines: [line] }),
      ]),
    ).rejects.toThrow(/whitelist/);
    await db.query("SELECT mcp_private.portal_pay_app_view_check($1::jsonb)", [
      JSON.stringify(shared.view),
    ]);
    // A stored view that grew a field is refused by the page's own schema.
    await db.query("UPDATE mcp_portal_items SET view = view || '{\"fee_pct\":10}' WHERE id=$1", [
      shared.item_id,
    ]);
    expect(portalViewSchema.safeParse(await view()).success).toBe(false);
    await db.query("UPDATE mcp_portal_items SET view = view - 'fee_pct' WHERE id=$1", [
      shared.item_id,
    ]);
    expect(portalViewSchema.safeParse(await view()).success).toBe(true);
  });

  it("declines without a code, and the decided version can't be shared again", async () => {
    expect((await decide(shared.item_id, "declined", null, hex(7))).status).toBe("changed");
    const r = await decide(shared.item_id, "declined", null, shared.fingerprint);
    expect(r).toMatchObject({
      status: "ok",
      label: "Payment Application 7",
      pm_email: "pat@example.com",
    });
    const d = (
      await db.query<Row>("SELECT * FROM mcp_portal_decisions WHERE item_id=$1", [shared.item_id])
    ).rows[0]!;
    expect(d).toMatchObject({
      decision: "declined",
      code_verified: false,
      note: "Retainage looks high",
    });
    await expect(share(2)).rejects.toThrow(/already decided/);
    const rec = await db.query<Row>(
      "SELECT kind, ref_table, ref_id FROM mcp_project_record_events WHERE job_id=$1 ORDER BY occurred_at DESC LIMIT 1",
      [job2],
    );
    expect(rec.rows[0]).toMatchObject({
      kind: "pay_application_customer_decline",
      ref_table: "mcp_payment_applications",
      ref_id: app,
    });
  });

  it("hides a shared version once the application is revised", async () => {
    await save("submitted", "SECRET REASON: revised after the owner's note");
    const again = await share(null);
    expect(again.version).toBe(3);
    expect((await view()).items.map((i: J) => i.id)).toContain(again.item_id);
    await save("submitted", "SECRET REASON: one more fix");
    expect((await view()).items.map((i: J) => i.id)).not.toContain(again.item_id);
    const code = await codeHash(access2, "135790");
    expect(
      (
        await server("mcp_portal_code_issue", [
          access2,
          "decide",
          code,
          null,
          sessionHash2,
          again.item_id,
        ])
      ).status,
    ).toBe("ok");
    expect((await decide(again.item_id, "approved", code, again.fingerprint)).status).toBe(
      "changed",
    );
  });

  it("approves the current version with a fresh emailed code, and changes no billing", async () => {
    const before = await db.query(
      "SELECT count(*)::int AS n FROM mcp_payment_application_versions WHERE application_id=$1",
      [app],
    );
    const billed = await db.query(
      "SELECT version, status FROM mcp_billing_invoice_versions WHERE invoice_id=$1 ORDER BY version",
      [app],
    );
    // The member shares it from chat: customer_portal share_pay_app, by number, after their yes.
    await expect(
      tool({ action: "share_pay_app", job_number: "2716", application_number: "7" }),
    ).rejects.toThrow(/confirm/);
    const shareTool = await tool({
      action: "share_pay_app",
      job_number: "2716",
      application_number: "7",
      expected_version: 4,
      due_on: due,
      notify: false,
      confirmed: true,
    });
    expect(shareTool.content[0]!.text).toContain(
      "Shared Payment Application 7 (version 4) for the customer's approval: $13,500.00 due",
    );
    expect(shareTool.content[0]!.text).not.toContain("SECRET");
    const cur = (await view()).items.find((i: J) => i.id === shareTool.structuredContent!.item_id);
    expect(cur).toMatchObject({ kind: "pay_app", due_on: due });
    cur.item_id = cur.id;
    expect((await decide(cur.item_id, "approved", null, cur.fingerprint)).status).toBe("expired");
    const code = await codeHash(access2, "975310");
    await server("mcp_portal_code_issue", [
      access2,
      "decide",
      code,
      null,
      sessionHash2,
      cur.item_id,
    ]);
    expect((await decide(cur.item_id, "approved", code, hex(8))).status).toBe("changed");
    const ok = await decide(cur.item_id, "approved", code, cur.fingerprint);
    expect(ok).toMatchObject({
      status: "ok",
      label: "Payment Application 7",
      customer: "Rosa Delgado",
    });
    expect((await decide(cur.item_id, "approved", code, cur.fingerprint)).status).toBe("not_open");
    const v = await view();
    expect(v.items.find((i: J) => i.id === cur.item_id).decision).toMatchObject({
      decision: "approved",
      typed_name: "Rosa Delgado",
      code_verified: true,
    });
    // The page records the owner's decision only: no new application version, certificate or invoice.
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM mcp_payment_application_versions WHERE application_id=$1",
          [app],
        )
      ).rows,
    ).toEqual(before.rows);
    expect(
      (
        await db.query(
          "SELECT version, status FROM mcp_billing_invoice_versions WHERE invoice_id=$1 ORDER BY version",
          [app],
        )
      ).rows,
    ).toEqual(billed.rows);
    const listed = await member("mcp_portal_list", [job2]);
    expect(listed.items.find((i: J) => i.item_id === cur.item_id).decision).toMatchObject({
      decision: "approved",
      email: "rosa@example.com",
    });
  });

  it("reads a plain saved number as a number, and labels exactly what was shared", async () => {
    const one = async (sql: string, n: string) => (await db.query<Row>(sql, [n])).rows[0]!.v;
    const plain = (n: string) => one("SELECT mcp_private.portal_pay_app_plain($1) AS v", n);
    const label = (n: string) => one("SELECT mcp_private.portal_pay_app_label($1) AS v", n);
    for (const n of [
      "2",
      "#2",
      " 12 ",
      "Pay application 2",
      "Payment Application 2",
      "application #3",
      "Pay app 4",
    ])
      expect(await plain(n), n).toBe(true);
    for (const n of ["WC-2810-PA-NOV-2026-DRAFT", "2026-11", "PA-2", "Draft 2", "", "12345"])
      expect(await plain(n), n).toBe(false);
    expect(await label("2")).toBe("Payment Application 2");
    expect(await label("#3")).toBe("Payment Application 3");
    expect(await label("Progress Billing 2 - November")).toBe("Progress Billing 2 - November");
    expect(payAppLabel("2")).toBe("Payment Application 2");
    expect(payAppLabel("Progress Billing 2 - November")).toBe("Progress Billing 2 - November");
  });

  it("pre-fills Payment Application and the number, shares exactly the name confirmed, and keeps the saved number", async () => {
    // An application saved under a code-like number (as older drafts were), billed after work invoiced outside Athena.
    // Set up directly: a second saved application would have to carry the first forward, which isn't what this tests.
    const coded = crypto.randomUUID();
    const number = "WC-2716-PA-NOV-2026-DRAFT";
    await db.query(
      `INSERT INTO mcp_payment_applications (id, job_id, company_id, number, created_by)
       SELECT $1, job_id, company_id, $2, created_by FROM mcp_payment_applications WHERE id = $3`,
      [coded, number, app],
    );
    await db.query(
      `INSERT INTO mcp_payment_application_versions (application_id, version, job_id, body, calculation, billing_version, recorded_by)
       SELECT $1, 1, job_id, body || jsonb_build_object('number', $2::text, 'prior_mode', 'external'), calculation, billing_version, recorded_by
         FROM mcp_payment_application_versions WHERE application_id = $3 ORDER BY version DESC LIMIT 1`,
      [coded, number, app],
    );
    const shareAs = (name: string | null) =>
      member("mcp_portal_share_pay_app", [job2, coded, null, null, due, name]);
    // Before the member confirms, Athena pre-fills the full name for them to keep or change.
    expect(await member("mcp_portal_pay_app_name", [job2, coded, null])).toMatchObject({
      saved_number: number,
      shared_name: null,
      suggested_name: "Payment Application 2",
    });
    await expect(
      tool({ action: "share_pay_app", job_number: "2716", application_id: coded, due_on: due }),
    ).rejects.toThrow(
      /pre-filled as "Payment Application 2".*keep it or type any name.*Nothing was shared/,
    );
    await expect(
      member("mcp_portal_pay_app_name", [job2, coded, null], outsider),
    ).rejects.toThrow();
    // Left unnamed, the code never reaches the customer.
    await expect(
      member("mcp_portal_share_pay_app", [job2, coded, null, null, due]),
    ).rejects.toThrow(
      /saved as "WC-2716-PA-NOV-2026-DRAFT".*pre-filled as "Payment Application 2".*client_number.*Nothing was shared/,
    );
    await expect(shareAs("x".repeat(61))).rejects.toThrow(/60 characters/);
    // The member keeps the pre-filled name; the page, the label and the emails all use it.
    const named = await tool({
      action: "share_pay_app",
      job_number: "2716",
      application_id: coded,
      client_number: "Payment Application 2",
      due_on: due,
      notify: false,
      confirmed: true,
    });
    const text = named.content[0]!.text;
    expect(text).toContain("Shared Payment Application 2 (version 1)");
    expect(text).not.toContain(number);
    const item = named.structuredContent!.item_id as string;
    const first = (await view()).items.find((i: J) => i.id === item);
    expect(first.view.number).toBe("Payment Application 2");
    expect(JSON.stringify(first)).not.toContain(number);
    // A re-share without a name keeps the name it was shared under.
    const again = await shareAs(null);
    expect(again).toMatchObject({ item_id: item, label: "Payment Application 2" });
    expect(again.fingerprint).toBe(first.fingerprint);
    expect(await member("mcp_portal_pay_app_name", [job2, coded, null])).toMatchObject({
      shared_name: "Payment Application 2",
      suggested_name: "Payment Application 2",
    });
    // Any name the member types is shown exactly; renaming an undecided share moves its view and fingerprint.
    const renamed = await shareAs("Progress Billing 2 - November");
    expect(renamed).toMatchObject({ item_id: item, label: "Progress Billing 2 - November" });
    expect(renamed.fingerprint).not.toBe(first.fingerprint);
    const shown = (await view()).items.find((i: J) => i.id === item);
    expect(shown).toMatchObject({ fingerprint: renamed.fingerprint });
    expect(shown.view.number).toBe("Progress Billing 2 - November");
    expect((await decide(item, "declined", null, first.fingerprint)).status).toBe("changed");
    // A bare number is stored as the full name.
    expect(await shareAs("3")).toMatchObject({ label: "Payment Application 3" });
    expect(
      (await member("mcp_portal_list", [job2])).items.find((i: J) => i.item_id === item),
    ).toMatchObject({ label: "Payment Application 3" });
    // The saved pay application keeps its own number.
    const saved = await db.query<Row>(
      "SELECT DISTINCT body->>'number' AS n FROM mcp_payment_application_versions WHERE application_id=$1",
      [coded],
    );
    expect(saved.rows).toEqual([{ n: number }]);
  });
});

describe.sequential("customer_portal tool", () => {
  it("asks for the member's yes before any write", async () => {
    await expect(
      tool({ action: "invite", email: "sam@example.com", name: "Sam Owner" }),
    ).rejects.toThrow(/confirm/);
    await expect(tool({ action: "post_update", title: "T", body: "B" })).rejects.toThrow(/confirm/);
  });

  it("won't invite while customer email is off, then invites and hands back the link when the email fails", async () => {
    const before = process.env.ATHENA_PORTAL_EMAIL_ENABLED;
    try {
      delete process.env.ATHENA_PORTAL_EMAIL_ENABLED;
      await expect(
        tool({ action: "invite", email: "sam@example.com", name: "Sam Owner", confirmed: true }),
      ).rejects.toThrow(/turned off/);
      process.env.ATHENA_PORTAL_EMAIL_ENABLED = "true";
      const key = process.env.RESEND_API_KEY;
      delete process.env.RESEND_API_KEY;
      const r = await tool({
        action: "invite",
        email: "sam@example.com",
        name: "Sam Owner",
        confirmed: true,
      });
      if (key !== undefined) process.env.RESEND_API_KEY = key;
      expect(r.structuredContent).toMatchObject({
        email: "sam@example.com",
        invited: true,
        email_sent: false,
      });
      expect(r.content[0]!.text).toMatch(/https:\/\/app\.meetathena\.io\/c\/i\/[A-Za-z0-9_-]{43}/);
    } finally {
      if (before === undefined) delete process.env.ATHENA_PORTAL_EMAIL_ENABLED;
      else process.env.ATHENA_PORTAL_EMAIL_ENABLED = before;
    }
  });

  it("lists customers and every decision", async () => {
    const r = await tool({ action: "list" });
    const text = r.content[0]!.text;
    expect(text).toContain("Sam Owner <sam@example.com>");
    expect(text).toContain("approved by Rosa Delgado <rosa@example.com>");
    expect(text).toContain("chose better by Rosa Delgado");
    expect(text).not.toContain("Rosa Delgado <rosa@example.com> ·");
  });

  it("posts an update without emailing when notify is false", async () => {
    const r = await tool({
      action: "post_update",
      title: "Paint starts Monday",
      body: "Walls get primer.",
      week_of: "2026-11-09",
      notify: false,
      confirmed: true,
    });
    expect(r.content[0]!.text).toContain('Posted "Paint starts Monday"');
  });

  it("refuses members without full job access", async () => {
    await expect(tool({ action: "list" }, outsider)).rejects.toThrow();
  });
});

describe.sequential("client messages", () => {
  const superOn = "00000000-0000-4000-8000-000000000c04";
  const inviteM = "C".repeat(43);
  const sessionM = "U".repeat(43);
  let sessM = "";
  let accessM = "";
  let item = "";
  let fingerprint = "";
  const post = (body: string, about: string | null = null, sess = sessM) =>
    server("mcp_portal_message_post", [accessM, sess, about, body, "203.0.113.9", "test"]);

  beforeAll(async () => {
    await db.query("INSERT INTO auth.users(id,email) VALUES ($1,'super@example.com')", [superOn]);
    await db.query("INSERT INTO test_active_members VALUES ($1)", [superOn]);
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'super','Sam Super')",
      [company, superOn],
    );
    await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
      job2,
      superOn,
      owner,
    ]);
    const r = await member("mcp_portal_invite", [
      job2,
      "lee@example.com",
      "Lee Park",
      await tokenHash(inviteM),
      new Date(Date.now() + 86_400_000).toISOString(),
    ]);
    accessM = r.access_id;
    const code = await codeHash(accessM, "135790");
    await server("mcp_portal_code_issue", [
      accessM,
      "sign_in",
      code,
      await tokenHash(inviteM),
      null,
      null,
    ]);
    sessM = await tokenHash(sessionM);
    expect(
      (
        await server("mcp_portal_sign_in", [
          await tokenHash(inviteM),
          code,
          sessM,
          false,
          null,
          null,
        ])
      ).status,
    ).toBe("ok");
    const it = await db.query<{ id: string; fingerprint: string }>(
      "SELECT id, fingerprint FROM mcp_portal_items WHERE job_id=$1 AND withdrawn_at IS NULL ORDER BY shared_at LIMIT 1",
      [job2],
    );
    item = it.rows[0]!.id;
    fingerprint = it.rows[0]!.fingerprint;
  });

  it("lets the signed-in client write about the job or a shared item, and never changes the item", async () => {
    expect(await post("Hi", null, hex(7))).toEqual({ status: "signed_out" });
    expect((await post("   ")).status).toBe("invalid");
    expect((await post("x".repeat(4001))).status).toBe("invalid");
    // An item from another job is refused.
    const otherItem = (
      await db.query<{ id: string }>("SELECT id FROM mcp_portal_items WHERE job_id=$1 LIMIT 1", [
        job,
      ])
    ).rows[0]!.id;
    expect((await post("About this?", otherItem)).status).toBe("invalid");

    const general = await post("When does paint start?");
    expect(general).toMatchObject({
      status: "ok",
      job_id: job2,
      job_number: "2716",
      customer: "Lee Park",
      item_id: null,
      about_label: null,
    });
    const about = await post("Why is retainage 10%?", item);
    expect(about).toMatchObject({ status: "ok", item_id: item, about_kind: "pay_app" });
    expect(about.about_label).toMatch(/Payment Application|Progress Billing/);
    const after = await db.query<{ fingerprint: string }>(
      "SELECT fingerprint FROM mcp_portal_items WHERE id=$1",
      [item],
    );
    expect(after.rows[0]!.fingerprint).toBe(fingerprint);
    // The page server records the notice the board reads.
    const n = await server("mcp_job_notice_record", [
      job2,
      "client_message",
      "client_question",
      "Lee Park asked about the pay application",
      "Why is retainage 10%?",
      "Lee Park",
      "mcp_portal_messages",
      about.message_id,
      JSON.stringify({ access_id: accessM }),
      "messages",
      `portal-message:${about.message_id}`,
    ]);
    // The job's PM and the owner hear about client messages.
    expect(n.recipients.map((r: J) => r.email).sort()).toEqual([
      "01@example.com",
      "02@example.com",
    ]);

    const thread = await server("mcp_portal_messages", [accessM, sessM, false]);
    expect(thread).toMatchObject({ status: "ok", unread: 0 });
    expect(thread.messages.map((m: J) => m.body)).toEqual([
      "When does paint start?",
      "Why is retainage 10%?",
    ]);
    expect(portalMessagesSchema.safeParse(thread).success).toBe(true);
    expect(JSON.stringify(thread)).not.toMatch(/author_user_id|team_read|email/);
  });

  it("shows the board every thread, and a full-access member replies", async () => {
    const l = await member("mcp_job_messages_list", [job2], pm);
    expect(l).toMatchObject({ job_number: "2716", awaiting_reply: 2 });
    const t = l.threads.find((x: J) => x.access_id === accessM);
    expect(t).toMatchObject({ customer_name: "Lee Park", customer_email: "lee@example.com" });
    const asked = t.messages.find((m: J) => m.item_id === item);
    expect(asked).toMatchObject({ about_kind: "pay_app", read: false });
    expect(asked.notice_id).toBeTruthy();

    await expect(member("mcp_job_message_reply", [job2, accessM, "  ", null], pm)).rejects.toThrow(
      /4,000/,
    );
    const r = await member(
      "mcp_job_message_reply",
      [job2, accessM, "Retainage is held until the job is accepted.", item],
      pm,
    );
    expect(r).toMatchObject({
      author_name: "Pat Lee",
      customer_email: "lee@example.com",
      company: "Northline Builders",
      item_id: item,
      job_number: "2716",
    });
    expect(JSON.stringify(r)).not.toMatch(/cost|markup|fee_pct/);
    const after = await member("mcp_job_messages_list", [job2], pm);
    expect(after.awaiting_reply).toBe(0);
    // The replier's notice for that question is read; the owner's stays unread.
    const mine = after.threads[0].messages.find((m: J) => m.id === asked.id);
    expect(mine.read).toBe(true);
    const owners = await member("mcp_job_messages_list", [job2], owner);
    expect(owners.threads[0].messages.find((m: J) => m.id === asked.id).read).toBe(false);

    // The client sees the reply once, then it counts as read.
    expect((await server("mcp_portal_messages", [accessM, sessM, false])).unread).toBe(1);
    const opened = await server("mcp_portal_messages", [accessM, sessM, true]);
    expect(opened.unread).toBe(1);
    expect(opened.messages.at(-1)).toMatchObject({ author_kind: "team", author_name: "Pat Lee" });
    expect((await server("mcp_portal_messages", [accessM, sessM, false])).unread).toBe(0);
  });

  it("refuses outsiders, supers and the client side for members", async () => {
    await expect(member("mcp_job_messages_list", [job2], outsider)).rejects.toThrow(/full access/);
    await expect(member("mcp_job_messages_list", [job2], superOn)).rejects.toThrow(/full access/);
    await expect(
      member("mcp_job_message_reply", [job2, accessM, "Hello", null], superOn),
    ).rejects.toThrow(/full access/);
    await expect(
      member("mcp_job_message_reply", [job2, accessM, "Hello", null], outsider),
    ).rejects.toThrow(/full access/);
    // A customer access from another job can't be replied to through this one.
    await expect(member("mcp_job_message_reply", [job, accessM, "Hello", null])).rejects.toThrow(
      /isn't on this job/,
    );
    await expect(
      member("mcp_portal_message_post", [accessM, sessM, null, "x", null, null]),
    ).rejects.toThrow(/permission denied/);
    await expect(member("mcp_portal_messages", [accessM, sessM, false])).rejects.toThrow(
      /permission denied/,
    );
    await expect(as(owner)("SELECT * FROM public.mcp_portal_messages")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("holds a client to 20 messages an hour", async () => {
    for (let i = 0; i < 18; i++) expect((await post(`Note ${i}`)).status).toBe("ok");
    expect((await post("One too many")).status).toBe("slow_down");
    // Team replies don't count toward the client's limit.
    await member("mcp_job_message_reply", [job2, accessM, "Got them all.", null], pm);
    expect((await post("Still too many")).status).toBe("slow_down");
  });

  it("gives the page server the job of the client's own decision only", async () => {
    const d = await db.query<{ id: string; access_id: string }>(
      "SELECT d.id, d.access_id FROM mcp_portal_decisions d JOIN mcp_portal_items i ON i.id=d.item_id WHERE i.job_id=$1 LIMIT 1",
      [job2],
    );
    const dec = d.rows[0]!;
    const sess2 = await tokenHash("T".repeat(43));
    expect(await server("mcp_portal_decision_job", [dec.access_id, sess2, dec.id])).toBe(job2);
    expect(await server("mcp_portal_decision_job", [accessM, sessM, dec.id])).toBeNull();
    expect(await server("mcp_portal_decision_job", [dec.access_id, hex(5), dec.id])).toBeNull();
    await expect(member("mcp_portal_decision_job", [dec.access_id, sess2, dec.id])).rejects.toThrow(
      /permission denied/,
    );
  });

  it("lets Athena read the messages and reply only after the member's yes", async () => {
    const list = await tool({ job_number: "2716", action: "messages_list" }, pm);
    expect(list.content[0]!.text).toContain("Lee Park <lee@example.com>");
    expect(list.content[0]!.text).toContain("Got them all.");
    await expect(
      tool({ job_number: "2716", action: "message_reply", access_id: accessM, body: "Yes." }, pm),
    ).rejects.toThrow(/Lee Park <lee@example.com>.*confirm/);
    const before = (await member("mcp_job_messages_list", [job2], pm)).threads[0].messages.length;
    const r = await tool(
      {
        job_number: "2716",
        action: "message_reply",
        access_id: accessM,
        body: "Paint starts Monday.",
        confirmed: true,
      },
      pm,
    );
    expect(r.content[0]!.text).toContain("Replied to Lee Park");
    const after = (await member("mcp_job_messages_list", [job2], pm)).threads[0].messages;
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)).toMatchObject({ author_kind: "team", body: "Paint starts Monday." });
    await expect(tool({ job_number: "2716", action: "messages_list" }, outsider)).rejects.toThrow();
  });

  it("emails the owner every notice the PM would get when the job has no PM", async () => {
    const noPm = "00000000-0000-4000-8000-000000000c29";
    await db.query(
      "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name,time_zone) VALUES($1,$2,$3,'2719','No PM Yet','America/Chicago')",
      [noPm, owner, company],
    );
    const record = async (jobId: string, key: string) =>
      (
        await server("mcp_job_notice_record", [
          jobId,
          "client_decision",
          "co_approved",
          "Lee Park approved CO-001",
          null,
          "Lee Park",
          null,
          null,
          "{}",
          "cos",
          key,
        ])
      ).recipients.map((r: J) => r.email);
    // With a PM, a client's decision goes to the PM only.
    expect(await record(job2, "fallback-1")).toEqual(["02@example.com"]);
    // No PM at all, or a PM saved as a name with no email: the owner gets it.
    expect(await record(noPm, "fallback-2")).toEqual(["01@example.com"]);
    await db.query("UPDATE mcp_jobs SET pm_name='Sam Contact' WHERE id=$1", [noPm]);
    expect(await record(noPm, "fallback-3")).toEqual(["01@example.com"]);
    // An owner's own choice on the job still wins.
    await member("mcp_job_notice_prefs_set", [noPm, "owner", "client_decision", false]);
    expect(await record(noPm, "fallback-4")).toEqual([]);
    await db.query("DELETE FROM mcp_job_notice_prefs WHERE job_id=$1", [noPm]);
    // Once the PM has an email, the owner goes back to client messages only.
    await db.query("UPDATE mcp_jobs SET pm_email='sam@example.com' WHERE id=$1", [noPm]);
    expect(await record(noPm, "fallback-5")).toEqual(["sam@example.com"]);
    const prefs = await member("mcp_job_notice_prefs_get", [noPm]);
    expect(
      prefs.prefs.find((p: J) => p.role === "owner" && p.topic === "client_decision").email,
    ).toBe(false);
  });
});

describe.sequential("client payments", () => {
  const sessionP = "P".repeat(43);
  let sessP = "";
  let accessP = "";
  let item = "";
  let app = "";
  const acct = "acct_1TestNorthline";
  const pay = (sess = sessP) => server("mcp_portal_pay_start", [accessP, sess, item]);
  const update = (
    sessionId: string,
    status: string,
    pi: string | null = null,
    amount: number | null = null,
    account = acct,
  ) =>
    server("mcp_portal_pay_update", [
      sessionId,
      account,
      status,
      pi,
      pi ? "ch_" + pi.slice(3) : null,
      pi ? "us_bank_account" : null,
      amount,
      pi ? 3375 : null,
      pi ? "2026-11-06T15:00:00Z" : null,
    ]);

  beforeAll(async () => {
    await db.exec(
      readFileSync("supabase/migrations/20261105190000_athena_client_payments.sql", "utf8"),
    );
    // The approved pay application from the pay application tests, and Rosa's access on that job.
    const r = await db.query<{ id: string; ref_id: string; access_id: string }>(
      `SELECT i.id, i.ref_id, d.access_id FROM mcp_portal_items i JOIN mcp_portal_decisions d ON d.item_id = i.id
        WHERE i.job_id = $1 AND i.kind = 'pay_app' AND d.decision = 'approved' ORDER BY i.shared_at DESC LIMIT 1`,
      [job2],
    );
    item = r.rows[0]!.id;
    app = r.rows[0]!.ref_id;
    accessP = r.rows[0]!.access_id;
    sessP = await tokenHash(sessionP);
    await db.query(
      "INSERT INTO mcp_portal_sessions(access_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')",
      [accessP, sessP],
    );
  });

  it("lets only an owner connect, and shows members the setup without account ids", async () => {
    await expect(
      server("mcp_client_payments_account_save", [company, "test", acct, "action_required", pm]),
    ).rejects.toThrow(/owner/);
    expect(await member("mcp_client_payments_get", [company], pm)).toMatchObject({
      can_manage: false,
      test: { connected: false, status: "not_connected" },
      ready: false,
    });
    await server("mcp_client_payments_account_save", [
      company,
      "test",
      acct,
      "action_required",
      owner,
    ]);
    await expect(
      server("mcp_client_payments_account_save", [
        company,
        "test",
        "acct_1Someoneelse",
        "ready",
        owner,
      ]),
    ).rejects.toThrow(/already has/);
    const got = await member("mcp_client_payments_get", [company]);
    expect(got).toMatchObject({
      can_manage: true,
      mode: "test",
      test: { connected: true, status: "action_required" },
    });
    expect(JSON.stringify(got)).not.toContain("acct_");
    await expect(member("mcp_client_payments_get", [company], outsider)).rejects.toThrow();
    await expect(
      member("mcp_client_payments_settings", [company, false, true, 500000], pm),
    ).rejects.toThrow(/owner/);
    await expect(
      member("mcp_client_payments_settings", [company, false, false, 500000]),
    ).rejects.toThrow(/one way/);
    expect(
      await member("mcp_client_payments_settings", [company, true, true, 500000]),
    ).toMatchObject({
      card_max_cents: 500000,
    });
    await expect(server("mcp_client_payments_set_mode", [company, "live", owner])).rejects.toThrow(
      /live setup/,
    );
  });

  it("takes payment only once Stripe says the account is ready, on an approved pay app", async () => {
    expect(await pay()).toEqual({ status: "not_accepting" });
    expect(await pay(hex(9))).toEqual({ status: "signed_out" });
    expect(
      await server("mcp_client_payments_account_status", [acct, false, "ready"]),
    ).toMatchObject({
      status: "ok",
      company_id: company,
    });
    expect(
      await server("mcp_client_payments_account_status", ["acct_1Unknown", false, "ready"]),
    ).toEqual({
      status: "unknown_account",
    });
    const start = await pay();
    // $13,500.00 is over the $5,000 card limit, so only bank is offered.
    expect(start).toMatchObject({
      status: "ok",
      mode: "test",
      account_id: acct,
      amount_cents: 1350000,
      card: false,
      bank: true,
      label: "Payment Application 7",
      open_session: null,
    });
    const state = await server("mcp_portal_payments_state", [accessP, sessP]);
    expect(state).toMatchObject({ status: "ok", accepting: true, test: true, payments: [] });
  });

  it("books a bank payment once: processing, then paid, applied to the pay application", async () => {
    await server("mcp_portal_pay_opened", [
      item,
      accessP,
      "test",
      acct,
      "cs_test_first",
      ["us_bank_account"],
      1350000,
      3375,
    ]);
    expect((await pay()).open_session).toMatchObject({ checkout_session_id: "cs_test_first" });
    // A new session replaces the open one.
    await server("mcp_portal_pay_opened", [
      item,
      accessP,
      "test",
      acct,
      "cs_test_second",
      ["us_bank_account"],
      1350000,
      3375,
    ]);
    expect(
      (
        await db.query(
          "SELECT checkout_session_id, status FROM mcp_portal_payments WHERE item_id=$1 ORDER BY created_at",
          [item],
        )
      ).rows,
    ).toEqual([
      { checkout_session_id: "cs_test_first", status: "expired" },
      { checkout_session_id: "cs_test_second", status: "open" },
    ]);
    await expect(update("cs_test_second", "paid", "pi_test_second", 1349999)).rejects.toThrow(
      /amount/,
    );
    await expect(
      update("cs_test_second", "paid", "pi_test_second", 1350000, "acct_1Other"),
    ).rejects.toThrow(/account/);
    expect(await update("cs_test_second", "processing", "pi_test_second", 1350000)).toMatchObject({
      status: "changed",
      payment_status: "processing",
      booked: false,
    });
    expect((await pay()).status).toBe("already_paid");
    const paid = await update("cs_test_second", "paid", "pi_test_second", 1350000);
    expect(paid).toMatchObject({
      status: "changed",
      payment_status: "paid",
      was: "processing",
      booked: true,
      applied: true,
      customer: "Rosa Delgado",
      job_number: "2716",
      test: true,
    });
    expect((await update("cs_test_second", "paid", "pi_test_second", 1350000)).status).toBe(
      "unchanged",
    );
    const receipt = (
      await db.query<Row>(
        "SELECT amount_cents, source FROM mcp_billing_receipts WHERE job_id=$1 AND source LIKE 'Client page payment%'",
        [job2],
      )
    ).rows;
    expect(receipt).toEqual([
      {
        amount_cents: 1350000,
        source: "Client page payment pi_test_second (Stripe test mode) for Payment Application 7",
      },
    ]);
    expect(
      (
        await db.query(
          "SELECT amount_cents FROM mcp_billing_allocations WHERE invoice_id=$1 AND reversal_of IS NULL",
          [app],
        )
      ).rows,
    ).toEqual([{ amount_cents: 1350000 }]);
    const state = await server("mcp_portal_payments_state", [accessP, sessP]);
    expect(state.payments).toEqual([
      expect.objectContaining({
        item_id: item,
        status: "paid",
        method: "us_bank_account",
        amount_cents: 1350000,
        test: true,
      }),
    ]);
    const board = await member("mcp_job_payments_list", [job2]);
    expect(board[0]).toMatchObject({
      status: "paid",
      fee_cents: 3375,
      customer: "Rosa Delgado",
      label: "Payment Application 7",
    });
    await expect(member("mcp_job_payments_list", [job2], outsider)).rejects.toThrow();
  });

  it("reverses only the new part of a refund, off the pay application and then the receipt", async () => {
    expect(await server("mcp_portal_pay_refunded", ["pi_test_unknown", acct, 100])).toEqual({
      status: "unknown_payment",
    });
    expect(await server("mcp_portal_pay_refunded", ["pi_test_second", acct, 50000])).toMatchObject({
      status: "changed",
      payment_status: "partially_refunded",
      refunded_cents: 50000,
    });
    expect((await server("mcp_portal_pay_refunded", ["pi_test_second", acct, 50000])).status).toBe(
      "unchanged",
    );
    expect(
      await server("mcp_portal_pay_refunded", ["pi_test_second", acct, 1350000]),
    ).toMatchObject({
      payment_status: "refunded",
      refunded_cents: 1300000,
    });
    const alloc = await db.query<{ n: string }>(
      "SELECT sum(CASE WHEN reversal_of IS NULL THEN amount_cents ELSE -amount_cents END)::text AS n FROM mcp_billing_allocations WHERE invoice_id=$1",
      [app],
    );
    expect(alloc.rows[0]!.n).toBe("0");
    const rev = await db.query<{ n: string }>(
      "SELECT sum(r.amount_cents)::text AS n FROM mcp_billing_receipt_reversals r JOIN mcp_billing_receipts b ON b.id=r.receipt_id WHERE b.source LIKE 'Client page payment pi_test_second%'",
    );
    expect(rev.rows[0]!.n).toBe("1350000");
    await expect(
      server("mcp_portal_pay_refunded", ["pi_test_second", acct, 1350001]),
    ).rejects.toThrow(/range/);
  });

  it("handles each Stripe event once, and keeps payments out of members' direct reach", async () => {
    expect(
      await server("mcp_stripe_connect_event_claim", [
        "evt_test_1",
        "checkout.session.completed",
        false,
        acct,
      ]),
    ).toBe("fresh");
    expect(
      await server("mcp_stripe_connect_event_claim", [
        "evt_test_1",
        "checkout.session.completed",
        false,
        acct,
      ]),
    ).toBe("busy");
    await server("mcp_stripe_connect_event_finish", ["evt_test_1", false]);
    expect(
      await server("mcp_stripe_connect_event_claim", [
        "evt_test_1",
        "checkout.session.completed",
        false,
        acct,
      ]),
    ).toBe("fresh");
    await server("mcp_stripe_connect_event_finish", ["evt_test_1", true]);
    expect(
      await server("mcp_stripe_connect_event_claim", [
        "evt_test_1",
        "checkout.session.completed",
        false,
        acct,
      ]),
    ).toBe("done");
    for (const fn of [
      ["mcp_portal_pay_update", ["cs_test_second", acct, "paid", "pi_x", null, null, 1, 0, null]],
      ["mcp_portal_pay_refunded", ["pi_test_second", acct, 1]],
      ["mcp_client_payments_account_save", [company, "test", acct, "ready", owner]],
      ["mcp_stripe_connect_event_claim", ["evt_test_2", "x", false, null]],
    ] as const)
      await expect(member(fn[0], [...fn[1]])).rejects.toThrow();
    await expect(as(owner)("SELECT * FROM mcp_portal_payments")).rejects.toThrow();
    await expect(as(owner)("SELECT * FROM mcp_company_payments")).rejects.toThrow();
  });

  it("records wire and check payments on the pay application, books them like a client page payment, and voids a mistake", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const req = (n: number) => `00000000-0000-4000-8000-00000000f0${n.toString().padStart(2, "0")}`;
    const record = (
      id: string,
      method: string,
      amount: number,
      ref: string,
      user = pm,
      note: string | null = null,
    ) =>
      member("mcp_pay_app_record_payment", [job2, app, id, method, amount, today, ref, note], user);
    const applied = async () =>
      (
        await db.query<{ n: string }>(
          "SELECT coalesce(sum(CASE WHEN reversal_of IS NULL THEN amount_cents ELSE -amount_cents END),0)::text AS n FROM mcp_billing_allocations WHERE invoice_id=$1",
          [app],
        )
      ).rows[0]!.n;
    // The client page payment above was refunded in full, so the whole amount is open again.
    expect(await member("mcp_pay_app_payments", [job2, app], pm)).toMatchObject({
      status: "ok",
      can_record: true,
      net_due_cents: 1350000,
      remaining_cents: 1350000,
      recorded: [],
      online: [expect.objectContaining({ status: "refunded" })],
    });
    await expect(record(req(1), "check", 500000, "1042", outsider)).rejects.toThrow();
    await expect(record(req(1), "cash", 500000, "1042")).rejects.toThrow(/wire or check/);
    await expect(record(req(1), "check", 500000, "  ")).rejects.toThrow(/check number/);
    await expect(record(req(1), "wire", 1350001, "FW-88")).rejects.toThrow(
      /more than the \$13,500.00 left/,
    );
    expect(await record(req(1), "check", 500000, "1042", pm, "Mailed to the office")).toMatchObject(
      {
        status: "ok",
        already_recorded: false,
        remaining_cents: 850000,
      },
    );
    // A retry of the same request records nothing new; the same id for something else is refused.
    expect(await record(req(1), "check", 500000, "1042")).toMatchObject({ already_recorded: true });
    await expect(record(req(1), "check", 400000, "1042")).rejects.toThrow(/different payment/);
    await expect(record(req(2), "check", 100000, " 1042 ")).rejects.toThrow(/already recorded/);
    expect(await applied()).toBe("500000");
    const receipt = (
      await db.query<Row>(
        "SELECT amount_cents, source FROM mcp_billing_receipts WHERE job_id=$1 AND source LIKE 'Check 1042%'",
        [job2],
      )
    ).rows;
    expect(receipt).toEqual([
      { amount_cents: 500000, source: `Check 1042 for 7 (recorded ${req(1).slice(-12)})` },
    ]);
    // The client page counts it, and asks only for what's left.
    expect((await server("mcp_portal_payments_state", [accessP, sessP])).recorded).toContainEqual({
      item_id: item,
      amount_cents: 500000,
      method: "check",
      received_on: today,
    });
    expect(await pay()).toMatchObject({ status: "ok", amount_cents: 850000 });
    expect(await record(req(3), "wire", 850000, "FW-88")).toMatchObject({ remaining_cents: 0 });
    expect(await pay()).toEqual({ status: "nothing_due" });
    expect((await server("mcp_portal_payments_state", [accessP, sessP])).recorded).toContainEqual({
      item_id: item,
      amount_cents: 1350000,
      method: "mixed",
      received_on: today,
    });
    await expect(record(req(4), "wire", 1, "FW-89")).rejects.toThrow(/\$0.00 left/);
    // A mistake is voided with a reason: it comes back off the pay application and the receipt.
    const check = (await member("mcp_pay_app_payments", [job2, app], pm)).recorded.find(
      (r: J) => r.method === "check",
    );
    expect(check).toMatchObject({
      amount_cents: 500000,
      reference: "1042",
      note: "Mailed to the office",
      voided: false,
    });
    await expect(member("mcp_pay_app_void_payment", [job2, check.id, " "], pm)).rejects.toThrow(
      /why/,
    );
    await expect(
      member("mcp_pay_app_void_payment", [job2, check.id, "Entered twice"], outsider),
    ).rejects.toThrow();
    expect(
      await member("mcp_pay_app_void_payment", [job2, check.id, "Check bounced"], pm),
    ).toMatchObject({ already_voided: false });
    expect(
      await member("mcp_pay_app_void_payment", [job2, check.id, "Check bounced"], pm),
    ).toMatchObject({ already_voided: true });
    expect(await applied()).toBe("850000");
    const rev = await db.query<{ n: string }>(
      "SELECT sum(r.amount_cents)::text AS n FROM mcp_billing_receipt_reversals r JOIN mcp_billing_receipts b ON b.id=r.receipt_id WHERE b.source LIKE 'Check 1042%'",
    );
    expect(rev.rows[0]!.n).toBe("500000");
    const after = await member("mcp_pay_app_payments", [job2, app], pm);
    expect(after.remaining_cents).toBe(500000);
    expect(after.recorded.find((r: J) => r.id === check.id)).toMatchObject({
      voided: true,
      void_reason: "Check bounced",
    });
    expect(await pay()).toMatchObject({ amount_cents: 500000 });
    // The replacement check can carry the same number once the first is voided.
    expect(await record(req(5), "check", 500000, "1042")).toMatchObject({ remaining_cents: 0 });
    await expect(as(owner)("SELECT * FROM mcp_recorded_payments")).rejects.toThrow();
    await expect(member("mcp_pay_app_payments", [job2, app], outsider)).rejects.toThrow();
  });

  it("applies twice, rolls back cleanly and applies again", async () => {
    const up = readFileSync(
      "supabase/migrations/20261105190000_athena_client_payments.sql",
      "utf8",
    );
    const down = readFileSync(
      "supabase/rollbacks/20261105190000_athena_client_payments.rollback.sql",
      "utf8",
    );
    await db.exec(`BEGIN; ${up}; COMMIT;`);
    await db.exec(`BEGIN; ${down}; COMMIT;`);
    expect(
      (await db.query("SELECT to_regclass('public.mcp_portal_payments') AS t")).rows[0],
    ).toEqual({ t: null });
    await db.exec(`BEGIN; ${up}; COMMIT;`);
  });

  it("code limits apply twice, roll back cleanly and apply again", async () => {
    const up = readFileSync(
      "supabase/migrations/20261106233000_athena_portal_code_reuse.sql",
      "utf8",
    );
    const down = readFileSync(
      "supabase/rollbacks/20261106233000_athena_portal_code_reuse.rollback.sql",
      "utf8",
    );
    await db.exec(`BEGIN; ${up}; COMMIT;`);
    await db.exec(`BEGIN; ${down}; COMMIT;`);
    expect(
      (
        await db.query(
          "SELECT to_regprocedure('public.mcp_portal_code_pending(uuid,text,uuid)') AS f",
        )
      ).rows[0],
    ).toEqual({ f: null });
    await db.exec(`BEGIN; ${up}; COMMIT;`);
  });
});
