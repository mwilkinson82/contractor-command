/* eslint-disable @typescript-eslint/no-explicit-any -- actual PostgreSQL RPC result assertions */
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser, fakeClient } from "../../../tests/mcp-roles/fake-supabase";

import { branchGettingStarted, firstJobCard, memberJobs } from "./getting-started";
import { checkAthenaEntitlement } from "./entitlement";

let db: PGlite;
let legacyCompany: string;
let legacyBefore: unknown;
let claimCompany: string;
const claimOwner = "00000000-0000-4000-8000-000000000301";
const claimPayer = "00000000-0000-4000-8000-000000000302";
const uid = "00000000-0000-4000-8000-000000000101";
const peer = "00000000-0000-4000-8000-000000000102";
const unverified = "00000000-0000-4000-8000-000000000103";
const migration = "supabase/migrations/20261024104817_athena_circle_company_provisioning.sql";
const query = async (sql: string, args: unknown[] = []) => (await db.query<any>(sql, args)).rows;
const value = async (sql: string, args: unknown[] = []) => (await query(sql, args))[0]?.v;
const userValue = async (who: string, sql: string) =>
  asUser(
    db,
    { sub: who, email: "untrusted-jwt@example.com", role: "authenticated" },
    async (tx) => (await tx.query(sql)).rows[0]?.v,
  );
const ensure = (source: string, claim: string | null = null, reserve = false) =>
  value("select mcp_private.ensure_circle_company($1,$2,$3) as v", [source, claim, reserve]);

