/* Isolated SQL fixtures only. Native multi-session locking is not certified. */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
import { buildSov, SovMismatch, type SovLineIn } from "./sov";

const owner = randomUUID(),
  outsider = randomUUID(),
  estimator = randomUUID();
const company = randomUUID(),
  job = randomUUID(),
  fresh = randomUUID(),
  accounting = randomUUID();
const unsafe = randomUUID(),
  historicalBad = randomUUID();
let db: PGlite;
let attributesBefore: unknown;
const query = (sql: string, params: unknown[] = [], actor = owner) =>
  asUser(
    db,
    { sub: actor, role: "authenticated", email: "fixture@example.invalid" },
    (tx) => tx.query(sql, params) as Promise<{ rows: Record<string, unknown>[] }>,
  );
const rpc = async (name: string, params: unknown[], actor = owner) => {
  const result = await query(
    `SELECT public.${name}(${params.map((_, i) => `$${i + 1}`).join(",")}) AS value`,
    params,
    actor,
  );
  return (result.rows[0] as { value: Record<string, unknown> }).value;
};
const snapshot = (id = job, actor = owner) => rpc("mcp_estimate_destination_snapshot", [id], actor);
const facts = (module: string, patch: unknown, id = job) =>
  rpc("mcp_set_facts", [id, module, JSON.stringify(patch), "member_answer"]);
const save = (
  version: unknown,
  p: {
    budget?: unknown;
    sov?: unknown;
    draft?: unknown;
    fee?: number;
    basis?: string;
    draftFee?: number;
    draftBasis?: string;
  } = {},
  id = job,
) =>
  rpc("mcp_estimate_destination_save", [
    id,
    version,
    p.budget === undefined ? null : JSON.stringify(p.budget),
    p.sov === undefined ? null : JSON.stringify(p.sov),
    p.draft === undefined ? null : JSON.stringify(p.draft),
    p.fee ?? null,
    p.basis ?? null,
    p.draftFee ?? null,
    p.draftBasis ?? null,
  ]);
const attrs = async () =>
  (
    await db.query(
      "SELECT oid,proowner,proacl,prosecdef,provolatile,proconfig FROM pg_proc WHERE oid IN ('public.mcp_set_facts(uuid,text,jsonb,text)'::regprocedure,'public.mcp_job_sov_terms(uuid,numeric,text)'::regprocedure) ORDER BY oid",
    )
  ).rows;

beforeAll(async () => {
  db = await makeDb();
  for (const actor of [owner, outsider, estimator]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'fixture@example.invalid')", [
      actor,
    ]);
    await db.query("INSERT INTO test_active_members VALUES($1)", [actor]);
  }
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Builder',$2)", [
    company,
    owner,
  ]);
  for (const [actor, role] of [
    [owner, "owner"],
    [estimator, "estimating"],
  ])
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,'Fixture')",
      [company, actor, role],
    );
  for (const id of [job, fresh, accounting, unsafe, historicalBad])
    await db.query(
      "INSERT INTO mcp_jobs(id,company_id,user_id,job_number,name) VALUES($1::uuid,$2,$3,($1::uuid)::text,'Job')",
      [id, company, owner],
    );
  // External CO source shape used by the real billing snapshot. Execution itself
  // is separately covered by change-order-db.test.ts with the full real chain.
  await db.exec(
    "CREATE TABLE mcp_submittals(id uuid PRIMARY KEY,job_id uuid,number text,revision integer); CREATE TABLE mcp_change_orders(submittal_id uuid PRIMARY KEY,job_id uuid,details jsonb);",
  );
  await db.exec(
    readFileSync("supabase/migrations/20261101120001_athena_project_billing_evidence.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/migrations/20261030140000_athena_sov_contract_total_guard.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/migrations/20261030150000_athena_sov_official_lock.sql", "utf8"),
  );
  await db.exec(readFileSync("drizzle/migrations/0057_sov_payment_applications.sql", "utf8"));
  await db.exec(
    readFileSync("drizzle/migrations/0058_payment_application_contract_basis.sql", "utf8"),
  );
  await facts(
    "sov",
    {
      "01": {
        description: "Historical malformed source",
        billable_value: 100,
        executed_change_order: "co",
        fee_included: "false",
      },
    },
    historicalBad,
  );
  await rpc("mcp_job_sov_terms", [historicalBad, 10, "Historical basis"]);
  attributesBefore = await attrs();
  await db.exec(readFileSync("release-proposals/estimating-destination-versions.sql", "utf8"));
});
afterAll(async () => db.close());

