/* eslint-disable @typescript-eslint/no-explicit-any -- actual PostgreSQL RPC result assertions */
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

let db: PGlite;
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
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe("Circle companies from real guarded SQL", () => {
  it("provisions only after payment evidence and gives owner plus five seats and every role", async () => {
    const s = await source("first", uid, "member@example.com", false);
    expect(await value("select count(*)::int as v from mcp_circle_provisioning")).toBe(0);
    await query(
      "insert into circle_subscription_evidence values('sub_first',now(),now()+interval '1 month',null)",
    );
    const cid = await ensure(s);
    const usage = await value("select mcp_seat_usage($1) as v", [cid]);
    expect(usage).toMatchObject({ tier: "circle", limit: 6, members: 1, extra_seats: 0 });
    expect(
      await value(
        "select bool_and(mcp_role_allowed($1,r)) as v from unnest(array['owner','pm','all_access','ap','estimating','contracts','super']) r",
        [cid],
      ),
    ).toBe(true);
    expect(await userValue(uid, "select mcp_gate() as v")).toBe(true);
  });
  it("reuses an existing company and stays idempotent across retries and renewals", async () => {
    const before = await value("select count(*)::int as v from mcp_companies");
    const s = await source("renewal");
    const cid = await ensure(s);
    expect(await ensure(s)).toBe(cid);
    expect(await value("select count(*)::int as v from mcp_companies")).toBe(before);
    expect(
      await value("select count(*)::int as v from mcp_company_members where company_id=$1", [cid]),
    ).toBe(1);
  });
  it("reserves an unclaimed workspace and claims it only with the verified payment identity", async () => {
    const s = await source("pending", null, "later@example.com");
    const cid = await ensure(s);
    expect(await value("select created_by as v from mcp_companies where id=$1", [cid])).toBeNull();
    expect(await ensure(s, peer)).toBe(cid);
    expect(
      await value(
        "select owner_user_id as v from mcp_circle_provisioning where source_subscription_id=$1",
        [s],
      ),
    ).toBeNull();
    await query("update auth.users set email='later@example.com' where id=$1", [peer]);
    expect(await userValue(peer, "select mcp_gate() as v")).toBe(true);
    expect(
      await value(
        "select owner_user_id as v from mcp_circle_provisioning where source_subscription_id=$1",
        [s],
      ),
    ).toBe(peer);
    await query("update auth.users set email='changed-later@example.com' where id=$1", [peer]);
    expect(await userValue(peer, "select mcp_gate() as v")).toBe(true);
    expect(await ensure(s, peer)).toBe(cid);
  });
  it("does not let an unverified email or a different account claim a bound owner", async () => {
    const s = await source("verifiedonly", null, "unverified@example.com");
    const cid = await ensure(s);
    expect(await ensure(s, unverified)).toBe(cid);
    expect(
      await value(
        "select owner_user_id as v from mcp_circle_provisioning where source_subscription_id=$1",
        [s],
      ),
    ).toBeNull();
    const bound = await source("bound");
    expect(await ensure(bound, peer)).toBe(await ensure(bound));
    expect(
      await value(
        "select owner_user_id as v from mcp_circle_provisioning where source_subscription_id=$1",
        [bound],
      ),
    ).toBe(uid);
  });
  it("uses a trusted linked user even when billing and sign-in emails differ", async () => {
    const s = await source("different", uid, "member@example.com");
    await query(
      "update subscriptions set metadata=jsonb_build_object('stripe_customer_email','billing@example.com') where id=$1",
      [s],
    );
    // An established binding changes to review instead of silently following a new billing identity.
    expect(
      await value(
        "select state as v from mcp_circle_provisioning where source_subscription_id=$1",
        [s],
      ),
    ).toBe("review");
    const otherUid = "00000000-0000-4000-8000-000000000104";
    await query("insert into auth.users values($1,'login@example.com',now())", [otherUid]);
    const other = await source("differentnew", otherUid, "login@example.com", false);
    await query(
      "update subscriptions set metadata=jsonb_build_object('stripe_customer_email','payment@example.com') where id=$1",
      [other],
    );
    await query(
      "insert into circle_subscription_evidence values('sub_differentnew',now(),now()+interval '1 month',null)",
    );
    expect(
      await value(
        "select owner_user_id as v from mcp_circle_provisioning where source_subscription_id=$1",
        [other],
      ),
    ).toBe(otherUid);
  });
  it("keeps pending-payment and explicitly inactive sources from granting access", async () => {
    const s = await source("unpaid", null, "hold@example.com", false);
    expect(await ensure(s)).toBeNull();
    const cid = await ensure(s, null, true);
    expect(await value("select mcp_company_plan_live($1) as v", [cid])).toBe(false);
    expect(
      await value("select status as v from mcp_company_entitlements where company_id=$1", [cid]),
    ).toBe("inactive");
    await query("update subscriptions set status='paused' where id=$1", [s]);
    expect(await value("select mcp_company_plan_live($1) as v", [cid])).toBe(false);
  });
  it("limits an audited owner override to its active source and explicit expiry", async () => {
    const newUid = "00000000-0000-4000-8000-000000000105";
    await query("insert into auth.users values($1,'override@example.com',now())", [newUid]);
    const s = await source("override", newUid, "override@example.com", false),
      cid = await ensure(s, null, true);
    await query(
      "update mcp_circle_provisioning set override_until=now()+interval '1 day',override_by=$2,override_reason='Owner-confirmed active account' where source_subscription_id=$1",
      [s, uid],
    );
    await ensure(s);
    expect(await value("select mcp_company_plan_live($1) as v", [cid])).toBe(true);
    await query(
      "update mcp_circle_provisioning set override_until=now()-interval '1 day' where source_subscription_id=$1",
      [s],
    );
    expect(await value("select mcp_company_plan_live($1) as v", [cid])).toBe(false);
  });
  it("preserves independent paid plans and purchased extra seats", async () => {
    const cid = await value(
      "select company_id as v from mcp_circle_provisioning where stripe_subscription_id='sub_first'",
    );
    await query(
      "update mcp_company_entitlements set plan='athena_pm',extra_seats=2,stripe_subscription_id='sub_standalone' where company_id=$1",
      [cid],
    );
    await ensure(
      await value("select id as v from subscriptions where stripe_subscription_id='sub_first'"),
    );
    expect(
      await value("select plan as v from mcp_company_entitlements where company_id=$1", [cid]),
    ).toBe("athena_pm");
    expect(await value("select mcp_seat_usage($1) as v", [cid])).toMatchObject({
      tier: "circle",
      limit: 8,
      extra_seats: 2,
    });
  });
  it("denies member writes and private function calls, and records provisioning history", async () => {
    expect(
      await value(
        "select has_table_privilege('authenticated','mcp_circle_provisioning','UPDATE') as v",
      ),
    ).toBe(false);
    expect(
      await value(
        "select has_table_privilege('authenticated','mcp_circle_provisioning','SELECT') as v",
      ),
    ).toBe(false);
    expect(
      await value(
        "select has_function_privilege('authenticated','mcp_private.ensure_circle_company(uuid,uuid,boolean,text)','EXECUTE') as v",
      ),
    ).toBe(false);
    expect(
      await value(
        "select has_table_privilege('service_role','mcp_circle_provisioning_audit','UPDATE') as v",
      ),
    ).toBe(false);
    expect(
      await value("select count(*)::int as v from mcp_circle_provisioning_audit"),
    ).toBeGreaterThan(0);
    expect(
      await value(
        "select count(*)::int as v from pg_trigger where not tgisinternal and tgrelid='auth.users'::regclass",
      ),
    ).toBe(0);
  });
  it("keeps an unclaimed renewal on the same reserved company", async () => {
    const first = await source("unclaimedrenewal", null, "future@example.com");
    const cid = await ensure(first);
    const second = await source("unclaimedrenewal2", null, "future@example.com", false);
    await query("update subscriptions set stripe_customer_id='cus_unclaimedrenewal' where id=$1", [
      second,
    ]);
    await query(
      "insert into circle_subscription_evidence values('sub_unclaimedrenewal2',now(),now()+interval '1 month',null)",
    );
    expect(await ensure(second)).toBe(cid);
  });
  it("enforces the sixth-person cap without sending invitations or emails", async () => {
    const owner = "00000000-0000-4000-8000-000000000110";
    await query("insert into auth.users values($1,'cap@example.com',now())", [owner]);
    const s = await source("cap", owner, "cap@example.com"),
      cid = await ensure(s);
    for (let i = 0; i < 5; i++)
      await userValue(
        owner,
        `select mcp_team_invite('${cid}','qa-seat-${i}@example.com','Fictional Seat','ap',array[]::text[]) as v`,
      );
    expect(await value("select mcp_seat_usage($1) as v", [cid])).toMatchObject({
      limit: 6,
      members: 1,
      pending: 5,
    });
    await expect(
      userValue(
        owner,
        `select mcp_team_invite('${cid}','qa-sixth@example.com','Fictional Sixth','pm',array[]::text[]) as v`,
      ),
    ).rejects.toThrow(/MCP_SEAT_LIMIT/);
  });
  it("removes Circle seat access after payment expiry, preserving company and history", async () => {
    const owner = "00000000-0000-4000-8000-000000000111";
    const seat = "00000000-0000-4000-8000-000000000112";
    await query(
      "insert into auth.users values($1,'expires@example.com',now()),($2,'seat@example.com',now())",
      [owner, seat],
    );
    const s = await source("expires", owner, "expires@example.com"),
      cid = await ensure(s);
    await query(
      "insert into mcp_company_members(company_id,user_id,display_name,role) values($1,$2,'Fictional Seat','ap')",
      [cid, seat],
    );
    expect(await userValue(seat, "select mcp_gate() as v")).toBe(true);
    await query(
      "update circle_subscription_evidence set paid_through=now()-interval '1 day' where stripe_subscription_id='sub_expires'",
    );
    expect(await userValue(seat, "select mcp_gate() as v")).toBe(false);
    expect(await value("select count(*)::int as v from mcp_companies where id=$1", [cid])).toBe(1);
    expect(
      await value("select count(*)::int as v from mcp_company_members where company_id=$1", [cid]),
    ).toBe(2);
  });
});
