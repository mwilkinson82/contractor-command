import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
import { reconcileBilling } from "./reconciliation";

const owner = "00000000-0000-4000-8000-000000000101";
const contract = "00000000-0000-4000-8000-000000000102";
const other = "00000000-0000-4000-8000-000000000103";
const company = "00000000-0000-4000-8000-000000000104";
const job = "00000000-0000-4000-8000-000000000105";
const otherJob = "00000000-0000-4000-8000-000000000106";
const otherCompany = "00000000-0000-4000-8000-000000000107";
const foreignJob = "00000000-0000-4000-8000-000000000108";
const pm = "00000000-0000-4000-8000-000000000109";
const superUser = "00000000-0000-4000-8000-000000000111";
let db: PGlite;
const q = (user: string, sql: string, args: unknown[] = []) =>
  asUser(
    db,
    { sub: user, email: "synthetic@example.test", role: "authenticated" },
    async (tx) => (await tx.query(sql, args)).rows as Record<string, unknown>[],
  );
const call = async (user: string, fn: string, args: unknown[]) =>
  (
    await q(
      user,
      `SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS value`,
      args,
    )
  )[0].value as Record<string, unknown>;
const register = (actor: string, project: string, id: unknown, size: number, hash: string) =>
  asUser(
    db,
    { sub: owner, email: "synthetic@example.test", role: "service_role" },
    async (tx) =>
      (
        await tx.query("SELECT public.mcp_billing_document_register($1,$2,$3,$4,$5) AS value", [
          project,
          id,
          size,
          hash,
          actor,
        ])
      ).rows[0].value as Record<string, unknown>,
  );
const link = (actor: string, args: unknown[]) =>
  asUser(
    db,
    { sub: owner, email: "synthetic@example.test", role: "service_role" },
    async (tx) =>
      (
        await tx.query("SELECT public.mcp_billing_document_link($1,$2,$3,$4,$5,$6) AS value", [
          ...args,
          actor,
        ])
      ).rows[0].value as Record<string, unknown>,
  );
const recordDocument = (actor: string, args: unknown[]) =>
  asUser(
    db,
    { sub: owner, email: "synthetic@example.test", role: "service_role" },
    async (tx) =>
      (
        await tx.query("SELECT public.mcp_billing_record_document($1,$2,$3,$4) AS value", [
          ...args,
          actor,
        ])
      ).rows[0].value as Record<string, unknown>,
  );
beforeAll(async () => {
  db = await makeDb();
  await db.exec(
    "CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated,service_role; GRANT SELECT,INSERT ON storage.objects TO authenticated,service_role; CREATE TABLE mcp_submittals(id uuid PRIMARY KEY,job_id uuid,number text,revision integer); CREATE TABLE mcp_change_orders(submittal_id uuid PRIMARY KEY,job_id uuid,details jsonb);",
  );
  await db.exec(readFileSync("supabase/migrations/20261031120000_athena_file_upload.sql", "utf8"));
  await db.exec(
    readFileSync("supabase/migrations/20261101120001_athena_project_billing_evidence.sql", "utf8"),
  );
  await db.exec(
    "INSERT INTO storage.buckets(id,name,public) VALUES ('athena-financial-documents','athena-financial-documents',false)",
  );
  await db.exec(
    readFileSync("supabase/migrations/20261101120002_athena_financial_documents.sql", "utf8"),
  );
  for (const user of [owner, contract, other, pm, superUser]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'synthetic@example.test')", [user]);
    await db.query("INSERT INTO test_active_members VALUES($1)", [user]);
  }
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Synthetic company',$2)",
    [company, owner],
  );
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Other synthetic company',$2)",
    [otherCompany, other],
  );
  for (const [id, role] of [
    [owner, "owner"],
    [contract, "contracts"],
    [pm, "pm"],
    [superUser, "super"],
  ])
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,'Synthetic')",
      [company, id, role],
    );
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Other owner')",
    [otherCompany, other],
  );
  for (const [id, number] of [
    [job, "A"],
    [otherJob, "B"],
  ])
    await db.query(
      "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name) VALUES($1,$2,$3,$4,'Synthetic job')",
      [id, owner, company, number],
    );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name) VALUES($1,$2,$3,'A','Other synthetic job')",
    [foreignJob, other, otherCompany],
  );
  for (const user of [pm, superUser])
    await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
      job,
      user,
      owner,
    ]);
}, 30000);
afterAll(async () => {
  await db.close();
});

const snap = async (user = owner, target = job) =>
  (await q(user, "SELECT public.mcp_billing_reconciliation_snapshot($1) AS value", [target]))[0]
    .value as {
    snapshot_version: number;
    job_id: string;
    company_id: string;
    complete: boolean;
    billing: { invoices: Array<{ versions: Array<{ net_due_cents: number }> }> };
    originals: { links: unknown[] };
  };
