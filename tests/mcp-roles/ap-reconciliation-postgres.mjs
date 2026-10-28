// Synthetic isolated PostgreSQL snapshot and concurrent-commit verification only.
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
const pg = createRequire(path.join(modules, "pg/package.json"))("pg");
const root = mkdtempSync("/tmp/athena-ap-snapshot-pg-"),
  port = 55483,
  repo = process.cwd();
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
const id = {
  owner: randomUUID(),
  ap: randomUUID(),
  company: randomUUID(),
  job: randomUUID(),
  record: randomUUID(),
};
let admin,
  writer,
  reader,
  failed = false;
async function snapshot() {
  await reader.query("BEGIN READ ONLY");
  try {
    await reader.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: id.ap, email: "synthetic@example.invalid", role: "authenticated" }),
    ]);
    await reader.query("SET LOCAL ROLE authenticated");
    const r = (
      await reader.query("SELECT public.mcp_cost_reconciliation_snapshot($1) AS value", [id.job])
    ).rows[0].value;
    await reader.query("COMMIT");
    return r;
  } catch (e) {
    await reader.query("ROLLBACK");
    throw e;
  }
}
const facts = (n) => ({
  kind: "supplier_bill",
  description: "Synthetic",
  counterparty_name: "Supplier",
  incurred_on: "2026-10-28",
  amount_cents: n * 100,
  original: "missing",
  allocations: [{ job_id: id.job, cost_code: "MAT", amount_cents: n * 100 }],
});
try {
  await server.initialise();
  await server.start();
  admin = client();
  writer = client();
  reader = client();
  await Promise.all([admin.connect(), writer.connect(), reader.connect()]);
  const boot = readFileSync(path.join(repo, "tests/mcp-roles/db.ts"), "utf8").match(
    /const BOOT = `([\s\S]*?)`;/,
  )?.[1];
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
  await admin.query(
    readFileSync(
      path.join(repo, "docs/athena/ap-reconciliation-snapshot.schema-draft.sql"),
      "utf8",
    ),
  );
  for (const u of [id.owner, id.ap]) {
    await admin.query("INSERT INTO auth.users(id,email) VALUES($1,'synthetic@example.invalid')", [
      u,
    ]);
    await admin.query("INSERT INTO test_active_members VALUES($1)", [u]);
  }
  await admin.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Synthetic',$2)", [
    id.company,
    id.owner,
  ]);
  await admin.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Owner'),($1,$3,'ap','Accounting')",
    [id.company, id.owner, id.ap],
  );
  await admin.query(
    "INSERT INTO mcp_jobs(id,company_id,user_id,job_number,name) VALUES($1,$2,$3,'SYN-A','Synthetic')",
    [id.job, id.company, id.owner],
  );
  await admin.query(
    "INSERT INTO mcp_cost_submissions(id,company_id,anchor_job_id,kind,created_by) VALUES($1,$2,$3,'supplier_bill',$4)",
    [id.record, id.company, id.job, id.owner],
  );
  await admin.query(
    "INSERT INTO mcp_cost_submission_versions(record_id,version,facts,recorded_by) VALUES($1,1,$2::jsonb,$3)",
    [id.record, JSON.stringify(facts(1)), id.owner],
  );
  await admin.query(
    "INSERT INTO mcp_cost_approvals(record_id,version,approved_by) VALUES($1,1,$2)",
    [id.record, id.owner],
  );
  await admin.query(
    "INSERT INTO mcp_cost_posting_events(record_id,version,posted_by) VALUES($1,1,$2)",
    [id.record, id.owner],
  );
  for (let n = 2; n <= 9; n++) {
    await writer.query("BEGIN");
    await writer.query(
      "INSERT INTO mcp_cost_submission_versions(record_id,version,facts,reason,recorded_by) VALUES($1,$2,$3::jsonb,'Synthetic correction',$4)",
      [id.record, n, JSON.stringify(facts(n)), id.owner],
    );
    await writer.query(
      "INSERT INTO mcp_cost_approvals(record_id,version,approved_by) VALUES($1,$2,$3)",
      [id.record, n, id.owner],
    );
    await writer.query(
      "INSERT INTO mcp_cost_posting_events(record_id,version,posted_by) VALUES($1,$2,$3)",
      [id.record, n, id.owner],
    );
    const [view] = await Promise.all([snapshot(), writer.query("SELECT pg_sleep(0.02); COMMIT")]);
    assert.equal(view.complete, true);
    const r = view.ap.records.find((x) => x.id === id.record);
    const latest = Math.max(...r.versions.map((x) => x.version));
    assert.ok(latest === n - 1 || latest === n);
    assert.equal(r.posted_version, latest);
    assert.equal(r.posting_events.at(-1).version, latest);
    assert.equal(r.accounting_approvals.at(-1).version, latest);
    const after = await snapshot();
    assert.equal(after.ap.records.find((x) => x.id === id.record).posted_version, n);
  }
  await writer.query("BEGIN");
  await writer.query("DELETE FROM mcp_company_members WHERE company_id=$1 AND user_id=$2", [
    id.company,
    id.ap,
  ]);
  const [beforeRevoke] = await Promise.all([
    snapshot(),
    writer.query("SELECT pg_sleep(0.02); COMMIT"),
  ]);
  assert.ok(
    beforeRevoke.complete === true ||
      JSON.stringify(beforeRevoke) ===
        JSON.stringify({ snapshot_version: 1, complete: false, status: "unavailable" }),
  );
  assert.deepEqual(await snapshot(), {
    snapshot_version: 1,
    complete: false,
    status: "unavailable",
  });
  console.log(
    JSON.stringify({
      postgres: (await admin.query("SHOW server_version")).rows[0].server_version,
      synthetic: true,
      concurrentCommitSnapshots: 8,
      atomicVersionApprovalPosting: "passed",
      accessRevocation: "passed",
    }),
  );
} catch (e) {
  console.error("AP SNAPSHOT TEST FAILED", e.stack);
  failed = true;
} finally {
  for (const c of [reader, writer, admin]) if (c) await c.end().catch(() => {});
  await server.stop().catch(() => {});
  rmSync(root, { recursive: true, force: true });
}
if (failed) process.exit(1);
