// Disposable synthetic PG17 only; no remote URLs, credentials or existing clusters.
// Default reproduces the unpatched baseline (expected failure). Set
// ATHENA_APPLY_POST_LOCK_PROPOSAL=1 to validate the reviewed follow-on.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const { Client } = require("/tmp/athena-accounting-pg17/node_modules/pg");
const bin = "/tmp/athena-accounting-pg17/node_modules/@embedded-postgres/darwin-arm64/native/bin";
const socket = mkdtempSync("/tmp/athena-sched-buyout-pg-");
const data = `${socket}/data`,
  output = "artifacts/buyout-lock-history";
mkdirSync(output, { recursive: true });
const run = (cmd, args, options = {}) => spawnSync(cmd, args, { encoding: "utf8", ...options });
const sessions = [],
  cases = [],
  violations = [];
let started = false,
  exitCode = 1,
  admin,
  a,
  b,
  ids;
const connect = async () => {
  const c = new Client({ host: socket, port: 65449, user: "postgres", database: "postgres" });
  await c.connect();
  sessions.push(c);
  return c;
};
const begin = async (c, uid) => {
  await c.query("BEGIN");
  await c.query("SET LOCAL ROLE authenticated");
  await c.query("SELECT set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: uid, role: "authenticated", email: "locks@synthetic.invalid" }),
  ]);
};
const query = async (c, uid, sql, args = []) => {
  await begin(c, uid);
  try {
    const r = await c.query(sql, args);
    await c.query("COMMIT");
    return r.rows[0]?.x;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
};
const reviewSql = "SELECT mcp_buyout_review($1,$2,$3,$4,$5,$6,$7,$8,$9) x";
const recordSql = "SELECT mcp_buyout_record($1,$2,$3,$4,$5,$6,$7,$8,$9,true) x";
const cancelSql = "SELECT mcp_buyout_review_cancel($1,$2,$3) x";
const packageFacts = (code) => ({
  code,
  title: "Synthetic scope",
  scope: "Division 26",
  budget_cents: 100000,
  currency: "USD",
  status: "draft",
  candidates: [],
  selected_party_id: null,
  commitment_refs: [],
  expected_award_on: null,
  needed_by: null,
  submittal_ids: [],
  schedule_ref: null,
  source: "Synthetic fixture",
});
const pending = async (uid = ids.pm) => {
  const p = [
    ids.company,
    ids.job,
    randomUUID(),
    "package",
    0,
    JSON.stringify(packageFacts(randomUUID())),
    "Synthetic lock test",
    randomUUID(),
    randomUUID(),
  ];
  await query(a, uid, reviewSql, p);
  return p;
};
const restore = async (uid, role) => {
  await admin.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,'Restored synthetic') ON CONFLICT(company_id,user_id) DO UPDATE SET role=EXCLUDED.role",
    [ids.company, uid, role],
  );
};
const waitForLock = async (pid) => {
  for (let n = 0; n < 150; n++) {
    if (
      (await admin.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [pid]))
        .rows[0]?.wait_event_type === "Lock"
    )
      return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Expected actual lock wait not observed");
};
async function revokedWait(
  name,
  uid,
  role,
  sql,
  args,
  lock = "company",
  snapshotSql = null,
  downgrade = null,
) {
  await restore(uid, role);
  const before = snapshotSql ? (await admin.query(snapshotSql, args.slice(0, 0))).rows : null;
  await b.query("BEGIN");
  await b.query(
    `SELECT id FROM ${lock === "company" ? "mcp_companies" : "mcp_jobs"} WHERE id=$1 FOR UPDATE`,
    [lock === "company" ? ids.company : ids.job],
  );
  await begin(a, uid);
  const waiting = a.query(sql, args).then(
    (r) => ({ ok: true, result: r.rows[0]?.x }),
    (e) => ({ ok: false, error: e.message }),
  );
  await waitForLock(a.processID);
  if (downgrade)
    await b.query("UPDATE mcp_company_members SET role=$3 WHERE company_id=$1 AND user_id=$2", [
      ids.company,
      uid,
      downgrade,
    ]);
  else
    await b.query("DELETE FROM mcp_company_members WHERE company_id=$1 AND user_id=$2", [
      ids.company,
      uid,
    ]);
  await b.query("COMMIT");
  const outcome = await waiting;
  await a.query("ROLLBACK"); // rollback even a vulnerable write: native demonstration never retains it
  if (outcome.ok) violations.push({ name, result: outcome.result });
  cases.push({
    name,
    lock_observed: true,
    revoked_before_release: true,
    denied: !outcome.ok,
    error: outcome.error ?? null,
  });
  if (snapshotSql) assert.deepEqual((await admin.query(snapshotSql)).rows, before);
  await restore(uid, role);
  return outcome;
}
try {
  let p = run(`${bin}/initdb`, [
    "-D",
    data,
    "-A",
    "trust",
    "-U",
    "postgres",
    "--no-locale",
    "-E",
    "UTF8",
  ]);
  assert.equal(p.status, 0, p.stderr);
  p = run(`${bin}/pg_ctl`, [
    "-D",
    data,
    "-l",
    `${socket}/postgres.log`,
    "-o",
    `-h '' -k ${socket} -p 65449 -c unix_socket_permissions=0700`,
    "-w",
    "start",
  ]);
  assert.equal(p.status, 0, p.stderr);
  started = true;
  process.env.ATHENA_SCHED_BUYOUT_PG_SOCKET = socket;
  p = run(process.execPath, [
    "node_modules/esbuild/bin/esbuild",
    "tests/buyout/lock-history-native-fixture.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--packages=external",
    `--outfile=${output}/fixture.mjs`,
  ]);
  assert.equal(p.status, 0, p.stderr);
  const f = await import(pathToFileURL(path.resolve(output, "fixture.mjs")));
  ids = f.ids;
  await f.install();
  admin = await connect();
  a = await connect();
  b = await connect();
  const server = (
    await admin.query(
      "SELECT version(),current_setting('listen_addresses') listeners,inet_server_addr() address",
    )
  ).rows[0];
  assert.equal(server.listeners, "");
  assert.equal(server.address, null);
  const metadataSql =
    "SELECT proname,proowner,proacl::text,provolatile,prosecdef,proconfig,prorettype,proargtypes::text,proparallel,proleakproof,procost,prorows FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY($1::text[]) ORDER BY proname";
  const guardedNames = [
    "mcp_buyout_review",
    "mcp_buyout_record",
    "mcp_buyout_review_cancel",
    "mcp_project_purchase_orders_review",
    "mcp_project_purchase_orders_record",
  ];
  const metadataBefore = (await admin.query(metadataSql, [guardedNames])).rows;
  const hardening = "drizzle/migrations/0051_post_lock_access_recheck.sql";
  if (process.env.ATHENA_APPLY_POST_LOCK_PROPOSAL === "1") {
    assert.ok(existsSync(hardening));
    await admin.query(readFileSync(hardening, "utf8"));
  }
  assert.deepEqual((await admin.query(metadataSql, [guardedNames])).rows, metadataBefore);
  const committed = await pending();
  await query(a, ids.pm, recordSql, committed);
  await revokedWait(
    "buyout committed replay after company lock",
    ids.pm,
    "pm",
    recordSql,
    committed,
  );
  await revokedWait(
    "buyout completed-save cancellation receipt after company lock",
    ids.pm,
    "pm",
    cancelSql,
    [ids.company, ids.job, committed[8]],
  );
  const uncommitted = await pending();
  await revokedWait(
    "buyout pending cancellation after company lock",
    ids.pm,
    "pm",
    cancelSql,
    [ids.company, ids.job, uncommitted[8]],
    "company",
    "SELECT id,cancelled FROM mcp_buyout_reviews ORDER BY id",
  );
  await revokedWait("buyout replay after job lock", ids.pm, "pm", recordSql, committed, "job");
  await revokedWait("buyout fresh record after company lock", ids.pm, "pm", recordSql, uncommitted);
  await revokedWait(
    "buyout replay after PM demoted to AP during company lock",
    ids.pm,
    "pm",
    recordSql,
    committed,
    "company",
    null,
    "ap",
  );
  const poPayload = {
    id: randomUUID(),
    request_id: randomUUID(),
    scope: "company",
    title: "Synthetic approved terms",
    body: "Synthetic source terms",
    source: "Owner synthetic review",
  };
  const poReview = randomUUID();
  await query(
    a,
    ids.owner,
    "SELECT mcp_project_purchase_orders_review($1,'approve_company_terms',$2,$3) x",
    [ids.job, JSON.stringify(poPayload), poReview],
  );
  await query(
    a,
    ids.owner,
    "SELECT mcp_project_purchase_orders_record($1,'approve_company_terms',$2,$3,true) x",
    [ids.job, JSON.stringify(poPayload), poReview],
  );
  await revokedWait(
    "canonical company approval committed replay after job lock",
    ids.owner,
    "owner",
    "SELECT mcp_project_purchase_orders_record($1,'approve_company_terms',$2,$3,true) x",
    [ids.job, JSON.stringify(poPayload), poReview],
    "job",
  );
  await admin.query(
    "INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$2) ON CONFLICT DO NOTHING",
    [ids.job, ids.owner],
  );
  await revokedWait(
    "company approval replay after owner demoted to PM with retained job access",
    ids.owner,
    "owner",
    "SELECT mcp_project_purchase_orders_record($1,'approve_company_terms',$2,$3,true) x",
    [ids.job, JSON.stringify(poPayload), poReview],
    "job",
    null,
    "pm",
  );
  const newPayload = { ...poPayload, id: randomUUID(), request_id: randomUUID() },
    newReview = randomUUID();
  await query(
    a,
    ids.owner,
    "SELECT mcp_project_purchase_orders_review($1,'approve_company_terms',$2,$3) x",
    [ids.job, JSON.stringify(newPayload), newReview],
  );
  await revokedWait(
    "fresh company approval after job lock control",
    ids.owner,
    "owner",
    "SELECT mcp_project_purchase_orders_record($1,'approve_company_terms',$2,$3,true) x",
    [ids.job, JSON.stringify(newPayload), newReview],
    "job",
  );
  // Revoke only assigned-job access while retaining PM company membership.
  const pReview = [
    ids.job,
    "order",
    JSON.stringify({ id: randomUUID(), request_id: randomUUID() }),
    randomUUID(),
  ];
  await b.query("BEGIN");
  await b.query("SELECT id FROM mcp_jobs WHERE id=$1 FOR UPDATE", [ids.job]);
  await begin(a, ids.pm);
  const wait = a.query("SELECT mcp_project_purchase_orders_review($1,$2,$3,$4) x", pReview).then(
    (r) => ({ ok: true, result: r.rows[0].x }),
    (e) => ({ ok: false, error: e.message }),
  );
  await waitForLock(a.processID);
  await b.query("DELETE FROM mcp_job_access WHERE job_id=$1 AND user_id=$2", [ids.job, ids.pm]);
  await b.query("COMMIT");
  const got = await wait;
  await a.query("ROLLBACK");
  if (got.ok)
    violations.push({
      name: "PO new review after assigned-job access revoked",
      result: got.result,
    });
  cases.push({
    name: "PO new review after assigned-job access revoked",
    lock_observed: true,
    denied: !got.ok,
    error: got.error ?? null,
  });
  await admin.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by)VALUES($1,$2,$3)", [
    ids.job,
    ids.pm,
    ids.owner,
  ]);
  const draftPayload = {
    id: ids.po,
    request_id: randomUUID(),
    expected_version: 1,
    party_id: ids.party,
    party_version: 1,
    number: "PO1",
    terms_id: ids.terms,
    status: "draft",
    lines: [
      { description: "Synthetic revised scope", quantity: 2, unit: "EA", unit_price_cents: 20000 },
    ],
    order_date: "2026-10-30",
    needed_by: "2026-12-01",
    reason: "Synthetic revocation draft",
  };
  const draftReview = randomUUID();
  await query(a, ids.pm, "SELECT mcp_project_purchase_orders_review($1,'order',$2,$3) x", [
    ids.job,
    JSON.stringify(draftPayload),
    draftReview,
  ]);
  await revokedWait(
    "PO fresh draft record after membership revoked during job lock",
    ids.pm,
    "pm",
    "SELECT mcp_project_purchase_orders_record($1,'order',$2,$3,true) x",
    [ids.job, JSON.stringify(draftPayload), draftReview],
    "job",
  );
  // Authorized retries must still work after all revocation tests.
  assert.equal((await query(a, ids.pm, recordSql, committed)).already_applied, true);
  assert.equal(
    (await query(a, ids.pm, cancelSql, [ids.company, ids.job, committed[8]])).saved,
    true,
  );
  const exposure = (
    await query(a, ids.owner, "SELECT mcp_buyout_get($1,$2) x", [ids.company, ids.job])
  ).orders[0].versions.filter((v) => v.status === "approved");
  assert.equal(exposure.length, 1);
  assert.equal(exposure[0].version, 1);
  assert.equal(
    (
      await query(
        a,
        ids.owner,
        "SELECT mcp_project_purchase_orders_record($1,'approve_company_terms',$2,$3,true) x",
        [ids.job, JSON.stringify(poPayload), poReview],
      )
    ).already_applied,
    true,
  );
  const cancelPending = await pending();
  assert.equal(
    (await query(a, ids.pm, cancelSql, [ids.company, ids.job, cancelPending[8]])).cancelled,
    true,
  );
  await assert.rejects(() => query(a, ids.pm, recordSql, cancelPending), /cancelled/);
  // Stress actual JSON RPC histories above ordinary row limits; direct admin inserts seed synthetic history only.
  const large = await pending(ids.owner);
  await query(a, ids.owner, recordSql, large);
  await admin.query(
    "INSERT INTO mcp_buyout_versions(record_id,version,facts,reason,recorded_by) SELECT $1,n,jsonb_set($2::jsonb,'{title}',to_jsonb('Synthetic history v'||n)),'Synthetic historic seed',$3 FROM generate_series(2,1205) n",
    [large[2], large[5], ids.owner],
  );
  await admin.query("UPDATE mcp_buyout_records SET version=1205 WHERE id=$1", [large[2]]);
  await admin.query(
    "INSERT INTO mcp_buyout_records(id,company_id,job_id,kind,record_key,version) SELECT gen_random_uuid(),$1,$2,'package','stress-'||n,1 FROM generate_series(1,1201) n",
    [ids.company, ids.job],
  );
  await admin.query(
    "INSERT INTO mcp_buyout_versions(record_id,version,facts,reason,recorded_by) SELECT id,1,jsonb_set($1::jsonb,'{code}',to_jsonb(record_key)),'Synthetic bulk seed',$2 FROM mcp_buyout_records r WHERE record_key LIKE 'stress-%'",
    [JSON.stringify(packageFacts("bulk")), ids.owner],
  );
  await admin.query(
    "INSERT INTO mcp_purchase_order_versions(po_id,version,status,terms_id,party_snapshot,lines,order_date,needed_by,created_by) SELECT $1,n,CASE WHEN n=1003 THEN 'approved' ELSE 'draft' END,$2,$3::jsonb,jsonb_build_array(jsonb_build_object('description','Synthetic PO history','quantity',1,'unit','EA','unit_price_cents',10000+n)),'2026-10-30','2026-12-01',$4 FROM generate_series(2,1005) n",
    [ids.po, ids.terms, JSON.stringify({ id: ids.party, name: "Synthetic Supplier" }), ids.owner],
  );
  await admin.query(
    "INSERT INTO mcp_living_reports(job_id,report_type,version,data) SELECT $1,'cpm',n,jsonb_build_object('activities',jsonb_build_array(jsonb_build_object('id','PROC-1','name','Schedule v'||n))) FROM generate_series(2,2500) n",
    [ids.job],
  );
  const historyStart = performance.now();
  const ledger = await query(a, ids.owner, "SELECT mcp_buyout_get($1,$2) x", [
    ids.company,
    ids.job,
  ]);
  const historyMs = performance.now() - historyStart;
  const historical = ledger.records.find((r) => r.id === large[2]);
  assert.equal(historical.version, 1205);
  assert.equal(historical.facts.title, "Synthetic history v1205");
  assert.equal(historical.versions.length, 1205);
  assert.equal(historical.versions[0].version, 1205);
  assert.equal(historical.versions.at(-1).version, 1);
  assert.equal(ledger.records.filter((r) => r.record_key.startsWith("stress-")).length, 1201);
  const po = ledger.orders.find((o) => o.id === ids.po);
  assert.equal(po.versions.length, 1005);
  assert.equal(f.orderVersions(po)[0].version, 1005);
  assert.equal(f.orderTotal(f.orderVersions(po)[0]), 11005);
  assert.equal(f.buyoutProjection(ledger).canonical_committed_cents, 11003);
  assert.equal(ledger.schedule_activities[0].report_version, 2500);
  const fresh = await pending();
  await query(a, ids.pm, recordSql, fresh);
  assert.equal((await query(a, ids.pm, recordSql, fresh)).already_applied, true);
  const history = {
    buyout_bulk_records: 1201,
    buyout_versions_on_one_record: 1205,
    PO_versions_on_one_order: 1005,
    current_PO_version: 1005,
    current_approved_PO_version: 1003,
    canonical_approved_cents: 11003,
    current_draft_cents: 11005,
    CPM_report_versions: 2500,
    current_CPM_version: 2500,
    response_bytes: Buffer.byteLength(JSON.stringify(ledger)),
    read_ms: Math.round(historyMs),
    authorized_save_and_exact_replay_after_stress: true,
  };
  writeFileSync(
    `${output}/results.json`,
    JSON.stringify(
      {
        server,
        localOnly: true,
        hardening_applied: process.env.ATHENA_APPLY_POST_LOCK_PROPOSAL === "1",
        cases,
        violations,
        authorized_replay_preserved: true,
        function_owner_acl_security_metadata_unchanged: true,
        history,
        revocation_tests_preserve_canonical_approved_PO: true,
      },
      null,
      2,
    ) + "\n",
  );
  exitCode = violations.length ? 1 : 0;
} catch (e) {
  console.error(e.stack);
} finally {
  for (const c of sessions) await c.end().catch(() => {});
  const stop = started ? run(`${bin}/pg_ctl`, ["-D", data, "-m", "fast", "-w", "stop"]) : null;
  const stopped =
    started && stop?.status === 0 && run(`${bin}/pg_ctl`, ["-D", data, "status"]).status === 3;
  if (started && !stopped) exitCode = 1;
  writeFileSync(
    `${output}/lifecycle.json`,
    JSON.stringify({ localOnly: true, socket, started, stopped, exitCode }, null, 2) + "\n",
  );
}
process.exitCode = exitCode;
