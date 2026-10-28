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

describe("billing original and ledger association", () => {
  it("stores and links an original to the exact invoice version atomically and idempotently", async () => {
    const u = await call(owner, "mcp_billing_upload_begin", [
      job,
      "invoice.pdf",
      "application/pdf",
      "ab".repeat(32),
    ]);
    await db.query(
      "INSERT INTO storage.objects(bucket_id,name) VALUES ('athena-financial-documents',$1)",
      [u.storage_path],
    );
    await expect(
      call(owner, "mcp_billing_document_register", [job, u.id, 123, "cd".repeat(32), owner]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      recordDocument(owner, [job, "invoice", JSON.stringify({ document_id: u.id })]),
    ).rejects.toThrow(/document/);
    await expect(register(other, job, u.id, 123, "cd".repeat(32))).rejects.toThrow(
      /full project access/,
    );
    await expect(register(contract, job, u.id, 123, "cd".repeat(32))).rejects.toThrow(
      /full project access/,
    );
    await expect(register(owner, otherJob, u.id, 123, "cd".repeat(32))).rejects.toThrow(
      /not available/,
    );
    const doc = await register(owner, job, u.id, 123, "cd".repeat(32));
    expect(doc.id).toBe(u.id);
    expect((await register(owner, job, u.id, 123, "cd".repeat(32))).already_stored).toBe(true);
    await expect(register(owner, job, u.id, 123, "ee".repeat(32))).rejects.toThrow(
      /does not match/,
    );
    await expect(
      call(owner, "mcp_billing_record_document", [
        job,
        "invoice",
        JSON.stringify({ document_id: u.id }),
        owner,
      ]),
    ).rejects.toThrow(/permission denied/);
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
    expect((await recordDocument(owner, [job, "invoice", JSON.stringify(p)])).version).toBe(1);
    expect((await recordDocument(owner, [job, "invoice", JSON.stringify(p)])).already_applied).toBe(
      true,
    );
    const state = await call(owner, "mcp_billing_documents_get", [job]);
    expect(state.links).toMatchObject([
      { document_id: u.id, invoice_id: p.id, invoice_version: 1, receipt_id: null },
    ]);
    await expect(
      recordDocument(owner, [
        job,
        "invoice",
        JSON.stringify({ ...p, document_id: crypto.randomUUID() }),
      ]),
    ).rejects.toThrow(/document/);
    await expect(
      recordDocument(owner, [
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
    await db.query(
      "INSERT INTO storage.objects(bucket_id,name) VALUES ('athena-financial-documents',$1)",
      [u.storage_path],
    );
    await register(owner, job, u.id, 50, "22".repeat(32));
    const p = {
      id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      receipt_date: "2026-10-02",
      source: "synthetic receipt document",
      amount_cents: 40000,
      document_id: u.id,
    };
    await recordDocument(owner, [job, "receipt", JSON.stringify(p)]);
    expect((await recordDocument(owner, [job, "receipt", JSON.stringify(p)])).already_applied).toBe(
      true,
    );
    const state = await call(owner, "mcp_billing_documents_get", [job]);
    expect(state.links).toContainEqual(
      expect.objectContaining({ document_id: u.id, receipt_id: p.id, invoice_id: null }),
    );
  });
  it("links verified originals to existing records without a financial revision and denies cross-project targets", async () => {
    const u = await call(owner, "mcp_billing_upload_begin", [
      job,
      "later.pdf",
      "application/pdf",
      "33".repeat(32),
    ]);
    await db.query(
      "INSERT INTO storage.objects(bucket_id,name) VALUES ('athena-financial-documents',$1)",
      [u.storage_path],
    );
    await register(owner, job, u.id, 42, "44".repeat(32));
    const invoice = {
      id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      expected_version: 0,
      kind: "invoice",
      document_number: "EXISTING-LINK",
      status: "submitted",
      invoice_date: "2026-10-01",
      effective_date: "2026-10-01",
      source: "existing synthetic invoice",
      gross_cents: 10000,
      withheld_cents: 0,
      released_cents: 0,
      net_due_cents: 10000,
    };
    const receipt = {
      id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      receipt_date: "2026-10-02",
      source: "existing synthetic receipt",
      amount_cents: 1000,
    };
    await call(owner, "mcp_billing_evidence_record", [job, "invoice", JSON.stringify(invoice)]);
    await call(owner, "mcp_billing_evidence_record", [job, "receipt", JSON.stringify(receipt)]);
    const foreignInvoice = {
      ...invoice,
      id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      document_number: "FOREIGN-LINK",
    };
    const foreignReceipt = {
      ...receipt,
      id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      source: "foreign synthetic receipt",
    };
    await call(owner, "mcp_billing_evidence_record", [
      otherJob,
      "invoice",
      JSON.stringify(foreignInvoice),
    ]);
    await call(owner, "mcp_billing_evidence_record", [
      otherJob,
      "receipt",
      JSON.stringify(foreignReceipt),
    ]);
    const foreignUpload = await call(owner, "mcp_billing_upload_begin", [
      otherJob,
      "foreign.pdf",
      "application/pdf",
      "55".repeat(32),
    ]);
    await db.query(
      "INSERT INTO storage.objects(bucket_id,name) VALUES ('athena-financial-documents',$1)",
      [foreignUpload.storage_path],
    );
    await register(owner, otherJob, foreignUpload.id, 42, "66".repeat(32));
    await expect(link(owner, [job, u.id, foreignInvoice.id, 1, null])).rejects.toThrow(
      /invoice version/,
    );
    await expect(link(owner, [job, u.id, null, null, foreignReceipt.id])).rejects.toThrow(
      /receipt/,
    );
    await expect(link(owner, [job, foreignUpload.id, invoice.id, 1, null])).rejects.toThrow(
      /document/,
    );
    const before = await call(owner, "mcp_billing_evidence_get", [job]);
    const invArgs = [job, u.id, invoice.id, 1, null];
    await expect(call(owner, "mcp_billing_document_link", [...invArgs, owner])).rejects.toThrow(
      /permission denied/,
    );
    expect((await link(owner, invArgs)).already_linked).toBe(false);
    expect((await link(owner, invArgs)).already_linked).toBe(true);
    expect((await link(owner, [job, u.id, null, null, receipt.id])).already_linked).toBe(false);
    expect(await call(owner, "mcp_billing_evidence_get", [job])).toEqual(before);
    const docs = await call(owner, "mcp_billing_documents_get", [job]);
    expect(docs.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ document_id: u.id, invoice_id: invoice.id, invoice_version: 1 }),
        expect.objectContaining({ document_id: u.id, receipt_id: receipt.id }),
      ]),
    );
    await expect(link(owner, [job, u.id, invoice.id, 2, null])).rejects.toThrow(/invoice version/);
    await expect(link(owner, [job, u.id, invoice.id, 1, receipt.id])).rejects.toThrow(
      /exactly one/,
    );
    await expect(link(owner, [otherJob, u.id, invoice.id, 1, null])).rejects.toThrow(/document/);
    await expect(link(owner, [job, u.id, crypto.randomUUID(), 1, null])).rejects.toThrow(
      /invoice version/,
    );
    await expect(link(owner, [job, u.id, null, null, crypto.randomUUID()])).rejects.toThrow(
      /receipt/,
    );
    for (const user of [contract, other])
      await expect(link(user, invArgs)).rejects.toThrow(/full project access/);
  });
  it("denies direct member uploads and limits server-reserved attempts", async () => {
    const u = await call(owner, "mcp_billing_upload_begin", [
      job,
      "quota.pdf",
      "application/pdf",
      "77".repeat(32),
    ]);
    await expect(
      q(
        owner,
        "INSERT INTO storage.objects(bucket_id,name) VALUES ('athena-financial-documents',$1)",
        [u.storage_path],
      ),
    ).rejects.toThrow(/row-level security/);
    const args = [u.id, owner, null];
    await expect(call(owner, "mcp_billing_upload_claim", args)).rejects.toThrow(
      /permission denied/,
    );
    const claim = (actor: string | null, token: string | null) =>
      asUser(
        db,
        { sub: owner, email: "synthetic@example.test", role: "service_role" },
        async (tx) =>
          (
            await tx.query("SELECT public.mcp_billing_upload_claim($1,$2,$3) AS value", [
              u.id,
              actor,
              token,
            ])
          ).rows[0].value,
      );
    await expect(claim(other, null)).rejects.toThrow(/unavailable/);
    await expect(claim(null, "00".repeat(32))).rejects.toThrow(/unavailable/);
    await claim(owner, null);
    await claim(null, "77".repeat(32));
    await claim(owner, null);
    await expect(claim(owner, null)).rejects.toThrow(/too many attempts/i);
  });
  it("limits new financial upload sessions per member", async () => {
    const limited = crypto.randomUUID();
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'limited@example.test')", [limited]);
    await db.query("INSERT INTO test_active_members VALUES($1)", [limited]);
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Synthetic')",
      [company, limited],
    );
    let lastUpload: Record<string, unknown> | undefined;
    for (let i = 0; i < 12; i++)
      lastUpload = await call(limited, "mcp_billing_upload_begin", [
        job,
        "small.pdf",
        "application/pdf",
        i.toString(16).padStart(64, "0"),
      ]);
    await expect(
      call(limited, "mcp_billing_upload_begin", [
        job,
        "small.pdf",
        "application/pdf",
        "ff".repeat(32),
      ]),
    ).rejects.toThrow(/too many billing uploads/i);
    await db.query("DELETE FROM mcp_company_members WHERE company_id=$1 AND user_id=$2", [
      company,
      limited,
    ]);
    await expect(
      asUser(
        db,
        { sub: owner, email: "synthetic@example.test", role: "service_role" },
        async (tx) =>
          tx.query("SELECT public.mcp_billing_upload_claim($1,$2,$3)", [
            lastUpload!.id,
            limited,
            null,
          ]),
      ),
    ).rejects.toThrow(/full project access/);
  });
});
