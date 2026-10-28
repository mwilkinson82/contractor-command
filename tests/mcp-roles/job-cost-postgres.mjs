// Synthetic, isolated multi-connection PostgreSQL verification. No production connection.
// Supply ATHENA_PG_MODULES as a local directory containing embedded-postgres and pg packages.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import path from "node:path";
const modules = process.env.ATHENA_PG_MODULES;
if (!modules || !path.isAbsolute(modules))
  throw new Error("Set ATHENA_PG_MODULES to an existing local node_modules directory.");
const EmbeddedPostgres = (
  await import(pathToFileURL(path.join(modules, "embedded-postgres/dist/index.js")).href)
).default;
const requireFromLab = createRequire(path.join(modules, "pg/package.json"));
const pg = requireFromLab("pg");
const repo = process.cwd(),
  root = mkdtempSync("/tmp/athena-cost-isolated-pg-"),
  port = 55482;
const server = new EmbeddedPostgres({
  databaseDir: path.join(root, "data"),
  user: "synthetic",
  password: "synthetic",
  port,
  persistent: false,
  postgresFlags: ["-c", "listen_addresses=", "-c", `unix_socket_directories=${root}`],
  onLog: () => {},
  onError: () => {},
});
const client = () =>
  new pg.Client({
    host: root,
    port,
    user: "synthetic",
    password: "synthetic",
    database: "postgres",
  });
const ids = {
  owner: randomUUID(),
  ap: randomUUID(),
  pm: randomUUID(),
  super: randomUUID(),
  super2: randomUUID(),
  outside: randomUUID(),
  company: randomUUID(),
  otherCompany: randomUUID(),
  job: randomUUID(),
  job2: randomUUID(),
  outsideJob: randomUUID(),
};
let admin;
let failed = false;
const connections = [];
async function asUser(c, user, sql, params = []) {
  await c.query("BEGIN");
  try {
    await c.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: user, email: "synthetic@example.invalid", role: "authenticated" }),
    ]);
    await c.query("SET LOCAL ROLE authenticated");
    const r = await c.query(sql, params);
    await c.query("COMMIT");
    return r.rows[0]?.value;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}