beforeAll(async () => {
  await db.exec(
    readFileSync("docs/athena/billing-reconciliation-snapshot.schema-draft.sql", "utf8"),
  );
  await call(owner, "mcp_billing_evidence_record", [
    job,
    "invoice",
    {
      id: "00000000-0000-4000-8000-000000000110",
      request_id: crypto.randomUUID(),
      expected_version: 0,
      kind: "invoice",
      document_number: "Synthetic-1",
      status: "submitted",
      invoice_date: "2026-10-01",
      effective_date: "2026-10-01",
      source: "Synthetic",
      gross_cents: 10000,
      withheld_cents: 0,
      released_cents: 0,
      net_due_cents: 10000,
    },
  ]);
});
it("reads a complete scoped snapshot with minimal projected financial fields", async () => {
  const r = await snap();
  expect(r).toMatchObject({
    snapshot_version: 1,
    job_id: job,
    company_id: company,
    complete: true,
  });
  expect(r.billing.invoices).toHaveLength(1);
  expect(r.billing.invoices[0].versions[0].net_due_cents).toBe(10000);
  expect(r.originals.links).toEqual([]);
  expect(JSON.stringify(r)).not.toContain("recorded_by");
  expect(JSON.stringify(r)).not.toContain("storage_path");
});
it("enforces membership and job scope at the database", async () => {
  for (const u of [contract, other, superUser])
    await expect(snap(u)).rejects.toThrow(/full project access/i);
  expect((await snap(pm)).company_id).toBe(company);
  await expect(snap(pm, otherJob)).rejects.toThrow(/full project access/i);
  await expect(snap(owner, foreignJob)).rejects.toThrow(/full project access/i);
  expect((await snap(other, foreignJob)).billing.invoices).toEqual([]);
  expect((await snap(owner, otherJob)).billing.invoices).toEqual([]);
  await db.query("DELETE FROM test_active_members WHERE user_id=$1", [owner]);
  await db.query("DELETE FROM mcp_gate_cache WHERE user_id=$1", [owner]);
  await expect(snap()).rejects.toThrow(/MCP_INACTIVE/);
  await db.query("INSERT INTO test_active_members VALUES($1)", [owner]);
  await db.query("DELETE FROM mcp_gate_cache WHERE user_id=$1", [owner]);
});
it("restricts function and table privileges and ignores temporary table shadows", async () => {
  const r = await db.query<{
    anon_exec: boolean;
    public_exec: boolean;
    authenticated_exec: boolean;
    authenticated_select: boolean;
  }>(
    "SELECT has_function_privilege('anon','public.mcp_billing_reconciliation_snapshot(uuid)','execute') anon_exec, has_function_privilege('public','public.mcp_billing_reconciliation_snapshot(uuid)','execute') public_exec, has_function_privilege('authenticated','public.mcp_billing_reconciliation_snapshot(uuid)','execute') authenticated_exec, has_table_privilege('authenticated','public.mcp_billing_invoices','select') authenticated_select",
  );
  expect(r.rows[0]).toMatchObject({
    anon_exec: false,
    public_exec: false,
    authenticated_exec: true,
    authenticated_select: false,
  });
  await asUser(
    db,
    { sub: owner, email: "synthetic@example.test", role: "authenticated" },
    async (tx) => {
      await tx.exec("CREATE TEMP TABLE mcp_billing_invoices(id uuid) ON COMMIT DROP");
      const read = await tx.query("SELECT public.mcp_billing_reconciliation_snapshot($1) value", [
        job,
      ]);
      expect(read.rows[0].value.billing.invoices).toHaveLength(1);
    },
  );
});
it("captures a linked original for the exact invoice version in the same envelope", async () => {
  const upload = await call(owner, "mcp_billing_upload_begin", [
    job,
    "synthetic.pdf",
    "application/pdf",
    "ab".repeat(32),
  ]);
  await db.query(
    "INSERT INTO storage.objects(bucket_id,name) VALUES ('athena-financial-documents',$1)",
    [upload.storage_path],
  );
  await register(owner, job, upload.id, 123, "cd".repeat(32));
  await link(owner, [job, upload.id, "00000000-0000-4000-8000-000000000110", 1, null]);
  const r = await snap();
  expect(r.originals.links).toMatchObject([{ document_id: upload.id, invoice_version: 1 }]);
  const result = reconcileBilling(r.billing, r.originals, { job_id: job, company_id: company });
  expect(result.coverage.state).toBe("checked");
  expect(result.findings.map((f) => f.code)).not.toContain("invoice_original_gap");
  expect(result.findings.find((f) => f.code === "invoice_unmatched")?.amount_cents).toBe("10000");
});
it("fails closed without a partial payload when a relation exceeds its bound", async () => {
  await db.query(
    "INSERT INTO mcp_billing_receipts(id,job_id,company_id,receipt_date,source,amount_cents,recorded_by) SELECT gen_random_uuid(),$1,$2,'2026-10-01','SYN-'||g,1,$3 FROM generate_series(1,5000) g",
    [job, company, owner],
  );
  expect((await snap()).complete).toBe(true);
  await db.query(
    "INSERT INTO mcp_billing_receipts(id,job_id,company_id,receipt_date,source,amount_cents,recorded_by) VALUES(gen_random_uuid(),$1,$2,'2026-10-01','SYN-5001',1,$3)",
    [job, company, owner],
  );
  const r = await snap();
  expect(r.complete).toBe(false);
  expect(r.billing).toBeNull();
  expect(r.originals).toBeNull();
  await db.query("DELETE FROM mcp_billing_receipts WHERE job_id=$1", [job]);
});
it("withholds results independently for each bounded evidence relation", async () => {
  const invoice = "00000000-0000-4000-8000-000000000110";
  const receipt = crypto.randomUUID();
  await db.query(
    "INSERT INTO mcp_billing_receipts(id,job_id,company_id,receipt_date,source,amount_cents,recorded_by) VALUES($1,$2,$3,'2026-10-01','BOUND-BASE',1,$4)",
    [receipt, job, company, owner],
  );
  const cases = [
    {
      table: "mcp_billing_invoices",
      insert:
        "INSERT INTO mcp_billing_invoices(id,job_id,company_id,document_number,kind,created_by) SELECT gen_random_uuid(),$1,$2,'BOUND-'||g,'invoice',$3 FROM generate_series(1,5000) g",
      cleanup: "DELETE FROM mcp_billing_invoices WHERE document_number LIKE 'BOUND-%'",
    },
    {
      table: "mcp_billing_invoice_versions",
      insert:
        "INSERT INTO mcp_billing_invoice_versions(invoice_id,job_id,version,status,invoice_date,effective_date,source,net_due_cents,recorded_by) SELECT $4,$1,g+1,'submitted','2026-10-01','2026-10-01','Synthetic',1,$3 FROM generate_series(1,5000) g WHERE $2::uuid IS NOT NULL",
      cleanup: "DELETE FROM mcp_billing_invoice_versions WHERE version>1",
    },
    {
      table: "mcp_billing_allocations",
      insert:
        "INSERT INTO mcp_billing_allocations(id,job_id,receipt_id,invoice_id,amount_cents,effective_date,source,recorded_by) SELECT gen_random_uuid(),$1,$5,$4,1,'2026-10-01','Synthetic',$3 FROM generate_series(1,5001) g WHERE $2::uuid IS NOT NULL",
      cleanup: "DELETE FROM mcp_billing_allocations WHERE job_id=$1",
    },
    {
      table: "mcp_billing_receipt_reversals",
      insert:
        "INSERT INTO mcp_billing_receipt_reversals(id,job_id,receipt_id,amount_cents,effective_date,source,recorded_by) SELECT gen_random_uuid(),$1,$5,1,'2026-10-01','Synthetic',$3 FROM generate_series(1,5001) g WHERE $2::uuid IS NOT NULL AND $4::uuid IS NOT NULL",
      cleanup: "DELETE FROM mcp_billing_receipt_reversals WHERE job_id=$1",
    },
  ];
  for (const item of cases) {
    // Use all parameters for each statement without making fixture-only SQL depend on string interpolation.
    const used = Math.max(...[...item.insert.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    await db.query(item.insert, [job, company, owner, invoice, receipt].slice(0, used));
    const r = await snap();
    expect(r.complete, item.table).toBe(false);
    expect(r.billing, item.table).toBeNull();
    expect(r.originals, item.table).toBeNull();
    await db.query(item.cleanup, item.cleanup.includes("$1") ? [job] : []);
  }
  await db.query(
    "WITH created AS (INSERT INTO mcp_billing_uploads(id,company_id,job_id,filename,mime_type,storage_path,token_hash,expires_at,created_by) SELECT gen_random_uuid(),$2,$1,'BOUND-'||g,'application/pdf','synthetic/'||g,lpad(to_hex(g+100),64,'0'),now()+interval '1 hour',$3 FROM generate_series(1,5000) g RETURNING *) INSERT INTO mcp_billing_documents(id,company_id,job_id,filename,mime_type,size_bytes,sha256,storage_path,created_by) SELECT id,company_id,job_id,filename,mime_type,1,repeat('a',64),storage_path,created_by FROM created",
    [job, company, owner],
  );
  expect((await snap()).complete).toBe(false); // Existing original + 5,000 new documents.
  await db.query("DELETE FROM mcp_billing_documents WHERE filename='BOUND-5000'");
  expect((await snap()).complete).toBe(true);
  await db.query(
    "INSERT INTO mcp_billing_document_links(document_id,job_id,invoice_id,invoice_version,recorded_by) SELECT id,$1,$2,1,$3 FROM mcp_billing_documents WHERE filename LIKE 'BOUND-%' ORDER BY filename LIMIT 2500",
    [job, invoice, owner],
  );
  await db.query(
    "INSERT INTO mcp_billing_document_links(document_id,job_id,receipt_id,recorded_by) SELECT id,$1,$2,$3 FROM mcp_billing_documents WHERE filename LIKE 'BOUND-%' ORDER BY filename LIMIT 2500",
    [job, receipt, owner],
  );
  const r = await snap();
  expect(r.complete).toBe(false);
  expect(r.billing).toBeNull();
  expect(r.originals).toBeNull();
});
