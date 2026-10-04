import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

let db: PGlite;
let existingFunctionAcls: unknown[];
let hostedAliasPrivilegesBefore: string[];
let hostedHistoryPrivilegesBefore: string[];
let hostedOwnerHistoryPrivilegesBefore: string[];
let unrelatedSecurityBefore: unknown[];
let dataBeforeCorrection: unknown[];
let dataAfterCorrection: unknown[];
const preservedDataQuery = `select 'grant_history' kind,to_jsonb(h) data from circle_owner_grant_history h
  union all select 'aliases',to_jsonb(a) from circle_source_aliases a
  union all select 'alias_history',to_jsonb(h) from circle_source_alias_history h
  union all select 'grants',to_jsonb(g) from circle_owner_grants g
  union all select 'subscriptions',to_jsonb(s) from subscriptions s
  union all select 'evidence',to_jsonb(e) from circle_subscription_evidence e
  union all select 'reviews',to_jsonb(r) from circle_legacy_reviews r
  union all select 'outbox',to_jsonb(o) from circle_audience_sync o order by kind,data`;
const unrelatedSecurityQuery = `
  select 'table' kind,c.oid::regclass::text identity,c.relacl::text acl from pg_class c
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
    and c.relname not in ('circle_source_aliases','circle_source_alias_history','circle_owner_grant_history')
  union all select 'function',p.oid::regprocedure::text,p.proacl::text from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','membership_private')
  union all select 'default',d.oid::text,d.defaclacl::text from pg_default_acl d
  union all select 'other-alias-grantee',c.relname||':'||a.grantee::text,a.privilege_type||':'||a.is_grantable::text
    from pg_class c cross join lateral aclexplode(c.relacl) a
    where c.oid in ('public.circle_source_aliases'::regclass,'public.circle_source_alias_history'::regclass,'public.circle_owner_grant_history'::regclass)
    and a.grantee <> (select oid from pg_roles where rolname='service_role')
  order by kind,identity,acl`;
async function serviceTablePrivileges(table: string): Promise<string[]> {
  return (await value(
    `select array_agg(a.privilege_type order by a.privilege_type) as value
    from pg_class c cross join lateral aclexplode(c.relacl) a
    where c.oid=$1::regclass and a.grantee=(select oid from pg_roles where rolname='service_role')`,
    [table],
  )) as string[];
}
const existingAclQuery = `select p.oid::regprocedure::text as signature,p.proacl::text as acl
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname='membership_private' and p.proname not in
    ('alias_binding_current','audit_circle_source_alias','queue_dependent_circle_aliases'))
    or p.oid='public.queue_circle_audience_sweep()'::regprocedure
  order by signature`;
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
    create role anon; create role authenticated; create role service_role bypassrls; create role sandbox_exec bypassrls;
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
  // Reproduce hosted defaults before either migration creates its tables.
  await db.exec(`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT ON TABLES TO sandbox_exec;
  `);
  await db.exec(
    readFileSync(
      "supabase/migrations/20261004190813_circle_entitlement_reconciliation.sql",
      "utf8",
    ),
  );
  // Retain the actual prior implementation only in this synthetic test database
  // to compare empty-mapping behavior across existing source states.
  const priorDecision = await value(
    "select pg_get_functiondef('membership_private.circle_decision(uuid,text,timestamptz)'::regprocedure) as value",
  );
  await db.exec(
    String(priorDecision).replace(
      "membership_private.circle_decision",
      "membership_private.pre_alias_circle_decision",
    ),
  );
  existingFunctionAcls = (await db.query(existingAclQuery)).rows;
  await db.exec(
    readFileSync("supabase/migrations/20261004201435_circle_source_aliases.sql", "utf8"),
  );
  hostedAliasPrivilegesBefore = await serviceTablePrivileges("circle_source_aliases");
  hostedHistoryPrivilegesBefore = await serviceTablePrivileges("circle_source_alias_history");
  hostedOwnerHistoryPrivilegesBefore = await serviceTablePrivileges("circle_owner_grant_history");
  await db.exec(`INSERT INTO circle_owner_grants(email,granted_by,reason)
    SELECT 'synthetic-'||i||'@example.test','${admin}','Synthetic audit preservation fixture'
    FROM generate_series(1,20) i`);
  dataBeforeCorrection = (await db.query(preservedDataQuery)).rows;
  unrelatedSecurityBefore = (await db.query(unrelatedSecurityQuery)).rows;
  await db.exec(
    readFileSync("supabase/migrations/20261004210254_circle_alias_table_privileges.sql", "utf8"),
  );
  dataAfterCorrection = (await db.query(preservedDataQuery)).rows;
}, 30000);
afterAll(async () => db?.close());
beforeEach(async () => {
  await db.exec(
    "truncate circle_owner_grants,circle_legacy_reviews,circle_subscription_evidence,circle_audience_sync,subscriptions,stripe_webhook_events cascade",
  );
});

