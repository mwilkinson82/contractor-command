// Opt-in synthetic PostgreSQL test. Point only at a dedicated local socket-only test cluster.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
const dir = process.env.RECONCILIATION_PG_DATA;
const socket = process.env.RECONCILIATION_PG_SOCKET;
const port = Number(process.env.RECONCILIATION_PG_PORT);
if (
  dir !== resolve("../pg-fixture/data") ||
  socket !== resolve("../pg-fixture/socket") ||
  port !== 55448
)
  throw new Error("Dedicated synthetic fixture cluster required");
const dbName = `recon_test_${process.pid}`;
const opts = {
  host: socket,
  port,
  username: process.env.USER,
  database: dbName,
  ssl: false,
  max: 1,
  prepare: false,
};
const bootstrap = postgres({ ...opts, database: "postgres" });
const [initial] = await bootstrap.unsafe(
  "select current_setting('data_directory') dir,current_setting('listen_addresses') listeners,inet_server_addr() addr",
);
assert.equal(initial.dir, dir);
assert.equal(initial.listeners, "");
assert.equal(initial.addr, null);
await bootstrap.unsafe(`CREATE DATABASE ${dbName}`);
const db = postgres(opts),
  reader = postgres(opts),
  writer = postgres(opts);
const owner = "00000000-0000-4000-8000-000000000201",
  company = "00000000-0000-4000-8000-000000000203",
  job = "00000000-0000-4000-8000-000000000204",
  inv = "00000000-0000-4000-8000-000000000205",
  receipt = "00000000-0000-4000-8000-000000000206",
  allocation = "00000000-0000-4000-8000-000000000207";
const actor = async (client, f) =>
  client.begin(async (tx) => {
    await tx.unsafe("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: owner, role: "authenticated", email: "synthetic@example.test" }),
    ]);
    await tx.unsafe("set local role authenticated");
    return f(tx);
  });
