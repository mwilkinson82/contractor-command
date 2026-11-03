/* Synthetic actual-handler/PGlite acceptance. No HTTP service, live records,
 * real keys or native PostgreSQL multi-session behavior is involved. */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeBuyoutDb, ids } from "../../../tests/buyout/fixture";
import { asUser, fakeClient } from "../../../tests/mcp-roles/fake-supabase";

const state = vi.hoisted(() => ({
  sb: null as unknown,
  actor: "",
  validIdentity: true,
  token: "synthetic-member-token",
  beforeSave: false,
  loseResponse: false,
  nullSuccess: false,
  calls: [] as Record<string, unknown>[],
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
      expect(name).toBe("mcp_estimate_facts_handoff");
      state.calls.push(p);
      if (p._step === "save" && state.beforeSave) {
        state.beforeSave = false;
        return { data: null, error: { message: "Interrupted before save" } };
      }
      try {
        const data = await service(p);
        if (p._step === "save" && state.nullSuccess) {
          state.nullSuccess = false;
          return { data: null, error: null };
        }
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
import type { DestinationPlan } from "./estimating-destination-mapping";

let db: PGlite;
let source: Record<string, unknown>;
let latestBudget: string;
let officialId: string;
let draftId: string;
let historical = false;
let awardBefore: unknown;
let ordersBefore: unknown;
let firstBudgetRequest: string;
let firstBudgetBefore: unknown;
let firstBudgetMapping: unknown;
let firstBudgetVersion: unknown;
const member = (user = ids.owner) =>
  fakeClient(db, { sub: user, role: "authenticated", email: "fixture@example.invalid" });
const rpc = async (name: string, args: Record<string, unknown>, user = ids.owner) => {
  const r = await member(user).rpc(name, args);
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
          "SELECT public.mcp_estimate_facts_handoff($1::uuid,$2::uuid,$3::text,$4::uuid,$5::jsonb) AS data",
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
type Response = { structuredContent: Record<string, unknown>; content: { text: string }[] };
const call = (args: Record<string, unknown>) =>
  (
    estimateHandoff as unknown as { handler: (a: unknown, c: unknown) => Promise<Response> }
  ).handler(
    { job_number: "900071", destination: "budget", ...args },
    { getToken: () => state.token },
  );
const destination = () => rpc("mcp_estimate_destination_snapshot", { _job: ids.job });
const claims = () =>
  db.query<{ component_id: string; request_id: string; destination: string }>(
    "SELECT component_id,request_id,destination FROM mcp_private.estimate_facts_handoff_claims WHERE job_id=$1 ORDER BY destination,component_id",
    [ids.job],
  );
const budgetPlan = (
  target = "C09",
  retire = false,
): Extract<DestinationPlan, { kind: "budget" }> => ({
  kind: "budget",
  lines: [
    { cost_code: target, description: "Paint execution budget" },
    ...(retire ? [{ cost_code: "C09", description: "Retired mapping", zero: true as const }] : []),
  ],
  allocations: bidComponents(calculateSavedBidSnapshot(source.snapshot).view.breakdown!).map(
    (c) => ({
      component_id: c.id,
      splits: c.id === "direct:T-1" ? [{ target_key: target, amount_cents: c.amountCents }] : [],
      excluded_cents: c.id === "direct:T-1" ? 0 : c.amountCents,
      exclusion_reason:
        c.id !== "direct:T-1" && c.amountCents > 0
          ? "Bid margin remains outside execution cost budget"
          : null,
    }),
  ),
});
const sovPlan = (
  copy: "official" | "draft",
  fee: number,
): Extract<DestinationPlan, { kind: "sov" }> => ({
  kind: "sov",
  copy,
  source_basis: "base_contract",
  fee_pct: fee,
  billing_basis: `Explicit base-contract allocation at ${fee}%`,
  lines: [{ line: "01", description: "Paint and base contract work", cost_codes: ["C10"] }],
  allocations: bidComponents(calculateSavedBidSnapshot(source.snapshot).view.breakdown!).map(
    (c) => {
      const mapped =
        fee === 10
          ? c.id === "direct:T-1"
            ? 150000
            : c.id === "overhead"
              ? 13350
              : 0
          : c.id === "direct:T-1"
            ? 145200
            : 0;
      return {
        component_id: c.id,
        splits: mapped ? [{ target_key: "01", amount_cents: mapped }] : [],
        fee_cents: c.amountCents - mapped,
      };
    },
  ),
});
async function review(plan: DestinationPlan, request: string = randomUUID(), correction?: string) {
  const current = await destination();
  return call({
    step: "review",
    destination: plan.kind,
    request_id: request,
    snapshot_id: source.snapshot_id,
    expected_version: current.version,
    plan,
    reason: "Explicit source and destination mapping",
    allow_historical: historical,
    correction_of: correction,
  });
}
const save = (request: string, kind = "budget") =>
  call({ step: "save", destination: kind, request_id: request, confirmed: true });
async function appendBudget(key: string) {
  await rpc("mcp_set_facts", {
    _job: ids.job,
    _module: "budget",
    _facts: { [key]: { description: "Independent zero append", amount: 0 } },
    _source: "member_answer",
  });
}

beforeAll(async () => {
  vi.stubEnv("SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-not-a-key");
  db = await makeBuyoutDb();
  await db.exec(
    "CREATE TABLE mcp_change_orders(submittal_id uuid PRIMARY KEY,job_id uuid,details jsonb);",
  );
  for (const path of [
    "supabase/migrations/20261101120001_athena_project_billing_evidence.sql",
    "supabase/migrations/20261030140000_athena_sov_contract_total_guard.sql",
    "supabase/migrations/20261030150000_athena_sov_official_lock.sql",
    "drizzle/migrations/0057_sov_payment_applications.sql",
    "drizzle/migrations/0058_payment_application_contract_basis.sql",
    "release-proposals/estimating-destination-versions.sql",
    "supabase/migrations/20261022200000_athena_estimating.sql",
    "supabase/migrations/20261022230000_athena_estimating_bid.sql",
    "supabase/migrations/20261023010000_athena_estimating_conventions.sql",
  ])
    await db.exec(readFileSync(path, "utf8"));
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
    "estimating-facts-handoff.sql",
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
      reason: "Schedule quantity explicitly confirmed",
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
  const req = randomUUID();
  await rpc("mcp_estimate_snapshot_review", {
    _job: ids.job,
    _request: req,
    _expected_version: current.version,
  });
  const frozen = await rpc("mcp_estimate_snapshot_save", {
    _job: ids.job,
    _request: req,
    _confirmed: true,
  });
  source = await rpc("mcp_estimate_snapshot_read", {
    _job: ids.job,
    _snapshot: frozen.snapshot_id,
  });
  const calculated = calculateSavedBidSnapshot(source.snapshot);
  expect(calculated.view.ready, JSON.stringify(calculated.state.blockers)).toBe(true);
  expect(calculated.view.total).toBe(1815);
  awardBefore = (
    await db.query(
      "SELECT to_jsonb(f) AS row FROM mcp_job_facts f WHERE job_id=$1 AND module='contract' ORDER BY key",
      [ids.job],
    )
  ).rows;
  ordersBefore = (await rpc("mcp_buyout_get", { _company: ids.company, _job: ids.job })).orders;
  selectActor();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db.close();
});

describe.sequential("reviewed frozen estimate budget/SOV handoff", () => {
  it("reads a guarded current destination version without creating a handoff", async () => {
    const before = state.calls.length;
    const r = await call({ step: "read" });
    expect(r.structuredContent).toMatchObject({
      status: "destination",
      company_id: ids.company,
      job_id: ids.job,
      capabilities: { destination_cas: true },
    });
    expect(state.calls).toHaveLength(before);
  });
  it("reviews the exact budget split and holds an unconfirmed save", async () => {
    latestBudget = randomUUID();
    firstBudgetRequest = latestBudget;
    const before = await destination();
    const r = await review(budgetPlan(), latestBudget);
    expect(r.structuredContent).toMatchObject({
      status: "review",
      accepted: false,
      destination: "budget",
      mapping: {
        review: { mapped_cents: 150000, excluded_cents: 31500, resulting_total_cents: 150000 },
      },
    });
    expect(r.content[0].text).toContain("C09: replace Unknown with $1,500.00");
    firstBudgetBefore = r.structuredContent.destination_before;
    expect(firstBudgetBefore).toEqual(before);
    await expect(call({ step: "save", request_id: latestBudget })).rejects.toThrow(/confirm/i);
    expect(await destination()).toEqual(before);
  });
  it("records once after interruption and lost response, with immutable receipt and active claims", async () => {
    state.beforeSave = true;
    await expect(save(latestBudget)).rejects.toThrow(/before save/i);
    expect((await destination()).budget).toEqual({});
    state.loseResponse = true;
    await expect(save(latestBudget)).rejects.toThrow(/after commit/i);
    const after = await destination();
    expect(after.budget).toEqual({ C09: { description: "Paint execution budget", amount: 1500 } });
    const retry = (await save(latestBudget)).structuredContent;
    firstBudgetMapping = retry.mapping;
    firstBudgetVersion = retry.destination_version;
    expect(retry).toMatchObject({
      status: "accepted",
      accepted: true,
      already_applied: true,
      destination_version: after.version,
      commitment_approval: false,
      payment_authorization: false,
    });
    expect(await destination()).toEqual(after);
    expect((await claims()).rows).toEqual([
      { component_id: "direct:T-1", request_id: latestBudget, destination: "budget" },
    ]);
    expect(
      (
        await db.query(
          "SELECT * FROM mcp_private.estimate_facts_handoff_operations WHERE request_id=$1",
          [latestBudget],
        )
      ).rows,
    ).toHaveLength(1);
    await expect(
      db.query(
        "UPDATE mcp_private.estimate_facts_handoff_reviews SET canonical_sha256='forged' WHERE request_id=$1",
        [latestBudget],
      ),
    ).rejects.toThrow();
  });
  it("requires latest explicit correction and prevents orphan amounts before C09 to C10 remapping", async () => {
    const before = await destination();
    await expect(review(budgetPlan("C10"))).rejects.toThrow(/latest accepted handoff/i);
    await expect(review(budgetPlan("C10"), randomUUID(), latestBudget)).rejects.toThrow(
      /map or zero every previous/i,
    );
    expect(await destination()).toEqual(before);
    const old = latestBudget,
      next = randomUUID();
    const r = await review(budgetPlan("C10", true), next, old);
    expect(r.structuredContent).toMatchObject({
      correction_of: old,
      released_components: [{ component_id: "direct:T-1", prior_request: old }],
    });
    await save(next);
    latestBudget = next;
    expect((await destination()).budget).toEqual({
      C09: { description: "Retired mapping", amount: 0 },
      C10: { description: "Paint execution budget", amount: 1500 },
    });
    expect((await claims()).rows).toEqual([
      { component_id: "direct:T-1", request_id: next, destination: "budget" },
    ]);
    const oldReceipt = await call({ step: "read", request_id: old });
    expect(oldReceipt.structuredContent.accepted).toBe(true);
    expect(oldReceipt.structuredContent.destination_before).toEqual(firstBudgetBefore);
    expect(oldReceipt.structuredContent.mapping).toEqual(firstBudgetMapping);
    expect(oldReceipt.structuredContent.destination_version).toBe(firstBudgetVersion);
    expect(
      (await db.query("SELECT * FROM mcp_private.estimate_facts_handoff_operations")).rows,
    ).toHaveLength(2);
  });
  it("holds a known contract mismatch and accepts only the matching recorded basis", async () => {
    const basis = {
      reference: "Separately supplied executed agreement",
      provided_by: ids.owner,
      provided_at: "2026-11-01T00:00:00.000Z",
    };
    // Explicit fixture sources; handoff must never award or correct a contract
    // merely to make its proposed SOV pass.
    await rpc("mcp_set_facts", {
      _job: ids.job,
      _module: "contract",
      _facts: { contract_value: 99999, contract_value_basis: basis },
      _source: "member_answer",
    });
    const before = await destination();
    await expect(review(sovPlan("official", 10))).rejects.toThrow(
      /canonical recorded original contract value/i,
    );
    expect(await destination()).toEqual(before);
    await rpc("mcp_set_facts", {
      _job: ids.job,
      _module: "contract",
      _facts: { contract_value: 1815 },
      _source: "member_answer",
    });
    awardBefore = (
      await db.query(
        "SELECT to_jsonb(f) AS row FROM mcp_job_facts f WHERE job_id=$1 AND module='contract' ORDER BY key",
        [ids.job],
      )
    ).rows;
  });
  it("creates initial official SOV with explicit 10% fee and exact frozen base reconciliation", async () => {
    officialId = randomUUID();
    const r = await review(sovPlan("official", 10), officialId);
    const recordedBasis = {
      reference: "Separately supplied executed agreement",
      provided_by: ids.owner,
      provided_at: "2026-11-01T00:00:00.000Z",
    };
    expect(r.structuredContent).toMatchObject({
      destination: "sov:official",
      mapping: {
        review: {
          resulting_base_cents: 163350,
          fee_cents: 18150,
          resulting_total_cents: 181500,
          recorded_contract_original_cents: 181500,
          recorded_contract_basis: recordedBasis,
        },
      },
    });
    expect(r.content[0].text).toContain("Fee: 10% of contract total, $181.50");
    expect(r.content[0].text).toContain(recordedBasis.reference);
    expect(r.content[0].text).toContain(recordedBasis.provided_by);
    expect(r.content[0].text).toContain(recordedBasis.provided_at);
    expect(r.content[0].text).not.toContain("[object Object]");
    await save(officialId, "sov");
    const current = await destination();
    expect(current.sov).toEqual({
      "01": {
        description: "Paint and base contract work",
        billable_value: 1633.5,
        cost_codes: ["C10"],
      },
    });
    expect(current.terms).toEqual({
      fee_pct: 10,
      basis: "Explicit base-contract allocation at 10%",
    });
    expect(current.official_locked).toBe(true);
    expect(current.sov_draft).toEqual({});
  });
  it("preserves official/CO data while accepting a draft with independent fee and terms", async () => {
    const sub = randomUUID();
    await db.query("INSERT INTO mcp_submittals(id,job_id,number,revision) VALUES($1,$2,'CO-1',0)", [
      sub,
      ids.job,
    ]);
    // Existing executed-CO source fixture; this is not a simulated approval action.
    await db.query("INSERT INTO mcp_change_orders(submittal_id,job_id,details) VALUES($1,$2,$3)", [
      sub,
      ids.job,
      { state: "executed", total_cents: 25000 },
    ]);
    const change = {
      description: "Approved change",
      billable_value: 250,
      executed_change_order: sub,
      fee_included: true,
      cost_codes: [],
      spec_section: "09 90 00",
      source_note: "Retain original evidence",
    };
    await db.query(
      "INSERT INTO mcp_job_facts(job_id,module,key,value,status,source,internal_only,updated_by) VALUES($1,'sov','09.001',$2,'known','member_answer',true,$3)",
      [ids.job, change, ids.owner],
    );
    const before = await destination();
    draftId = randomUUID();
    const r = await review(sovPlan("draft", 20), draftId);
    expect(r.structuredContent).toMatchObject({
      destination: "sov:draft",
      mapping: {
        review: {
          resulting_base_cents: 145200,
          fee_cents: 36300,
          retained_change_cents: 25000,
          resulting_total_cents: 206500,
        },
      },
    });
    await save(draftId, "sov");
    const after = await destination();
    expect(after.sov).toEqual(before.sov);
    expect(after.terms).toEqual(before.terms);
    expect(after.sov_draft).toEqual({
      "01": {
        description: "Paint and base contract work",
        billable_value: 1452,
        cost_codes: ["C10"],
      },
      "09.001": change,
    });
    expect(after.draft_terms).toEqual({
      fee_pct: 20,
      basis: "Explicit base-contract allocation at 20%",
    });
    expect(after.contract).toEqual(before.contract);
    expect(after.changes).toEqual(before.changes);
  });
  it("rejects attempts to reprice locked official dollars", async () => {
    const before = await destination();
    await expect(review(sovPlan("official", 20), randomUUID(), officialId)).rejects.toThrow(
      /official SOV dollars are locked/i,
    );
    expect(await destination()).toEqual(before);
  });
  it("holds stale destination/source reviews and preserves independently changed state", async () => {
    const request = randomUUID();
    await review(budgetPlan("C10", true), request, latestBudget);
    await appendBudget("UNRELATED");
    const before = await destination();
    await expect(save(request)).rejects.toThrow(/source or destination changed/i);
    expect(await destination()).toEqual(before);
    const sourceReview = randomUUID();
    await review(budgetPlan("C10", true), sourceReview, latestBudget);
    await rpc("mcp_estimate_setup_save", {
      _job: ids.job,
      _patch: { assumptions: ["Source changed after review"] },
    });
    await expect(save(sourceReview)).rejects.toThrow(/source or destination changed/i);
    historical = true;
    await expect(
      call({
        step: "review",
        request_id: randomUUID(),
        snapshot_id: source.snapshot_id,
        expected_version: (await destination()).version,
        plan: budgetPlan("C10", true),
        reason: "No historical permission",
        correction_of: latestBudget,
      }),
    ).rejects.toThrow(/historical/i);
  });
  it("cancels reviews and reports expiration without accepting destination changes", async () => {
    const request = randomUUID();
    await review(budgetPlan("C10", true), request, latestBudget);
    const before = await destination();
    expect((await call({ step: "cancel", request_id: request })).structuredContent).toMatchObject({
      cancelled: true,
      accepted: false,
    });
    await expect(save(request)).rejects.toThrow(/expired or cancelled/i);
    expect(await destination()).toEqual(before);
    const expired = randomUUID();
    await db.exec(
      "ALTER TABLE mcp_private.estimate_facts_handoff_reviews ALTER COLUMN expires_at SET DEFAULT clock_timestamp()-interval '1 second'",
    );
    try {
      await review(budgetPlan("C10", true), expired, latestBudget);
    } finally {
      await db.exec(
        "ALTER TABLE mcp_private.estimate_facts_handoff_reviews ALTER COLUMN expires_at SET DEFAULT clock_timestamp()+interval '30 minutes'",
      );
    }
    expect((await call({ step: "read", request_id: expired })).structuredContent).toMatchObject({
      expired: true,
      accepted: false,
    });
    await expect(save(expired)).rejects.toThrow(/expired or cancelled/i);
    expect(await destination()).toEqual(before);
  });
  it("rolls back destination revision, receipt and active-claim retirement if later recording fails", async () => {
    const request = randomUUID();
    await review(budgetPlan("C10", true), request, latestBudget);
    const before = await destination(),
      beforeClaims = (await claims()).rows;
    await db.exec(
      "CREATE FUNCTION mcp_private.fixture_facts_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fixture interrupted receipt'; END $$; CREATE TRIGGER fixture_facts_receipt_failure BEFORE INSERT ON mcp_private.estimate_facts_handoff_operations FOR EACH ROW EXECUTE FUNCTION mcp_private.fixture_facts_receipt_failure();",
    );
    try {
      await expect(save(request)).rejects.toThrow(/interrupted receipt/i);
      expect(await destination()).toEqual(before);
      expect((await claims()).rows).toEqual(beforeClaims);
      expect(
        (
          await db.query(
            "SELECT * FROM mcp_private.estimate_facts_handoff_operations WHERE request_id=$1",
            [request],
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await db.exec(
        "DROP TRIGGER fixture_facts_receipt_failure ON mcp_private.estimate_facts_handoff_operations; DROP FUNCTION mcp_private.fixture_facts_receipt_failure()",
      );
    }
    await save(request);
    latestBudget = request;
    expect((await claims()).rows.find((c) => c.destination === "budget")?.request_id).toBe(request);
    expect(
      (await db.query("SELECT * FROM mcp_private.estimate_destination_write_ticket")).rows,
    ).toHaveLength(0);
    expect((await destination()).budget).toMatchObject({
      C09: { amount: 0 },
      C10: { amount: 1500 },
      UNRELATED: { amount: 0 },
    });
  });
  it("reconciles a committed null-success response before retrying the same request", async () => {
    const request = randomUUID();
    await review(budgetPlan("C10", true), request, latestBudget);
    state.nullSuccess = true;
    await expect(save(request)).rejects.toThrow(
      `The handoff result could not be verified. Read request ${request} before retrying.`,
    );
    const after = await destination();
    const read = (await call({ step: "read", request_id: request })).structuredContent;
    expect(read).toMatchObject({
      accepted: true,
      request_id: request,
      destination_version: after.version,
    });
    expect((await claims()).rows.find((c) => c.destination === "budget")?.request_id).toBe(request);
    const retry = (await save(request)).structuredContent;
    expect(retry).toMatchObject({
      accepted: true,
      already_applied: true,
      request_id: request,
      destination_version: after.version,
    });
    expect(await destination()).toEqual(after);
    expect(
      (
        await db.query(
          "SELECT * FROM mcp_private.estimate_facts_handoff_operations WHERE request_id=$1",
          [request],
        )
      ).rows,
    ).toHaveLength(1);
    latestBudget = request;
  });
  it("holds the second of competing reviewed replacements after the first accepts", async () => {
    const first = randomUUID(),
      second = randomUUID();
    await review(budgetPlan("C10", true), first, latestBudget);
    await review(budgetPlan("C10", true), second, latestBudget);
    await save(first);
    latestBudget = first;
    const after = await destination();
    await expect(save(second)).rejects.toThrow(/changed|latest accepted/i);
    expect(await destination()).toEqual(after);
    expect((await claims()).rows.find((c) => c.destination === "budget")?.request_id).toBe(first);
  });
  it("requires verified actor/runtime configuration and denies direct ordinary-member attestation", async () => {
    const before = state.calls.length;
    state.validIdentity = false;
    await expect(call({ step: "read", request_id: latestBudget })).rejects.toThrow(
      /verified member/i,
    );
    state.validIdentity = true;
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await expect(call({ step: "read", request_id: latestBudget })).rejects.toThrow(/unavailable/i);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-not-a-key");
    expect(state.calls).toHaveLength(before);
    await expect(
      rpc("mcp_estimate_facts_handoff", {
        _job: ids.job,
        _actor: ids.owner,
        _step: "read",
        _request: latestBudget,
        _p: { kind: "budget" },
      }),
    ).rejects.toThrow(/permission denied/i);
    selectActor(ids.pm);
    await expect(call({ step: "read", request_id: latestBudget })).rejects.toThrow(
      /different handoff/i,
    );
    for (const actor of [ids.ap, ids.contracts, ids.super, ids.other]) {
      selectActor(actor);
      await expect(call({ step: "read", request_id: latestBudget })).rejects.toThrow();
    }
    selectActor();
    const r = await call({ step: "read", request_id: latestBudget, _actor: ids.other });
    expect(r.structuredContent.accepted).toBe(true);
    expect(state.calls.at(-1)?._actor).toBe(ids.owner);
  });
  it("preserves contract award, buyout commitments and immutable acceptance history", async () => {
    const award = (
      await db.query(
        "SELECT to_jsonb(f) AS row FROM mcp_job_facts f WHERE job_id=$1 AND module='contract' ORDER BY key",
        [ids.job],
      )
    ).rows;
    expect(award).toEqual(awardBefore);
    expect((await rpc("mcp_buyout_get", { _company: ids.company, _job: ids.job })).orders).toEqual(
      ordersBefore,
    );
    expect(
      (await call({ step: "read", destination: "sov", request_id: officialId })).structuredContent,
    ).toMatchObject({ accepted: true, destination: "sov:official" });
    const rows = (
      await db.query<{ destination: string }>(
        "SELECT r.destination FROM mcp_private.estimate_facts_handoff_reviews r JOIN mcp_private.estimate_facts_handoff_operations o USING(request_id) ORDER BY o.accepted_seq",
      )
    ).rows;
    expect(rows.map((r) => r.destination)).toContain("sov:official");
    expect(rows.map((r) => r.destination)).toContain("sov:draft");
    await expect(
      db.query("DELETE FROM mcp_private.estimate_facts_handoff_operations WHERE request_id=$1", [
        latestBudget,
      ]),
    ).rejects.toThrow();
    const original = (await call({ step: "read", request_id: firstBudgetRequest }))
      .structuredContent;
    expect(original.destination_before).toEqual(firstBudgetBefore);
    expect(original.mapping).toEqual(firstBudgetMapping);
    expect(original.destination_version).toBe(firstBudgetVersion);
  });
  it("retires all budget claims only after explicitly zeroing prior targets and excluding each source component", async () => {
    const prior = latestBudget,
      request = randomUUID(),
      plan = budgetPlan("C10", true);
    plan.lines.forEach((line) => {
      line.zero = true;
    });
    const sourceComponents = new Map(
      bidComponents(calculateSavedBidSnapshot(source.snapshot).view.breakdown!).map((c) => [
        c.id,
        c.amountCents,
      ]),
    );
    plan.allocations.forEach((a) => {
      a.splits = [];
      a.excluded_cents = sourceComponents.get(a.component_id)!;
      a.exclusion_reason =
        a.excluded_cents > 0 ? "Explicitly retire this execution-budget allocation" : null;
    });
    await review(plan, request, prior);
    const accepted = (await save(request)).structuredContent;
    latestBudget = request;
    expect(accepted).toMatchObject({
      accepted: true,
      released_components: [{ component_id: "direct:T-1", prior_request: prior }],
      mapping: { allocated_components: [] },
    });
    expect((await claims()).rows.filter((c) => c.destination === "budget")).toEqual([]);
    expect((await destination()).budget).toMatchObject({
      C09: { amount: 0 },
      C10: { amount: 0 },
      UNRELATED: { amount: 0 },
    });
    const old = (await call({ step: "read", request_id: prior })).structuredContent;
    expect(old.accepted).toBe(true);
    expect((old.mapping as { allocated_components: string[] }).allocated_components).toEqual([
      "direct:T-1",
    ]);
    expect(
      (await call({ step: "read", request_id: firstBudgetRequest })).structuredContent
        .destination_before,
    ).toEqual(firstBudgetBefore);
  });
});