async function source(
  tag: string,
  user: string | null = uid,
  email = "member@example.com",
  eligible = true,
) {
  const id = await value(
    `insert into subscriptions(user_id,email,stripe_customer_id,stripe_subscription_id,status,tier,metadata)
    values($1,$2,$3,$4,'active','circle',jsonb_build_object('stripe_customer_email',$2::text)) returning id as v`,
    [user, email, `cus_${tag}`, `sub_${tag}`],
  );
  if (eligible)
    await query(
      `insert into circle_subscription_evidence values($1,now(),now()+interval '1 month',null)`,
      [`sub_${tag}`],
    );
  return id as string;
}

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
    insert into auth.users values('${uid}','member@example.com',now()),('${peer}','peer@example.com',now()),('${unverified}','unverified@example.com',null);
    insert into profiles values('${uid}','member@example.com','Fictional Builder'),('${peer}','peer@example.com','Fictional Peer');
  `);
  const identity = readFileSync(
    "supabase/migrations/20260527182404_9674d14f-9cbd-46bd-8a50-4e651788d04d.sql",
    "utf8",
  );
  await db.exec(
    identity.slice(0, identity.indexOf("CREATE OR REPLACE FUNCTION public.has_active_access")),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261004190813_circle_entitlement_reconciliation.sql",
      "utf8",
    ),
  );
  await db.exec(
    readFileSync("supabase/migrations/20261004201435_circle_source_aliases.sql", "utf8"),
  );
  await db.exec(readFileSync("supabase/migrations/20261021190000_athena_team_invites.sql", "utf8"));
  await db.exec(readFileSync(migration, "utf8"));
  await db.exec(
    readFileSync(
      "supabase/migrations/20261024110422_athena_circle_verified_payment_claim.sql",
      "utf8",
    ),
  );
  // Model an already-deployed #259/#260 company before the corrective migration.
  const existing = await source("legacy", uid);
  legacyCompany = await ensure(existing);
  await query(
    "insert into auth.users values($1,'legacy-claim-owner@example.com',now()),($2,'legacy-claim-payer@example.com',now())",
    [claimOwner, claimPayer],
  );
  const claimSource = await source("legacyclaim", claimOwner, "legacy-claim-payer@example.com");
  claimCompany = await ensure(claimSource);
  legacyBefore = await legacySnapshot();
  await db.exec(
    readFileSync("supabase/migrations/20261024124951_athena_company_onboarding_choice.sql", "utf8"),
  );
  expect(await legacySnapshot()).toEqual(legacyBefore);
}, 30000);
afterAll(async () => {
  await db?.close();
});

async function member(tag: string) {
  const id = await value(
    "insert into auth.users(id,email,email_confirmed_at) values(gen_random_uuid(),$1,now()) returning id as v",
    [`${tag}@example.com`],
  );
  return { id: id as string, email: `${tag}@example.com` };
}

function client(who: { id: string; email: string }) {
  return fakeClient(db, { sub: who.id, email: who.email, role: "authenticated" });
}

async function counts() {
  return (
    await query(`select
    (select count(*)::int from mcp_companies) companies,
    (select count(*)::int from mcp_company_members) members,
    (select count(*)::int from mcp_circle_provisioning) bindings`)
  )[0];
}

async function legacySnapshot() {
  return (
    await query(
      `select
    (select to_jsonb(c) from mcp_companies c where id=$1) company,
    (select jsonb_agg(to_jsonb(m) order by user_id) from mcp_company_members m where company_id=$1) members,
    (select to_jsonb(e) from mcp_company_entitlements e where company_id=$1) entitlement,
    (select to_jsonb(p) from mcp_circle_provisioning p where company_id=$1) binding`,
      [legacyCompany],
    )
  )[0];
}

describe("Access before explicit company onboarding", () => {
  it("paid Circle access, subscription/evidence retries and sign-in create no company", async () => {
    const who = await member("paid-onboarding");
    const before = await counts();
    const s = await source("paidonboarding", who.id, who.email);
    expect(await ensure(s)).toBeNull();
    // Even the former reserve operation must not invent a placeholder company.
    expect(await ensure(s, null, true)).toBeNull();
    await query("update subscriptions set metadata=metadata where id=$1", [s]);
    await query(
      "update circle_subscription_evidence set observed_at=now() where stripe_subscription_id='sub_paidonboarding'",
    );
    expect(await checkAthenaEntitlement(client(who))).toEqual({ allowed: true, source: "circle" });
    expect(await checkAthenaEntitlement(client(who))).toEqual({ allowed: true, source: "circle" });
    expect(await counts()).toEqual(before);
    expect(await memberJobs(client(who) as never)).toEqual({ company: false, jobs: [] });
    const morning = () => {
      throw new Error("No job yet: onboarding must open first");
    };
    const card = await branchGettingStarted(client(who) as never, morning, firstJobCard);
    expect(card.title).toBe("Let's set up your company");
    expect(card.ask?.prompt).toBe("What is the company name?");
  });

  it("granted Circle access also opens onboarding without a Stripe subscription or company", async () => {
    const who = await member("granted-onboarding");
    const before = await counts();
    await query(
      "insert into circle_owner_grants(user_id,email,granted_by,reason) values($1,$2,$3,'Fictional onboarding verification')",
      [who.id, who.email, uid],
    );
    expect(await checkAthenaEntitlement(client(who))).toEqual({ allowed: true, source: "circle" });
    expect(await memberJobs(client(who) as never)).toEqual({ company: false, jobs: [] });
    expect(await counts()).toEqual(before);
    const cid = await userValue(
      who.id,
      `select mcp_company_save(null,'{"name":"Fictional Granted Builder"}') as v`,
    );
    expect(await value("select name as v from mcp_companies where id=$1", [cid])).toBe(
      "Fictional Granted Builder",
    );
    expect(await value("select mcp_seat_usage($1) as v", [cid])).toMatchObject({
      tier: "circle",
      limit: 6,
      members: 1,
    });
  });

  it("saves the member's chosen company through the existing onboarding RPC and binds it on the next call", async () => {
    const who = await member("named-onboarding");
    const s = await source("namedonboarding", who.id, who.email);
    const before = await counts();
    const cid = await userValue(
      who.id,
      `select mcp_company_save(null,'{"name":"Fictional Chosen Construction"}') as v`,
    );
    expect(await value("select name as v from mcp_companies where id=$1", [cid])).toBe(
      "Fictional Chosen Construction",
    );
    expect(await checkAthenaEntitlement(client(who))).toEqual({ allowed: true, source: "circle" });
    expect(await ensure(s)).toBe(cid);
    expect(
      await value("select current_company as v from mcp_user_settings where user_id=$1", [who.id]),
    ).toBe(cid);
    expect(await value("select mcp_seat_usage($1) as v", [cid])).toMatchObject({
      tier: "circle",
      limit: 6,
      members: 1,
    });
    expect((await counts()).companies).toBe(before.companies + 1);
    expect(await memberJobs(client(who) as never)).toEqual({ company: true, jobs: [] });
  });

  it("does not reserve a company for a payment email before its member signs in", async () => {
    const before = await counts();
    const s = await source("notyetregistered", null, "not-yet-registered@example.com");
    expect(await ensure(s)).toBeNull();
    expect(await ensure(s, null, true)).toBeNull();
    expect(await counts()).toEqual(before);
    const who = await member("not-yet-registered");
    expect(await checkAthenaEntitlement(client(who))).toEqual({ allowed: true, source: "circle" });
    expect(await memberJobs(client(who) as never)).toEqual({ company: false, jobs: [] });
    expect(await counts()).toEqual(before);
  });

  it("preserves the existing company, owner and plan through the migration and renewal", async () => {
    expect(await legacySnapshot()).toEqual(legacyBefore);
    const before = await counts();
    expect(await userValue(uid, "select mcp_gate() as v")).toBe(true);
    expect(
      await value(
        "select company_id as v from mcp_circle_provisioning where stripe_subscription_id='sub_legacy'",
      ),
    ).toBe(legacyCompany);
    expect(await value("select mcp_seat_usage($1) as v", [legacyCompany])).toMatchObject({
      tier: "circle",
      limit: 6,
      members: 1,
    });
    expect(
      await value("select role as v from mcp_company_members where company_id=$1 and user_id=$2", [
        legacyCompany,
        uid,
      ]),
    ).toBe("owner");
    await query(
      "update circle_subscription_evidence set paid_through=now()+interval '2 months' where stripe_subscription_id='sub_legacy'",
    );
    expect(await counts()).toEqual(before);
  });

  it("keeps verified payment-email claims on an existing company without making another company", async () => {
    const before = await counts();
    expect(await userValue(claimPayer, "select mcp_gate() as v")).toBe(true);
    expect(
      await value("select payment_user_id as v from mcp_circle_provisioning where company_id=$1", [
        claimCompany,
      ]),
    ).toBe(claimPayer);
    expect(
      await value("select owner_user_id as v from mcp_circle_provisioning where company_id=$1", [
        claimCompany,
      ]),
    ).toBe(claimOwner);
    await query("update auth.users set email='claim-payer-later@example.com' where id=$1", [
      claimPayer,
    ]);
    expect(await userValue(claimPayer, "select mcp_gate() as v")).toBe(true);
    expect((await counts()).companies).toBe(before.companies);
  });

  it("keeps the existing expiry rule and retains company records when paid access ends", async () => {
    const who = await member("expiry-onboarding");
    await source("expiryonboarding", who.id, who.email);
    const cid = await userValue(
      who.id,
      `select mcp_company_save(null,'{"name":"Fictional Expiry Builder"}') as v`,
    );
    expect(await userValue(who.id, "select mcp_gate() as v")).toBe(true);
    await query(
      "update circle_subscription_evidence set paid_through=now()-interval '1 day' where stripe_subscription_id='sub_expiryonboarding'",
    );
    await query("delete from mcp_gate_cache where user_id=$1", [who.id]);
    expect(await userValue(who.id, "select mcp_gate() as v")).toBe(false);
    expect(await value("select name as v from mcp_companies where id=$1", [cid])).toBe(
      "Fictional Expiry Builder",
    );
    expect(
      await value("select count(*)::int as v from mcp_company_members where company_id=$1", [cid]),
    ).toBe(1);
  });

  it("denies entry and company creation when no access entitlement exists", async () => {
    const who = await member("not-entitled");
    const before = await counts();
    expect(await checkAthenaEntitlement(client(who))).toEqual({
      allowed: false,
      reason: "no_entitlement",
    });
    await expect(
      userValue(who.id, `select mcp_company_save(null,'{"name":"Must Not Exist"}') as v`),
    ).rejects.toThrow();
    expect(await counts()).toEqual(before);
    expect(
      await value(
        "select has_function_privilege('authenticated','mcp_private.ensure_circle_company(uuid,uuid,boolean,text)','EXECUTE') as v",
      ),
    ).toBe(false);
  });
});
