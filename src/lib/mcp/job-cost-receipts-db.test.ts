import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
const owner = "00000000-0000-4000-8000-000000000101",
  super1 = "00000000-0000-4000-8000-000000000102",
  super2 = "00000000-0000-4000-8000-000000000103",
  pm = "00000000-0000-4000-8000-000000000104",
  company = "00000000-0000-4000-8000-000000000105",
  job = "00000000-0000-4000-8000-000000000106",
  job2 = "00000000-0000-4000-8000-000000000107",
  record = "00000000-0000-4000-8000-000000000108";
let db: PGlite;
const q = (
  user: string,
  sql: string,
  args: unknown[] = [],
  role: "authenticated" | "service_role" = "authenticated",
) =>
  asUser(
    db,
    { sub: user, email: "synthetic@example.test", role },
    async (tx) => (await tx.query(sql, args)).rows as Record<string, unknown>[],
  );
const call = async (
  user: string,
  name: string,
  args: unknown[],
  role: "authenticated" | "service_role" = "authenticated",
) =>
  (
    await q(
      user,
      `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS value`,
      args,
      role,
    )
  )[0].value as Record<string, unknown>;
beforeAll(async () => {
  db = await makeDb();
  await db.exec(
    "CREATE FUNCTION public.get_user_tier(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'circle'::text $$; CREATE SCHEMA storage; CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);",
  );
  for (const f of [
    "20261021190000_athena_team_invites.sql",
    "20261022120000_athena_account_team_privacy_terms.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await db.exec(readFileSync("docs/athena/job-cost-submission.schema-draft.sql", "utf8"));
  await db.exec(readFileSync("docs/athena/job-cost-originals.schema-draft.sql", "utf8"));
  for (const user of [owner, super1, super2, pm]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'synthetic@example.invalid')", [
      user,
    ]);
    await db.query("INSERT INTO test_active_members VALUES($1)", [user]);
  }
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Synthetic',$2)", [
    company,
    owner,
  ]);
  for (const [user, role] of [
    [owner, "owner"],
    [super1, "super"],
    [super2, "super"],
    [pm, "pm"],
  ])
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,'Synthetic')",
      [company, user, role],
    );
  for (const [id, num] of [
    [job, "A"],
    [job2, "B"],
  ])
    await db.query(
      "INSERT INTO mcp_jobs(id,company_id,user_id,job_number,name) VALUES($1,$2,$3,$4,'Synthetic')",
      [id, company, owner, num],
    );
  for (const user of [super1, super2, pm])
    await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
      job,
      user,
      owner,
    ]);
  await db.query(
    "INSERT INTO public.mcp_cost_submissions(id,company_id,anchor_job_id,kind,created_by) VALUES($1,$2,$3,'company_paid_expense',$4)",
    [record, company, job, super1],
  );
}, 30000);
afterAll(async () => db.close());
describe("scoped field receipt access", () => {
  it("binds upload and retrieval to the assigned submitter and exact record", async () => {
    const hash = "aa".repeat(32);
    for (const filename of ["../receipt.pdf", "folder/receipt.pdf", "folder\\receipt.pdf"]) {
      await expect(
        call(super1, "mcp_cost_receipt_upload_begin", [
          job,
          record,
          filename,
          "application/pdf",
          hash,
        ]),
      ).rejects.toThrow(/Invalid financial document/);
    }
    await expect(
      call(super2, "mcp_cost_receipt_upload_begin", [
        job,
        record,
        "receipt.png",
        "image/png",
        hash,
      ]),
    ).rejects.toThrow(/own assigned/);
    await expect(
      call(super1, "mcp_cost_receipt_upload_begin", [
        job2,
        record,
        "receipt.png",
        "image/png",
        hash,
      ]),
    ).rejects.toThrow(/own assigned/);
    const u = await call(super1, "mcp_cost_receipt_upload_begin", [
      job,
      record,
      "receipt.png",
      "image/png",
      hash,
    ]);
    await expect(q(super1, "SELECT * FROM public.mcp_cost_receipt_uploads")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      call(super1, "mcp_cost_receipt_upload_claim", [u.id, super1, null]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      call(owner, "mcp_cost_receipt_upload_claim", [u.id, super2, null], "service_role"),
    ).rejects.toThrow(/unavailable/);
    const claimed = await call(
      owner,
      "mcp_cost_receipt_upload_claim",
      [u.id, null, hash],
      "service_role",
    );
    expect(claimed.record_id).toBe(record);
    await db.query(
      "INSERT INTO storage.objects(bucket_id,name) VALUES('athena-financial-documents',$1)",
      [u.storage_path],
    );
    await expect(
      call(super1, "mcp_cost_receipt_register", [job, record, u.id, 12, "bb".repeat(32), super1]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      call(
        owner,
        "mcp_cost_receipt_register",
        [job, record, u.id, 12, "bb".repeat(32), super2],
        "service_role",
      ),
    ).rejects.toThrow(/unavailable/);
    expect(
      (
        await call(
          owner,
          "mcp_cost_receipt_register",
          [job, record, u.id, 12, "bb".repeat(32), super1],
          "service_role",
        )
      ).already_stored,
    ).toBe(false);
    expect(
      (
        await call(
          owner,
          "mcp_cost_receipt_register",
          [job, record, u.id, 12, "bb".repeat(32), super1],
          "service_role",
        )
      ).already_stored,
    ).toBe(true);
    const audit = await db.query(
      "SELECT actor,object_id FROM public.mcp_audit_log WHERE tool='cost_receipt' AND action='store_original'",
    );
    expect(audit.rows).toEqual([expect.objectContaining({ actor: super1, object_id: u.id })]);
    await expect(
      call(
        owner,
        "mcp_cost_receipt_register",
        [job, record, u.id, 13, "bb".repeat(32), super1],
        "service_role",
      ),
    ).rejects.toThrow(/does not match/);
    expect((await call(super1, "mcp_cost_receipt_get", [job, record, u.id])).id).toBe(u.id);
    expect((await call(owner, "mcp_cost_receipt_get", [job, record, u.id])).id).toBe(u.id);
    expect((await call(super1, "mcp_cost_receipt_list", [job, record])).receipts).toHaveLength(1);
    await expect(call(super2, "mcp_cost_receipt_get", [job, record, u.id])).rejects.toThrow(
      /unavailable/,
    );
    await expect(call(pm, "mcp_cost_receipt_get", [job, record, u.id])).rejects.toThrow(
      /unavailable/,
    );
    await expect(call(super1, "mcp_cost_submission_read", [job])).rejects.toThrow(/Full project/);
    await expect(q(super1, "SELECT * FROM public.mcp_cost_receipts")).rejects.toThrow(
      /permission denied/,
    );
    await db.query("DELETE FROM mcp_job_access WHERE job_id=$1 AND user_id=$2", [job, super1]);
    await expect(call(super1, "mcp_cost_receipt_get", [job, record, u.id])).rejects.toThrow(
      /unavailable/,
    );
    await expect(
      call(owner, "mcp_cost_receipt_upload_claim", [u.id, null, hash], "service_role"),
    ).rejects.toThrow(/unavailable/);
  });
});