describe("owner-reviewed aliases follow their paid source", () => {
  it("reproduces why a subset GRANT did not remove hosted default-ALL table privileges", () => {
    for (const privileges of [
      hostedAliasPrivilegesBefore,
      hostedHistoryPrivilegesBefore,
      hostedOwnerHistoryPrivilegesBefore,
    ]) {
      expect(privileges).toEqual([
        "DELETE",
        "INSERT",
        "MAINTAIN",
        "REFERENCES",
        "SELECT",
        "TRIGGER",
        "TRUNCATE",
        "UPDATE",
      ]);
    }
  });
  it("leaves only the intended service-role permissions, with no grant options", async () => {
    expect(await serviceTablePrivileges("circle_source_aliases")).toEqual([
      "INSERT",
      "SELECT",
      "UPDATE",
    ]);
    expect(await serviceTablePrivileges("circle_source_alias_history")).toEqual([
      "INSERT",
      "SELECT",
    ]);
    expect(await serviceTablePrivileges("circle_owner_grant_history")).toEqual([
      "INSERT",
      "SELECT",
    ]);
    expect(
      await value(`select count(*)::int as value from pg_class c cross join lateral aclexplode(c.relacl) a
      where c.oid in ('circle_source_aliases'::regclass,'circle_source_alias_history'::regclass,'circle_owner_grant_history'::regclass)
      and a.grantee=(select oid from pg_roles where rolname='service_role') and a.is_grantable`),
    ).toBe(0);
  });
  it("preserves all other table/function/default ACLs and owner/platform grants", async () => {
    expect((await db.query(unrelatedSecurityQuery)).rows).toEqual(unrelatedSecurityBefore);
    for (const table of [
      "circle_source_aliases",
      "circle_source_alias_history",
      "circle_owner_grant_history",
    ]) {
      expect(
        await value("select has_table_privilege('sandbox_exec',$1,'SELECT,INSERT') as value", [
          table,
        ]),
      ).toBe(true);
    }
    expect(
      await value("select rolbypassrls as value from pg_roles where rolname='sandbox_exec'"),
    ).toBe(true);
  });
  it("preserves the 20 existing synthetic grant-history rows and every source/outbox record", () => {
    expect(
      dataBeforeCorrection.filter((row) => (row as { kind: string }).kind === "grant_history"),
    ).toHaveLength(20);
    expect(dataAfterCorrection).toEqual(dataBeforeCorrection);
  });
  it("is idempotent and leaves all permission boundaries intact", async () => {
    await db.exec(
      readFileSync("supabase/migrations/20261004210254_circle_alias_table_privileges.sql", "utf8"),
    );
    expect(await serviceTablePrivileges("circle_source_aliases")).toEqual([
      "INSERT",
      "SELECT",
      "UPDATE",
    ]);
    expect(await serviceTablePrivileges("circle_source_alias_history")).toEqual([
      "INSERT",
      "SELECT",
    ]);
    expect(await serviceTablePrivileges("circle_owner_grant_history")).toEqual([
      "INSERT",
      "SELECT",
    ]);
    expect((await db.query(unrelatedSecurityQuery)).rows).toEqual(unrelatedSecurityBefore);
  });
  it("preserves every pre-existing private function ACL and the replaced public sweep ACL", async () => {
    expect((await db.query(existingAclQuery)).rows).toEqual(existingFunctionAcls);
  });
  it("limits new helper execution to the owner and service role", async () => {
    for (const signature of [
      "membership_private.alias_binding_current(circle_source_aliases,subscriptions,timestamp with time zone)",
      "membership_private.audit_circle_source_alias()",
      "membership_private.queue_dependent_circle_aliases()",
    ]) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        expect(
          await value("select has_function_privilege($1,$2,'EXECUTE') as value", [role, signature]),
        ).toBe(role === "service_role");
      }
    }
  });
  const aliasUser = "00000000-0000-0000-0000-000000000002";
  const aliasEmail = "second@example.test";
  const billingEmail = "billing@example.test";
  async function source() {
    await db.query(
      "insert into profiles(id,email,full_name) values($1,$2,'Second Identity') on conflict(id) do update set email=excluded.email",
      [aliasUser, aliasEmail],
    );
    const sid = await addSub();
    await db.query(
      "update subscriptions set stripe_customer_id='cus_test',metadata=jsonb_build_object('stripe_customer_email',$2::text) where id=$1",
      [sid, billingEmail],
    );
    await evidence();
    return sid;
  }
  async function map(
    sid: string,
    opts: {
      enabled?: boolean;
      userId?: string;
      email?: string;
      actor?: string;
      expires?: string;
      expectedStripeId?: string;
    } = {},
  ) {
    return value(
      "select set_circle_source_alias($1,$2,'cus_test',$3,'member@example.test',$4,$5,$6,$7,$8,'Verified same member',$9) as value",
      [
        sid,
        opts.expectedStripeId ?? "sub_test",
        uid,
        opts.userId ?? aliasUser,
        opts.email ?? aliasEmail,
        billingEmail,
        opts.actor ?? admin,
        opts.enabled ?? true,
        opts.expires ?? null,
      ],
    );
  }
  async function aliasDecision(at?: string) {
    return value(
      "select membership_private.circle_decision($1,$2,coalesce($3::timestamptz,now())) as value",
      [aliasUser, aliasEmail, at ?? null],
    );
  }
  it.each([
    { status: "active", through: future, legacy: false },
    { status: "canceled", through: future, legacy: false },
    { status: "canceled", through: past, legacy: false },
    { status: "active", through: null, legacy: true },
    { status: "past_due", through: past, legacy: true },
    { status: "trialing", through: null, legacy: true },
  ])(
    "the empty alias migration preserves the prior decision for %j",
    async ({ status, through, legacy }) => {
      const sid = await addSub({ status });
      if (through) await evidence(undefined, through);
      if (legacy)
        await db.query(
          "insert into circle_legacy_reviews(subscription_id,preserve_access) values($1,true)",
          [sid],
        );
      for (const at of [null, past, future]) {
        expect(
          await value(
            "select membership_private.circle_decision($1,$2,coalesce($3::timestamptz,now())) = membership_private.pre_alias_circle_decision($1,$2,coalesce($3::timestamptz,now())) as value",
            [uid, "member@example.test", at],
          ),
        ).toBe(true);
      }
    },
  );
  it("source supersession queues aliases and a source owner's separate grant is not inherited", async () => {
    const sid = await source();
    await map(sid);
    await db.query("insert into circle_legacy_reviews values($1,false,now(),'superseded')", [sid]);
    expect(await aliasDecision()).toMatchObject({ state: "ineligible", hasAccess: false });
    expect(
      await value("select revision::int as value from circle_audience_sync where email=$1", [
        aliasEmail,
      ]),
    ).toBe(2);
    const grantId = await addSub({ stripe_subscription_id: null });
    await grant(grantId);
    expect(await decision()).toMatchObject({ state: "eligible", hasAccess: true });
    expect(await aliasDecision()).toMatchObject({ state: "ineligible", hasAccess: false });
  });
  it("requires an exact reviewed mapping, allows both accounts and does not grant arbitrary cross-user matches", async () => {
    const sid = await source();
    expect(await aliasDecision()).toMatchObject({ state: "ineligible", hasAccess: false });
    await map(sid);
    expect(await decision()).toMatchObject({ state: "eligible", hasAccess: true });
    expect(await aliasDecision()).toMatchObject({ state: "eligible", hasAccess: true });
    expect(await value("select get_user_tier($1) as value", [aliasUser])).toBe("circle");
    expect(
      await value("select membership_private.circle_decision($1,'member@example.test') as value", [
        aliasUser,
      ]),
    ).toMatchObject({ state: "review", hasAccess: false });
  });
  it("inherits paid expiry and scheduled cancellation without extending the paid period", async () => {
    const sid = await source();
    await map(sid);
    await db.query(
      "update subscriptions set status='canceled',cancel_at_period_end=true where id=$1",
      [sid],
    );
    expect(await aliasDecision()).toMatchObject({ state: "eligible", hasAccess: true });
    expect(await aliasDecision(future)).toMatchObject({ state: "ineligible", hasAccess: false });
  });
  it("refund/dispute review never transfers the source owner's preserved legacy access", async () => {
    const sid = await source();
    await map(sid);
    await db.query(
      "insert into circle_legacy_reviews(subscription_id,preserve_access) values($1,true)",
      [sid],
    );
    await db.exec(
      "update circle_subscription_evidence set review_reason='stripe_payment_disputed'",
    );
    expect(await decision()).toMatchObject({ state: "review", hasAccess: true });
    expect(await aliasDecision()).toMatchObject({ state: "review", hasAccess: false });
  });
  it("alias revocation is audited/idempotent and cannot erase independent owner grants", async () => {
    const sid = await source();
    const aliasId = await map(sid);
    expect(await map(sid)).toBe(aliasId);
    expect(await value("select count(*)::int as value from circle_source_alias_history")).toBe(1);
    await map(sid, { enabled: false });
    await map(sid, { enabled: false });
    expect(await aliasDecision()).toMatchObject({ state: "ineligible", hasAccess: false });
    expect(await value("select count(*)::int as value from circle_source_alias_history")).toBe(2);
    const grantId = await addSub({
      user_id: aliasUser,
      email: aliasEmail,
      stripe_subscription_id: null,
    });
    await db.query("select set_circle_owner_grant($1,$2,$3,$4,true,'Separate owner grant')", [
      grantId,
      aliasUser,
      aliasEmail,
      admin,
    ]);
    expect(await aliasDecision()).toMatchObject({ state: "eligible", hasAccess: true });
  });
  it("alias expiry cannot erase an independent paid source", async () => {
    const sid = await source();
    await map(sid, { expires: "2098-01-01T00:00:00Z" });
    expect(await aliasDecision("2098-01-01T00:00:00Z")).toMatchObject({
      state: "ineligible",
      hasAccess: false,
    });
    await addSub({ user_id: aliasUser, email: aliasEmail, stripe_subscription_id: "sub_other" });
    await evidence("sub_other");
    expect(await aliasDecision("2098-01-01T00:00:00Z")).toMatchObject({
      state: "eligible",
      hasAccess: true,
    });
  });
  it.each([
    "update subscriptions set stripe_subscription_id='sub_retargeted'",
    "update subscriptions set stripe_customer_id='cus_other'",
    "update subscriptions set user_id=null",
    "update subscriptions set email='other@example.test'",
    "update subscriptions set metadata='{}'",
    "update profiles set email='changed@example.test' where email='second@example.test'",
  ])("requires renewed review after a binding changes: %s", async (sql) => {
    const sid = await source();
    await map(sid);
    await db.exec(sql);
    expect(await aliasDecision()).toMatchObject({ state: "ineligible", hasAccess: false });
  });
  it("approves only exact primary-account billing aliases, never an arbitrary cross-user rebind", async () => {
    const sid = await source();
    await map(sid);
    const allowed = (billing = billingEmail) =>
      value(
        "select circle_billing_identity_approved($1,'sub_test','cus_test',$2,'member@example.test',$3) as value",
        [sid, uid, billing],
      );
    expect(await allowed()).toBe(false);
    await map(sid, { userId: uid, email: "member@example.test" });
    expect(await allowed()).toBe(true);
    expect(await allowed("unexpected@example.test")).toBe(false);
    await map(sid, { userId: uid, email: "member@example.test", enabled: false });
    expect(await allowed()).toBe(false);
  });
  it("rejects stale source, non-admin actor, and target email/profile mismatch", async () => {
    const sid = await source();
    await expect(map(sid, { expectedStripeId: "sub_other" })).rejects.toThrow("Source changed");
    await expect(map(sid, { actor: uid })).rejects.toThrow("Forbidden");
    await expect(map(sid, { email: "someoneelse@example.test" })).rejects.toThrow(
      "Target identity",
    );
    expect(await value("select count(*)::int as value from circle_source_aliases")).toBe(0);
  });
  it("queues source changes, reversal evidence, profile changes and retired destinations for retry", async () => {
    const sid = await source();
    await map(sid);
    const revision = () =>
      value("select revision::int as value from circle_audience_sync where email=$1", [aliasEmail]);
    expect(await revision()).toBe(1);
    await db.query("update subscriptions set status='canceled' where id=$1", [sid]);
    expect(await revision()).toBe(2);
    await db.exec(
      "update circle_subscription_evidence set review_reason='stripe_payment_fully_refunded'",
    );
    expect(await revision()).toBe(3);
    await db.query("update profiles set email='changed@example.test' where id=$1", [aliasUser]);
    expect(await revision()).toBe(4);
    await map(sid, { enabled: false });
    await db.exec("delete from circle_audience_sync; select queue_circle_audience_sweep()");
    expect(await revision()).toBe(1);
  });
  it("denies members access to alias records, history and approval RPCs", async () => {
    expect(
      await value(
        "select has_table_privilege('service_role','circle_source_aliases','DELETE') as value",
      ),
    ).toBe(false);
    expect(
      await value(
        "select has_table_privilege('service_role','circle_source_alias_history','UPDATE') as value",
      ),
    ).toBe(false);
    for (const role of ["anon", "authenticated"]) {
      expect(
        await value("select has_table_privilege($1,'circle_source_aliases','SELECT') as value", [
          role,
        ]),
      ).toBe(false);
      expect(
        await value(
          "select has_table_privilege($1,'circle_source_alias_history','INSERT') as value",
          [role],
        ),
      ).toBe(false);
      expect(
        await value(
          "select has_function_privilege($1,'circle_billing_identity_approved(uuid,text,text,uuid,text,text)','EXECUTE') as value",
          [role],
        ),
      ).toBe(false);
      expect(
        await value(
          "select has_function_privilege($1,'set_circle_source_alias(uuid,text,text,uuid,text,uuid,text,text,uuid,boolean,text,timestamptz)','EXECUTE') as value",
          [role],
        ),
      ).toBe(false);
    }
  });
});

