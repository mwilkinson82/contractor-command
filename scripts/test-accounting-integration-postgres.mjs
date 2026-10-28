// Opt-in synthetic lab. Always creates its own socket-only temporary cluster.
// Does not accept a database URL, existing data directory or live credentials.
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
const runtime = process.env.ATHENA_EMBEDDED_PG_MODULE;
assert.ok(runtime, "Set ATHENA_EMBEDDED_PG_MODULE to an installed embedded-postgres module");
const { default: EmbeddedPostgres } = await import(pathToFileURL(resolve(runtime)).href);
const root = await realpath(await mkdtemp("/tmp/athena-integration-pg-"));
const port = 55486;
const server = new EmbeddedPostgres({
  databaseDir: join(root, "data"),
  user: "synthetic",
  password: "synthetic-only",
  port,
  persistent: false,
  postgresFlags: ["-c", "listen_addresses=", "-c", `unix_socket_directories=${root}`],
  onLog: () => {},
  onError: () => {},
});
const connections = [];
const connect = () => {
  const c = postgres({
    host: root,
    port,
    username: "synthetic",
    password: "synthetic-only",
    database: "postgres",
    max: 1,
    prepare: false,
    connect_timeout: 10,
    onnotice: () => {},
  });
  connections.push(c);
  return c;
};
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(7201),
  pm = id(7202),
  company = id(7210),
  job = id(7211);
async function actor(c, user, fn, readOnly = false) {
  return c.begin(readOnly ? "read only" : "", async (tx) => {
    await tx.unsafe("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: user, role: "authenticated", email: "synthetic@example.test" }),
    ]);
    await tx.unsafe("SET LOCAL role authenticated");
    return fn(tx);
  });
}
const rpc = async (tx, name, args) =>
  (
    await tx.unsafe(
      `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS data`,
      args.map((v) => (v && typeof v === "object" ? tx.json(v) : v)),
    )
  )[0].data;
