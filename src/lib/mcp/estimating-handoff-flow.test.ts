/* Synthetic actual-handler + existing buyout + estimating SQL integration.
 * Admin RPC is simulated in PGlite; no network, keys or live records are used. */
import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeBuyoutDb, ids } from "../../../tests/buyout/fixture";
import { fakeClient, asUser } from "../../../tests/mcp-roles/fake-supabase";

const state = vi.hoisted(() => ({
  sb: null as unknown,
  actor: "",
  validIdentity: true,
  beforeSave: false,
  loseResponse: false,
  adminCalls: [] as Record<string, unknown>[],
}));
vi.mock("./guard", () => ({
  run: async (_n: string, _c: unknown, _o: unknown, fn: (sb: unknown) => unknown) => fn(state.sb),
  text: (text: string) => ({ content: [{ type: "text", text }] }),
  dbError: (e: { message: string }) => {
    throw new Error(e.message);
  },
  isMissingFunction: () => false,
}));
vi.mock("./jobs", () => ({
  resolveJob: async () => ({
    job_id: ids.job,
    company_id: ids.company,
    job_number: "900071",
    name: "Synthetic Example",
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: async (name: string, p: Record<string, unknown>) => {
      expect(name).toBe("mcp_estimate_buyout_handoff");
      state.adminCalls.push(p);
      if (p._step === "save" && state.beforeSave) {
        state.beforeSave = false;
        return { data: null, error: { message: "Interrupted before save" } };
      }
      try {
        const data = await service(p);
        if (p._step === "save" && state.loseResponse) {
          state.loseResponse = false;
          return { data: null, error: { message: "Interrupted after commit" } };
        }
        return { data, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
  }),
}));
import { estimateHandoff } from "./tools/estimate-handoff-tool";
import { GC_ITEMS } from "./estimating-bid";
import { calculateSavedBidSnapshot } from "./tools/estimate-bid-tools";
import { bidComponents } from "./estimating-handoff-preview";

let db: PGlite;
let source: Record<string, unknown>;
const packageId = randomUUID();
const member = (user: string) =>
  fakeClient(db, { sub: user, role: "authenticated", email: "fixture@example.invalid" });
const rpc = async (fn: string, p: Record<string, unknown>, user = ids.owner) => {
  const r = await member(user).rpc(fn, p);
  if (r.error) throw new Error(r.error.message);
  return r.data as Record<string, unknown>;
};
async function service(p: Record<string, unknown>) {
  return asUser(
    db,
    { sub: ids.owner, role: "service_role", email: "fixture@example.invalid" },
    async (tx) =>
      (
        await tx.query(
          "SELECT public.mcp_estimate_buyout_handoff($1::uuid,$2::uuid,$3::text,$4::uuid,$5::jsonb) AS data",
          [p._job, p._actor, p._step, p._request, JSON.stringify(p._p)],
        )
      ).rows[0].data as Record<string, unknown>,
  );
}
function selectActor(user = ids.owner) {
  state.actor = user;
  state.sb = {
    ...member(user),
    auth: {
      getUser: async () => ({
        error: null,
        data: { user: state.validIdentity ? { id: state.actor } : null },
      }),
    },
  };
}
const call = async (args: Record<string, unknown>) =>
  (
    estimateHandoff as unknown as {
      handler: (a: unknown, c: unknown) => Promise<{ structuredContent: Record<string, unknown> }>;
    }
  ).handler(
    { job_number: "900071", destination: "buyout", ...args },
    { getToken: () => "synthetic-verified-token" },
  );
async function ledger() {
  return rpc("mcp_buyout_get", { _company: ids.company, _job: ids.job });
}
async function record(id = packageId) {
  const l = await ledger();
  return (l.records as { id: string; version: number; facts: Record<string, unknown> }[]).find(
    (r) => r.id === id,
  )!;
}
const allocations = (included: string | null) =>
  bidComponents(calculateSavedBidSnapshot(source.snapshot).view.breakdown!).map((c) => ({
    component_id: c.id,
    include: c.id === included,
    exclusion_reason: c.id === included ? null : "Retained outside this package budget",
  }));
const review = async (
  request: string,
  component: string | null = "direct:T-1",
  historical = false,
  user = ids.owner,
  correctionOf?: string,
  targetId = packageId,
) => {
  selectActor(user);
  return call({
    step: "review",
    request_id: request,
    snapshot_id: source.snapshot_id,
    package_id: targetId,
    expected_version: (await record(targetId)).version,
    correction_of: correctionOf,
    allocations: allocations(component),
    reason: "Explicit package planning allocation",
    allow_historical: historical,
  });
};
async function revisePackage() {
  const current = await record();
  const req = randomUUID(),
    rev = randomUUID();
  const p = {
    _company: ids.company,
    _job: ids.job,
    _id: packageId,
    _kind: "package",
    _expected: current.version,
    _facts: { ...current.facts, title: `Reviewed revision ${current.version}` },
    _reason: "Independent package revision",
    _request: req,
    _review: rev,
  };
  await rpc("mcp_buyout_review", p);
  await rpc("mcp_buyout_record", { ...p, _confirmed: true });
}
async function createPackage(id: string) {
  const current = await record();
  const p = {
    _company: ids.company,
    _job: ids.job,
    _id: id,
    _kind: "package",
    _expected: 0,
    _facts: {
      ...current.facts,
      code: `OTHER-${id}`,
      title: "Other package",
      budget_cents: 0,
      source: "Independent package fixture",
    },
    _reason: "Separate package fixture",
    _request: randomUUID(),
    _review: randomUUID(),
  };
  await rpc("mcp_buyout_review", p);
  await rpc("mcp_buyout_record", { ...p, _confirmed: true });
}

beforeAll(async () => {
  vi.stubEnv("SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-not-a-key");
  db = await makeBuyoutDb();
  for (const name of [
    "20261022200000_athena_estimating.sql",
    "20261022230000_athena_estimating_bid.sql",
    "20261023010000_athena_estimating_conventions.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  await db.exec(
    "CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);",
  );
  for (const name of [
    "20261031120000_athena_file_upload.sql",
    "20261027130000_athena_drawing_versions.sql",
    "20261024005713_athena_takeoff_engine.sql",
    "20261024160000_athena_takeoff_carry_by_identity.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  for (const name of [
    "estimating-member-read-transactions.sql",
    "estimating-quote-coverage.sql",
    "estimating-gc-requirements-cas.sql",
    "estimating-frozen-source-snapshot.sql",
    "estimating-requirement-sources.sql",
    "estimating-buyout-handoff.sql",
  ])
    await db.exec(readFileSync(`release-proposals/${name}`, "utf8"));
  await rpc("mcp_estimate_setup_save", {
    _job: ids.job,
    _patch: {
      role: "gc",
      trades: ["Finishes"],
      in_scope: ["Paint"],
      out_scope: ["Foundation work"],
    },
  });
  await rpc("mcp_estimate_takeoff_save", {
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
  await rpc("mcp_takeoff_geometry_save", {
    _job: ids.job,
    _operation: "not_drawable",
    _expected: 0,
    _record: {
      line_no: 1,
      takeoff_version: 1,
      exception_kind: "schedule_quantity",
      quantity: 100,
      reason: "Schedule quantity confirmed",
    },
  });
  await rpc("mcp_estimate_gc_save", {
    _job: ids.job,
    _start: null,
    _finish: null,
    _days: 1,
    _lines: GC_ITEMS.map(({ key }) => ({ key, amount: 0, qty: 1, rate: 0, confirmed: true })),
  });
  await rpc("mcp_estimate_bid_save", { _job: ids.job, _overhead: 10, _profit: 10 });
  const before = await rpc("mcp_estimate_coverage_snapshot", { _job: ids.job });
  await rpc("mcp_estimate_pricing_save_versioned", {
    _job: ids.job,
    _expected_version: before.version,
    _labor: [{ ref: "T-1", production_per_man_hour: 10, hourly_rate: 100, confirmed: true }],
    _material: [{ ref: "T-1", unit_price: 5, confirmed: true }],
    _quotes: null,
    _sources: null,
  });
  const unscanned = await rpc("mcp_estimate_coverage_snapshot", { _job: ids.job });
  await rpc("mcp_estimate_requirements_save", {
    _job: ids.job,
    _items: {
      expected_version: unscanned.version,
      source_sha256: (unscanned.requirement_sources as { sha256: string }).sha256,
      reviewed_confirmations: [],
      items: [],
    },
  });
  const current = await rpc("mcp_estimate_coverage_snapshot", { _job: ids.job });
  const request = randomUUID();
  await rpc("mcp_estimate_snapshot_review", {
    _job: ids.job,
    _request: request,
    _expected_version: current.version,
  });
  const saved = await rpc("mcp_estimate_snapshot_save", {
    _job: ids.job,
    _request: request,
    _confirmed: true,
  });
  source = await rpc("mcp_estimate_snapshot_read", { _job: ids.job, _snapshot: saved.snapshot_id });
  const replayed = calculateSavedBidSnapshot(source.snapshot);
  expect(replayed.view.ready, JSON.stringify(replayed.state.blockers)).toBe(true);
  expect(replayed.view.total).toBe(1815);
  const req = randomUUID(),
    rev = randomUUID();
  const p = {
    _company: ids.company,
    _job: ids.job,
    _id: packageId,
    _kind: "package",
    _expected: 0,
    _facts: {
      code: "PAINT",
      title: "Paint",
      scope: "Paint scope",
      budget_cents: 100000,
      currency: "USD",
      status: "draft",
      candidates: [
        {
          party_id: ids.party,
          party_version: 1,
          quote_cents: null,
          scope: "Paint",
          exclusions: null,
          source: "Written scope",
          quoted_on: null,
          expected_delivery_on: null,
        },
      ],
      selected_party_id: null,
      commitment_refs: [],
      expected_award_on: null,
      needed_by: null,
      submittal_ids: [],
      schedule_ref: null,
      source: "Original planning source",
    },
    _reason: "Initial package",
    _request: req,
    _review: rev,
  };
  await rpc("mcp_buyout_review", p);
  await rpc("mcp_buyout_record", { ...p, _confirmed: true });
  selectActor();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db.close();
});

describe.sequential("explicit frozen estimate handoff to existing buyout", () => {
  const accepted = randomUUID();
  let latestAccepted = accepted;
  let ordersBefore: unknown;
  let factsBefore: unknown;
  it("requires an explicit budget/SOV plan without invoking the buyout writer", async () => {
    const before = state.adminCalls.length;
    for (const destination of ["budget", "sov"])
      await expect(call({ step: "review", destination })).rejects.toThrow(
        /source|version|plan|reason/i,
      );
    expect(state.adminCalls).toHaveLength(before);
  });
  it("reviews exact source/components and replacement budget without selecting a vendor", async () => {
    const before = await record();
    ordersBefore = (await ledger()).orders;
    factsBefore = (await db.query("SELECT to_jsonb(f) AS row FROM mcp_job_facts f ORDER BY id"))
      .rows;
    const response = await review(accepted);
    const result = response.structuredContent;
    expect((response as unknown as { content: { text: string }[] }).content[0].text).toContain(
      "Replace planning budget $1,000.00 with $1,500.00",
    );
    expect(result).toMatchObject({
      status: "review",
      accepted: false,
      previous_budget_cents: 100000,
      proposed_budget_cents: 150000,
      source_total_cents: 181500,
      excluded_cents: 31500,
    });
    expect(result.preserved_package_facts).toMatchObject({
      selected_party_id: null,
      commitment_refs: [],
    });
    expect(await record()).toEqual(before);
    await expect(call({ step: "save", request_id: accepted })).rejects.toThrow(/confirm/i);
    const stored = await db.query<{ canonical_sha256: string }>(
      "SELECT canonical_sha256 FROM mcp_private.estimate_handoff_reviews WHERE request_id=$1",
      [accepted],
    );
    expect(stored.rows[0].canonical_sha256).toBe(result.canonical_sha256);
  });
  it("handles interruption and lost response with one atomic/idempotent accepted version", async () => {
    state.beforeSave = true;
    await expect(call({ step: "save", request_id: accepted, confirmed: true })).rejects.toThrow(
      /before save/i,
    );
    expect((await record()).version).toBe(1);
    state.loseResponse = true;
    await expect(call({ step: "save", request_id: accepted, confirmed: true })).rejects.toThrow(
      /after commit/i,
    );
    expect((await record()).version).toBe(2);
    const result = (await call({ step: "save", request_id: accepted, confirmed: true }))
      .structuredContent;
    expect(result).toMatchObject({
      accepted: true,
      already_applied: true,
      version: 2,
      source_snapshot_id: source.snapshot_id,
    });
    const current = await record();
    expect(current.facts).toMatchObject({
      budget_cents: 150000,
      selected_party_id: null,
      commitment_refs: [],
    });
    expect((await ledger()).orders).toEqual(ordersBefore);
    expect(
      (await db.query("SELECT to_jsonb(f) AS row FROM mcp_job_facts f ORDER BY id")).rows,
    ).toEqual(factsBefore);
    expect(
      (
        await db.query(
          "SELECT * FROM mcp_private.estimate_handoff_operations WHERE request_id=$1",
          [accepted],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("rejects duplicate component allocation and cross-actor replay", async () => {
    await expect(review(randomUUID(), "profit")).rejects.toThrow(/explicit correction/i);
    expect((await record()).facts.budget_cents).toBe(150000);
    selectActor(ids.pm);
    await expect(call({ step: "save", request_id: accepted, confirmed: true })).rejects.toThrow(
      /another review/i,
    );
    selectActor();
  });
  it("holds stale destinations and preserves the independently revised package", async () => {
    const id = randomUUID();
    await review(id, "overhead", false, ids.owner, accepted);
    await revisePackage();
    const after = await record();
    await expect(call({ step: "save", request_id: id, confirmed: true })).rejects.toThrow(
      /changed/i,
    );
    expect(await record()).toEqual(after);
  });
  it("holds source changes after review, even though the frozen evidence is immutable", async () => {
    const id = randomUUID();
    await review(id, "overhead", false, ids.owner, accepted);
    await rpc("mcp_estimate_setup_save", {
      _job: ids.job,
      _patch: { assumptions: ["New review context"] },
    });
    await expect(call({ step: "save", request_id: id, confirmed: true })).rejects.toThrow(
      /estimate changed/i,
    );
    expect(
      (await call({ step: "save", request_id: accepted, confirmed: true })).structuredContent,
    ).toMatchObject({
      already_applied: true,
      source_current: false,
      destination_current_version: (await record()).version,
    });
    await expect(review(randomUUID(), "overhead")).rejects.toThrow(/historical/i);
    expect(
      (await review(randomUUID(), "overhead", true, ids.owner, accepted)).structuredContent
        .source_current,
    ).toBe(false);
  });
  it("cancels a pending review without accepting it", async () => {
    const id = randomUUID();
    await review(id, "overhead", true, ids.owner, accepted);
    expect((await call({ step: "cancel", request_id: id })).structuredContent).toMatchObject({
      cancelled: true,
      saved: false,
    });
    await expect(call({ step: "save", request_id: id, confirmed: true })).rejects.toThrow(
      /cancelled/i,
    );
  });
  it("rolls back destination, lineage and claims if atomic recording is interrupted", async () => {
    const id = randomUUID();
    const correction = await review(id, "profit", true, ids.owner, accepted);
    expect(correction.structuredContent).toMatchObject({
      correction_of: accepted,
      prior_accepted: { request_id: accepted, package_version: 2, budget_cents: 150000 },
      previous_budget_cents: 150000,
      proposed_budget_cents: 16500,
      released_components: [
        { component_id: "direct:T-1", request_id: accepted, amount_cents: 150000 },
      ],
    });
    const before = await record();
    await db.exec(
      "CREATE FUNCTION mcp_private.fixture_claim_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fixture interrupted atomic claim'; END $$; CREATE TRIGGER fixture_claim_failure BEFORE INSERT ON mcp_private.estimate_handoff_component_claims FOR EACH ROW EXECUTE FUNCTION mcp_private.fixture_claim_failure();",
    );
    await expect(call({ step: "save", request_id: id, confirmed: true })).rejects.toThrow(
      /interrupted atomic/i,
    );
    expect(await record()).toEqual(before);
    expect(
      (
        await db.query(
          "SELECT request_id FROM mcp_private.estimate_handoff_component_claims WHERE job_id=$1 AND component_id='direct:T-1'",
          [ids.job],
        )
      ).rows,
    ).toEqual([{ request_id: accepted }]);
    expect(
      (
        await db.query(
          "SELECT * FROM mcp_private.estimate_handoff_operations WHERE request_id=$1",
          [id],
        )
      ).rows,
    ).toHaveLength(0);
    await db.exec(
      "DROP TRIGGER fixture_claim_failure ON mcp_private.estimate_handoff_component_claims; DROP FUNCTION mcp_private.fixture_claim_failure();",
    );
    const saved = (await call({ step: "save", request_id: id, confirmed: true })).structuredContent;
    expect(saved).toMatchObject({
      accepted: true,
      version: before.version + 1,
      correction_of: accepted,
      released_components: [
        { component_id: "direct:T-1", request_id: accepted, amount_cents: 150000 },
      ],
    });
    latestAccepted = id;
    expect((await record()).facts.budget_cents).toBe(16500);
    expect(
      (
        await db.query(
          "SELECT component_id, request_id FROM mcp_private.estimate_handoff_component_claims WHERE job_id=$1 ORDER BY component_id",
          [ids.job],
        )
      ).rows,
    ).toEqual([{ component_id: "profit", request_id: id }]);
    expect((await call({ step: "read", request_id: accepted })).structuredContent).toMatchObject({
      accepted: true,
      proposed_budget_cents: 150000,
      version: 2,
    });
  });
  it("requires verified identity, existing runtime configuration and the service-only grant", async () => {
    const calls = state.adminCalls.length;
    state.validIdentity = false;
    await expect(call({ step: "read", request_id: accepted })).rejects.toThrow(/verified member/i);
    state.validIdentity = true;
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await expect(call({ step: "read", request_id: accepted })).rejects.toThrow(/unavailable/i);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-not-a-key");
    expect(state.adminCalls).toHaveLength(calls);
    await expect(
      rpc("mcp_estimate_buyout_handoff", {
        _job: ids.job,
        _actor: ids.owner,
        _step: "read",
        _request: accepted,
        _p: {},
      }),
    ).rejects.toThrow(/permission denied/i);
    const grants = await db.query<{ allowed: boolean }>(
      "SELECT has_function_privilege('authenticated','public.mcp_estimate_buyout_handoff(uuid,uuid,text,uuid,jsonb)','EXECUTE') AS allowed",
    );
    expect(grants.rows[0].allowed).toBe(false);
    const table = await db.query<{ allowed: boolean }>(
      "SELECT has_table_privilege('authenticated','mcp_private.estimate_handoff_reviews','INSERT') AS allowed",
    );
    expect(table.rows[0].allowed).toBe(false);
    for (const user of [ids.ap, ids.contracts, ids.super, ids.other]) {
      selectActor(user);
      await expect(call({ step: "read", request_id: accepted })).rejects.toThrow();
    }
    selectActor();
  });
  it("retains immutable accepted evidence and reports later destination versions honestly", async () => {
    await expect(
      db.query(
        "UPDATE mcp_private.estimate_handoff_reviews SET canonical_sha256='forged' WHERE request_id=$1",
        [accepted],
      ),
    ).rejects.toThrow();
    const result = (await call({ step: "read", request_id: accepted })).structuredContent;
    expect(result).toMatchObject({
      accepted: true,
      version: 2,
      destination_current_version: (await record()).version,
      source_current: false,
    });
  });
  it("rejects malformed mappings and forged source identity at the SQL boundary", async () => {
    const original = state.adminCalls.find((p) => p._step === "review" && p._request === accepted)!;
    const p = structuredClone(original._p) as Record<string, unknown>;
    p.allow_historical = true;
    p.correction_of = latestAccepted;
    const rows = p.allocations as {
      component_id: string;
      include: unknown;
      exclusion_reason: string | null;
    }[];
    rows.forEach((r) => {
      r.include = r.component_id === "gc:Trailer";
      r.exclusion_reason = r.include ? null : "Outside this package";
    });
    const invoke = (payload: Record<string, unknown>) =>
      service({ ...original, _request: randomUUID(), _p: payload });
    const duplicate = structuredClone(p);
    (duplicate.allocations as unknown[])[1] = (duplicate.allocations as unknown[])[0];
    await expect(invoke(duplicate)).rejects.toThrow(/exactly once/i);
    const malformed = structuredClone(p);
    (malformed.allocations as { include: unknown }[])[0].include = "false";
    await expect(invoke(malformed)).rejects.toThrow(/boolean/i);
    const forged = structuredClone(p);
    const payload = JSON.parse(String(forged.canonical_json));
    payload.companyId = ids.company2;
    forged.canonical_json = JSON.stringify(payload);
    forged.canonical_sha256 = createHash("sha256")
      .update(String(forged.canonical_json))
      .digest("hex");
    await expect(invoke(forged)).rejects.toThrow(/immutable source/i);
    await expect(
      service({ ...original, _step: "save", _p: { confirmed: "true" } }),
    ).rejects.toThrow(/explicitly confirm/i);
    await expect(service({ ...original, _p: { ...p, reason: "Changed request" } })).rejects.toThrow(
      /different facts/i,
    );
    await expect(
      service({ ...original, _job: ids.job2, _request: randomUUID(), _p: p }),
    ).rejects.toThrow(/source is unavailable/i);
  });
  it("rechecks access after lock acquisition even for an accepted replay", async () => {
    const original = (
      await db.query<{ sql: string }>(
        "SELECT pg_get_functiondef('mcp_private.estimate_lock(uuid)'::regprocedure) AS sql",
      )
    ).rows[0].sql;
    await db.exec(`CREATE OR REPLACE FUNCTION mcp_private.estimate_lock(_job uuid) RETURNS bigint
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE v bigint; BEGIN
        PERFORM pg_advisory_xact_lock(hashtextextended('estimate-coverage:'||_job::text,0));
        SELECT version INTO v FROM mcp_private.estimate_revision WHERE job_id=_job FOR UPDATE;
        DELETE FROM public.mcp_company_members WHERE user_id=auth.uid() AND company_id=(SELECT company_id FROM public.mcp_jobs WHERE id=_job);
        RETURN v;
      END $$;`);
    try {
      await expect(call({ step: "save", request_id: accepted, confirmed: true })).rejects.toThrow();
    } finally {
      await db.exec(original);
    }
    expect((await call({ step: "read", request_id: accepted })).structuredContent.accepted).toBe(
      true,
    );
  });
  it("reports expired review and holds a later save", async () => {
    const request = randomUUID();
    await review(request, "gc:Trailer", true, ids.owner, latestAccepted);
    await db.query(
      "UPDATE mcp_buyout_reviews SET expires_at=clock_timestamp()-interval '1 second' WHERE request_id=$1",
      [request],
    );
    expect((await call({ step: "read", request_id: request })).structuredContent).toMatchObject({
      accepted: false,
      expired: true,
    });
    await expect(call({ step: "save", request_id: request, confirmed: true })).rejects.toThrow(
      /expired/i,
    );
  });
  it("requires the latest correction and blocks active claims on other packages", async () => {
    await expect(review(randomUUID(), "overhead", true, ids.owner, accepted)).rejects.toThrow(
      /latest accepted/i,
    );
    const other = randomUUID();
    await createPackage(other);
    await expect(review(randomUUID(), "profit", true, ids.owner, undefined, other)).rejects.toThrow(
      /active on another package/i,
    );
    // The explicit correction retired T-1's active claim; it can now be allocated
    // elsewhere without erasing its original immutable acceptance history.
    const relocated = randomUUID();
    await review(relocated, "direct:T-1", true, ids.owner, undefined, other);
    await call({ step: "save", request_id: relocated, confirmed: true });
    expect((await record(other)).facts.budget_cents).toBe(150000);
    expect(
      (
        await db.query(
          "SELECT request_id FROM mcp_private.estimate_handoff_component_claims WHERE job_id=$1 AND component_id='direct:T-1'",
          [ids.job],
        )
      ).rows,
    ).toEqual([{ request_id: relocated }]);
  });
  it("explicitly releases all claims with a genuine zero-budget correction", async () => {
    const zero = randomUUID();
    const reviewed = (await review(zero, null, true, ids.owner, latestAccepted)).structuredContent;
    expect(reviewed).toMatchObject({
      correction_of: latestAccepted,
      proposed_budget_cents: 0,
      prior_accepted: { request_id: latestAccepted, budget_cents: 16500 },
      released_components: [{ component_id: "profit", amount_cents: 16500 }],
    });
    const saved = (await call({ step: "save", request_id: zero, confirmed: true }))
      .structuredContent;
    expect(saved).toMatchObject({
      accepted: true,
      correction_of: latestAccepted,
      proposed_budget_cents: 0,
    });
    expect((await record()).facts.budget_cents).toBe(0);
    expect(
      (
        await db.query(
          "SELECT c.component_id FROM mcp_private.estimate_handoff_component_claims c JOIN mcp_private.estimate_handoff_reviews r ON r.request_id=c.request_id WHERE r.package_id=$1",
          [packageId],
        )
      ).rows,
    ).toEqual([]);
    await expect(review(randomUUID(), "overhead", true)).rejects.toThrow(/explicit correction/i);
    latestAccepted = zero;
    expect((await call({ step: "read", request_id: zero })).structuredContent).toMatchObject({
      accepted: true,
      proposed_budget_cents: 0,
    });
  });
  it("rejects a correction if another reviewed correction is accepted first", async () => {
    const first = randomUUID(),
      stale = randomUUID();
    await review(first, "overhead", true, ids.owner, latestAccepted);
    await review(stale, "gc:Trailer", true, ids.owner, latestAccepted);
    await call({ step: "save", request_id: first, confirmed: true });
    const before = await record();
    await expect(call({ step: "save", request_id: stale, confirmed: true })).rejects.toThrow(
      /prior accepted handoff changed/i,
    );
    expect(await record()).toEqual(before);
    expect(
      (
        await db.query(
          "SELECT component_id,request_id FROM mcp_private.estimate_handoff_component_claims c JOIN mcp_private.estimate_handoff_reviews r USING(request_id) WHERE r.package_id=$1",
          [packageId],
        )
      ).rows,
    ).toEqual([{ component_id: "overhead", request_id: first }]);
    latestAccepted = first;
  });
});