describe("canonical membership in PostgreSQL", () => {
  it("a refund/dispute hold overrides saved greatest paid-through without restoring canceled access", async () => {
    const sid = await addSub({ status: "canceled" });
    await db.query(
      "insert into circle_legacy_reviews(subscription_id,preserve_access) values($1,false)",
      [sid],
    );
    await evidence();
    await db.query(
      `select apply_circle_subscription_snapshot($1,null,now()+interval '1 second','stripe_payment_fully_refunded')`,
      [
        {
          user_id: uid,
          email: "member@example.test",
          stripe_subscription_id: "sub_test",
          status: "canceled",
          tier: "circle",
        },
      ],
    );
    expect(await decision()).toMatchObject({ state: "review", hasAccess: false });
    expect(
      await value("select paid_through is not null as value from circle_subscription_evidence"),
    ).toBe(true);
    await db.query(
      `select apply_circle_subscription_snapshot($1,null,now()+interval '2 seconds','stripe_payment_unverified')`,
      [
        {
          user_id: uid,
          email: "member@example.test",
          stripe_subscription_id: "sub_test",
          status: "active",
          tier: "circle",
        },
      ],
    );
    expect(await decision()).toMatchObject({ state: "review", hasAccess: false });
  });
  it("payment reversal review preserves an independent owner grant or paid subscription", async () => {
    await addSub({ status: "canceled" });
    await evidence(undefined, future, "stripe_payment_disputed");
    const manual = await addSub({ stripe_subscription_id: null });
    await grant(manual);
    expect(await decision()).toMatchObject({ state: "eligible", hasAccess: true });
    await grant(manual, false);
    await addSub({ stripe_subscription_id: "sub_other" });
    await evidence("sub_other");
    expect(await decision()).toMatchObject({ state: "eligible", hasAccess: true });
  });
  it("payment policy review does not broadly revoke an established unresolved legacy member", async () => {
    const sid = await addSub();
    await db.query(
      "insert into circle_legacy_reviews(subscription_id,preserve_access) values($1,true)",
      [sid],
    );
    await evidence(undefined, future, "stripe_partial_refund_review");
    expect(await decision()).toMatchObject({ state: "review", hasAccess: true });
  });
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