async function prepared(tx, purpose, name, payload) {
  const p = payload;
  const ticket = await rpc(tx, "mcp_cost_review_prepare", [job, purpose, p]);
  return rpc(tx, name, [job, p, ticket.review_id, true]);
}
const facts = (ref, amount = 10000) => ({
  kind: "supplier_bill",
  description: "Synthetic only",
  counterparty_name: "Synthetic Supplier",
  currency_code: "USD",
  incurred_on: "2026-10-01",
  amount_cents: amount,
  document_reference: ref,
  original: "missing",
  allocations: [{ job_id: job, cost_code: "MATERIAL", amount_cents: amount }],
});
const submission = (ref, record = crypto.randomUUID()) => ({
  id: record,
  request_id: crypto.randomUUID(),
  expected_version: 0,
  facts: facts(ref),
});
const results = { coverage: "isolated synthetic PostgreSQL only", cases: {} };
try {
  await server.initialise();
  await server.start();
  const db = connect(),
    a = connect(),
    b = connect(),
    reader = connect();
  const [settings] = await db.unsafe(
    "SELECT current_setting('data_directory') AS dir,current_setting('listen_addresses') AS listeners,inet_server_addr() AS addr,version() AS version",
  );
  assert.equal(settings.dir, join(root, "data"));
  assert.equal(settings.listeners, "");
  assert.equal(settings.addr, null);
  results.postgres = settings.version;
  const boot = readFileSync("tests/mcp-roles/db.ts", "utf8").match(
    /const BOOT = `([\s\S]*?)`;/,
  )?.[1];
  assert.ok(boot);
  await db.unsafe(boot);
  for (const f of readdirSync("drizzle/migrations")
    .filter((f) => f.endsWith(".sql") && f <= "0024_athena_reopen_open_item.sql")
    .sort())
    await db.unsafe(
      readFileSync(`drizzle/migrations/${f}`, "utf8").replace(/--> statement-breakpoint/g, ""),
    );
  await db.unsafe(
    "CREATE FUNCTION public.get_user_tier(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'circle'::text $$; CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated,service_role; GRANT SELECT,INSERT ON storage.objects TO authenticated,service_role; CREATE TABLE mcp_submittals(id uuid PRIMARY KEY,job_id uuid,number text,revision integer); CREATE TABLE mcp_change_orders(submittal_id uuid PRIMARY KEY,job_id uuid,details jsonb); INSERT INTO storage.buckets(id,name,public) VALUES('athena-financial-documents','athena-financial-documents',false)",
  );
  const sources = [
    "supabase/migrations/20261021190000_athena_team_invites.sql",
    "supabase/migrations/20261022120000_athena_account_team_privacy_terms.sql",
    "supabase/migrations/20261031120000_athena_file_upload.sql",
    "supabase/migrations/20261101120001_athena_project_billing_evidence.sql",
    "supabase/migrations/20261101120002_athena_financial_documents.sql",
    "supabase/migrations/20261028143924_athena_project_purchase_orders.sql",
    "docs/athena/job-cost-submission.schema-draft.sql",
    "docs/athena/job-cost-project-refs.schema-draft.sql",
    "docs/athena/job-cost-originals.schema-draft.sql",
    "docs/athena/ap-reconciliation-snapshot.schema-draft.sql",
    "docs/athena/billing-reconciliation-snapshot.schema-draft.sql",
  ];
  await db.begin(async (tx) => {
    for (const f of sources)
      await tx.unsafe(
        readFileSync(f, "utf8")
          .replace(/^BEGIN;$/gm, "")
          .replace(/^COMMIT;$/gm, ""),
      );
  });
  results.cases.orderedDdl = "all producers and integration constraints installed together";
  for (const u of [owner, pm]) {
    await db.unsafe("INSERT INTO auth.users(id,email) VALUES($1,'synthetic@example.test')", [u]);
    await db.unsafe("INSERT INTO test_active_members VALUES($1)", [u]);
  }
  await db.unsafe(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Synthetic native integration',$2)",
    [company, owner],
  );
  for (const [u, role] of [
    [owner, "owner"],
    [pm, "pm"],
  ])
    await db.unsafe(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,'Synthetic')",
      [company, u, role],
    );
  await db.unsafe(
    "INSERT INTO mcp_jobs(id,company_id,user_id,job_number,name) VALUES($1,$2,$3,'SYN-NATIVE','Synthetic')",
    [job, company, owner],
  );
  await db.unsafe("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
    job,
    pm,
    owner,
  ]);
  const first = submission("SYN-DUP"),
    second = submission("syn-dup");
  const duplicate = await Promise.allSettled([
    actor(a, owner, (tx) => prepared(tx, "submission", "mcp_cost_submission_save", first)),
    actor(b, owner, (tx) => prepared(tx, "submission", "mcp_cost_submission_save", second)),
  ]);
  assert.equal(
    duplicate.filter((r) => r.status === "fulfilled").length,
    1,
    JSON.stringify(
      duplicate.map((r) =>
        r.status === "rejected" ? { code: r.reason.code, message: r.reason.message } : r.value,
      ),
    ),
  );
  assert.match(duplicate.find((r) => r.status === "rejected").reason.message, /Duplicate/);
  results.cases.concurrentDuplicate =
    "one commit, one duplicate rejection on independent connections";
  const exact = submission("SYN-RETRY");
  const p = exact;
  const ticket = await actor(db, owner, (tx) =>
    rpc(tx, "mcp_cost_review_prepare", [job, "submission", p]),
  );
  const retried = await Promise.all(
    [a, b].map((c) =>
      actor(c, owner, (tx) =>
        rpc(tx, "mcp_cost_submission_save", [job, p, ticket.review_id, true]),
      ),
    ),
  );
  assert.deepEqual(retried.map((x) => x.already_applied).sort(), [false, true]);
  results.cases.concurrentRetry = "one version and idempotent readback";
  for (const action of ["approve", "post"])
    await actor(db, owner, (tx) =>
      prepared(tx, "accounting", "mcp_cost_accounting_action", {
        action,
        id: exact.id,
        request_id: crypto.randomUUID(),
        expected_version: 1,
        ...(action === "post" ? { accounting_effective_on: "2026-10-01" } : {}),
      }),
    );
  await actor(db, pm, (tx) =>
    prepared(tx, "pm_approval", "mcp_cost_pm_approve", {
      id: exact.id,
      request_id: crypto.randomUUID(),
      expected_version: 1,
      allocated_cents: 10000,
      basis: "work_verified",
    }),
  );
  const payments = await Promise.allSettled(
    [a, b].map((c) =>
      actor(c, owner, (tx) =>
        prepared(tx, "accounting", "mcp_cost_accounting_action", {
          action: "payment",
          id: exact.id,
          request_id: crypto.randomUUID(),
          expected_version: 1,
          payment_id: crypto.randomUUID(),
          amount_cents: 8000,
          paid_on: "2026-10-02",
          reference: crypto.randomUUID(),
        }),
      ),
    ),
  );
  assert.equal(payments.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(payments.find((r) => r.status === "rejected").reason.message, /exceeds/);
  results.cases.concurrentOverpayment =
    "one 8000-cent evidence record, second rejected against 10000-cent payable";
  let unblock, notifyPending;
  const pending = new Promise((resolve) => {
    notifyPending = resolve;
  });
  const resume = new Promise((resolve) => {
    unblock = resolve;
  });
  const correction = actor(a, owner, async (tx) => {
    await prepared(tx, "submission", "mcp_cost_submission_save", {
      id: exact.id,
      request_id: crypto.randomUUID(),
      expected_version: 1,
      reason: "Synthetic correction",
      facts: facts("SYN-RETRY", 12000),
    });
    for (const action of ["approve", "post"])
      await prepared(tx, "accounting", "mcp_cost_accounting_action", {
        action,
        id: exact.id,
        request_id: crypto.randomUUID(),
        expected_version: 2,
        ...(action === "post" ? { accounting_effective_on: "2026-10-03" } : {}),
      });
    notifyPending();
    await resume;
  });
  await Promise.race([
    pending,
    correction.then(() => {
      throw new Error("Writer finished before barrier");
    }),
  ]);
  let before;
  try {
    before = await actor(
      reader,
      owner,
      (tx) => rpc(tx, "mcp_cost_reconciliation_snapshot", [job]),
      true,
    );
  } finally {
    unblock();
  }
  await correction;
  const after = await actor(
    reader,
    owner,
    (tx) => rpc(tx, "mcp_cost_reconciliation_snapshot", [job]),
    true,
  );
  assert.equal(before.complete, true);
  assert.equal(after.complete, true);
  assert.equal(before.ap.records.find((r) => r.id === exact.id).posted_version, 1);
  assert.equal(after.ap.records.find((r) => r.id === exact.id).posted_version, 2);
  assert.equal(before.ap.records.find((r) => r.id === exact.id).versions.length, 1);
  assert.equal(after.ap.records.find((r) => r.id === exact.id).versions.length, 2);
  results.cases.snapshotIsolation =
    "read-only snapshot observes complete pre-commit state and next read complete post-commit state";
  const billing = await actor(reader, owner, (tx) =>
    rpc(tx, "mcp_billing_reconciliation_snapshot", [job]),
  );
  assert.equal(billing.complete, true);
  await db.unsafe("DELETE FROM mcp_company_members WHERE company_id=$1 AND user_id=$2", [
    company,
    owner,
  ]);
  const denied = await actor(
    reader,
    owner,
    (tx) => rpc(tx, "mcp_cost_reconciliation_snapshot", [job]),
    true,
  );
  assert.deepEqual(denied, { snapshot_version: 1, complete: false, status: "unavailable" });
  results.cases.revokedMembership = "next read denied without hidden rows or counts";
  await writeFile(
    "artifacts/native-postgres-results.json",
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  for (const c of connections) await c.end({ timeout: 5 }).catch(() => {});
  await server.stop().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
