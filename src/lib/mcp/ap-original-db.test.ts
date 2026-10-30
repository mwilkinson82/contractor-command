import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
import { reconcileApOriginals } from "./ap-original-reconciliation";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(101),
  ap = id(102),
  pm = id(103),
  superintendent = id(104),
  outsider = id(105),
  company = id(201),
  companyB = id(202),
  job = id(301),
  jobB = id(302),
  bill = id(401),
  field = id(402);
const hash = "a".repeat(64);
type DbResult = {
  id: string;
  record_id: string;
  storage_path: string;
  sha256: string;
  review_key: string;
  payload: Record<string, unknown>;
  originals: Array<{ version: number }>;
  already_linked: boolean;
};
let db: PGlite;
const call = async (user: string, name: string, args: unknown[], service = false) =>
  asUser(
    db,
    {
      sub: user,
      email: "synthetic@example.invalid",
      role: service ? "service_role" : "authenticated",
    },
    async (tx) =>
      (
        await tx.query(
          `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS value`,
          args,
        )
      ).rows[0].value as DbResult,
  );
const facts = {
  kind: "supplier_bill",
  description: "Materials",
  counterparty_name: "Summit",
  document_reference: "INV-1",
  incurred_on: "2026-10-01",
  currency_code: "USD",
  amount_cents: 10000,
  original: "missing",
  allocations: [{ job_id: job, cost_code: "26", amount_cents: 10000 }],
};
async function makeBill(record: string, version = 1) {
  if (version === 1)
    await db.query(
      "INSERT INTO mcp_cost_submissions(id,company_id,anchor_job_id,kind,created_by) VALUES($1,$2,$3,'supplier_bill',$4)",
      [record, company, job, owner],
    );
  await db.query(
    "INSERT INTO mcp_cost_submission_versions(record_id,version,facts,recorded_by) VALUES($1,$2,$3,$4)",
    [record, version, JSON.stringify(facts), owner],
  );
}
const begin = (n: number, record = bill, actor = ap, fingerprint = hash) =>
  call(actor, "mcp_ap_original_upload_begin", [
    job,
    record,
    1,
    id(n),
    "invoice.pdf",
    "application/pdf",
    12,
    fingerprint,
  ]);
