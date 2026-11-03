// Prepared for a separately authorized disposable GitHub Actions service.
// This file does not start a database or accept a production connection URL.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import {
  ids,
  installEstimatingFixture,
  seedReadyEstimate,
  readAuthorizationFingerprints,
} from "./estimating-fixture";
import { calculateSavedBidSnapshot } from "../../src/lib/mcp/tools/estimate-bid-tools";
import { prepareHandoffDraft } from "../../src/lib/mcp/estimating-handoff-draft";
import { bidComponents } from "../../src/lib/mcp/estimating-handoff-preview";
import { mapEstimateDestination } from "../../src/lib/mcp/estimating-destination-mapping";
import { destinationSnapshot } from "../../src/lib/mcp/estimating-facts-handoff.server";

type Connection = Awaited<ReturnType<ReturnType<typeof postgres>["reserve"]>>;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const output = "artifacts/estimating-native";
mkdirSync(output, { recursive: true });
const cases: Json[] = [];
const unexecuted = [
  "PostgREST warm-member transaction classification (no HTTP service in this job)",
  "Hosted signed download/open/expiry and original drawing accuracy",
  "Revocation committing after the final authorization check (not serialized by this proposal)",
  "Full per-writer geometry/calibration/drawing/clause/GC scan race matrix in the prepared procedure",
  "Native SOV/buyout stale/cancel/expiry/failure-between-write-and-lineage permutations (bounded native acceptance below covers duplicate confirmation; budget covers those other paths)",
];
let environment: Json | undefined;
let authorization: unknown;
let failure: Json | undefined;
let pool: ReturnType<typeof postgres> | undefined;
let connections: Connection[] = [];
const q = async (c: Connection, sql: string, params: unknown[] = []) =>
  Array.from(await c.unsafe(sql, params as never[]));
const bind = (value: unknown) => {
  if (value === null || typeof value !== "object") return value;
  assert.ok(pool, "Initialize only the verified disposable-service client");
  // postgres.js serializes inferred jsonb itself. Passing JSON.stringify(value)
  // would instead store a JSON string, as the earlier email runner reproduced.
  return pool.json(value as never);
};
const rpcIn = async (c: Connection, name: string, params: unknown[]) => {
  assert.match(name, /^mcp_[a-z_]+$/);
  const rows = await q(
    c,
    `SELECT public.${name}(${params.map((_, i) => `$${i + 1}`).join(",")}) AS value`,
    params.map(bind),
  );
  return rows[0].value as Json;
};
async function begin(c: Connection, actor = ids.owner, role = "authenticated") {
  assert.ok(["authenticated", "anon", "service_role"].includes(role));
  await q(c, "BEGIN ISOLATION LEVEL READ COMMITTED");
  await q(c, `SET LOCAL ROLE ${role}`);
  await q(c, "SELECT set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: actor, role, email: `${actor}@example.invalid` }),
  ]);
}
async function execute(
  c: Connection,
  name: string,
  params: unknown[],
  actor = ids.owner,
  role = "authenticated",
) {
  await begin(c, actor, role);
  try {
    const result = await rpcIn(c, name, params);
    await q(c, "COMMIT");
    return result;
  } catch (error) {
    await q(c, "ROLLBACK");
    throw error;
  }
}
const errorInfo = (error: unknown) => ({
  code: String((error as { code?: string }).code ?? ""),
  message: error instanceof Error ? error.message : String(error),
});
const observe = (promise: Promise<Json>) =>
  promise.then(
    (result) => ({ ok: true as const, result }),
    (error: unknown) => ({ ok: false as const, error: errorInfo(error) }),
  );
async function finish(c: Connection, pending: ReturnType<typeof observe>) {
  const result = await pending;
  await q(c, result.ok ? "COMMIT" : "ROLLBACK");
  return result;
}
async function waitForLock(observer: Connection, blocked: number, blocker: number) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await q(
      observer,
      "SELECT wait_event_type,$2::int=ANY(pg_blocking_pids($1::int)) AS expected_blocker FROM pg_stat_activity WHERE pid=$1",
      [blocked, blocker],
    );
    if (rows[0]?.wait_event_type === "Lock" && rows[0].expected_blocker) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The expected native lock wait was not observed");
}
function rejected(outcome: Awaited<ReturnType<typeof observe>>, pattern: RegExp) {
  assert.equal(outcome.ok, false, "Expected atomic rejection");
  if (!outcome.ok) assert.match(outcome.error.message, pattern);
}