try {
  const [server] = await db.unsafe(
    "select current_setting('data_directory') dir,current_setting('listen_addresses') listeners,inet_server_addr() addr,version() version",
  );
  assert.equal(server.dir, dir);
  assert.equal(server.listeners, "");
  assert.equal(server.addr, null);
  const boot = readFileSync("tests/mcp-roles/db.ts", "utf8")
    .match(/const BOOT = `([\s\S]*?)`;/)[1]
    .replace(
      "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;",
      () =>
        "DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $$;",
    );
  await db.unsafe(boot);
  for (const f of readdirSync("drizzle/migrations")
    .filter((f) => f.endsWith(".sql") && f <= "0024_athena_reopen_open_item.sql")
    .sort())
    await db.unsafe(
      readFileSync(`drizzle/migrations/${f}`, "utf8").replace(/--> statement-breakpoint/g, ""),
    );
  await db.unsafe(
    "CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated,service_role; GRANT SELECT,INSERT ON storage.objects TO authenticated,service_role; CREATE TABLE mcp_submittals(id uuid PRIMARY KEY,job_id uuid,number text,revision integer); CREATE TABLE mcp_change_orders(submittal_id uuid PRIMARY KEY,job_id uuid,details jsonb);",
  );
  await db.unsafe(
    readFileSync("supabase/migrations/20261031120000_athena_file_upload.sql", "utf8"),
  );
  await db.unsafe(
    readFileSync("supabase/migrations/20261101120001_athena_project_billing_evidence.sql", "utf8"),
  );
  await db.unsafe(
    "INSERT INTO storage.buckets(id,name,public) VALUES ('athena-financial-documents','athena-financial-documents',false)",
  );
  await db.unsafe(
    readFileSync("supabase/migrations/20261101120002_athena_financial_documents.sql", "utf8"),
  );
  const sql = readFileSync("docs/athena/billing-reconciliation-snapshot.schema-draft.sql", "utf8");
  await db.unsafe(sql);
  await db.unsafe("INSERT INTO auth.users VALUES($1,'synthetic@example.test')", [owner]);
  await db.unsafe("INSERT INTO test_active_members VALUES($1)", [owner]);
  await db.unsafe("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Synthetic',$2)", [
    company,
    owner,
  ]);
  await db.unsafe(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Synthetic')",
    [company, owner],
  );
  await db.unsafe(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name) VALUES($1,$2,$3,'SYN','Synthetic')",
    [job, owner, company],
  );
  await db.unsafe(
    "INSERT INTO mcp_billing_invoices(id,job_id,company_id,document_number,kind,created_by) VALUES($1,$2,$3,'SYN-1','invoice',$4)",
    [inv, job, company, owner],
  );
  await db.unsafe(
    "INSERT INTO mcp_billing_invoice_versions(invoice_id,job_id,version,status,invoice_date,effective_date,source,net_due_cents,recorded_by) VALUES($1,$2,1,'submitted','2026-10-01','2026-10-01','Synthetic',10000,$3)",
    [inv, job, owner],
  );
  const get = (client) =>
    actor(
      client,
      async (tx) =>
        (await tx.unsafe("select public.mcp_billing_reconciliation_snapshot($1) result", [job]))[0]
          .result,
    );
  const first = await get(reader);
  assert.equal(first.complete, true);
  assert.equal(first.billing.receipts.length, 0);
  // Test-only delay occurs inside the same statement after PostgreSQL has chosen its MVCC snapshot.
  const functionSql = sql.slice(
    sql.indexOf("CREATE FUNCTION public.mcp_billing_reconciliation_snapshot"),
  );
  const slow = functionSql
    .replace(
      "CREATE FUNCTION public.mcp_billing_reconciliation_snapshot",
      "CREATE OR REPLACE FUNCTION public.mcp_billing_reconciliation_snapshot",
    )
    .replace(
      "SELECT id, company_id FROM public.mcp_jobs WHERE id = _job AND public.mcp_job_scope(_job) = 'full'",
      "SELECT id, company_id FROM public.mcp_jobs CROSS JOIN (SELECT pg_sleep(2)) delayed WHERE id = _job AND public.mcp_job_scope(_job) = 'full'",
    );
  assert.notEqual(slow, functionSql);
  await db.unsafe(slow);
  const pending = get(reader);
  let sleeping = false;
  for (let n = 0; n < 100; n++) {
    const rows = await db.unsafe(
      "select 1 from pg_stat_activity where wait_event='PgSleep' and query like '%mcp_billing_reconciliation_snapshot%' ",
    );
    if (rows.length) {
      sleeping = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.ok(sleeping, "reader entered snapshot statement");
  await writer.begin(async (tx) => {
    await tx.unsafe(
      "INSERT INTO mcp_billing_receipts(id,job_id,company_id,receipt_date,source,amount_cents,recorded_by) VALUES($1,$2,$3,'2026-10-02','Synthetic check',4000,$4)",
      [receipt, job, company, owner],
    );
    await tx.unsafe(
      "INSERT INTO mcp_billing_allocations(id,job_id,receipt_id,invoice_id,amount_cents,effective_date,source,recorded_by) VALUES($1,$2,$3,$4,4000,'2026-10-02','Synthetic allocation',$5)",
      [allocation, job, receipt, inv, owner],
    );
  });
  const before = await pending;
  assert.equal(before.billing.receipts.length, 0);
  assert.equal(before.billing.allocations.length, 0);
  await db.unsafe(
    functionSql.replace(
      "CREATE FUNCTION public.mcp_billing_reconciliation_snapshot",
      "CREATE OR REPLACE FUNCTION public.mcp_billing_reconciliation_snapshot",
    ),
  );
  const after = await get(reader);
  assert.equal(after.billing.receipts.length, 1);
  assert.equal(after.billing.allocations.length, 1);
  assert.equal(after.billing.allocations[0].amount_cents, 4000);
  await db.unsafe(slow);
  const pendingCorrection = get(reader);
  let correctionSleeping = false;
  for (let n = 0; n < 100; n++) {
    const rows = await db.unsafe(
      "select 1 from pg_stat_activity where wait_event='PgSleep' and query like '%mcp_billing_reconciliation_snapshot%'",
    );
    if (rows.length) {
      correctionSleeping = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.ok(correctionSleeping, "reader entered correction snapshot statement");
  const reverseAllocation = "00000000-0000-4000-8000-000000000208";
  const receiptReversal = "00000000-0000-4000-8000-000000000209";
  await writer.begin(async (tx) => {
    await tx.unsafe(
      "INSERT INTO mcp_billing_invoice_versions(invoice_id,job_id,version,status,invoice_date,effective_date,source,net_due_cents,reason,recorded_by) VALUES($1,$2,2,'submitted','2026-10-01','2026-10-03','Synthetic correction',9000,'Correct amount',$3)",
      [inv, job, owner],
    );
    await tx.unsafe(
      "INSERT INTO mcp_billing_allocations(id,job_id,receipt_id,invoice_id,amount_cents,reversal_of,effective_date,source,recorded_by) VALUES($1,$2,$3,$4,1000,$5,'2026-10-03','Synthetic reversal',$6)",
      [reverseAllocation, job, receipt, inv, allocation, owner],
    );
    await tx.unsafe(
      "INSERT INTO mcp_billing_receipt_reversals(id,job_id,receipt_id,amount_cents,effective_date,source,recorded_by) VALUES($1,$2,$3,1000,'2026-10-03','Synthetic reversal',$4)",
      [receiptReversal, job, receipt, owner],
    );
  });
  const beforeCorrection = await pendingCorrection;
  assert.equal(beforeCorrection.billing.invoices[0].versions.length, 1);
  assert.equal(beforeCorrection.billing.allocations.length, 1);
  assert.equal(beforeCorrection.billing.receipt_reversals.length, 0);
  await db.unsafe(
    functionSql.replace(
      "CREATE FUNCTION public.mcp_billing_reconciliation_snapshot",
      "CREATE OR REPLACE FUNCTION public.mcp_billing_reconciliation_snapshot",
    ),
  );
  const afterCorrection = await get(reader);
  assert.equal(afterCorrection.billing.invoices[0].versions.length, 2);
  assert.equal(afterCorrection.billing.invoices[0].versions[0].net_due_cents, 9000);
  assert.equal(afterCorrection.billing.allocations.length, 2);
  assert.equal(afterCorrection.billing.receipt_reversals.length, 1);

  console.log(
    JSON.stringify({
      postgres: server.version,
      socket_only: true,
      concurrent_commit_during_snapshot: true,
      old_snapshot_consistent: true,
      new_snapshot_consistent: true,
      concurrent_correction_reversal_consistent: true,
    }),
  );
} finally {
  await Promise.allSettled([
    db.end({ timeout: 5 }),
    reader.end({ timeout: 5 }),
    writer.end({ timeout: 5 }),
  ]);
  await bootstrap.unsafe(`DROP DATABASE ${dbName}`);
  await bootstrap.end({ timeout: 5 });
}
