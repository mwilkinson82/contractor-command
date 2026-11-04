// Team plans on a local database: a signed-in user reads only the plan their own company is on, while the
// seat and role checks that read the table inside SECURITY DEFINER functions keep working for everyone.
/* eslint-disable @typescript-eslint/no-explicit-any -- actual PostgreSQL rows */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

let db: PGlite;
const pmOwner = "00000000-0000-4000-8000-000000000d01";
const pmMember = "00000000-0000-4000-8000-000000000d02";
const officeOwner = "00000000-0000-4000-8000-000000000d03";
const nobody = "00000000-0000-4000-8000-000000000d04";
const pmCompany = "00000000-0000-4000-8000-000000000d10";
const officeCompany = "00000000-0000-4000-8000-000000000d11";

const as = (user: string, sql: string, args: unknown[] = []) =>
  asUser(
    db,
    { sub: user, email: `${user.slice(-2)}@example.com`, role: "authenticated" },
    async (tx): Promise<any[]> => (await tx.query(sql, args)).rows,
  );
const anon = (sql: string) =>
  db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE anon");
    return (await tx.query<any>(sql)).rows;
  });
const tiers = async (user: string) =>
  (await as(user, "select tier from public.mcp_team_plans order by tier")).map((r) => r.tier);

beforeAll(async () => {
  db = await makeDb();
  await db.exec(`
    alter table auth.users add column email_confirmed_at timestamptz;
    create type app_tier as enum ('aos_only','book_buyer','power_hour','sm_school','contractor_school','intensive','circle','hardcore');
    create table profiles(id uuid primary key,email text,full_name text);
    create table user_roles(user_id uuid,role text);
    create table subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid,email text not null,
      stripe_customer_id text,stripe_subscription_id text unique,price_id text,product_id text,status text not null,
      current_period_end timestamptz,cancel_at_period_end boolean default false,is_founding boolean default false,
      is_comped boolean not null default false,metadata jsonb not null default '{}',tier app_tier default 'circle',updated_at timestamptz default now());
    create table aos_addons(user_id uuid,email text,kind text,quantity int,status text);
    create table aos_links(user_id uuid,aos_email text);
    create table stripe_webhook_events(event_id text primary key,event_type text,object_id text,status text,
      attempts int default 1,processing_started_at timestamptz,processed_at timestamptz,last_error text,updated_at timestamptz default now());
    create function has_role(uid uuid,r text) returns boolean language sql as $$ select exists(select 1 from user_roles where user_id=uid and role=r) $$;
    create function tier_rank(t app_tier) returns integer language sql as $$ select case t when 'hardcore' then 5 when 'circle' then 4 else 1 end $$;
    drop function get_circle_entitlement(uuid,text);
  `);
  const identity = readFileSync(
    "supabase/migrations/20260527182404_9674d14f-9cbd-46bd-8a50-4e651788d04d.sql",
    "utf8",
  );
  await db.exec(
    identity.slice(0, identity.indexOf("CREATE OR REPLACE FUNCTION public.has_active_access")),
  );
  for (const f of [
    "20261004190813_circle_entitlement_reconciliation",
    "20261004201435_circle_source_aliases",
    "20261021190000_athena_team_invites",
    "20261024104817_athena_circle_company_provisioning",
    "20261104180000_athena_team_plans_read_own",
  ])
    await db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"));

  for (const u of [pmOwner, pmMember, officeOwner, nobody])
    await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [
      u,
      `${u.slice(-2)}@example.com`,
    ]);
  await db.query(
    "insert into mcp_companies(id,name,created_by) values($1,'Northline Builders',$2),($3,'Harbor Electric',$4)",
    [pmCompany, pmOwner, officeCompany, officeOwner],
  );
  await db.query(
    `insert into mcp_company_members(company_id,user_id,role,display_name)
     values($1,$2,'owner','Owner'),($1,$3,'pm','PM'),($4,$5,'owner','Owner')`,
    [pmCompany, pmOwner, pmMember, officeCompany, officeOwner],
  );
  await db.query(
    "insert into mcp_company_entitlements(company_id,plan,status) values($1,'athena_pm','active'),($2,'athena_office','active')",
    [pmCompany, officeCompany],
  );
});
afterAll(async () => db?.close());

describe("team plans read their own company's plan only", () => {
  it("shows each member only the plan their company is on", async () => {
    expect(await tiers(pmOwner)).toEqual(["athena_pm"]);
    expect(await tiers(pmMember)).toEqual(["athena_pm"]);
    expect(await tiers(officeOwner)).toEqual(["athena_office"]);
  });

  it("shows a signed-in user with no company nothing, and anon cannot read at all", async () => {
    expect(await tiers(nobody)).toEqual([]);
    await expect(anon("select tier from public.mcp_team_plans")).rejects.toThrow(/permission/);
  });

  it("still lets nobody signed in change a plan", async () => {
    await expect(
      as(pmOwner, "update public.mcp_team_plans set included_seats = 99 where tier = 'athena_pm'"),
    ).rejects.toThrow(/permission/);
    await expect(
      as(pmOwner, "insert into public.mcp_team_plans(tier) values ('free_for_all')"),
    ).rejects.toThrow(/permission/);
  });

  it("keeps the role and seat checks working through their SECURITY DEFINER functions", async () => {
    const allowed = async (user: string, company: string, role: string) =>
      (await as(user, "select public.mcp_role_allowed($1,$2) as v", [company, role]))[0].v;
    expect(await allowed(pmOwner, pmCompany, "pm")).toBe(true);
    expect(await allowed(pmOwner, pmCompany, "estimating")).toBe(false);
    expect(await allowed(officeOwner, officeCompany, "estimating")).toBe(true);
    // A user outside the company still gets the right answer from the definer function.
    expect(await allowed(nobody, officeCompany, "ap")).toBe(true);
    const snap = (await as(pmOwner, "select public.mcp_seat_usage($1) as v", [pmCompany]))[0].v;
    expect(snap.tier).toBe("athena_pm");
    expect(snap.limit).toBe(6);
  });
});
