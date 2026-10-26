import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

const owner = "00000000-0000-4000-8000-000000000010";
const superId = "00000000-0000-4000-8000-000000000012";
const estimator = "00000000-0000-4000-8000-000000000013";
const company = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const job = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const claims = (id = owner) => ({
  sub: id,
  email: `test-${id.slice(-2)}@example.com`,
  role: "authenticated" as const,
});
let db: PGlite;
const q = async (sql: string, args: unknown[] = [], user = owner) =>
  asUser(db, claims(user), async (tx) => (await tx.query(sql, args)).rows);
const rpc = async (fn: string, args: unknown[], user = owner) =>
  (
    await q(
      `SELECT public.${fn}(${args.map((_, i) => "$" + (i + 1)).join(",")}) AS data`,
      args,
      user,
    )
  )[0].data;

beforeAll(async () => {
  db = await makeDb();
  await db.exec(
    `CREATE SCHEMA IF NOT EXISTS storage; CREATE TABLE IF NOT EXISTS storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]); CREATE TABLE IF NOT EXISTS storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated, service_role; GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role; GRANT SELECT, INSERT, UPDATE, DELETE ON storage.buckets TO authenticated, service_role;`,
  );
  await db.exec(readFileSync("supabase/migrations/20261031120000_athena_file_upload.sql", "utf8"));
  for (const id of [owner, superId, estimator]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES ($1,$2)", [id, claims(id).email]);
    await db.query("INSERT INTO test_active_members VALUES ($1)", [id]);
  }
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES ($1,'Fictional Construction',$2)",
    [company, owner],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id,time_zone) VALUES ($1,$2,'Test Job','2701',$3,'America/New_York')",
    [job, owner, company],
  );
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES ($1,$2,'owner','Test PM')",
    [company, owner],
  );
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES ($1,$2,'super','Fictional Super')",
    [company, superId],
  );
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES ($1,$2,'estimating','Fictional Estimator')",
    [company, estimator],
  );
  await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES ($1,$2,$3)", [
    job,
    superId,
    owner,
  ]);
}, 30000);
afterAll(() => db.close());

const HASH = "ab".repeat(32);

describe("contract file rows", () => {
  it("stores one contract, keeps its file when clauses are checked, and adds a spec beside it", async () => {
    const begun = await rpc("mcp_file_upload_begin", [
      job,
      "contract",
      "Agreement.txt",
      "text/plain",
      HASH,
      null,
      null,
      null,
    ]);
    expect(begun.storage_path).toMatch(
      new RegExp(`^${company}/${job}/[0-9a-f-]{36}/Agreement.txt$`),
    );
    expect(begun.bucket).toBe("athena-documents");
    const storedHash = (
      await asUser(
        db,
        { ...claims(owner), role: "service_role" },
        async (tx) =>
          (await tx.query("SELECT token_hash FROM mcp_file_uploads WHERE id = $1", [begun.id]))
            .rows,
      )
    )[0].token_hash;
    expect(storedHash).toBe(HASH);
    expect(storedHash).not.toMatch(/^[A-Za-z0-9_-]{43}$/);
    await q("INSERT INTO storage.objects(bucket_id,name) VALUES ('athena-documents',$1)", [
      begun.storage_path,
    ]);
    const body = "The contractor shall give notice within 7 calendar days.";
    const saved = await rpc("mcp_contract_document_save", [
      job,
      JSON.stringify({
        kind: "contract",
        name: "Agreement.txt",
        body,
        bucket: "athena-documents",
        path: begun.storage_path,
        mime_type: "text/plain",
        size_bytes: 64,
        file_sha256: "cd".repeat(32),
        upload_id: begun.id,
        truncated: false,
      }),
    ]);
    expect(saved.body_chars).toBe(body.length);
    const spec = await rpc("mcp_contract_document_save", [
      job,
      JSON.stringify({
        kind: "spec",
        name: "Division 03.txt",
        body: "Fine grade is required.",
        bucket: "athena-documents",
        path: begun.storage_path,
        mime_type: "text/plain",
        size_bytes: 64,
        file_sha256: "ef".repeat(32),
        upload_id: "22222222-2222-4222-8222-222222222222",
        truncated: false,
      }),
    ]);
    expect(spec.kind).toBe("spec");
    const rows = await q(
      "SELECT kind, storage_path IS NOT NULL AS has_file FROM mcp_contract_documents WHERE job_id = $1 ORDER BY kind",
      [job],
    );
    expect(rows).toEqual([
      { kind: "contract", has_file: true },
      { kind: "spec", has_file: true },
    ]);
    const checked = await rpc("mcp_clauses_save", [
      job,
      null,
      JSON.stringify([
        { section: "9.4", text: "notice within 7 calendar days", category: "delay_notice" },
      ]),
    ]);
    expect(checked.clauses[0].source).toBe("document");
    const still = await q(
      "SELECT storage_path FROM mcp_contract_documents WHERE job_id = $1 AND kind = 'contract'",
      [job],
    );
    expect(still[0].storage_path).toBe(begun.storage_path);
    await expect(
      rpc(
        "mcp_file_upload_begin",
        [job, "contract", "Other.txt", "text/plain", "11".repeat(32), null, null, null],
        superId,
      ),
    ).rejects.toThrow(/can't store a file/);
    const estimate = await rpc(
      "mcp_file_upload_begin",
      [job, "spec", "Notes.txt", "text/plain", "22".repeat(32), null, null, null],
      estimator,
    );
    expect(estimate.purpose).toBe("spec");
  });

  it("records chunks and finishes once", async () => {
    const begun = await rpc("mcp_file_upload_begin", [
      job,
      "spec",
      "More.txt",
      "text/plain",
      "33".repeat(32),
      null,
      null,
      null,
    ]);
    await rpc("mcp_file_upload_chunk", [begun.id, job, 0]);
    await rpc("mcp_file_upload_chunk", [begun.id, job, 2]);
    const mid = await rpc("mcp_file_upload_get", [begun.id, job]);
    expect(mid.chunks).toEqual([0, 2]);
    const done = await rpc("mcp_file_upload_complete", [
      begun.id,
      job,
      JSON.stringify({ visible: "stored", structured: { stored: true } }),
    ]);
    expect(done.visible).toBe("stored");
    const again = await rpc("mcp_file_upload_complete", [
      begun.id,
      job,
      JSON.stringify({ visible: "other" }),
    ]);
    expect(again.visible).toBe("stored");
    await asUser(db, { ...claims(owner), role: "service_role" }, async (tx) => {
      await tx.query(
        "UPDATE mcp_file_uploads SET expires_at = now() - interval '1 minute', status = 'open' WHERE id = $1",
        [begun.id],
      );
    });
    await expect(rpc("mcp_file_upload_chunk", [begun.id, job, 1])).rejects.toThrow(/expired/);
  });
});
