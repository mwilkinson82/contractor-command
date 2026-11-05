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
import { payAppLabel, portalViewSchema } from "./model";
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
