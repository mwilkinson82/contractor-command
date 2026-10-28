import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

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

describe("billing original and ledger association", () => {
  it("stores and links an original to the exact invoice version atomically and idempotently", async () => {
    const u = await call(owner, "mcp_billing_upload_begin", [
      job,
      "invoice.pdf",
      "application/pdf",
      "ab".repeat(32),
    ]);
    await q(
      owner,
      "INSERT INTO storage.objects(bucket_id,name) VALUES ('athena-financial-documents',$1)",
      [u.storage_path],
    );
    const doc = await call(owner, "mcp_billing_document_register", [
      job,
      u.id,
      123,
      "cd".repeat(32),
    ]);
    expect(doc.id).toBe(u.id);
    expect(
      (await call(owner, "mcp_billing_document_register", [job, u.id, 123, "cd".repeat(32)]))
        .already_stored,
    ).toBe(true);
    await expect(
      call(owner, "mcp_billing_document_register", [job, u.id, 123, "ee".repeat(32)]),
    ).rejects.toThrow(/does not match/);
    const p = {
      id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      expected_version: 0,
      kind: "invoice",
      document_number: "SYN-1",
      status: "submitted",
      invoice_date: "2026-10-01",
      effective_date: "2026-10-01",
      source: "synthetic invoice",
      gross_cents: 100000,
      withheld_cents: 10000,
      released_cents: 0,
      net_due_cents: 90000,
      document_id: u.id,
    };
    expect(
      (await call(owner, "mcp_billing_record_document", [job, "invoice", JSON.stringify(p)]))
        .version,
    ).toBe(1);
    expect(
      (await call(owner, "mcp_billing_record_document", [job, "invoice", JSON.stringify(p)]))
        .already_applied,
    ).toBe(true);
    const state = await call(owner, "mcp_billing_documents_get", [job]);
    expect(state.links).toMatchObject([
      { document_id: u.id, invoice_id: p.id, invoice_version: 1, receipt_id: null },
    ]);
    await expect(
      call(owner, "mcp_billing_record_document", [
        job,
        "invoice",
        JSON.stringify({ ...p, document_id: crypto.randomUUID() }),
      ]),
    ).rejects.toThrow(/document/);
    await expect(
      call(owner, "mcp_billing_record_document", [
        otherJob,
        "invoice",
        JSON.stringify({
          ...p,
          id: crypto.randomUUID(),
          request_id: crypto.randomUUID(),
          document_number: "SYN-2",
        }),
      ]),
    ).rejects.toThrow(/document/);
    const otherLedger = await call(owner, "mcp_billing_evidence_get", [otherJob]);
    expect(otherLedger.invoices).toEqual([]);
  });
  it("denies contract-only and unrelated users the original and direct table access", async () => {
    for (const user of [contract, other]) {
      await expect(call(user, "mcp_billing_documents_get", [job])).rejects.toThrow();
      await expect(
        call(user, "mcp_billing_upload_begin", [
          job,
          "receipt.pdf",
          "application/pdf",
          "ef".repeat(32),
        ]),
      ).rejects.toThrow();
    }
    await expect(q(owner, "SELECT * FROM mcp_billing_documents")).rejects.toThrow();
    expect(
      await q(
        contract,
        "SELECT name FROM storage.objects WHERE bucket_id='athena-financial-documents'",
      ),
    ).toEqual([]);
    expect(
      await q(
        other,
        "SELECT name FROM storage.objects WHERE bucket_id='athena-financial-documents'",
      ),
    ).toEqual([]);
  });

  it("associates a receipt original with the receipt and safely replays the same operation", async () => {
    const u = await call(owner, "mcp_billing_upload_begin", [
      job,
      "receipt.png",
      "image/png",
      "11".repeat(32),
    ]);
    await q(
      owner,
      "INSERT INTO storage.objects(bucket_id,name) VALUES ('athena-financial-documents',$1)",
      [u.storage_path],
    );
    await call(owner, "mcp_billing_document_register", [job, u.id, 50, "22".repeat(32)]);
    const p = {
      id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      receipt_date: "2026-10-02",
      source: "synthetic receipt document",
      amount_cents: 40000,
      document_id: u.id,
    };
    await call(owner, "mcp_billing_record_document", [job, "receipt", JSON.stringify(p)]);
    expect(
      (await call(owner, "mcp_billing_record_document", [job, "receipt", JSON.stringify(p)]))
        .already_applied,
    ).toBe(true);
    const state = await call(owner, "mcp_billing_documents_get", [job]);
    expect(state.links).toContainEqual(
      expect.objectContaining({ document_id: u.id, receipt_id: p.id, invoice_id: null }),
    );
  });
});
