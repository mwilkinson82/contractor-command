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
  for (const user of [owner, contract, other]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'synthetic@example.test')", [user]);
    await db.query("INSERT INTO test_active_members VALUES($1)", [user]);
  }
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Synthetic company',$2)",
    [company, owner],
  );
  for (const [id, role] of [
    [owner, "owner"],
    [contract, "contracts"],
  ])
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,'Synthetic')",
      [company, id, role],
    );
  for (const [id, number] of [
    [job, "A"],
    [otherJob, "B"],
  ])
    await db.query(
      "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name) VALUES($1,$2,$3,$4,'Synthetic job')",
      [id, owner, company, number],
    );
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
  for (const u of [contract, other]) await expect(snap(u)).rejects.toThrow(/full project access/i);
  expect((await snap(owner, otherJob)).billing.invoices).toEqual([]);
  await db.query("DELETE FROM test_active_members WHERE user_id=$1", [owner]);
  await db.query("DELETE FROM mcp_gate_cache WHERE user_id=$1", [owner]);
  await expect(snap()).rejects.toThrow(/MCP_INACTIVE/);
  await db.query("INSERT INTO test_active_members VALUES($1)", [owner]);
  await db.query("DELETE FROM mcp_gate_cache WHERE user_id=$1", [owner]);
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
    "INSERT INTO mcp_billing_receipts(id,job_id,company_id,receipt_date,source,amount_cents,recorded_by) SELECT gen_random_uuid(),$1,$2,'2026-10-01','SYN-'||g,1,$3 FROM generate_series(1,5001) g",
    [job, company, owner],
  );
  const r = await snap();
  expect(r.complete).toBe(false);
  expect(r.billing).toBeNull();
  expect(r.originals).toBeNull();
});
