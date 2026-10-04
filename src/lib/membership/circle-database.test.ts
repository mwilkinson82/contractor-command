import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

let db: PGlite;
const uid = "00000000-0000-0000-0000-000000000001";
const admin = "00000000-0000-0000-0000-000000000099";
const past = "2020-01-01T00:00:00Z",
  future = "2099-01-01T00:00:00Z";
async function value(sql: string, params: unknown[] = []) {
  return (await db.query<Record<string, unknown>>(sql, params)).rows[0]?.value;
}
async function addSub(overrides: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    user_id: uid,
    email: "member@example.test",
    stripe_subscription_id: "sub_test",
    status: "active",
    tier: "circle",
    ...overrides,
  };
  return (await value(
    `insert into subscriptions(user_id,email,stripe_subscription_id,status,tier,is_comped,metadata)
    values($1,$2,$3,$4,$5,$6,$7) returning id as value`,
    [
      row.user_id,
      row.email,
      row.stripe_subscription_id,
      row.status,
      row.tier,
      row.is_comped ?? false,
      row.metadata ?? {},
    ],
  )) as string;
}
async function evidence(
  sid = "sub_test",
  through: string | null = future,
  reason: string | null = null,
) {
  await db.query("insert into circle_subscription_evidence values($1,now(),$2,$3)", [
    sid,
    through,
    reason,
  ]);
}
async function decision() {
  return (await value("select get_circle_entitlement($1,'member@example.test') as value", [
    uid,
  ])) as { state: string; hasAccess: boolean; tier: string | null };
}
async function grant(sid: string, enabled = true, expires: string | null = null) {
  await db.query(
    "select set_circle_owner_grant($1,$2,'member@example.test',$3,$4,'Owner test action',$5)",
    [sid, uid, admin, enabled, expires],
  );
}