async function verified(n: number, record = bill, fingerprint = hash) {
  const u = await begin(n, record, ap, fingerprint);
  await call(ap, "mcp_ap_original_upload_claim", [u.id, ap], true);
  await db.query(
    "INSERT INTO storage.objects(bucket_id,name) VALUES('athena-financial-documents',$1)",
    [u.storage_path],
  );
  await call(ap, "mcp_ap_original_verify", [job, record, 1, u.id, 12, fingerprint, ap], true);
  return u;
}
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
  await db.exec(readFileSync("drizzle/migrations/0036_accounting_ap.sql", "utf8"));
  await db.exec(readFileSync("drizzle/migrations/0038_accounting_receipts.sql", "utf8"));
  await db.exec(readFileSync("docs/athena/ap-supplier-originals.proposed.sql", "utf8"));
  for (const user of [owner, ap, pm, superintendent, outsider]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'synthetic@example.invalid')", [
      user,
    ]);
    await db.query("INSERT INTO test_active_members VALUES($1)", [user]);
  }
  for (const co of [company, companyB])
    await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Synthetic',$2)", [
      co,
      owner,
    ]);
  for (const [user, role] of [
    [owner, "owner"],
    [ap, "ap"],
    [pm, "pm"],
    [superintendent, "super"],
  ])
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,'Synthetic')",
      [company, user, role],
    );
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Synthetic')",
    [companyB, outsider],
  );
  for (const [j, co] of [
    [job, company],
    [jobB, companyB],
  ])
    await db.query(
      "INSERT INTO mcp_jobs(id,company_id,user_id,job_number,name,restricted) VALUES($1,$2,$3,$4,'Synthetic',true)",
      [j, co, owner, j === job ? "A1" : "B1"],
    );
  for (const u of [pm, superintendent])
    await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
      job,
      u,
      owner,
    ]);
  await makeBill(bill);
  await db.query(
    "INSERT INTO mcp_cost_submissions(id,company_id,anchor_job_id,kind,created_by) VALUES($1,$2,$3,'reimbursable_expense',$4)",
    [field, company, job, superintendent],
  );
  await db.query(
    "INSERT INTO mcp_cost_submission_versions(record_id,version,facts,recorded_by) VALUES($1,1,$2,$3)",
    [field, JSON.stringify({ ...facts, kind: "reimbursable_expense" }), superintendent],
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe("AP supplier originals use real database gates and exact immutable versions", () => {
  it("rejects PM/super/outsider, wrong job/version and the field-expense route", async () => {
    for (const u of [pm, superintendent, outsider])
      await expect(begin(501, bill, u)).rejects.toThrow(/Accounting or owner|MCP_INACTIVE/);
    await expect(call(ap, "mcp_ap_original_scope", [jobB, bill, 1, false])).rejects.toThrow(
      /unavailable/,
    );
    await expect(call(ap, "mcp_ap_original_scope", [job, bill, 2, false])).rejects.toThrow(
      /version/,
    );
    await expect(begin(501, field)).rejects.toThrow(/unavailable/);
  });
  it("deduplicates the same actor/bill/version/fingerprint but rejects changed upload identity", async () => {
    const a = await begin(502),
      b = await begin(503);
    expect(b.id).toBe(a.id);
    await expect(
      call(ap, "mcp_ap_original_upload_begin", [
        job,
        bill,
        1,
        a.id,
        "different.pdf",
        "application/pdf",
        12,
        hash,
      ]),
    ).rejects.toThrow(/different content/);
    await expect(call(ap, "mcp_ap_original_upload_get", [job, bill, 1, id(999)])).rejects.toThrow(
      /unavailable/,
    );
  });
  it("requires server attestation and an actual storage object with the reviewed fingerprint", async () => {
    const u = await begin(504);
    await expect(
      call(ap, "mcp_ap_original_verify", [job, bill, 1, u.id, 12, hash, ap]),
    ).rejects.toThrow(/permission denied/);
    await expect(call(ap, "mcp_ap_original_review", [job, bill, 1, u.id, id(605)])).rejects.toThrow(
      /verify/,
    );
    await expect(
      call(ap, "mcp_ap_original_verify", [job, bill, 1, u.id, 12, hash, ap], true),
    ).rejects.toThrow(/does not match/);
    await expect(call(ap, "mcp_ap_original_upload_claim", [u.id, pm], true)).rejects.toThrow(
      /unavailable/,
    );
    await db.query(
      "INSERT INTO storage.objects(bucket_id,name) VALUES('athena-financial-documents',$1)",
      [u.storage_path],
    );
    await expect(
      call(ap, "mcp_ap_original_verify", [job, bill, 1, u.id, 13, hash, ap], true),
    ).rejects.toThrow(/does not match/);
    await call(ap, "mcp_ap_original_verify", [job, bill, 1, u.id, 12, hash, ap], true);
  });
  it("links only after actor-bound exact review/confirmation; retries never duplicate", async () => {
    const u = await begin(506);
    const r = await call(ap, "mcp_ap_original_review", [job, bill, 1, u.id, id(606)]);
    await expect(
      call(ap, "mcp_ap_original_link", [job, r.payload, r.review_key, false]),
    ).rejects.toThrow(/confirm/);
    await expect(
      call(owner, "mcp_ap_original_link", [job, r.payload, r.review_key, true]),
    ).rejects.toThrow(/changed|exact/);
    await expect(
      call(ap, "mcp_ap_original_link", [
        job,
        { ...r.payload, filename: "other.pdf" },
        r.review_key,
        true,
      ]),
    ).rejects.toThrow(/changed/);
    const a = await call(ap, "mcp_ap_original_link", [job, r.payload, r.review_key, true]);
    expect(a.already_linked).toBe(false);
    expect(
      (await call(ap, "mcp_ap_original_link", [job, r.payload, r.review_key, true])).already_linked,
    ).toBe(true);
    await expect(
      call(ap, "mcp_ap_original_link", [
        job,
        { ...r.payload, filename: "other.pdf" },
        r.review_key,
        true,
      ]),
    ).rejects.toThrow(/different content/);
    const docs = await call(owner, "mcp_ap_original_list", [job, bill, null]);
    expect(docs.originals).toHaveLength(1);
    expect(docs.originals[0].version).toBe(1);
    const read = await call(owner, "mcp_ap_original_get", [job, bill, u.id]);
    expect(read.sha256).toBe(hash);
  });
  it("preserves field receipt ownership without admitting AP to the superintendent path", async () => {
    const f = await call(superintendent, "mcp_cost_receipt_upload_begin", [
      job,
      field,
      "receipt.pdf",
      "application/pdf",
      "b".repeat(64),
    ]);
    expect(f.record_id).toBe(field);
    await expect(
      call(ap, "mcp_cost_receipt_upload_begin", [
        job,
        field,
        "receipt.pdf",
        "application/pdf",
        "c".repeat(64),
      ]),
    ).rejects.toThrow(/own assigned/);
  });
  it("fails closed for direct writes and immutable original changes", async () => {
    await expect(
      asUser(db, { sub: ap, email: "synthetic@example.invalid", role: "authenticated" }, (tx) =>
        tx.query("SELECT * FROM mcp_ap_originals"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(db.exec("UPDATE mcp_ap_originals SET filename='replacement.pdf'")).rejects.toThrow(
      /append-only|immutable|cannot|change/i,
    );
    await expect(db.exec("DELETE FROM mcp_ap_originals")).rejects.toThrow(
      /append-only|immutable|cannot|change/i,
    );
  });
  it("rejects stale and expired reviews; older originals never cover a new version", async () => {
    const record = id(410);
    await makeBill(record);
    const u = await verified(510, record, "d".repeat(64));
    const r = await call(ap, "mcp_ap_original_review", [job, record, 1, u.id, id(610)]);
    await db.query(
      "UPDATE mcp_cost_review_tickets SET expires_at=now()-interval '1 second' WHERE id=$1",
      [r.review_key],
    );
    await expect(
      call(ap, "mcp_ap_original_link", [job, r.payload, r.review_key, true]),
    ).rejects.toThrow(/Review the exact/);
    const fresh = await call(ap, "mcp_ap_original_review", [job, record, 1, u.id, id(611)]);
    await makeBill(record, 2);
    await expect(
      call(ap, "mcp_ap_original_link", [job, fresh.payload, fresh.review_key, true]),
    ).rejects.toThrow(/bill changed/);
    await makeBill(bill, 2);
    const s = await call(ap, "mcp_ap_original_snapshot", [job]);
    const reconciled = reconcileApOriginals(s, { job_id: job, company_id: company });
    expect(reconciled.coverage.state).toBe("checked");
    expect(reconciled.findings.find((x) => x.record_ids.includes(bill))?.message).toContain(
      "version 2",
    );
    expect((await call(owner, "mcp_ap_original_list", [job, bill, 1])).originals).toHaveLength(1);
  });
  it("captures associations in a read-only transaction without refreshing entitlement state", async () => {
    await db.transaction(async (tx) => {
      await tx.exec("SET TRANSACTION READ ONLY; SET LOCAL ROLE authenticated");
      await tx.query("SELECT set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: ap, role: "authenticated", email: "synthetic@example.invalid" }),
      ]);
      const s = await tx.query<{ value: { complete: boolean } }>(
        "SELECT public.mcp_ap_original_snapshot($1) AS value",
        [job],
      );
      expect(s.rows[0].value.complete).toBe(true);
    });
  });
  it("rechecks all allocation scopes and current membership before reads", async () => {
    const record = id(420);
    await makeBill(record);
    await db.query(
      "INSERT INTO mcp_cost_submission_versions(record_id,version,facts,recorded_by) VALUES($1,2,$2,$3)",
      [
        record,
        JSON.stringify({
          ...facts,
          allocations: [{ job_id: jobB, cost_code: "26", amount_cents: 10000 }],
        }),
        owner,
      ],
    );
    await expect(call(ap, "mcp_ap_original_list", [job, record, 1])).rejects.toThrow(
      /every allocated job/,
    );
    await db.query("DELETE FROM mcp_company_members WHERE company_id=$1 AND user_id=$2", [
      company,
      ap,
    ]);
    await expect(call(ap, "mcp_ap_original_list", [job, bill, 1])).rejects.toThrow(
      /unavailable|MCP_INACTIVE/,
    );
  });
});
