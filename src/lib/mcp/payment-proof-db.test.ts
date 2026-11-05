import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(101),
  ap = id(102),
  pm = id(103),
  outsider = id(105),
  company = id(201),
  companyB = id(202),
  job = id(301),
  jobB = id(302),
  bill = id(401),
  otherBill = id(402),
  payment = id(501),
  otherPayment = id(502),
  shared = id(503);
const hash = "b".repeat(64);
let db: PGlite;

const call = async <T = Record<string, unknown>>(user: string, name: string, args: unknown[]) =>
  asUser(
    db,
    { sub: user, email: "synthetic@example.invalid", role: "authenticated" },
    async (tx) =>
      (
        await tx.query(
          `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS value`,
          args,
        )
      ).rows[0] as { value: T },
  ).then((r) => r.value);

const facts = {
  kind: "supplier_bill",
  description: "Materials",
  counterparty_name: "Summit",
  document_reference: "INV-1",
  incurred_on: "2026-10-01",
  currency_code: "USD",
  amount_cents: 640000,
  allocations: [{ job_id: job, cost_code: "26", amount_cents: 640000 }],
};
async function makeBill(record: string) {
  await db.query(
    "INSERT INTO mcp_cost_submissions(id,company_id,anchor_job_id,kind,created_by) VALUES($1,$2,$3,'supplier_bill',$4)",
    [record, company, job, owner],
  );
  await db.query(
    "INSERT INTO mcp_cost_submission_versions(record_id,version,facts,recorded_by) VALUES($1,1,$2,$3)",
    [record, JSON.stringify(facts), owner],
  );
}
const store = (proof: string, filename = "check-1042.pdf") =>
  db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('athena-financial-documents',$1)", [
    `${company}/${job}/${proof}/${filename}`,
  ]);
const link = (
  actor: string,
  proof: string,
  pay = payment,
  filename = "check-1042.pdf",
  sha = hash,
) =>
  call(actor, "mcp_cost_payment_proof_link", [
    job,
    bill,
    pay,
    proof,
    filename,
    "application/pdf",
    2048,
    sha,
  ]);

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
  await db.exec(
    readFileSync("supabase/migrations/20261105220000_athena_payment_proofs.sql", "utf8"),
  );
  for (const user of [owner, ap, pm, outsider]) {
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
  await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
    job,
    pm,
    owner,
  ]);
  await makeBill(bill);
  await makeBill(otherBill);
  await db.query(
    "INSERT INTO mcp_cost_payment_evidence(id,record_id,amount_cents,paid_on,reference,recorded_by) VALUES($1,$2,640000,'2026-11-03','Check 1042',$3)",
    [payment, bill, ap],
  );
  await db.query(
    "INSERT INTO mcp_cost_payment_evidence(id,record_id,amount_cents,paid_on,reference,recorded_by) VALUES($1,$2,1000,'2026-11-03','Check 9',$3)",
    [otherPayment, otherBill, ap],
  );
  await db.query(
    "INSERT INTO mcp_cost_shared_payments(id,company_id,amount_cents,paid_on,reference,recorded_by) VALUES($1,$2,5000,'2026-11-04','Wire 77',$3)",
    [shared, company, ap],
  );
  await db.query(
    "INSERT INTO mcp_cost_shared_allocations(payment_id,record_id,amount_cents) VALUES($1,$2,5000)",
    [shared, bill],
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe("payment proof SQL", () => {
  it("scopes a proof to a payment recorded on this bill and this job", async () => {
    const s = await call(pm, "mcp_cost_payment_proof_scope", [job, bill, payment]);
    expect(s).toMatchObject({ payment_id: payment, shared: false, can_attach: false });
    const sh = await call(ap, "mcp_cost_payment_proof_scope", [job, bill, shared]);
    expect(sh).toMatchObject({ shared: true, can_attach: true });
    await expect(
      call(ap, "mcp_cost_payment_proof_scope", [job, bill, otherPayment]),
    ).rejects.toThrow(/not recorded on this bill/);
    await expect(
      call(outsider, "mcp_cost_payment_proof_scope", [job, bill, payment]),
    ).rejects.toThrow(/Full project access/);
    await expect(
      call(outsider, "mcp_cost_payment_proof_scope", [jobB, bill, payment]),
    ).rejects.toThrow(/not available on this project/);
  });

  it("lets only owner or AP link, and only a file that is actually stored", async () => {
    await expect(link(pm, id(601))).rejects.toThrow(/owner or accounts payable/);
    await expect(link(ap, id(601))).rejects.toThrow(/not stored/);
    await store(id(601));
    const row = await link(ap, id(601));
    expect(row).toMatchObject({ id: id(601), payment_id: payment, filename: "check-1042.pdf" });
    expect(row).not.toHaveProperty("storage_path");
  });

  it("returns the existing proof when the same file is attached twice", async () => {
    await store(id(602));
    const again = await link(owner, id(602));
    expect(again).toMatchObject({ id: id(601) });
    const { rows } = await db.query("SELECT count(*)::int AS n FROM mcp_cost_payment_proofs");
    expect((rows[0] as { n: number }).n).toBe(1);
  });

  it("lists proofs without paths and hands the server the path only through get", async () => {
    const list = await call<{ proofs: Array<Record<string, unknown>>; can_attach: boolean }>(
      pm,
      "mcp_cost_payment_proof_list",
      [job, bill],
    );
    expect(list.can_attach).toBe(false);
    expect(list.proofs).toHaveLength(1);
    expect(list.proofs[0]).not.toHaveProperty("storage_path");
    const got = await call(pm, "mcp_cost_payment_proof_get", [job, id(601)]);
    expect(got).toMatchObject({
      storage_path: `${company}/${job}/${id(601)}/check-1042.pdf`,
      sha256: hash,
    });
    await expect(call(outsider, "mcp_cost_payment_proof_get", [jobB, id(601)])).rejects.toThrow(
      /not available/,
    );
  });

  it("keeps linked proofs immutable and the table closed to members", async () => {
    await expect(
      db.query("UPDATE mcp_cost_payment_proofs SET filename='x.pdf' WHERE id=$1", [id(601)]),
    ).rejects.toThrow();
    await expect(
      asUser(db, { sub: ap, email: "synthetic@example.invalid", role: "authenticated" }, (tx) =>
        tx.query("SELECT * FROM mcp_cost_payment_proofs"),
      ),
    ).rejects.toThrow(/permission denied/);
    const { rows } = await db.query(
      `SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS member
         FROM pg_proc p WHERE p.proname LIKE 'mcp_cost_payment_proof_%'`,
    );
    expect(rows).toHaveLength(4);
    for (const r of rows as Array<{ anon: boolean; member: boolean }>)
      expect(r).toMatchObject({ anon: false, member: true });
  });
});
