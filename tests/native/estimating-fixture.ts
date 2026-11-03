// Synthetic fixture only. It opens no native connection and accepts no database URL.
// The caller owns the already-authorized PGlite/native lifecycle and adapter.
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { makeBuyoutDb, ids } from "../buyout/fixture";
import { makeDb } from "../mcp-roles/db";
import { GC_ITEMS } from "../../src/lib/mcp/estimating-bid";

export { ids };

export interface QueryDb {
  query<T = Record<string, unknown>>(sql: string, args?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}
export interface FixtureDb extends QueryDb {
  transaction<T>(fn: (tx: QueryDb) => Promise<T>): Promise<T>;
  close(): Promise<unknown>;
}
export type FixtureFactory = () => Promise<FixtureDb>;

const read = (path: string) => readFileSync(path, "utf8");
const email = (actor: string) => `${actor}@example.invalid`;

/** Extract the unchanged first function statement, refusing an absent marker. */
export function sourceFunction(path: string, name: string): { sql: string; body: string } {
  if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/i.test(name))
    throw new Error("Choose a literal source function name.");
  const pattern = new RegExp(
    `CREATE(?: OR REPLACE)? FUNCTION\\s+${name.replace(".", "\\.")}\\b[\\s\\S]*?\\bAS\\s+(\\$(?:[a-z_][a-z0-9_]*)?\\$)([\\s\\S]*?)\\1\\s*;`,
    "i",
  );
  const match = read(path).match(pattern);
  if (!match) throw new Error(`Source function ${name} was not found in ${path}.`);
  return { sql: match[0], body: match[2] };
}

export const fixtureAuthSources = [
  {
    signature: "public.has_role(uuid,public.app_role)",
    name: "public.has_role",
    path: "supabase/migrations/20260518141113_1dd88491-dd03-4200-ad4d-2318db517045.sql",
  },
  {
    signature: "public.tier_rank(public.app_tier)",
    name: "public.tier_rank",
    path: "supabase/migrations/20260522045845_40090842-25e6-48d2-b9ac-c009162b9837.sql",
  },
  {
    signature: "public.get_circle_entitlement(uuid,text)",
    name: "public.get_circle_entitlement",
    path: "supabase/migrations/20261004190813_circle_entitlement_reconciliation.sql",
  },
  {
    signature: "public.get_user_tier(uuid)",
    name: "public.get_user_tier",
    path: "supabase/migrations/20261004190813_circle_entitlement_reconciliation.sql",
  },
  {
    signature: "mcp_private.is_circle_active(uuid)",
    name: "mcp_private.is_circle_active",
    path: "drizzle/migrations/0003_mcp_module1_job_setup.sql",
  },
  {
    signature: "public.mcp_gate()",
    name: "public.mcp_gate",
    path: "supabase/migrations/20261024104817_athena_circle_company_provisioning.sql",
  },
  {
    signature: "public.mcp_job_scope(uuid)",
    name: "public.mcp_job_scope",
    path: "supabase/migrations/20261022120000_athena_account_team_privacy_terms.sql",
  },
] as const;

export async function readAuthorizationFingerprints(db: QueryDb) {
  return Promise.all(
    fixtureAuthSources.map(async (source) => {
      const row = (
        await db.query<{
          body: string;
          body_md5: string;
          owner_name: string;
          acl: string | null;
          config: string[] | null;
          security_definer: boolean;
          volatility: string;
        }>(
          `SELECT prosrc AS body, md5(prosrc) AS body_md5,
                  pg_get_userbyid(proowner) AS owner_name, proacl::text AS acl,
                  proconfig AS config, prosecdef AS security_definer,
                  provolatile::text AS volatility
           FROM pg_proc WHERE oid=$1::regprocedure`,
          [source.signature],
        )
      ).rows[0];
      if (!row || row.body !== sourceFunction(source.path, source.name).body)
        throw new Error(`Authorization body drifted: ${source.signature}`);
      return { ...source, ...row };
    }),
  );
}