try {
  // These guards run before constructing a database client. No generic URL or
  // password override is accepted, even when GITHUB_ACTIONS is set manually.
  assert.equal(process.env.GITHUB_ACTIONS, "true", "Disposable CI service only");
  assert.equal(process.env.ATHENA_ESTIMATING_NATIVE_TEST, "1", "Explicit opt-in required");
  assert.match(process.env.GITHUB_RUN_ID ?? "", /^\d+$/);
  assert.match(process.env.GITHUB_RUN_ATTEMPT ?? "", /^\d+$/);
  const expectedPassword = `synthetic-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  assert.equal(process.env.ATHENA_ESTIMATING_NATIVE_PASSWORD, expectedPassword);
  pool = postgres({
    host: "127.0.0.1",
    port: 55440,
    database: "athena_estimating_ci",
    username: "synthetic",
    password: expectedPassword,
    max: 3,
    prepare: false,
    onnotice: () => {},
    connection: { statement_timeout: 20_000, lock_timeout: 15_000 },
  });
  const [admin, a, b] = await Promise.all([pool.reserve(), pool.reserve(), pool.reserve()]);
  connections = [admin, a, b];
  const [env] = await q(
    admin,
    "SELECT current_database() AS db,current_user AS username,current_setting('server_version_num')::int AS version,current_setting('data_directory') AS directory",
  );
  environment = env;
  assert.equal(env.db, "athena_estimating_ci");
  assert.equal(env.username, "synthetic");
  assert.ok(env.version >= 170000 && env.version < 180000);
  assert.equal(env.directory, "/var/lib/postgresql/data");
  assert.equal(
    (await q(admin, "SELECT to_regclass('public.mcp_jobs') AS existing"))[0].existing,
    null,
    "Refuse an existing Athena schema",
  );
  const boot = readFileSync("tests/mcp-roles/db.ts", "utf8").match(
    /const BOOT = `([\s\S]*?)`;/,
  )?.[1];
  assert.ok(boot, "The synthetic base bootstrap must be present");
  await admin.unsafe(boot).simple();
  for (const name of readdirSync("drizzle/migrations")
    .filter((name) => name.endsWith(".sql") && name <= "0024_athena_reopen_open_item.sql")
    .sort()) {
    await admin
      .unsafe(
        readFileSync(`drizzle/migrations/${name}`, "utf8").replace(/--> statement-breakpoint/g, ""),
      )
      .simple();
  }
  const adapter = {
    // The shared legacy pg-client fixture supplies one pre-serialized JSON
    // lines parameter. Normalize that exact INSERT only; JWT/text stays text.
    query: async (sql: string, params: unknown[] = []) => ({
      rows: await q(
        admin,
        sql,
        params.map((value, i) => {
          if (
            /^INSERT INTO mcp_purchase_order_versions\b/i.test(sql) &&
            i === 3 &&
            typeof value === "string"
          ) {
            const lines = JSON.parse(value);
            assert.ok(Array.isArray(lines), "Expected the synthetic legacy PO line array");
            return bind(lines);
          }
          return bind(value);
        }),
      ),
    }),
    exec: async (sql: string) => {
      await admin.unsafe(sql).simple();
    },
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      await q(admin, "BEGIN");
      try {
        const result = await fn(adapter);
        await q(admin, "COMMIT");
        return result;
      } catch (error) {
        await q(admin, "ROLLBACK");
        throw error;
      }
    },
    close: async () => {},
  };
  const db = await installEstimatingFixture(async () => adapter as never);
  authorization = await readAuthorizationFingerprints(db);
  const frozen = await seedReadyEstimate(db);
  const source = calculateSavedBidSnapshot(frozen.snapshot);
  assert.equal(source.view.ready, true);
  assert.equal(source.view.total, 1815);
  const snapshot = () => execute(a, "mcp_estimate_coverage_snapshot", [ids.job]);
  const destination = () => execute(a, "mcp_estimate_destination_snapshot", [ids.job]);
  const pidA = Number((await q(a, "SELECT pg_backend_pid() AS pid"))[0].pid);
  const pidB = Number((await q(b, "SELECT pg_backend_pid() AS pid"))[0].pid);
  const protectedBefore = await q(
    admin,
    "SELECT to_jsonb(v) AS value FROM mcp_purchase_order_versions v ORDER BY po_id,version",
  );

  // Real membership, scope, RLS and proposal ACLs are installed by the fixture.
  const inactive = randomUUID();
  await q(admin, "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())", [
    inactive,
    `${inactive}@example.invalid`,
  ]);
  await q(
    admin,
    "INSERT INTO profiles(id,email,full_name) VALUES($1,$2,'Synthetic inactive member')",
    [inactive, `${inactive}@example.invalid`],
  );
  await begin(a, inactive);
  assert.equal((await q(a, "SELECT public.mcp_gate() AS allowed"))[0].allowed, false);
  await q(a, "COMMIT");
  // ids.locked from the old fixture is an assigned PM in an active company:
  // the actual gate correctly permits it through company-seat entitlement.
  for (const actor of [ids.other, ids.super, ids.contracts, inactive]) {
    await assert.rejects(execute(a, "mcp_estimate_destination_snapshot", [ids.job], actor));
  }
  await assert.rejects(execute(a, "mcp_estimate_coverage_snapshot", [ids.job], ids.owner, "anon"));
  await assert.rejects(
    execute(a, "mcp_estimate_facts_handoff", [
      ids.job,
      ids.owner,
      "read",
      randomUUID(),
      { kind: "budget" },
    ]),
  );
  await begin(a);
  await assert.rejects(q(a, "SELECT * FROM mcp_private.estimate_source_snapshot"));
  await q(a, "ROLLBACK");
  cases.push({
    name: "Real member/scope/anonymous/service and private-table boundaries",
    passed: true,
  });

  const price = (rate: number) => [
    { ref: "T-1", production_per_man_hour: 10, hourly_rate: rate, confirmed: true },
  ];
  {
    const before = await snapshot();
    await begin(a);
    await rpcIn(a, "mcp_estimate_pricing_save_versioned", [
      ids.job,
      before.version,
      price(101),
      null,
      null,
      null,
    ]);
    await begin(b);
    const pending = observe(
      rpcIn(b, "mcp_estimate_pricing_save_versioned", [
        ids.job,
        before.version,
        price(999),
        null,
        null,
        null,
      ]),
    );
    await waitForLock(admin, pidB, pidA);
    await q(a, "COMMIT");
    const loser = await finish(b, pending);
    rejected(loser, /changed/i);
    const after = await snapshot();
    assert.equal(after.bid.pricing.labor[0].hourly_rate, 101);
    assert.deepEqual(after.bid.pricing.quotes, before.bid.pricing.quotes);
    cases.push({
      name: "Concurrent same-version pricing has one whole winner",
      lock_observed: true,
      loser,
    });
  }
  {
    const current = await snapshot(),
      request = randomUUID();
    await execute(a, "mcp_estimate_snapshot_review", [ids.job, request, current.version]);
    await execute(b, "mcp_estimate_bid_save_versioned", [ids.job, current.version, 11, 10]);
    await assert.rejects(
      execute(a, "mcp_estimate_snapshot_save", [ids.job, request, true]),
      /changed/i,
    );
    assert.equal(
      Number(
        (
          await q(
            admin,
            "SELECT count(*) AS n FROM mcp_private.estimate_source_snapshot WHERE request_id=$1",
            [request],
          )
        )[0].n,
      ),
      0,
    );
    cases.push({
      name: "Source drift rejects an unsaved freeze without a partial snapshot",
      passed: true,
    });
  }
  {
    const current = await snapshot(),
      request = randomUUID();
    await execute(a, "mcp_estimate_snapshot_review", [ids.job, request, current.version]);
    await begin(a);
    const saved = await rpcIn(a, "mcp_estimate_snapshot_save", [ids.job, request, true]);
    await begin(b);
    const pending = observe(rpcIn(b, "mcp_estimate_snapshot_save", [ids.job, request, true]));
    await waitForLock(admin, pidB, pidA);
    await q(a, "COMMIT");
    const replay = await finish(b, pending);
    assert.equal(replay.ok && replay.result.snapshot_id, saved.snapshot_id);
    assert.equal(
      Number(
        (
          await q(
            admin,
            "SELECT count(*) AS n FROM mcp_private.estimate_source_snapshot WHERE request_id=$1",
            [request],
          )
        )[0].n,
      ),
      1,
    );
    cases.push({
      name: "Concurrent source confirmation saves exactly one snapshot",
      lock_observed: true,
    });
  }
  {
    const before = await destination();
    const patch = (amount: number) => ({ "C-NATIVE": { description: "Synthetic cost", amount } });
    await begin(a);
    await rpcIn(a, "mcp_estimate_destination_save", [ids.job, before.version, patch(101)]);
    await begin(b);
    const pending = observe(
      rpcIn(b, "mcp_estimate_destination_save", [ids.job, before.version, patch(999)]),
    );
    await waitForLock(admin, pidB, pidA);
    await q(a, "COMMIT"); // Intentionally discard the first response: simulated response loss.
    const loser = await finish(b, pending);
    rejected(loser, /changed/i);
    const next = await destination();
    assert.equal(next.budget["C-NATIVE"].amount, 101);
    await execute(b, "mcp_estimate_destination_save", [ids.job, next.version, patch(200)]);
    await assert.rejects(
      execute(a, "mcp_estimate_destination_save", [ids.job, before.version, patch(101)]),
      /changed/i,
    );
    await assert.rejects(
      execute(a, "mcp_set_facts", [ids.job, "budget", patch(101), "member_answer"]),
      /version.checked/i,
    );
    assert.equal((await destination()).budget["C-NATIVE"].amount, 200);
    cases.push({
      name: "Concurrent destination CAS and lost-response101 replay preserve later200",
      lock_observed: true,
      loser,
    });
  }
  {
    // Hold the same advisory lock the real source RPC takes. Its second guard
    // must see a company membership revoked after the initial check.
    await q(a, "BEGIN");
    await q(
      a,
      "SELECT pg_advisory_xact_lock(hashtextextended('estimate-coverage:'||$1::uuid::text,0))",
      [ids.job],
    );
    await begin(b);
    const pending = observe(rpcIn(b, "mcp_estimate_coverage_snapshot", [ids.job]));
    await waitForLock(admin, pidB, pidA);
    await q(a, "DELETE FROM mcp_company_members WHERE company_id=$1 AND user_id=$2", [
      ids.company,
      ids.owner,
    ]);
    await q(a, "COMMIT");
    const revoked = await finish(b, pending);
    rejected(revoked, /MCP_|access|scope/i);
    await q(
      admin,
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Synthetic')",
      [ids.company, ids.owner],
    );
    cases.push({
      name: "Membership revoked during actual source lock wait denies read",
      lock_observed: true,
      revoked,
    });
  }

  {
    const quote = {
      sub: "Synthetic written quote",
      description: "Whole paint line",
      amount: 1200,
      ref: "T-1",
    };
    let current = await snapshot();
    await execute(a, "mcp_estimate_pricing_save_versioned", [
      ids.job,
      current.version,
      null,
      null,
      [quote],
      null,
    ]);
    current = await snapshot();
    const request = randomUUID();
    const decisions = [
      {
        quote_index: 0,
        decision: "carry",
        ref: "T-1",
        replace_labor_and_material: true,
        exclusive_to_line: true,
        source_note: "Synthetic written quote",
        scope_note: "Whole paint line",
        exclusions_note: "None stated",
      },
    ];
    await execute(a, "mcp_estimate_coverage_review", [
      ids.job,
      request,
      current.version,
      decisions,
    ]);
    await begin(a);
    const saved = await rpcIn(a, "mcp_estimate_coverage_save", [ids.job, request, true]);
    await begin(b);
    const pending = observe(rpcIn(b, "mcp_estimate_coverage_save", [ids.job, request, true]));
    await waitForLock(admin, pidB, pidA);
    await q(a, "COMMIT");
    const replay = await finish(b, pending);
    assert.equal(replay.ok && replay.result.version, saved.version);
    const selected = await snapshot();
    assert.equal(selected.selection.current, true);
    const calculated = calculateSavedBidSnapshot(selected);
    assert.equal(calculated.view.ready, true);
    assert.deepEqual(
      calculated.view.breakdown!.direct.map((line) => line.amountCents),
      [120000],
    );
    assert.equal(calculated.view.breakdown!.totalCents, 146520);
    const staleReview = randomUUID();
    await execute(a, "mcp_estimate_coverage_review", [
      ids.job,
      staleReview,
      selected.version,
      decisions,
    ]);
    await execute(b, "mcp_estimate_bid_save_versioned", [ids.job, selected.version, 12, 10]);
    await assert.rejects(
      execute(a, "mcp_estimate_coverage_save", [ids.job, staleReview, true]),
      /changed/i,
    );
    const old = await snapshot();
    const appended = {
      sub: "Synthetic comparison",
      description: "Competing whole paint line",
      amount: 2000,
      ref: "T-1",
    };
    await execute(b, "mcp_estimate_pricing_save_versioned", [
      ids.job,
      old.version,
      null,
      null,
      [quote, appended],
      null,
    ]);
    await assert.rejects(
      execute(a, "mcp_estimate_pricing_save_versioned", [
        ids.job,
        old.version,
        price(104),
        null,
        null,
        null,
      ]),
      /changed/i,
    );
    assert.deepEqual((await snapshot()).bid.pricing.quotes, [quote, appended]);
    const fresh = await snapshot();
    await execute(a, "mcp_estimate_pricing_save_versioned", [
      ids.job,
      fresh.version,
      price(105),
      null,
      null,
      null,
    ]);
    assert.deepEqual((await snapshot()).bid.pricing.quotes, [quote, appended]);
    cases.push({
      name: "Concurrent quote confirmation replaces direct cost once; stale review and rate retry preserve appended comparison quotes",
      lock_observed: true,
    });
  }

  // Build the exact privileged payload from the real saved-source calculator
  // and mapper. No client totals are accepted by the native test adapter.
  const attestation = await prepareHandoffDraft({
    companyId: ids.company,
    jobId: ids.job,
    snapshot: source.snapshot,
    ready: source.view.ready,
    breakdown: source.view.breakdown,
  });
  const budgetReview = async (request: string, correction: string | null = null) => {
    const current = await destination();
    const components = bidComponents(source.view.breakdown!);
    const mapping = mapEstimateDestination({
      breakdown: source.view.breakdown!,
      destination: destinationSnapshot(current),
      plan: {
        kind: "budget",
        lines: [{ cost_code: "C-NATIVE", description: "Reviewed synthetic cost" }],
        allocations: components.map((c) => ({
          component_id: c.id,
          splits:
            c.id === "direct:T-1" ? [{ target_key: "C-NATIVE", amount_cents: c.amountCents }] : [],
          excluded_cents: c.id === "direct:T-1" ? 0 : c.amountCents,
          exclusion_reason:
            c.id === "direct:T-1" ? null : "Explicitly excluded from execution budget",
        })),
      },
    });
    const payload = {
      kind: "budget",
      snapshot_id: frozen.snapshot_id,
      expected_version: current.version,
      allow_historical: true,
      correction_of: correction,
      reason: "Explicit synthetic source and cost mapping review",
      canonical_json: JSON.stringify(attestation.payload),
      canonical_sha256: attestation.sha256,
      mapping_json: JSON.stringify(mapping),
    };
    const reviewed = await execute(
      a,
      "mcp_estimate_facts_handoff",
      [ids.job, ids.owner, "review", request, payload],
      ids.owner,
      "service_role",
    );
    return { payload, reviewed };
  };
  let acceptedRequest: string;
  {
    acceptedRequest = randomUUID();
    const { payload } = await budgetReview(acceptedRequest);
    await begin(a, ids.owner, "service_role");
    const accepted = await rpcIn(a, "mcp_estimate_facts_handoff", [
      ids.job,
      ids.owner,
      "save",
      acceptedRequest,
      { kind: "budget", confirmed: true },
    ]);
    await begin(b, ids.owner, "service_role");
    const pending = observe(
      rpcIn(b, "mcp_estimate_facts_handoff", [
        ids.job,
        ids.owner,
        "save",
        acceptedRequest,
        { kind: "budget", confirmed: true },
      ]),
    );
    await waitForLock(admin, pidB, pidA);
    await q(a, "COMMIT");
    const replay = await finish(b, pending);
    assert.equal(accepted.accepted, true);
    assert.equal(replay.ok && replay.result.already_applied, true);
    assert.equal((await destination()).budget["C-NATIVE"].amount, 1500);
    assert.equal(
      Number(
        (
          await q(
            admin,
            "SELECT count(*) AS n FROM mcp_private.estimate_facts_handoff_operations WHERE request_id=$1",
            [acceptedRequest],
          )
        )[0].n,
      ),
      1,
    );
    await assert.rejects(
      execute(
        a,
        "mcp_estimate_facts_handoff",
        [
          ids.job,
          ids.owner,
          "review",
          acceptedRequest,
          { ...payload, reason: "Different request facts" },
        ],
        ids.owner,
        "service_role",
      ),
      /changed|different/i,
    );
    cases.push({
      name: "Concurrent exact handoff acceptance and uncertain-response replay apply once",
      lock_observed: true,
    });
  }
  {
    const request = randomUUID();
    await budgetReview(request, acceptedRequest!);
    const before = await destination();
    await execute(
      a,
      "mcp_estimate_facts_handoff",
      [ids.job, ids.owner, "cancel", request, { kind: "budget" }],
      ids.owner,
      "service_role",
    );
    await assert.rejects(
      execute(
        a,
        "mcp_estimate_facts_handoff",
        [ids.job, ids.owner, "save", request, { kind: "budget", confirmed: true }],
        ids.owner,
        "service_role",
      ),
      /cancelled/i,
    );
    assert.deepEqual(await destination(), before);
    cases.push({ name: "Cancelled mapping never changes its destination", passed: true });
  }
  {
    const request = randomUUID();
    await budgetReview(request, acceptedRequest!);
    const before = await destination();
    await execute(b, "mcp_estimate_destination_save", [
      ids.job,
      before.version,
      { "C-NATIVE": { description: "Later reviewed correction", amount: 2000 } },
    ]);
    await assert.rejects(
      execute(
        a,
        "mcp_estimate_facts_handoff",
        [ids.job, ids.owner, "save", request, { kind: "budget", confirmed: true }],
        ids.owner,
        "service_role",
      ),
      /changed/i,
    );
    assert.equal((await destination()).budget["C-NATIVE"].amount, 2000);
    cases.push({
      name: "Destination drift after handoff review preserves later correction",
      passed: true,
    });
  }
  {
    const request = randomUUID();
    await budgetReview(request, acceptedRequest!);
    const before = await destination();
    await admin
      .unsafe(
        `CREATE FUNCTION mcp_private.native_acceptance_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='${request}'::uuid THEN RAISE EXCEPTION 'Synthetic failure after destination before lineage'; END IF; RETURN NEW; END $$; CREATE TRIGGER native_acceptance_failure BEFORE INSERT ON mcp_private.estimate_facts_handoff_operations FOR EACH ROW EXECUTE FUNCTION mcp_private.native_acceptance_failure();`,
      )
      .simple();
    try {
      await assert.rejects(
        execute(
          a,
          "mcp_estimate_facts_handoff",
          [ids.job, ids.owner, "save", request, { kind: "budget", confirmed: true }],
          ids.owner,
          "service_role",
        ),
        /Synthetic failure/i,
      );
      assert.deepEqual(await destination(), before);
      assert.equal(
        Number(
          (
            await q(
              admin,
              "SELECT count(*) AS n FROM mcp_private.estimate_facts_handoff_operations WHERE request_id=$1",
              [request],
            )
          )[0].n,
        ),
        0,
      );
      assert.equal(
        Number(
          (
            await q(
              admin,
              "SELECT count(*) AS n FROM mcp_private.estimate_facts_handoff_claims WHERE request_id=$1",
              [request],
            )
          )[0].n,
        ),
        0,
      );
    } finally {
      await admin
        .unsafe(
          "DROP TRIGGER native_acceptance_failure ON mcp_private.estimate_facts_handoff_operations; DROP FUNCTION mcp_private.native_acceptance_failure();",
        )
        .simple();
    }
    cases.push({
      name: "Failure between destination and lineage rolls back values versions and claims",
      passed: true,
    });
  }
  // The official and draft copies share the real destination revision, while
  // retaining distinct fee terms and the official dollar lock.
  const recordedBasis = {
    reference: "Synthetic separately supplied executed agreement",
    provided_by: ids.owner,
    provided_at: "2026-11-01T00:00:00.000Z",
  };
  await execute(a, "mcp_set_facts", [
    ids.job,
    "contract",
    { contract_value: 1815, contract_value_basis: recordedBasis },
    "member_answer",
  ]);
  const awardBefore = await q(
    admin,
    "SELECT to_jsonb(f) AS value FROM mcp_job_facts f WHERE job_id=$1 AND module='contract' ORDER BY key",
    [ids.job],
  );
  for (const copy of ["official", "draft"] as const) {
    const current = await destination(),
      request = randomUUID();
    const fee = copy === "official" ? 10 : 20;
    const mapping = mapEstimateDestination({
      breakdown: source.view.breakdown!,
      destination: destinationSnapshot(current),
      plan: {
        kind: "sov",
        copy,
        source_basis: "base_contract",
        fee_pct: fee,
        billing_basis: `Explicit synthetic base-contract allocation at ${fee}%`,
        lines: [{ line: "01", description: "Synthetic base work", cost_codes: ["C-NATIVE"] }],
        allocations: bidComponents(source.view.breakdown!).map((component) => {
          const allocated =
            copy === "official"
              ? component.id === "direct:T-1"
                ? 150000
                : component.id === "overhead"
                  ? 13350
                  : 0
              : component.id === "direct:T-1"
                ? 145200
                : 0;
          return {
            component_id: component.id,
            splits: allocated ? [{ target_key: "01", amount_cents: allocated }] : [],
            fee_cents: component.amountCents - allocated,
          };
        }),
      },
    });
    const payload = {
      kind: "sov",
      snapshot_id: frozen.snapshot_id,
      expected_version: current.version,
      allow_historical: true,
      correction_of: null,
      reason: `Reviewed synthetic ${copy} SOV`,
      canonical_json: JSON.stringify(attestation.payload),
      canonical_sha256: attestation.sha256,
      mapping_json: JSON.stringify(mapping),
    };
    await execute(
      a,
      "mcp_estimate_facts_handoff",
      [ids.job, ids.owner, "review", request, payload],
      ids.owner,
      "service_role",
    );
    await begin(a, ids.owner, "service_role");
    const saved = await rpcIn(a, "mcp_estimate_facts_handoff", [
      ids.job,
      ids.owner,
      "save",
      request,
      { kind: "sov", confirmed: true },
    ]);
    await begin(b, ids.owner, "service_role");
    const pending = observe(
      rpcIn(b, "mcp_estimate_facts_handoff", [
        ids.job,
        ids.owner,
        "save",
        request,
        { kind: "sov", confirmed: true },
      ]),
    );
    await waitForLock(admin, pidB, pidA);
    await q(a, "COMMIT");
    const replay = await finish(b, pending);
    assert.equal(saved.accepted, true);
    assert.equal(replay.ok && replay.result.already_applied, true);
    const after = await destination();
    assert.equal(after.sov["01"].billable_value, 1633.5);
    assert.equal(after.terms.fee_pct, 10);
    assert.equal(after.official_locked, true);
    if (copy === "draft") {
      assert.equal(after.sov_draft["01"].billable_value, 1452);
      assert.equal(after.draft_terms.fee_pct, 20);
      assert.deepEqual(after.sov, current.sov);
      assert.deepEqual(after.terms, current.terms);
    }
    assert.equal(
      Number(
        (
          await q(
            admin,
            "SELECT count(*) AS n FROM mcp_private.estimate_facts_handoff_operations WHERE request_id=$1",
            [request],
          )
        )[0].n,
      ),
      1,
    );
    cases.push({
      name: `Concurrent ${copy} SOV acceptance is idempotent and preserves official terms`,
      lock_observed: true,
    });
  }
  {
    const packageId = randomUUID(),
      packageRequest = randomUUID(),
      packageReview = randomUUID();
    const facts = {
      code: "NATIVE-PAINT",
      title: "Synthetic package",
      scope: "Finishes",
      budget_cents: 100000,
      currency: "USD",
      status: "selected",
      candidates: [
        {
          party_id: ids.party,
          party_version: 1,
          quote_cents: 40000,
          scope: "Existing synthetic supplier scope",
          exclusions: null,
          source: "Existing synthetic written quote",
          quoted_on: null,
          expected_delivery_on: null,
        },
      ],
      selected_party_id: ids.party,
      commitment_refs: [{ po_id: ids.po, version: 1 }],
      expected_award_on: null,
      needed_by: null,
      submittal_ids: [],
      schedule_ref: null,
      source: "Synthetic reviewed package",
    };
    const args = [
      ids.company,
      ids.job,
      packageId,
      "package",
      0,
      facts,
      "Synthetic existing package",
      packageRequest,
      packageReview,
    ];
    await execute(a, "mcp_buyout_review", args);
    await execute(a, "mcp_buyout_record", [...args, true]);
    const request = randomUUID();
    const allocations = bidComponents(source.view.breakdown!).map((component) => ({
      component_id: component.id,
      include: component.id === "direct:T-1",
      exclusion_reason:
        component.id === "direct:T-1" ? null : "Explicitly excluded from package cost",
    }));
    const payload = {
      snapshot_id: frozen.snapshot_id,
      package_id: packageId,
      expected_version: 1,
      canonical_json: JSON.stringify(attestation.payload),
      canonical_sha256: attestation.sha256,
      allocations,
      reason: "Reviewed synthetic whole-component package mapping",
      allow_historical: true,
      correction_of: null,
    };
    await execute(
      a,
      "mcp_estimate_buyout_handoff",
      [ids.job, ids.owner, "review", request, payload],
      ids.owner,
      "service_role",
    );
    await begin(a, ids.owner, "service_role");
    const accepted = await rpcIn(a, "mcp_estimate_buyout_handoff", [
      ids.job,
      ids.owner,
      "save",
      request,
      { confirmed: true },
    ]);
    await begin(b, ids.owner, "service_role");
    const pending = observe(
      rpcIn(b, "mcp_estimate_buyout_handoff", [
        ids.job,
        ids.owner,
        "save",
        request,
        { confirmed: true },
      ]),
    );
    await waitForLock(admin, pidB, pidA);
    await q(a, "COMMIT");
    const replay = await finish(b, pending);
    assert.equal(accepted.accepted, true);
    assert.equal(replay.ok && replay.result.already_applied, true);
    const ledger = await execute(a, "mcp_buyout_get", [ids.company, ids.job]);
    const actual = ledger.records.find((record: Json) => record.id === packageId);
    assert.equal(actual.version, 2);
    assert.equal(actual.facts.budget_cents, 150000);
    for (const field of ["candidates", "selected_party_id", "commitment_refs"])
      assert.deepEqual(actual.facts[field], facts[field as keyof typeof facts]);
    assert.equal(
      Number(
        (
          await q(
            admin,
            "SELECT count(*) AS n FROM mcp_private.estimate_handoff_operations WHERE request_id=$1",
            [request],
          )
        )[0].n,
      ),
      1,
    );
    cases.push({
      name: "Concurrent existing-package handoff saves one budget version and preserves suppliers and POs",
      lock_observed: true,
    });
  }
  assert.deepEqual(
    await q(
      admin,
      "SELECT to_jsonb(f) AS value FROM mcp_job_facts f WHERE job_id=$1 AND module='contract' ORDER BY key",
      [ids.job],
    ),
    awardBefore,
  );
  {
    const before = await snapshot();
    await q(a, "BEGIN");
    await q(a, "SELECT job_id FROM mcp_estimate_pricing WHERE job_id=$1 FOR UPDATE", [ids.job]);
    await begin(b);
    const bQuery = observe(
      rpcIn(b, "mcp_estimate_pricing_save_versioned", [
        ids.job,
        before.version,
        price(102),
        null,
        null,
        null,
      ]),
    );
    await waitForLock(admin, pidB, pidA);
    // The retained direct writer owns the tuple before its revision trigger;
    // the versioned writer owns the advisory lock before reaching that tuple.
    const bFinished = finish(b, bQuery);
    const aQuery = observe(
      q(
        a,
        "UPDATE mcp_estimate_pricing SET updated_at=clock_timestamp() WHERE job_id=$1 RETURNING job_id",
        [ids.job],
      ).then(() => ({})),
    );
    const [aResult, bResult] = await Promise.all([finish(a, aQuery), bFinished]);
    const results = [aResult, bResult];
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.filter((r) => !r.ok && r.error.code === "40P01").length, 1);
    const after = await snapshot();
    assert.equal(
      after.bid.pricing.labor[0].hourly_rate,
      bResult.ok ? 102 : before.bid.pricing.labor[0].hourly_rate,
    );
    const fresh = await snapshot();
    await execute(a, "mcp_estimate_pricing_save_versioned", [
      ids.job,
      fresh.version,
      price(103),
      null,
      null,
      null,
    ]);
    assert.equal((await snapshot()).bid.pricing.labor[0].hourly_rate, 103);
    cases.push({
      name: "Native opposite-lock deadlock rolls back one victim and permits a separately fresh retry",
      lock_observed: true,
      outcomes: results,
    });
  }
  assert.deepEqual(
    await q(
      admin,
      "SELECT to_jsonb(v) AS value FROM mcp_purchase_order_versions v ORDER BY po_id,version",
    ),
    protectedBefore,
  );
  const historical = await execute(a, "mcp_estimate_snapshot_read", [ids.job, frozen.snapshot_id]);
  assert.equal(calculateSavedBidSnapshot(historical.snapshot).view.total, 1815);
  cases.push({
    name: "Historical canonical1815 source and approved PO versions remain unchanged",
    passed: true,
  });
} catch (error) {
  failure = errorInfo(error);
  process.exitCode = 1;
} finally {
  // Never leave reserved sessions in a failed transaction or dispose an
  // external database: the official CI service owns its own lifecycle.
  for (const c of connections) {
    await q(c, "ROLLBACK").catch(() => {});
    c.release();
  }
  if (pool) await pool.end({ timeout: 5 });
  const proposals = [
    "estimating-member-read-transactions",
    "estimating-quote-coverage",
    "estimating-gc-requirements-cas",
    "estimating-frozen-source-snapshot",
    "estimating-requirement-sources",
    "estimating-destination-versions",
    "estimating-buyout-handoff",
    "estimating-facts-handoff",
    "estimating-bid-artifact-storage",
  ].map((name) => {
    const path = `release-proposals/${name}.sql`,
      bytes = readFileSync(path);
    return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  writeFileSync(
    `${output}/results.json`,
    JSON.stringify(
      {
        environment,
        authorization,
        source: process.env.GITHUB_SHA ?? "unverified",
        synthetic: true,
        cases,
        unexecuted,
        failure,
        proposals,
        status: failure ? "failed" : "passed bounded native cases",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ passed_cases: cases.length, failure, unexecuted }, null, 2));
}