beforeAll(async () => {
  db = new PGlite();
  // Minimal existing schema, not a reimplementation of the entitlement under test.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
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
    create function has_role(uid uuid,r text) returns boolean language sql as $$ select exists(select 1 from user_roles where user_id = uid and role = r) $$;
    create function tier_rank(t app_tier) returns integer language sql as $$ select case t when 'hardcore' then 5 when 'circle' then 4 when 'power_hour' then 4 when 'sm_school' then 4 when 'contractor_school' then 4 when 'intensive' then 3 when 'book_buyer' then 1 else 0 end $$;
    insert into profiles values('${uid}','member@example.test','Member');
    insert into user_roles values('${admin}','admin');
  `);
  const existing = readFileSync(
    "supabase/migrations/20260527182404_9674d14f-9cbd-46bd-8a50-4e651788d04d.sql",
    "utf8",
  );
  await db.exec(
    existing.slice(0, existing.indexOf("CREATE OR REPLACE FUNCTION public.has_active_access")),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261004190813_circle_entitlement_reconciliation.sql",
      "utf8",
    ),
  );
}, 30000);
afterAll(async () => db?.close());
beforeEach(async () => {
  await db.exec(
    "truncate circle_owner_grants,circle_legacy_reviews,circle_subscription_evidence,circle_audience_sync,subscriptions,stripe_webhook_events cascade",
  );
});

describe("canonical membership in PostgreSQL", () => {
  it("keeps paid signup access and pending paid identities without a profile", async () => {
    await addSub({ user_id: null });
    await evidence();
    expect((await decision()).state).toBe("eligible");
    expect(await value("select get_user_tier($1) as value", [uid])).toBe("circle");
    expect(await value("select has_active_access($1) as value", [uid])).toBe(true);
  });
  it("preserves a scheduled cancellation through the paid period, then expires at the boundary without a webhook", async () => {
    await addSub();
    await evidence();
    await db.exec("update subscriptions set cancel_at_period_end=true");
    expect((await decision()).state).toBe("eligible");
    const result = await value(
      "select membership_private.circle_decision($1,'member@example.test',$2) as value",
      [uid, future],
    );
    expect(result).toMatchObject({ state: "ineligible", hasAccess: false });
  });
  it("a canceled paid source ends at paid-through, regardless of stale current_period_end", async () => {
    await addSub({ status: "canceled" });
    await evidence(undefined, past);
    await db.query("update subscriptions set current_period_end=$1", [future]);
    expect(await decision()).toMatchObject({ state: "ineligible", hasAccess: false });
  });
  it("a canceled source does not erase an independent owner grant", async () => {
    await addSub({ status: "canceled" });
    await evidence(undefined, past);
    const manual = await addSub({ stripe_subscription_id: null });
    await grant(manual);
    expect(await decision()).toMatchObject({ state: "eligible", hasAccess: true });
  });
  it("grant revoke and expiry never resurrect a legacy manual subscription", async () => {
    const manual = await addSub({ stripe_subscription_id: null, is_comped: true });
    await grant(manual);
    await grant(manual, false);
    expect(await decision()).toMatchObject({ state: "ineligible", hasAccess: false });
    await grant(manual, true, future);
    expect(
      await value(
        "select membership_private.circle_decision($1,'member@example.test',$2) as value",
        [uid, future],
      ),
    ).toMatchObject({ state: "ineligible", hasAccess: false });
  });
  it("owner-grant retries are idempotent and preserve an audit trail", async () => {
    const id = await addSub({ stripe_subscription_id: null });
    await grant(id);
    await grant(id);
    expect(await value("select count(*)::int as value from circle_owner_grant_history")).toBe(1);
    await grant(id, false);
    await grant(id, false);
    expect(await value("select count(*)::int as value from circle_owner_grant_history")).toBe(2);
  });
  it("a Circle grant action does not erase an unrelated comped product", async () => {
    const id = await addSub({ tier: "book_buyer", stripe_subscription_id: null, is_comped: true });
    await grant(id);
    await grant(id, false);
    expect(await value("select is_comped as value from subscriptions where id=$1", [id])).toBe(
      true,
    );
    expect(await value("select get_user_tier($1) as value", [uid])).toBe("book_buyer");
  });
  it("revoking one source leaves another independent grant in place", async () => {
    const a = await addSub({ stripe_subscription_id: null }),
      b = await addSub({ stripe_subscription_id: null });
    await grant(a);
    await grant(b);
    await grant(a, false);
    expect((await decision()).state).toBe("eligible");
  });
  it("old canceled and superseded rows cannot defeat a newer paid source", async () => {
    await addSub({ status: "canceled" });
    await addSub({ stripe_subscription_id: "sub_old", status: "superseded", is_comped: true });
    await addSub({ stripe_subscription_id: "sub_new" });
    await evidence("sub_new");
    expect((await decision()).state).toBe("eligible");
  });
  it("retired comp flags are review cases until explicitly resolved, then cannot restore access", async () => {
    const id = await addSub({ status: "superseded", is_comped: true });
    await db.query("insert into circle_legacy_reviews values($1,true,null,null)", [id]);
    expect(await decision()).toMatchObject({ state: "review", hasAccess: true });
    await db.query(
      "update circle_legacy_reviews set resolved_at=now(),resolution='superseded' where subscription_id=$1",
      [id],
    );
    expect(await decision()).toMatchObject({ state: "ineligible", hasAccess: false });
  });
  it("past_due retains an already paid period but requires explicit grace review after expiry", async () => {
    const id = await addSub({ status: "past_due" });
    await evidence();
    expect((await decision()).state).toBe("eligible");
    await db.query("update circle_subscription_evidence set paid_through=$1", [past]);
    expect(await decision()).toMatchObject({ state: "review", hasAccess: false });
    await db.query("insert into circle_legacy_reviews values($1,true,null,null)", [id]);
    expect(await decision()).toMatchObject({ state: "review", hasAccess: true });
  });
  it("active without settled payment, trial and malformed imported identities require review", async () => {
    await addSub({ stripe_subscription_id: "sub_typo" });
    expect((await decision()).state).toBe("review");
    await db.exec("update subscriptions set status='trialing'");
    expect((await decision()).state).toBe("review");
  });
  it("a pending renewal cannot end a still-paid period, but requires review after its boundary", async () => {
    await addSub();
    await evidence("sub_test", future, "renewal_payment_pending");
    expect((await decision()).state).toBe("eligible");
    expect(
      await value(
        "select membership_private.circle_decision($1,'member@example.test',$2) as value",
        [uid, future],
      ),
    ).toMatchObject({ state: "review" });
  });
  it("identity conflicts do not transfer another account's paid access", async () => {
    await addSub({ user_id: "00000000-0000-0000-0000-000000000002" });
    await evidence();
    expect(await decision()).toMatchObject({ state: "review", hasAccess: false });
  });
  it("a legacy hold cannot transfer access from an already bound identity", async () => {
    const id = await addSub({ user_id: "00000000-0000-0000-0000-000000000002" });
    await db.query("insert into circle_legacy_reviews values($1,true,null,null)", [id]);
    expect(await decision()).toMatchObject({ state: "review", hasAccess: false });
    expect(
      await value(
        "select get_circle_entitlement('00000000-0000-0000-0000-000000000002','member@example.test') as value",
      ),
    ).toMatchObject({ state: "review", hasAccess: true });
  });
  it.each(["power_hour", "sm_school", "contractor_school", "intensive", "book_buyer", "aos_only"])(
    "preserves unrelated %s access without adding a Circle audience member",
    async (tier) => {
      await addSub({ tier });
      expect((await decision()).state).toBe("ineligible");
      expect(await value("select get_user_tier($1) as value", [uid])).toBe(tier);
    },
  );
  it("preserves Hardcore rank for an independently granted member", async () => {
    const id = await addSub({ tier: "hardcore", stripe_subscription_id: null });
    await grant(id);
    expect(await value("select get_user_tier($1) as value", [uid])).toBe("hardcore");
  });
  it("admin access is independent of announcement membership", async () => {
    expect(await value("select get_user_tier($1) as value", [admin])).toBe("circle");
    expect(
      await value("select get_circle_entitlement($1,'admin@example.test') as value", [admin]),
    ).toMatchObject({ state: "ineligible" });
  });
  it("expired Circle cannot retain unlimited AOS while an independent book purchase stays valid", async () => {
    await addSub();
    await evidence(undefined, past);
    await addSub({ tier: "book_buyer", stripe_subscription_id: "cs_book" });
    expect((await db.query("select * from get_user_aos_limits($1)", [uid])).rows[0]).toEqual({
      tier: "book_buyer",
      workspace_limit: 1,
      seat_limit: 2,
    });
  });
  it("new snapshots are atomic and older concurrent refreshes cannot overwrite them", async () => {
    const row = {
      user_id: uid,
      email: "member@example.test",
      stripe_subscription_id: "sub_test",
      tier: "circle",
      status: "canceled",
    };
    const sql = "select apply_circle_subscription_snapshot($1,$2,$3,null) as value";
    expect(await value(sql, [row, past, "2026-10-04T01:00:02Z"])).toBe(true);
    expect(await value(sql, [{ ...row, status: "active" }, future, "2026-10-04T01:00:01Z"])).toBe(
      false,
    );
    expect(await value("select status as value from subscriptions")).toBe("canceled");
    expect(await value("select count(*)::int as value from circle_audience_sync")).toBe(1);
  });
  it("failed provider work is retryable and a newer job cannot be marked synced by an older worker", async () => {
    await db.exec("select queue_circle_audience_sync('member@example.test')");
    const claimed = (
      await db.query<{ revision: number; attempts: number }>(
        "select * from claim_circle_audience_sync()",
      )
    ).rows[0];
    await db.exec("select queue_circle_audience_sync('member@example.test')");
    await db.query(
      "select finish_circle_audience_sync('member@example.test',$1,$2,'synced',null)",
      [claimed.revision, claimed.attempts],
    );
    expect(await value("select status as value from circle_audience_sync")).toBe("pending");
    const retry = (
      await db.query<{ revision: number; attempts: number }>(
        "select * from claim_circle_audience_sync()",
      )
    ).rows[0];
    await db.query(
      "select finish_circle_audience_sync('member@example.test',$1,$2,'failed','missing key')",
      [retry.revision, retry.attempts],
    );
    expect(await value("select last_error as value from circle_audience_sync")).toBe("missing key");
    expect((await db.query("select * from claim_circle_audience_sync()")).rows).toHaveLength(1);
  });
  it("deduplicates events and reclaims only failed/expired work", async () => {
    const sql = "select begin_stripe_webhook_event('evt_test','invoice.paid','in_test') as value";
    expect(await value(sql)).toBe("process");
    expect(await value(sql)).toBe("in_progress");
    await db.exec("update stripe_webhook_events set status='failed'");
    expect(await value(sql)).toBe("process");
    await db.exec("update stripe_webhook_events set status='processed'");
    expect(await value(sql)).toBe("duplicate");
  });
  it("denies public/authenticated membership writes and private decision RPCs", async () => {
    for (const role of ["anon", "authenticated"]) {
      expect(
        await value("select has_table_privilege($1,'circle_owner_grants','INSERT') as value", [
          role,
        ]),
      ).toBe(false);
      expect(
        await value(
          "select has_function_privilege($1,'get_circle_entitlement(uuid,text)','EXECUTE') as value",
          [role],
        ),
      ).toBe(false);
      expect(
        await value(
          "select has_function_privilege($1,'apply_circle_subscription_snapshot(jsonb,timestamptz,timestamptz,text)','EXECUTE') as value",
          [role],
        ),
      ).toBe(false);
    }
  });
});