async function prepare(c, user, job, purpose, payload) {
  return (
    await asUser(c, user, "SELECT public.mcp_cost_review_prepare($1,$2,$3::jsonb) AS value", [
      job,
      purpose,
      JSON.stringify(payload),
    ])
  ).review_id;
}
async function invoke(c, user, job, name, payload, ticket) {
  return asUser(c, user, `SELECT public.${name}($1,$2::jsonb,$3::uuid,true) AS value`, [
    job,
    JSON.stringify(payload),
    ticket,
  ]);
}
async function reviewed(c, user, job, purpose, name, payload) {
  return invoke(c, user, job, name, payload, await prepare(c, user, job, purpose, payload));
}
function facts(ref, kind = "supplier_bill") {
  return {
    kind,
    description: "Synthetic material",
    counterparty_name: "Synthetic payee",
    incurred_on: "2026-10-28",
    amount_cents: 10000,
    document_reference: ref,
    original: "missing",
    allocations: [{ job_id: ids.job, cost_code: "MAT", amount_cents: 10000 }],
  };
}
function submission(ref, kind) {
  return {
    id: randomUUID(),
    request_id: randomUUID(),
    expected_version: 0,
    facts: facts(ref, kind),
  };
}
function accounting(id, action, extra = {}) {
  return { id, action, request_id: randomUUID(), expected_version: 1, ...extra };
}
async function submit(c, p) {
  return reviewed(c, ids.owner, ids.job, "submission", "mcp_cost_submission_save", p);
}
async function action(c, p) {
  return reviewed(c, ids.ap, ids.job, "accounting", "mcp_cost_accounting_action", p);
}
async function pmApprove(c, p) {
  const payload = {
    id: p.id,
    request_id: randomUUID(),
    expected_version: 1,
    allocated_cents: 10000,
    basis: "work_verified",
  };
  return reviewed(c, ids.pm, ids.job, "pm_approval", "mcp_cost_pm_approve", payload);
}
async function postPayable(c, p) {
  await submit(c, p);
  await action(c, accounting(p.id, "approve"));
  await action(c, accounting(p.id, "post"));
  await pmApprove(c, p);
}
try {
  await server.initialise();
  await server.start();
  admin = client();
  await admin.connect();
  const dbTest = readFileSync(path.join(repo, "tests/mcp-roles/db.ts"), "utf8");
  const boot = dbTest.match(/const BOOT = `([\s\S]*?)`;/)?.[1];
  assert.ok(boot);
  await admin.query(boot);
  for (const f of readdirSync(path.join(repo, "drizzle/migrations"))
    .filter((f) => f.endsWith(".sql") && f <= "0024_athena_reopen_open_item.sql")
    .sort())
    await admin.query(
      readFileSync(path.join(repo, "drizzle/migrations", f), "utf8").replace(
        /--> statement-breakpoint/g,
        "",
      ),
    );
  await admin.query(
    "CREATE FUNCTION public.get_user_tier(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'circle'::text $$;",
  );
  for (const f of [
    "20261021190000_athena_team_invites.sql",
    "20261022120000_athena_account_team_privacy_terms.sql",
  ])
    await admin.query(readFileSync(path.join(repo, "supabase/migrations", f), "utf8"));
  await admin.query(
    readFileSync(path.join(repo, "docs/athena/job-cost-submission.schema-draft.sql"), "utf8"),
  );
  for (const id of [ids.owner, ids.ap, ids.pm, ids.super, ids.super2, ids.outside]) {
    await admin.query("INSERT INTO auth.users(id,email) VALUES($1,'synthetic@example.invalid')", [
      id,
    ]);
    await admin.query("INSERT INTO test_active_members VALUES($1)", [id]);
  }
  for (const [company, owner] of [
    [ids.company, ids.owner],
    [ids.otherCompany, ids.outside],
  ]) {
    await admin.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Synthetic',$2)", [
      company,
      owner,
    ]);
    await admin.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Owner')",
      [company, owner],
    );
  }
  for (const [user, role] of [
    [ids.ap, "ap"],
    [ids.pm, "pm"],
    [ids.super, "super"],
    [ids.super2, "super"],
  ])
    await admin.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,'Synthetic')",
      [ids.company, user, role],
    );
  for (const [job, company, owner, number] of [
    [ids.job, ids.company, ids.owner, "SYN-A"],
    [ids.job2, ids.company, ids.owner, "SYN-B"],
    [ids.outsideJob, ids.otherCompany, ids.outside, "SYN-C"],
  ])
    await admin.query(
      "INSERT INTO mcp_jobs(id,company_id,user_id,job_number,name) VALUES($1,$2,$3,$4,'Synthetic')",
      [job, company, owner, number],
    );
  for (const user of [ids.pm, ids.super, ids.super2])
    await admin.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
      ids.job,
      user,
      ids.owner,
    ]);
  for (let i = 0; i < 3; i++) {
    const c = client();
    await c.connect();
    connections.push(c);
  }
  const [a, b, c] = connections;
  const version = (await admin.query("SHOW server_version")).rows[0].server_version;
  // The same external reference raced from two independent transactions is inserted once.
  const d1 = submission("duplicate-race"),
    d2 = submission(" DUPLICATE-RACE ");
  const t1 = await prepare(a, ids.owner, ids.job, "submission", d1),
    t2 = await prepare(b, ids.owner, ids.job, "submission", d2);
  const duplicates = await Promise.allSettled([
    invoke(a, ids.owner, ids.job, "mcp_cost_submission_save", d1, t1),
    invoke(b, ids.owner, ids.job, "mcp_cost_submission_save", d2, t2),
  ]);
  assert.equal(duplicates.filter((x) => x.status === "fulfilled").length, 1);
  assert.match(duplicates.find((x) => x.status === "rejected").reason.message, /Duplicate/);
  // Concurrent retries of the same reviewed request produce one write and an idempotent replay.
  const retry = submission("same-request");
  const retryTicket = await prepare(a, ids.owner, ids.job, "submission", retry);
  const retries = await Promise.all([
    invoke(a, ids.owner, ids.job, "mcp_cost_submission_save", retry, retryTicket),
    invoke(b, ids.owner, ids.job, "mcp_cost_submission_save", retry, retryTicket),
  ]);
  assert.deepEqual(retries.map((r) => r.already_applied).sort(), [false, true]);
  assert.equal(
    Number(
      (await admin.query("SELECT count(*) n FROM mcp_cost_submissions WHERE id=$1", [retry.id]))
        .rows[0].n,
    ),
    1,
  );
  // Independent AP transactions cannot collectively exceed the posted payable.
  const bill = submission("payment-race");
  await postPayable(c, bill);
  const x = accounting(bill.id, "payment", {
    payment_id: randomUUID(),
    amount_cents: 6000,
    paid_on: "2026-10-29",
    reference: "race-check-1",
  });
  const y = accounting(bill.id, "payment", {
    payment_id: randomUUID(),
    amount_cents: 6000,
    paid_on: "2026-10-29",
    reference: "race-check-2",
  });
  const tx = await prepare(a, ids.ap, ids.job, "accounting", x),
    ty = await prepare(b, ids.ap, ids.job, "accounting", y);
  const payments = await Promise.allSettled([
    invoke(a, ids.ap, ids.job, "mcp_cost_accounting_action", x, tx),
    invoke(b, ids.ap, ids.job, "mcp_cost_accounting_action", y, ty),
  ]);
  assert.equal(payments.filter((z) => z.status === "fulfilled").length, 1);
  assert.match(payments.find((z) => z.status === "rejected").reason.message, /exceeds/);
  const after = (
    await asUser(c, ids.owner, "SELECT public.mcp_cost_submission_read($1) AS value", [ids.job])
  ).records.find((z) => z.id === bill.id);
  assert.equal(Number(after.active_settlement_cents), 6000);
  // Concurrent withdrawal/payment yields a serial result and preserves a payment if it won first.
  const bill2 = submission("withdrawal-race");
  await postPayable(c, bill2);
  const pmView = await asUser(c, ids.pm, "SELECT public.mcp_cost_pm_review($1) AS value", [
    ids.job,
  ]);
  const approval = pmView.records.find((z) => z.id === bill2.id).approval.id;
  const withdraw = {
    id: bill2.id,
    request_id: randomUUID(),
    expected_version: 1,
    approval_id: approval,
    reason: "Recheck",
  };
  const pay = accounting(bill2.id, "payment", {
    payment_id: randomUUID(),
    amount_cents: 1000,
    paid_on: "2026-10-29",
    reference: "withdrawal-race-check",
  });
  const tw = await prepare(a, ids.pm, ids.job, "pm_withdraw", withdraw),
    tp = await prepare(b, ids.ap, ids.job, "accounting", pay);
  const race = await Promise.allSettled([
    invoke(a, ids.pm, ids.job, "mcp_cost_pm_withdraw", withdraw, tw),
    invoke(b, ids.ap, ids.job, "mcp_cost_accounting_action", pay, tp),
  ]);
  assert.equal(race[0].status, "fulfilled");
  if (race[1].status === "rejected") assert.match(race[1].reason.message, /PM approval/);
  const afterWithdrawal = (
    await asUser(c, ids.owner, "SELECT public.mcp_cost_submission_read($1) AS value", [ids.job])
  ).records.find((z) => z.id === bill2.id);
  assert.equal(
    Number(afterWithdrawal.active_settlement_cents),
    race[1].status === "fulfilled" ? 1000 : 0,
  );
  assert.equal(afterWithdrawal.payments.length, race[1].status === "fulfilled" ? 1 : 0);
  assert.equal(afterWithdrawal.business_approvals[0].withdrawn, true);
  // Assigned superintendent sees only their own metadata, and cannot read the full ledger.
  const field = submission("super-field", "company_paid_expense");
  await reviewed(c, ids.super, ids.job, "field", "mcp_cost_field_submit", field);
  const own = await asUser(c, ids.super, "SELECT public.mcp_cost_field_own_read($1) AS value", [
    ids.job,
  ]);
  const other = await asUser(c, ids.super2, "SELECT public.mcp_cost_field_own_read($1) AS value", [
    ids.job,
  ]);
  assert.ok(own.submissions.some((z) => z.id === field.id));
  assert.equal(other.submissions.length, 0);
  await assert.rejects(
    asUser(c, ids.super, "SELECT public.mcp_cost_submission_read($1) AS value", [ids.job]),
    /Full project/,
  );
  await assert.rejects(
    asUser(c, ids.super, "SELECT * FROM public.mcp_cost_submissions"),
    /permission denied/,
  );
  await assert.rejects(
    asUser(
      c,
      ids.pm,
      "SELECT public.mcp_cost_accounting_action($1,$2::jsonb,$3::uuid,true) AS value",
      [ids.job, JSON.stringify(accounting(bill.id, "approve")), null],
    ),
    /not available/,
  );
  const wrong = submission("no-review");
  await assert.rejects(
    asUser(
      c,
      ids.owner,
      "SELECT public.mcp_cost_submission_save($1,$2::jsonb,$3::uuid,true) AS value",
      [ids.job, JSON.stringify(wrong), null],
    ),
    /Review the exact action/,
  );
  console.log(
    JSON.stringify({
      postgres: version,
      synthetic: true,
      duplicateRace: "one success",
      idempotentRace: "one write and one replay",
      overpaymentRace: "one success",
      withdrawalRace: race[1].status,
      fieldIsolation: "passed",
      roleAndReview: "passed",
    }),
  );
} catch (e) {
  console.error("POSTGRES TEST FAILED", e.stack);
  failed = true;
} finally {
  for (const c of connections) await c.end().catch(() => {});
  if (admin) await admin.end().catch(() => {});
  await server.stop().catch(() => {});
  rmSync(root, { recursive: true, force: true });
}
if (failed) process.exit(1);
