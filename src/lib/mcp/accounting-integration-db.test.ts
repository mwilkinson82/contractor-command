import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
import { readAccountingReport, type AccountingIO } from "../accounting-report-read";
import { reconcileApSnapshot } from "./ap-reconciliation-snapshot";
import { reconcileBilling } from "./reconciliation";

// One disposable database loads every actual producer together, in dependency order.
// Entitlement/auth/storage primitives are synthetic; this is not a managed rehearsal.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(7101),
  pm = id(7102),
  superUser = id(7103),
  outsider = id(7104);
const company = id(7110),
  job = id(7111),
  party = id(7112),
  terms = id(7113),
  po = id(7114);
let db: PGlite;
async function call(user: string, name: string, args: unknown[]) {
  return asUser(
    db,
    { sub: user, role: "authenticated", email: "synthetic@example.test" },
    async (tx) =>
      (
        await tx.query(
          `SELECT public.${name}(${args.map((_, n) => `$${n + 1}`).join(",")}) AS data`,
          args,
        )
      ).rows[0].data as Record<string, unknown>,
  );
}
async function write(user: string, purpose: string, name: string, payload: object) {
  const p = JSON.stringify(payload);
  const ticket = await call(user, "mcp_cost_review_prepare", [job, purpose, p]);
  return call(user, name, [job, p, ticket.review_id, true]);
}
function io(user: string): AccountingIO {
  return {
    rpc: async (name, args) => {
      try {
        return { data: await call(user, name, [args._job]), error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
    budgetPage: async (j, start, end) =>
      asUser(
        db,
        { sub: user, role: "authenticated", email: "synthetic@example.test" },
        async (tx) => ({
          data: (
            await tx.query(
              "SELECT job_id,key,value,status FROM public.mcp_job_facts WHERE job_id=$1 AND module='budget' ORDER BY key LIMIT $2 OFFSET $3",
              [j, end - start + 1, start],
            )
          ).rows,
          error: null,
        }),
      ),
  };
}
beforeAll(async () => {
  db = await makeDb();
  await db.exec(
    "CREATE FUNCTION public.get_user_tier(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'circle'::text $$; CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated,service_role; GRANT SELECT,INSERT ON storage.objects TO authenticated,service_role; CREATE TABLE mcp_submittals(id uuid PRIMARY KEY,job_id uuid,number text,revision integer); CREATE TABLE mcp_change_orders(submittal_id uuid PRIMARY KEY,job_id uuid,details jsonb);",
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
  await db.exec(
    "INSERT INTO storage.buckets(id,name,public) VALUES('athena-financial-documents','athena-financial-documents',false)",
  );
  await db.transaction(async (tx) => {
    for (const path of sources) await tx.exec(readFileSync(path, "utf8"));
  });
  for (const u of [owner, pm, superUser, outsider]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'synthetic@example.test')", [u]);
    await db.query("INSERT INTO test_active_members VALUES($1)", [u]);
  }
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Synthetic integration',$2)",
    [company, owner],
  );
  for (const [u, role] of [
    [owner, "owner"],
    [pm, "pm"],
    [superUser, "super"],
  ])
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,'Synthetic')",
      [company, u, role],
    );
  await db.query(
    "INSERT INTO mcp_jobs(id,company_id,user_id,job_number,name) VALUES($1,$2,$3,'SYN-INTEGRATED','Synthetic')",
    [job, company, owner],
  );
  for (const u of [pm, superUser])
    await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
      job,
      u,
      owner,
    ]);
  // Privileged fixture setup only; feature write handlers are exercised below.
  await db.query(
    "INSERT INTO mcp_project_parties(id,company_id,job_id,name,kind,created_by) VALUES($1,$2,$3,'Synthetic Supplier','supplier',$4)",
    [party, company, job, owner],
  );
  await db.query(
    "INSERT INTO mcp_po_terms_versions(id,company_id,scope,state,title,body,source,approved_by,created_by) VALUES($1,$2,'company','approved','Synthetic terms','Synthetic only','fixture',$3,$3)",
    [terms, company, owner],
  );
  await db.query(
    "INSERT INTO mcp_purchase_orders(id,company_id,job_id,party_id,number,created_by) VALUES($1,$2,$3,$4,'SYN-PO',$5)",
    [po, company, job, party, owner],
  );
  await db.query(
    "INSERT INTO mcp_purchase_order_versions(po_id,version,status,terms_id,party_snapshot,lines,order_date,needed_by,created_by,created_at) VALUES($1,1,'approved',$2,jsonb_build_object('id',$3::text,'name','Synthetic Supplier'),'[{\"description\":\"Synthetic material\",\"quantity\":1,\"unit\":\"each\",\"unit_price_cents\":10000}]','2026-10-01','2026-10-28',$4,'2026-10-01')",
    [po, terms, party, owner],
  );
}, 30000);
afterAll(async () => db?.close());