async function installMembership(db: FixtureDb) {
  // Replace the base fixture's entitlement/tier stand-ins, without CASCADE or
  // editing an authorization body to fit the test. Exact source functions follow.
  await db.exec(`
    ALTER TABLE auth.users ADD COLUMN email_confirmed_at timestamptz;
    CREATE TYPE public.app_tier AS ENUM (
      'aos_only','book_buyer','power_hour','sm_school','contractor_school',
      'intensive','circle','hardcore'
    );
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,email text,full_name text);
    CREATE TABLE public.aos_addons(user_id uuid,email text,kind text,quantity integer,status text);
    CREATE TABLE public.aos_links(user_id uuid,aos_email text);
    CREATE TABLE public.stripe_webhook_events(
      event_id text PRIMARY KEY,event_type text,object_id text,status text,
      attempts integer DEFAULT 1,processing_started_at timestamptz,
      processed_at timestamptz,last_error text,updated_at timestamptz DEFAULT now()
    );
    DROP FUNCTION public.get_circle_entitlement(uuid,text);
    DROP FUNCTION public.get_user_tier(uuid);
  `);
  const core = read("supabase/migrations/20260518141113_1dd88491-dd03-4200-ad4d-2318db517045.sql");
  const end = core.indexOf("-- Access helper used by content RLS");
  if (end < 0) throw new Error("Membership core fixture boundary changed.");
  // Actual app_role/user_roles/has_role and subscriptions schema/policies.
  await db.exec(core.slice(0, end));
  await db.exec(
    "ALTER TABLE public.subscriptions ADD COLUMN tier public.app_tier DEFAULT 'circle';",
  );
  await db.exec(sourceFunction(fixtureAuthSources[1].path, "public.tier_rank").sql);
  const identity = read(
    "supabase/migrations/20260527182404_9674d14f-9cbd-46bd-8a50-4e651788d04d.sql",
  );
  const identityEnd = identity.indexOf("CREATE OR REPLACE FUNCTION public.get_user_aos_limits");
  if (identityEnd < 0) throw new Error("Identity fixture boundary changed.");
  await db.exec(identity.slice(0, identityEnd));
  for (const name of [
    "20261004190813_circle_entitlement_reconciliation.sql",
    "20261004201435_circle_source_aliases.sql",
    "20261024104817_athena_circle_company_provisioning.sql",
    "20261024110422_athena_circle_verified_payment_claim.sql",
  ])
    await db.exec(read(`supabase/migrations/${name}`));
  // makeBuyoutDb already installed team invites and the later privacy scope.
  // Provisioning retains those functions; body equality below prevents drift.
  for (const actor of [
    ids.owner,
    ids.pm,
    ids.ap,
    ids.other,
    ids.super,
    ids.contracts,
    ids.locked,
  ]) {
    await db.query("UPDATE auth.users SET email=$2,email_confirmed_at=now() WHERE id=$1", [
      actor,
      email(actor),
    ]);
    await db.query("INSERT INTO public.profiles(id,email,full_name) VALUES($1,$2,'Synthetic')", [
      actor,
      email(actor),
    ]);
  }
  // Distinct addresses prevent an inactive user matching another actor's grant.
  for (const actor of [ids.owner, ids.other])
    await db.query(
      `INSERT INTO public.circle_owner_grants(user_id,email,granted_by,reason)
       VALUES($1,$2,$1,'Synthetic native estimating fixture')`,
      [actor, email(actor)],
    );
  await db.query(
    `INSERT INTO public.mcp_company_members(company_id,user_id,role,display_name)
     VALUES($1,$2,'owner','Synthetic foreign owner')`,
    [ids.company2, ids.other],
  );
  await db.exec("DELETE FROM public.mcp_gate_cache; DROP TABLE public.test_active_members;");
  await readAuthorizationFingerprints(db);
}

