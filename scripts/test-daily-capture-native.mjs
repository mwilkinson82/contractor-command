// Disposable synthetic PG17 only. No external connection URL, password or existing cluster accepted.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import {
  installDailyCaptureFixture,
  dailyFixture as f,
  captureSql,
  captureArgs,
  legacySql,
  dailyLines,
} from "../tests/daily-capture-fixture.mjs";
const require = createRequire(import.meta.url);
const { Client } = require("/tmp/athena-accounting-pg17/node_modules/pg");
const bin = "/tmp/athena-accounting-pg17/node_modules/@embedded-postgres/darwin-arm64/native/bin";
const socket = mkdtempSync("/tmp/athena-daily-create-pg-");
const data = `${socket}/data`,
  port = 65449;
const output = "artifacts/daily-capture-create-only";
mkdirSync(output, { recursive: true });
const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });
const sessions = [];
const cases = [];
let started = false,
  exitCode = 1;
const connect = async () => {
  const c = new Client({ host: socket, port, user: "postgres", database: "postgres" });
  await c.connect();
  sessions.push(c);
  return c;
};
const begin = async (c, uid) => {
  await c.query("BEGIN");
  await c.query("SET LOCAL ROLE authenticated");
  await c.query("SELECT set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: uid, role: "authenticated", email: "daily-fixture.invalid" }),
  ]);
};
const asUser = async (c, uid, sql, args = []) => {
  await begin(c, uid);
  try {
    const out = await c.query(sql, args);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
};
const result = async (c, uid, args) => (await asUser(c, uid, captureSql, args)).rows[0].result;
const waitForLock = async (admin, pid) => {
  for (let n = 0; n < 100; n++) {
    if (
      (await admin.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [pid]))
        .rows[0]?.wait_event_type === "Lock"
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Second native session did not block on the expected unique-row lock.");
};
let admin;
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
    `-h '' -k ${socket} -p ${port}`,
    "-w",
    "start",
  ]);
  assert.equal(p.status, 0, p.stderr);
  started = true;
  admin = await connect();
  const a = await connect(),
    b = await connect();
  const server = (
    await admin.query(
      "SELECT version(),current_setting('listen_addresses') listeners,inet_server_addr() address",
    )
  ).rows[0];
  assert.equal(server.listeners, "");
  assert.equal(server.address, null);
  await installDailyCaptureFixture((sql, args) => admin.query(sql, args));
  cases.push(
    "actual superintendent SQL and unchanged canonical save installed with proposal on native PG17",
  );
  const snapshot = async (day) =>
    (
      await admin.query(
        "SELECT (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM mcp_daily_reports r WHERE report_date=$1) reports,(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM mcp_daily_work_lines l JOIN mcp_daily_reports r ON r.id=l.daily_id WHERE r.report_date=$1) lines,(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM mcp_production_rates p JOIN mcp_daily_reports r ON r.id=p.daily_id WHERE r.report_date=$1) rates",
        [day],
      )
    ).rows[0];

  // Two distinct sessions/actors start with the same absent date. Loser is held on the actual unique index.
  const raceDay = "2026-10-01",
    first = captureArgs(randomUUID(), raceDay, "Winner");
  await begin(a, f.owner);
  const winner = (await a.query(captureSql, first)).rows[0].result;
  await begin(b, f.super);
  const loser = b.query(captureSql, captureArgs(randomUUID(), raceDay, "Must never replace")).then(
    (x) => ({ ok: true, x }),
    (e) => ({ ok: false, e }),
  );
  await waitForLock(admin, b.processID);
  await a.query("COMMIT");
  const lost = await loser;
  assert.equal(lost.ok, false);
  assert.match(lost.e.message, /MCP_DAILY_EXISTS/);
  await b.query("ROLLBACK");
  let snap = await snapshot(raceDay);
  assert.equal(snap.reports.length, 1);
  assert.equal(snap.lines[0].work, "Winner");
  assert.equal(snap.lines.length, 1);
  assert.equal(snap.rates.length, 1);
  assert.equal(snap.reports[0].id, winner.id);
  cases.push(
    "two native sessions racing one job/date: one creates, blocked loser fails, winner report/lines/rates unchanged",
  );

  // Same request concurrently/after ambiguous response: return original receipt, never write twice.
  const retryDay = "2026-10-02",
    retry = captureArgs(randomUUID(), retryDay, "Idempotent");
  await begin(a, f.owner);
  const original = (await a.query(captureSql, retry)).rows[0].result;
  await begin(b, f.owner);
  const concurrent = b.query(captureSql, retry);
  await waitForLock(admin, b.processID);
  await a.query("COMMIT");
  const replay = (await concurrent).rows[0].result;
  await b.query("COMMIT");
  assert.equal(replay.id, original.id);
  assert.equal(replay.replayed, true);
  const before = await snapshot(retryDay);
  assert.equal((await result(a, f.owner, retry)).replayed, true);
  assert.deepEqual(await snapshot(retryDay), before);
  const mismatch = [...retry];
  mismatch[12] = JSON.stringify(dailyLines("Changed after confirmation"));
  await assert.rejects(() => result(a, f.owner, mismatch), /MCP_DAILY_KEY/);
  assert.deepEqual(await snapshot(retryDay), before);
  cases.push(
    "same-key concurrent and lost-response retries reuse one receipt; changed payload rejected without replacing evidence",
  );

  // A new request from a stale review cannot overwrite an intervening canonical create.
  const staleDay = "2026-10-03",
    stale = captureArgs(randomUUID(), staleDay, "Old reviewed draft");
  await asUser(a, f.owner, legacySql, [
    f.job,
    staleDay,
    "Preserved legacy transcript",
    JSON.stringify(dailyLines("Canonical saved first")),
  ]);
  const existing = await snapshot(staleDay);
  await assert.rejects(() => result(b, f.super, stale), /MCP_DAILY_EXISTS/);
  assert.deepEqual(await snapshot(staleDay), existing);
  cases.push(
    "stale confirmation / known-existing date preserves canonical report, transcript, line IDs and rates",
  );
  const expired = captureArgs(
    randomUUID(),
    "2026-10-04",
    "Expired",
    new Date(Date.now() - 16 * 60_000).toISOString(),
  );
  await assert.rejects(() => result(a, f.owner, expired), /MCP_DAILY_STALE/);
  assert.equal((await snapshot("2026-10-04")).reports, null);
  cases.push("expired confirmation rejected with no report or receipt residue");

  // Legacy and create-only paths contend on the same unique row; legacy is not rewritten or bypassed.
  const legacyDay = "2026-10-05";
  await begin(a, f.owner);
  await a.query(legacySql, [
    f.job,
    legacyDay,
    "Legacy original",
    JSON.stringify(dailyLines("Legacy wins")),
  ]);
  await begin(b, f.super);
  const pending = b.query(captureSql, captureArgs(randomUUID(), legacyDay, "Capture loser")).then(
    (x) => ({ ok: true, x }),
    (e) => ({ ok: false, e }),
  );
  await waitForLock(admin, b.processID);
  await a.query("COMMIT");
  const legacyLost = await pending;
  assert.equal(legacyLost.ok, false);
  assert.match(legacyLost.e.message, /MCP_DAILY_EXISTS/);
  await b.query("ROLLBACK");
  assert.equal((await snapshot(legacyDay)).lines[0].work, "Legacy wins");
  cases.push("capture versus canonical writer race fails safely on the shared job/date constraint");

  // Cancel a real blocked request, rollback its transaction, and retain only the winner.
  const cancelDay = "2026-10-06",
    cancelKey = randomUUID();
  await begin(a, f.owner);
  await a.query(captureSql, captureArgs(randomUUID(), cancelDay, "Cancel winner"));
  await begin(b, f.super);
  const canceled = b.query(captureSql, captureArgs(cancelKey, cancelDay, "Canceled")).then(
    (x) => ({ ok: true, x }),
    (e) => ({ ok: false, e }),
  );
  await waitForLock(admin, b.processID);
  assert.equal(
    (await admin.query("SELECT pg_cancel_backend($1) canceled", [b.processID])).rows[0].canceled,
    true,
  );
  const canceledResult = await canceled;
  assert.equal(canceledResult.ok, false);
  assert.equal(canceledResult.e.code, "57014");
  await b.query("ROLLBACK");
  await a.query("COMMIT");
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM mcp_daily_capture_requests WHERE request_id=$1",
        [cancelKey],
      )
    ).rows[0].n,
    0,
  );
  assert.equal((await snapshot(cancelDay)).lines[0].work, "Cancel winner");
  cases.push("canceling an actual blocked native query leaves no capture receipt/partial daily");

  // Canonical validation failure after expected-absence claim rolls report/receipt/rates/feed back together.
  const bad = captureArgs(randomUUID(), "2026-10-07");
  const feedBefore = (
    await admin.query("SELECT * FROM mcp_field_schedule_feed ORDER BY job_id,activity_id")
  ).rows;
  bad[12] = JSON.stringify([
    dailyLines("First valid line writes a feed")[0],
    { ...dailyLines("Second invalid line")[0], activity_id: "E091", crew: 0 },
  ]);
  await assert.rejects(() => result(a, f.owner, bad), /missing|crew|hours|check/i);
  assert.equal((await snapshot("2026-10-07")).reports, null);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM mcp_daily_capture_requests WHERE request_id=$1",
        [bad[3]],
      )
    ).rows[0].n,
    0,
  );
  assert.deepEqual(
    (await admin.query("SELECT * FROM mcp_field_schedule_feed ORDER BY job_id,activity_id")).rows,
    feedBefore,
  );
  cases.push(
    "canonical validation failure rolls back claim, receipt, daily, lines, rates and feed atomically",
  );

  // An exact same-key replay blocked behind a creation must recheck access AFTER its wait.
  const blockedAccessArgs = captureArgs(randomUUID(), "2026-10-11", "Created before revocation");
  await begin(a, f.super);
  await a.query(captureSql, blockedAccessArgs);
  await begin(b, f.super);
  const blockedReplay = b.query(captureSql, blockedAccessArgs).then(
    (x) => ({ ok: true, x }),
    (e) => ({ ok: false, e }),
  );
  await waitForLock(admin, b.processID);
  await admin.query("DELETE FROM mcp_job_access WHERE job_id=$1 AND user_id=$2", [f.job, f.super]);
  await a.query("COMMIT");
  const revokedReplay = await blockedReplay;
  assert.equal(revokedReplay.ok, false);
  assert.match(revokedReplay.e.message, /MCP_NO_JOB|role|access/i);
  await b.query("ROLLBACK");
  await admin.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
    f.job,
    f.super,
    f.owner,
  ]);
  cases.push("access revoked during same-key lock wait prevents receipt return after the wait");

  // The losing contender may win after rollback, but must still pass the canonical guard then.
  const lostAccessDay = "2026-10-12";
  await begin(a, f.owner);
  await a.query(captureSql, captureArgs(randomUUID(), lostAccessDay, "Rolled-back first"));
  await begin(b, f.super);
  const waitingCreate = b
    .query(captureSql, captureArgs(randomUUID(), lostAccessDay, "Revoked second"))
    .then(
      (x) => ({ ok: true, x }),
      (e) => ({ ok: false, e }),
    );
  await waitForLock(admin, b.processID);
  await admin.query("DELETE FROM mcp_job_access WHERE job_id=$1 AND user_id=$2", [f.job, f.super]);
  await a.query("ROLLBACK");
  const revokedCreate = await waitingCreate;
  assert.equal(revokedCreate.ok, false);
  assert.match(revokedCreate.e.message, /MCP_NO_JOB|role|access/i);
  await b.query("ROLLBACK");
  assert.equal((await snapshot(lostAccessDay)).reports, null);
  await admin.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
    f.job,
    f.super,
    f.owner,
  ]);
  cases.push(
    "access loss during job/date wait rolls back a subsequently won claim without a partial daily",
  );

  // If a first transaction aborts, a still-authorized second session can safely create exactly once.
  const abortDay = "2026-10-13",
    abortKey = randomUUID();
  await begin(a, f.owner);
  await a.query(captureSql, captureArgs(abortKey, abortDay, "Aborted first"));
  await begin(b, f.super);
  const survivor = b.query(captureSql, captureArgs(randomUUID(), abortDay, "Surviving second"));
  await waitForLock(admin, b.processID);
  await a.query("ROLLBACK");
  assert.equal((await survivor).rows[0].result.creation_only, true);
  await b.query("COMMIT");
  assert.equal((await snapshot(abortDay)).lines[0].work, "Surviving second");
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM mcp_daily_capture_requests WHERE request_id=$1",
        [abortKey],
      )
    ).rows[0].n,
    0,
  );
  cases.push(
    "rolled-back first creator leaves no reservation and the authorized second session creates once",
  );

  // Committed receipt remains resolvable after the confirmation window without replaying any writes.
  const aging = captureArgs(
    randomUUID(),
    "2026-10-14",
    "Expired receipt retry",
    new Date(Date.now() - 898_500).toISOString(),
  );
  await result(a, f.owner, aging);
  const agingBefore = await snapshot("2026-10-14");
  await new Promise((resolve) => setTimeout(resolve, 1700));
  assert.equal((await result(b, f.owner, aging)).replayed, true);
  assert.deepEqual(await snapshot("2026-10-14"), agingBefore);
  cases.push("committed exact-request replay remains idempotent after confirmation expiry");

  // Guard precedes idempotent receipt return. Existing/new limited roles retain canonical scope.
  const superArgs = captureArgs(randomUUID(), "2026-10-08");
  await result(a, f.super, superArgs);
  await admin.query("DELETE FROM mcp_job_access WHERE job_id=$1 AND user_id=$2", [f.job, f.super]);
  await assert.rejects(() => result(b, f.super, superArgs), /MCP_NO_JOB|role|access/i);
  for (const uid of [f.contracts, f.outsider])
    await assert.rejects(
      () => result(a, uid, captureArgs(randomUUID(), "2026-10-09")),
      /MCP_NO_JOB|role|access/i,
    );
  await assert.rejects(
    () =>
      result(
        a,
        f.pm,
        captureArgs(randomUUID(), "2026-10-09", "Foreign job", undefined, f.otherJob),
      ),
    /MCP_NO_JOB|role|access/i,
  );
  await assert.rejects(
    () => asUser(a, f.owner, "SELECT * FROM mcp_daily_capture_requests"),
    /permission denied/,
  );
  cases.push(
    "revoked assigned-super replay, contracts/foreign/unassigned roles and direct receipt-table reads denied",
  );
  const denied = captureArgs(randomUUID(), "2026-10-10", undefined, undefined, undefined, false);
  await assert.rejects(() => result(a, f.owner, denied), /MCP_DAILY_CONFIRM/);
  assert.equal((await snapshot("2026-10-10")).reports, null);
  cases.push("unconfirmed/canceled-before-submit daily creates no server reservation");
  // Intentional existing workflow corrections remain available; replaying prior capture does not revert one.
  await asUser(a, f.owner, legacySql, [
    f.job,
    retryDay,
    "Later intentional correction",
    JSON.stringify(dailyLines("Later canonical correction")),
  ]);
  const corrected = await snapshot(retryDay);
  assert.equal((await result(a, f.owner, retry)).replayed, true);
  assert.deepEqual(await snapshot(retryDay), corrected);
  cases.push(
    "existing canonical correction remains functional; old create receipt replay never reverts current evidence",
  );
  exitCode = 0;
  writeFileSync(
    `${output}/native-tests.json`,
    JSON.stringify({ server, cases, passed: cases.length, localOnly: true }, null, 2) + "\n",
  );
  console.log(JSON.stringify({ passed: cases.length, cases }, null, 2));
} catch (e) {
  console.error(e);
  writeFileSync(`${output}/native-failure.txt`, String(e.stack ?? e));
} finally {
  for (const c of sessions)
    try {
      await c.end();
    } catch {}
  const stop = started ? run(`${bin}/pg_ctl`, ["-D", data, "-m", "fast", "-w", "stop"]) : null;
  const stopped =
    started && stop?.status === 0 && run(`${bin}/pg_ctl`, ["-D", data, "status"]).status === 3;
  if (started && !stopped) exitCode = 1;
  writeFileSync(
    `${output}/native-lifecycle.json`,
    JSON.stringify(
      {
        socket,
        localOnly: true,
        started,
        stopped,
        exitCode,
        version: run(`${bin}/postgres`, ["--version"]).stdout.trim(),
      },
      null,
      2,
    ) + "\n",
  );
}
process.exitCode = exitCode;