it("combines real PO references, reviewed AP writes, both snapshots and report without double counting", async () => {
  const record = id(7120);
  const facts = {
    kind: "supplier_bill",
    description: "Synthetic material",
    counterparty_name: "Synthetic Supplier",
    incurred_on: "2026-10-01",
    currency_code: "USD",
    amount_cents: 3000,
    document_reference: "SYN-BILL",
    original: "missing",
    party_id: party,
    purchase_order_id: po,
    purchase_order_version: 1,
    allocations: [{ job_id: job, cost_code: "MATERIAL", amount_cents: 3000 }],
  };
  const payload = { id: record, request_id: crypto.randomUUID(), expected_version: 0, facts };
  await write(owner, "submission", "mcp_cost_submission_save", payload);
  expect(await write(owner, "submission", "mcp_cost_submission_save", payload)).toMatchObject({
    already_applied: true,
  });
  await write(owner, "accounting", "mcp_cost_accounting_action", {
    action: "approve",
    id: record,
    request_id: crypto.randomUUID(),
    expected_version: 1,
  });
  await write(owner, "accounting", "mcp_cost_accounting_action", {
    action: "post",
    id: record,
    request_id: crypto.randomUUID(),
    expected_version: 1,
    accounting_effective_on: "2026-10-01",
  });
  const payment = {
    action: "payment",
    id: record,
    request_id: crypto.randomUUID(),
    expected_version: 1,
    payment_id: id(7121),
    amount_cents: 1000,
    paid_on: "2026-10-02",
    reference: "SYN-EVIDENCE",
  };
  await expect(write(owner, "accounting", "mcp_cost_accounting_action", payment)).rejects.toThrow(
    /PM approval/,
  );
  await write(pm, "pm_approval", "mcp_cost_pm_approve", {
    id: record,
    request_id: crypto.randomUUID(),
    expected_version: 1,
    allocated_cents: 3000,
    basis: "work_verified",
  });
  await write(owner, "accounting", "mcp_cost_accounting_action", payment);
  await write(owner, "submission", "mcp_cost_submission_save", {
    id: record,
    request_id: crypto.randomUUID(),
    expected_version: 1,
    reason: "Synthetic unposted correction",
    facts: {
      ...facts,
      amount_cents: 5000,
      allocations: [{ job_id: job, cost_code: "MATERIAL", amount_cents: 5000 }],
    },
  });
  const snap = await call(owner, "mcp_cost_reconciliation_snapshot", [job]);
  expect(snap).toMatchObject({ complete: true, company_id: company, job_id: job });
  const reconciled = reconcileApSnapshot(snap, { company_id: company, job_id: job });
  expect(reconciled.coverage.state).toBe("checked");
  expect(reconciled.currency_totals[0]).toMatchObject({
    currency_code: "USD",
    supplier_bill_cents: "3000",
  });
  const billing = await call(owner, "mcp_billing_reconciliation_snapshot", [job]);
  expect(billing).toMatchObject({ complete: true, company_id: company, job_id: job });
  expect(
    reconcileBilling(billing.billing, billing.originals, { company_id: company, job_id: job })
      .coverage.state,
  ).toBe("checked");
  const report = await readAccountingReport(
    io(owner),
    job,
    { asOf: "2026-10-28" },
    company,
    new Date("2026-10-28T15:00:00Z"),
  );
  expect(report.metrics.find((m) => m.key === "actual_costs")?.cents).toBe(3000);
  expect(report.metrics.find((m) => m.key === "commitments")?.cents).toBe(10000);
  expect(report.metrics.find((m) => m.key === "unpaid_costs")?.cents).toBeNull();
});

it("preserves PM versus AP and superintendent ledger boundaries with every schema installed", async () => {
  expect(await call(pm, "mcp_cost_reconciliation_snapshot", [job])).toEqual({
    snapshot_version: 1,
    complete: false,
    status: "unavailable",
  });
  await expect(call(superUser, "mcp_cost_submission_read", [job])).rejects.toThrow();
  await expect(
    readAccountingReport(io(superUser), job, { asOf: "2026-10-28" }, company),
  ).rejects.toThrow(/full access/);
  await expect(
    readAccountingReport(io(outsider), job, { asOf: "2026-10-28" }, company),
  ).rejects.toThrow(/full access/);
  expect(
    (
      await db.query<{ enabled: boolean }>(
        "SELECT public.mcp_cost_shared_identity_validated($1,$2::uuid[]) AS enabled",
        [company, []],
      )
    ).rows[0].enabled,
  ).toBe(false);
});

it("retains durable supplier and exact PO revision references under privileged maintenance", async () => {
  await expect(
    db.query(
      "INSERT INTO mcp_cost_submission_versions(record_id,version,facts,recorded_by) VALUES($1,3,$2::jsonb,$3)",
      [
        id(7120),
        JSON.stringify({ party_id: party, purchase_order_id: po, purchase_order_version: 99 }),
        owner,
      ],
    ),
  ).rejects.toThrow(/foreign key/);
  await expect(db.query("DELETE FROM mcp_project_parties WHERE id=$1", [party])).rejects.toThrow(
    /foreign key/,
  );
  await expect(
    db.query("UPDATE mcp_cost_submission_versions SET facts='{}' WHERE record_id=$1", [id(7120)]),
  ).rejects.toThrow();
});