export const fixtureProposalPaths = [
  "estimating-member-read-transactions.sql",
  "estimating-quote-coverage.sql",
  "estimating-gc-requirements-cas.sql",
  "estimating-frozen-source-snapshot.sql",
  "estimating-requirement-sources.sql",
  "estimating-destination-versions.sql",
  "estimating-buyout-handoff.sql",
  "estimating-facts-handoff.sql",
  "estimating-bid-artifact-storage.sql",
].map((name) => `release-proposals/${name}`);

// Exact exposed RPC inventory; exercise actual inherited privileges as well as direct ACLs.
export const memberEstimateRpcs = [
  "public.mcp_estimate_coverage_snapshot(uuid)",
  "public.mcp_estimate_coverage_review(uuid,uuid,bigint,jsonb)",
  "public.mcp_estimate_coverage_save(uuid,uuid,boolean)",
  "public.mcp_estimate_pricing_save_versioned(uuid,bigint,jsonb,jsonb,jsonb,jsonb)",
  "public.mcp_estimate_bid_save_versioned(uuid,bigint,numeric,numeric)",
  "public.mcp_estimate_snapshot_review(uuid,uuid,bigint)",
  "public.mcp_estimate_snapshot_save(uuid,uuid,boolean)",
  "public.mcp_estimate_snapshot_read(uuid,uuid)",
  "public.mcp_estimate_destination_snapshot(uuid)",
  "public.mcp_estimate_destination_save(uuid,bigint,jsonb,jsonb,jsonb,numeric,text,numeric,text)",
] as const;
export const serviceEstimateRpcs = [
  "public.mcp_estimate_buyout_handoff(uuid,uuid,text,uuid,jsonb)",
  "public.mcp_estimate_facts_handoff(uuid,uuid,text,uuid,jsonb)",
] as const;

export async function assertEstimatingRpcPrivileges(db: QueryDb) {
  for (const [signatures, expected] of [
    [memberEstimateRpcs, { member: true, service: false }],
    [serviceEstimateRpcs, { member: false, service: true }],
  ] as const) {
    for (const signature of signatures) {
      const row = (await db.query<{ member: boolean; service: boolean; anon: boolean; owner: boolean }>(
        `SELECT has_function_privilege('authenticated',$1::regprocedure,'EXECUTE') AS member,
                has_function_privilege('service_role',$1::regprocedure,'EXECUTE') AS service,
                has_function_privilege('anon',$1::regprocedure,'EXECUTE') AS anon,
                has_function_privilege(pg_get_userbyid(p.proowner),p.oid,'EXECUTE') AS owner
         FROM pg_proc p WHERE p.oid=$1::regprocedure`, [signature],
      )).rows[0];
      if (!row || row.member !== expected.member || row.service !== expected.service || row.anon || !row.owner)
        throw new Error(`Unexpected effective RPC privileges for ${signature}: ${JSON.stringify(row)}`);
    }
  }
}

// Test harness only. Production would pin each expected hash independently.
export function wrapVerifiedMigration(sql: string, expected?: string): string {
  const bytes = Buffer.from(sql, "utf8");
  const sha = expected ?? createHash("sha256").update(bytes).digest("hex");
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error("Invalid pinned SHA-256");
  const encoded = bytes.toString("base64");
  return `DO $verified_migration$ DECLARE payload bytea := decode('${encoded}', 'base64'); BEGIN
    IF encode(sha256(payload), 'hex') IS DISTINCT FROM '${sha}' THEN
      RAISE EXCEPTION 'Migration payload SHA-256 mismatch';
    END IF;
    EXECUTE convert_from(payload, 'UTF8');
  END $verified_migration$;`;
}