describe.sequential("versioned existing budget/SOV destinations", () => {
  it("preserves public writer metadata and returns a guarded versioned model", async () => {
    expect(await attrs()).toEqual(attributesBefore);
    expect(await snapshot()).toMatchObject({
      version: 0,
      company_id: company,
      job_id: job,
      budget: {},
      sov: {},
      sov_draft: {},
      terms: { fee_pct: null, basis: null },
      draft_terms: { fee_pct: null, basis: null },
      official_locked: false,
      capabilities: { destination_cas: true },
    });
    await expect(snapshot(job, outsider)).rejects.toThrow();
    await expect(snapshot(job, estimator)).rejects.toThrow();
  });
  it("safely creates, repeats and appends legacy entries without overwriting existing amounts", async () => {
    await facts("budget", { "09-100": { description: "Paint", amount: 100 } });
    const current = await snapshot();
    await facts("budget", { "09-100": { description: "Paint", amount: 100 } });
    expect((await snapshot()).version).toBe(current.version);
    await facts("budget", {
      "09-100": { description: "Paint", amount: 100 },
      "09-200": { description: "Floor", amount: 0 },
    });
    await expect(
      facts("budget", { "09-100": { description: "Paint", amount: 200 } }),
    ).rejects.toThrow(/version-checked/i);
    expect((await snapshot()).budget).toEqual({
      "09-100": { description: "Paint", amount: 100 },
      "09-200": { description: "Floor", amount: 0 },
    });
  });
  it("rejects stale whole-request saves atomically after a concurrent legacy append", async () => {
    const old = await snapshot();
    await facts("budget", { "09-300": { description: "Trim", amount: 50 } });
    const before = await snapshot();
    await expect(
      save(old.version, {
        budget: { "09-100": { description: "Stale", amount: 999 } },
        draft: { "09.01": { billable_value: 999 } },
      }),
    ).rejects.toThrow(/destination changed/i);
    expect(await snapshot()).toEqual(before);
  });
  it("supports matching-version corrections and genuine zero without changing the official copy", async () => {
    const current = await snapshot();
    const changed = await save(current.version, {
      budget: { "09-100": { description: "Paint", amount: 0 } },
      draft: { "09.01": { description: "Paint", billable_value: 150, cost_codes: ["09-100"] } },
      draftFee: 0,
      draftBasis: "Estimate E1",
    });
    expect(changed).toMatchObject({
      budget: { "09-100": { amount: 0 } },
      sov: {},
      terms: { fee_pct: null, basis: null },
      sov_draft: { "09.01": { billable_value: 150 } },
      draft_terms: { fee_pct: 0, basis: "Estimate E1" },
    });
    expect(Number(changed.version)).toBeGreaterThan(Number(current.version));
    expect(
      (await db.query("SELECT * FROM mcp_private.estimate_destination_write_ticket")).rows,
    ).toHaveLength(0);
  });
  it("blocks direct existing-fact edits/removals and cannot be bypassed with a forged custom GUC", async () => {
    const before = await snapshot();
    await expect(
      db.query("UPDATE mcp_job_facts SET value='{}'::jsonb WHERE job_id=$1 AND module='budget'", [
        job,
      ]),
    ).rejects.toThrow(/version-checked/i);
    await expect(
      db.query("DELETE FROM mcp_job_facts WHERE job_id=$1 AND module='budget'", [job]),
    ).rejects.toThrow(/version-checked/i);
    await expect(
      asUser(
        db,
        { sub: owner, role: "service_role", email: "fixture@example.invalid" },
        async (tx) => {
          await tx.query("SELECT set_config('athena.destination_version_checked','true',true)");
          await tx.query(
            "UPDATE mcp_job_facts SET value='{}'::jsonb WHERE job_id=$1 AND module='budget'",
            [job],
          );
        },
      ),
    ).rejects.toThrow(/version-checked/i);
    expect(await snapshot()).toEqual(before);
    const permission = await db.query<{ allowed: boolean }>(
      "SELECT has_table_privilege('authenticated','mcp_private.estimate_destination_write_ticket','INSERT') AS allowed",
    );
    expect(permission.rows[0].allowed).toBe(false);
  });
  it("protects legacy draft corrections and preserves omitted draft rows", async () => {
    await expect(
      facts("sov_draft", { "09.01": { description: "Stale", billable_value: 1 } }),
    ).rejects.toThrow(/version-checked/i);
    const current = await snapshot();
    const changed = await save(current.version, {
      draft: { "09.02": { description: "Floor", billable_value: 0, cost_codes: ["09-200"] } },
      draftFee: 10,
      draftBasis: "Reviewed E2",
    });
    expect(changed).toMatchObject({
      sov_draft: { "09.01": { billable_value: 150 }, "09.02": { billable_value: 0 } },
      draft_terms: { fee_pct: 10, basis: "Reviewed E2" },
      terms: { fee_pct: null, basis: null },
    });
  });
  it("requires CAS for direct term corrections and protected module reassignment", async () => {
    const before = await snapshot();
    await expect(
      db.query(
        "UPDATE mcp_private.estimate_destination_draft_terms SET fee_pct=20 WHERE job_id=$1",
        [job],
      ),
    ).rejects.toThrow(/version-checked/i);
    await facts("contract", { temporary_source: { amount: 1 } });
    await expect(
      db.query(
        "UPDATE mcp_job_facts SET module='budget' WHERE job_id=$1 AND module='contract' AND key='temporary_source'",
        [job],
      ),
    ).rejects.toThrow(/version-checked/i);
    expect((await snapshot()).draft_terms).toEqual(before.draft_terms);
  });
  it("rejects fee percentages that the persisted four-decimal values would round", async () => {
    const columns = await db.query<{
      column_name: string;
      numeric_scale: number;
      numeric_precision: number;
    }>(
      "SELECT column_name,numeric_scale,numeric_precision FROM information_schema.columns WHERE (table_schema='public' AND table_name='mcp_jobs' AND column_name='sov_fee_pct') OR (table_schema='mcp_private' AND table_name='estimate_destination_draft_terms' AND column_name='fee_pct') ORDER BY column_name",
    );
    expect(columns.rows).toEqual([
      { column_name: "fee_pct", numeric_scale: 4, numeric_precision: 7 },
      { column_name: "sov_fee_pct", numeric_scale: 4, numeric_precision: 7 },
    ]);
    const before = await snapshot();
    await expect(save(before.version, { fee: 1.23456 })).rejects.toThrow(/four decimal places/i);
    await expect(save(before.version, { draftFee: 1.23456 })).rejects.toThrow(
      /four decimal places/i,
    );
    expect(await snapshot()).toEqual(before);
    const saved = await save(before.version, { fee: 0.1234, draftFee: 1.2345 });
    expect(saved).toMatchObject({ terms: { fee_pct: 0.1234 }, draft_terms: { fee_pct: 1.2345 } });
  });
  it("initializes official values and chosen terms in one transaction, then preserves the approved-CO lock", async () => {
    const first = await save(
      (await snapshot(fresh)).version,
      {
        sov: { "09.01": { description: "Paint", billable_value: 900, cost_codes: ["09-100"] } },
        fee: 10,
        basis: "Executed agreement",
      },
      fresh,
    );
    expect(first).toMatchObject({
      official_locked: true,
      terms: { fee_pct: 10, basis: "Executed agreement" },
    });
    await expect(
      save(
        first.version,
        { sov: { "09.01": { description: "Paint", billable_value: 901 } } },
        fresh,
      ),
    ).rejects.toThrow(/approved change order/i);
    expect(await snapshot(fresh)).toEqual(first);
    await expect(rpc("mcp_job_sov_terms", [fresh, 20, "Different basis"])).rejects.toThrow(
      /version-checked/i,
    );
    await expect(save(first.version, { fee: 20 }, fresh)).rejects.toThrow(/approved change order/i);
    const renamed = await save(
      first.version,
      {
        sov: {
          "09.01": {
            description: "Reviewed description",
            billable_value: 900,
            cost_codes: ["09-100"],
          },
        },
      },
      fresh,
    );
    expect(renamed.sov).toMatchObject({
      "09.01": { description: "Reviewed description", billable_value: 900 },
    });
  });
  it("rolls back budget changes, draft terms and revision if the later official write fails", async () => {
    const before = await snapshot(fresh);
    await expect(
      save(
        before.version,
        {
          budget: { "09-100": { description: "Must roll back", amount: 123 } },
          sov: { "09.01": { billable_value: 901 } },
          draftFee: 20,
        },
        fresh,
      ),
    ).rejects.toThrow(/approved change order/i);
    expect(await snapshot(fresh)).toEqual(before);
    expect(
      (await db.query("SELECT * FROM mcp_private.estimate_destination_write_ticket")).rows,
    ).toHaveLength(0);
  });
  it("advances revision for approved-CO direct inserts and contract totals without weakening their writer", async () => {
    const sub = randomUUID();
    const before = await snapshot(fresh);
    await db.query("INSERT INTO mcp_submittals(id,job_id,number,revision) VALUES($1,$2,'CO1',0)", [
      sub,
      fresh,
    ]);
    await db.query(
      "INSERT INTO mcp_change_orders(submittal_id,job_id,details) VALUES($1,$2,$3::jsonb)",
      [sub, fresh, JSON.stringify({ state: "executed", total_cents: 10000 })],
    );
    await db.query(
      "INSERT INTO mcp_job_facts(job_id,module,key,value,status,source,internal_only,updated_by) VALUES($1,'sov','09.002',$2::jsonb,'known','member_answer',true,$3)",
      [
        fresh,
        JSON.stringify({
          description: "Approved change",
          billable_value: 100,
          executed_change_order: sub,
          fee_included: true,
          cost_codes: [],
        }),
        owner,
      ],
    );
    await facts("contract", { executed_change_orders: 100 }, fresh);
    const after = await snapshot(fresh);
    expect(Number(after.version)).toBeGreaterThan(Number(before.version));
    expect(after.sov).toMatchObject({
      "09.002": { billable_value: 100, executed_change_order: sub },
    });
    expect(after.changes as unknown[]).toHaveLength(1);
    await expect(
      save(before.version, { draft: { "09.90": { billable_value: 999 } } }, fresh),
    ).rejects.toThrow(/destination changed/i);
  });
  it("invalidates a pending destination when contract source metadata changes", async () => {
    const before = await snapshot();
    await facts("contract", { retainage: "5% supplied terms" });
    await expect(save(before.version, { budget: { "09-100": { amount: 100 } } })).rejects.toThrow(
      /destination changed/i,
    );
  });
  it("preserves the real 0058 reviewed contract-basis save and leaves no capability ticket", async () => {
    await save(
      (await snapshot(accounting)).version,
      {
        sov: { "01.01": { description: "Base", billable_value: 1000 } },
        fee: 0,
        basis: "Contract A",
      },
      accounting,
    );
    await facts("contract", { contract_value: 1000 }, accounting);
    const before = await snapshot(accounting);
    const read = await rpc("mcp_billing_evidence_record", [
      accounting,
      "contract_basis_read",
      "{}",
    ]);
    const p = {
      request_id: randomUUID(),
      original_cents: 100000,
      basis: "Executed agreement A",
      expected_version: read.version,
    };
    const review = await rpc("mcp_billing_evidence_record", [
      accounting,
      "contract_basis_review",
      JSON.stringify(p),
    ]);
    const result = await rpc("mcp_billing_evidence_record", [
      accounting,
      "contract_basis_save",
      JSON.stringify({ ...p, review_key: review.review_key }),
    ]);
    expect(result).toMatchObject({ saved: true, original_cents: 100000 });
    expect(Number((await snapshot(accounting)).version)).toBeGreaterThan(Number(before.version));
    expect(
      (await db.query("SELECT * FROM mcp_private.estimate_destination_write_ticket")).rows,
    ).toHaveLength(0);
  });
  it("rechecks membership after a lock wait and rolls back protected edits", async () => {
    const version = (await snapshot()).version;
    const original = (
      await db.query<{ definition: string }>(
        "SELECT pg_get_functiondef('mcp_private.estimate_destination_lock(uuid)'::regprocedure) AS definition",
      )
    ).rows[0].definition;
    await db.exec(`CREATE OR REPLACE FUNCTION mcp_private.estimate_destination_lock(_job uuid) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
      DECLARE v bigint; BEGIN SELECT version INTO v FROM mcp_private.estimate_destination_revision WHERE job_id=_job FOR UPDATE;
      DELETE FROM public.mcp_company_members WHERE user_id=auth.uid() AND company_id=(SELECT company_id FROM public.mcp_jobs WHERE id=_job); RETURN v; END $$;`);
    try {
      await expect(save(version, { budget: { "09-100": { amount: 111 } } })).rejects.toThrow();
    } finally {
      await db.exec(original);
    }
    expect((await snapshot()).version).toBe(version);
  });
  it("rejects a drifted installation before adding schema or grants", async () => {
    const isolated = await makeDb();
    try {
      await isolated.exec(
        readFileSync(
          "supabase/migrations/20261030140000_athena_sov_contract_total_guard.sql",
          "utf8",
        ),
      );
      await isolated.exec(
        readFileSync("supabase/migrations/20261030150000_athena_sov_official_lock.sql", "utf8"),
      );
      await isolated.exec(
        "CREATE TABLE mcp_submittals(id uuid,job_id uuid); CREATE TABLE mcp_change_orders(job_id uuid); CREATE OR REPLACE FUNCTION public.mcp_job_sov_terms(_job uuid,_fee_pct numeric,_basis text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Changed source'; END $$;",
      );
      await expect(
        isolated.exec(
          readFileSync("release-proposals/estimating-destination-versions.sql", "utf8"),
        ),
      ).rejects.toThrow(/source dependencies differ/i);
      const state = await isolated.query<{ private_table: string | null; rpc: string | null }>(
        "SELECT to_regclass('mcp_private.estimate_destination_draft_terms')::text AS private_table,to_regprocedure('public.mcp_estimate_destination_snapshot(uuid)')::text AS rpc",
      );
      expect(state.rows[0]).toEqual({ private_table: null, rpc: null });
    } finally {
      await isolated.close();
    }
  });
  it("rejects malformed nested flags on initial CAS, legacy and direct source writes", async () => {
    const before = await snapshot(unsafe);
    for (const flags of [
      { fee_included: "false", executed_change_order: "co" },
      { fee_included: null },
      { fee_included: 1 },
      { fee_included: true, executed_change_order: true },
      { fee_included: true, executed_change_order: "" },
    ]) {
      const line = { description: "Unsafe", billable_value: 100, ...flags };
      await expect(save(before.version, { sov: { "01": line }, fee: 10 }, unsafe)).rejects.toThrow(
        /fee_included|executed_change_order/i,
      );
      await expect(facts("sov", { "01": line }, unsafe)).rejects.toThrow(
        /fee_included|executed_change_order/i,
      );
      await expect(
        db.query(
          "INSERT INTO mcp_job_facts(job_id,module,key,value,status,source,updated_by) VALUES($1,'sov','01',$2::jsonb,'known','member_answer',$3)",
          [unsafe, JSON.stringify(line), owner],
        ),
      ).rejects.toThrow(/fee_included|executed_change_order/i);
      expect(await snapshot(unsafe)).toEqual(before);
    }
  });
  it("blocks client-invented executed sources but preserves approved writer timing and exact draft copies", async () => {
    const sub = randomUUID();
    await db.query(
      "INSERT INTO mcp_submittals(id,job_id,number,revision) VALUES($1,$2,'CO-approved',0)",
      [sub, unsafe],
    );
    await db.query(
      "INSERT INTO mcp_change_orders(submittal_id,job_id,details) VALUES($1,$2,$3::jsonb)",
      [sub, unsafe, JSON.stringify({ state: "approved", total_cents: 10000 })],
    );
    const line = {
      description: "Approved change",
      billable_value: 100,
      executed_change_order: sub,
      fee_included: true,
    };
    const before = await snapshot(unsafe);
    await expect(save(before.version, { sov: { "02": line }, fee: 10 }, unsafe)).rejects.toThrow(
      /cannot be invented/i,
    );
    await expect(facts("sov", { "02": line }, unsafe)).rejects.toThrow(/cannot be invented/i);
    await save(
      before.version,
      { sov: { "01": { description: "Base", billable_value: 100, fee_included: false } }, fee: 10 },
      unsafe,
    );
    await db.query(
      "INSERT INTO mcp_job_facts(job_id,module,key,value,status,source,updated_by) VALUES($1,'sov','02',$2::jsonb,'known','member_answer',$3)",
      [unsafe, JSON.stringify(line), owner],
    );
    const official = await snapshot(unsafe);
    const rows = Object.entries(official.sov as Record<string, Record<string, unknown>>).map(
      ([item_no, value]) => ({
        item_no,
        description: String(value.description),
        scheduled_value: value.billable_value,
        fee_included: value.fee_included,
        executed_change_order: value.executed_change_order,
      }),
    ) as SovLineIn[];
    expect(buildSov(rows, 10, null).summary.contract_total).toBe(211.11);
    await save(
      official.version,
      { draft: { "02": line }, draftFee: 10, draftBasis: "Copied approved source" },
      unsafe,
    );
    const copied = await snapshot(unsafe);
    expect(copied.sov_draft).toMatchObject({ "02": line });
    await expect(
      save(copied.version, { draft: { "02": { ...line, billable_value: 99 } } }, unsafe),
    ).rejects.toThrow(/preserve the exact existing official/i);
    expect(await snapshot(unsafe)).toEqual(copied);
  });
  it("holds pre-existing malformed rows at guarded read and real SOV calculation boundaries", async () => {
    await expect(snapshot(historicalBad)).rejects.toThrow(/fee_included must be a boolean/i);
    const raw = (
      await db.query<{ value: Record<string, unknown> }>(
        "SELECT value FROM mcp_job_facts WHERE job_id=$1 AND module='sov'",
        [historicalBad],
      )
    ).rows[0].value;
    expect(() =>
      buildSov(
        [
          {
            item_no: "01",
            description: "Historical source",
            scheduled_value: raw.billable_value,
            executed_change_order: raw.executed_change_order,
            fee_included: raw.fee_included,
          } as SovLineIn,
        ],
        10,
        null,
      ),
    ).toThrow(SovMismatch);
  });
});