export async function installEstimatingFixture(
  createDb: FixtureFactory = makeDb as unknown as FixtureFactory,
): Promise<FixtureDb> {
  // makeBuyoutDb installs/seed existing purchase-order and buyout workflows. Its
  // native adapter boundary is structural; no connection is opened in this file.
  const db = (await makeBuyoutDb(createDb as unknown as typeof makeDb)) as unknown as FixtureDb;
  try {
    await installMembership(db);
    await db.exec(
      "CREATE TABLE public.mcp_change_orders(submittal_id uuid PRIMARY KEY,job_id uuid,details jsonb);",
    );
    for (const path of [
      "supabase/migrations/20261101120001_athena_project_billing_evidence.sql",
      "supabase/migrations/20261030140000_athena_sov_contract_total_guard.sql",
      "supabase/migrations/20261030150000_athena_sov_official_lock.sql",
      "drizzle/migrations/0057_sov_payment_applications.sql",
      "drizzle/migrations/0058_payment_application_contract_basis.sql",
      "supabase/migrations/20261022200000_athena_estimating.sql",
      "supabase/migrations/20261022230000_athena_estimating_bid.sql",
      "supabase/migrations/20261023010000_athena_estimating_conventions.sql",
    ])
      await db.exec(read(path));
    // Storage HTTP/signing is not emulated. These are only the existing SQL
    // interface/default role privileges needed to exercise the exact policies.
    await db.exec(`
      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA storage TO authenticated,service_role;
      GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated,service_role;
    `);
    for (const name of [
      "20261021000000_athena_file_shares.sql",
      "20261026120000_athena_drawing_sets.sql",
      "20261031120000_athena_file_upload.sql",
      "20261027130000_athena_drawing_versions.sql",
      "20261024005713_athena_takeoff_engine.sql",
      "20261024160000_athena_takeoff_carry_by_identity.sql",
    ])
      await db.exec(read(`supabase/migrations/${name}`));
    await db.exec(
      `INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
       VALUES('athena-estimate-exports','athena-estimate-exports',false,10485760,
         ARRAY['application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[])`,
    );
    const good = "CREATE TABLE public.integrity_corruption_probe(n int);";
    const changed = "CREATE TABLE public.integrity_corruption_probe(n bigint);";
    const pinned = createHash("sha256").update(good).digest("hex");
    let rejected = false;
    try { await db.exec(wrapVerifiedMigration(changed, pinned)); } catch (error) {
      if (!String(error).includes("Migration payload SHA-256 mismatch")) throw error;
      rejected = true;
    }
    if (!rejected || (await db.query("SELECT to_regclass('public.integrity_corruption_probe') AS t")).rows[0].t !== null)
      throw new Error("Corrupted payload was not rejected before execution");
    let rolledBack = false;
    try { await db.exec(wrapVerifiedMigration("CREATE TABLE public.integrity_rollback_probe(n int); SELECT 1/0;")); } catch (error) {
      if (!String(error).includes("division by zero")) throw error;
      rolledBack = true;
    }
    if (!rolledBack || (await db.query("SELECT to_regclass('public.integrity_rollback_probe') AS t")).rows[0].t !== null)
      throw new Error("Failed wrapped payload was not rolled back");
    const expectedHashes = [
      "373f682e84fd7f3a1488134680ae7dddff75dc3314b92f6e6e8275ae320b3dd5",
      "a7bf053579855b71424f3e6c416e0ed2bc16c251aa450dd041c614fb6397c568",
      "2bf04de4391a243efd1d127738356cbb81cc6d207ddfbd1764eed06b86b7ef11",
      "251619f3d7284c04b594acd0cf87d8764bbd4b74d54ff83dfea11e064ac10bad",
      "837ec120fa5c999a9279d79fddd77dc1edcd47b981b70ae0f714b9dcc7b1c4cb",
      "96f481a4ec56699b9a464df180a27941ded93f94b567694d1265f4189c6ae11c",
      "9486fb9470c2765059ab803ff3f2598096853688bc09210ef793f7e0a0cab3d3",
    ];
    for (let i = 0; i < fixtureProposalPaths.length; i++) {
      const text = read(fixtureProposalPaths[i]);
      await db.exec(i >= 1 && i <= 7 ? wrapVerifiedMigration(text, expectedHashes[i - 1]) : text);
    }
    await assertEstimatingRpcPrivileges(db);
    await readAuthorizationFingerprints(db);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

/** Caller-supplied RPC names/argument keys must be literal identifiers. */
export async function rpc<T = Record<string, unknown>>(
  db: FixtureDb,
  name: string,
  args: Record<string, unknown>,
  actor = ids.owner,
  role: "authenticated" | "anon" | "service_role" = "authenticated",
): Promise<T> {
  if (
    !/^[a-z_][a-z0-9_]*$/i.test(name) ||
    Object.keys(args).some((k) => !/^_[a-z_][a-z0-9_]*$/i.test(k))
  )
    throw new Error("Choose literal fixture RPC identifiers.");
  return db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE ${role}`);
    await tx.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: actor, email: email(actor), role }),
    ]);
    const keys = Object.keys(args);
    const data = await tx.query<{ data: T }>(
      `SELECT public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(",")}) AS data`,
      Object.values(args),
    );
    return data.rows[0].data;
  });
}

export const liveSnapshot = (db: FixtureDb) =>
  rpc(db, "mcp_estimate_coverage_snapshot", { _job: ids.job });

export async function seedReadyEstimate(db: FixtureDb) {
  await rpc(db, "mcp_estimate_setup_save", {
    _job: ids.job,
    _patch: {
      role: "gc",
      trades: ["Finishes"],
      in_scope: ["Paint"],
      out_scope: ["Foundation work"],
    },
  });
  await rpc(db, "mcp_estimate_takeoff_save", {
    _job: ids.job,
    _revision: "A",
    _scales: [],
    _lines: [
      {
        line_no: 1,
        item: "Paint",
        qty: 100,
        unit: "SF",
        sheet: "A1",
        basis: "measured",
        math: "100 SF",
      },
    ],
  });
  await rpc(db, "mcp_takeoff_geometry_save", {
    _job: ids.job,
    _operation: "not_drawable",
    _expected: 0,
    _record: {
      line_no: 1,
      takeoff_version: 1,
      exception_kind: "schedule_quantity",
      quantity: 100,
      reason: "Synthetic schedule quantity explicitly confirmed",
    },
  });
  await rpc(db, "mcp_estimate_gc_save", {
    _job: ids.job,
    _start: null,
    _finish: null,
    _days: 1,
    _lines: GC_ITEMS.map(({ key }) => ({ key, amount: 0, qty: 1, rate: 0, confirmed: true })),
  });
  await rpc(db, "mcp_estimate_bid_save", { _job: ids.job, _overhead: 10, _profit: 10 });
  const before = await liveSnapshot(db);
  await rpc(db, "mcp_estimate_pricing_save_versioned", {
    _job: ids.job,
    _expected_version: before.version,
    _labor: [{ ref: "T-1", production_per_man_hour: 10, hourly_rate: 100, confirmed: true }],
    _material: [{ ref: "T-1", unit_price: 5, confirmed: true }],
    _quotes: null,
    _sources: null,
  });
  const unscanned = await liveSnapshot(db);
  await rpc(db, "mcp_estimate_requirements_save", {
    _job: ids.job,
    _items: {
      expected_version: unscanned.version,
      source_sha256: (unscanned.requirement_sources as { sha256: string }).sha256,
      reviewed_confirmations: [],
      items: [],
    },
  });
  const current = await liveSnapshot(db);
  const request = randomUUID();
  await rpc(db, "mcp_estimate_snapshot_review", {
    _job: ids.job,
    _request: request,
    _expected_version: current.version,
  });
  const saved = await rpc(db, "mcp_estimate_snapshot_save", {
    _job: ids.job,
    _request: request,
    _confirmed: true,
  });
  return rpc(db, "mcp_estimate_snapshot_read", { _job: ids.job, _snapshot: saved.snapshot_id });
}
