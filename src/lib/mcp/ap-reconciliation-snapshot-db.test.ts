import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
const owner = "00000000-0000-4000-8000-000000000501",
  ap = "00000000-0000-4000-8000-000000000502",
  pm = "00000000-0000-4000-8000-000000000503",
  outside = "00000000-0000-4000-8000-000000000504",
  company = "00000000-0000-4000-8000-000000000505",
  otherCompany = "00000000-0000-4000-8000-000000000506",
  job = "00000000-0000-4000-8000-000000000507",
  job2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8",
  otherJob = "00000000-0000-4000-8000-000000000509";
let db: PGlite;
const call = async (user: string, fn: string, args: unknown[]) =>
  asUser(
    db,
    { sub: user, email: "synthetic@example.invalid", role: "authenticated" },
    async (tx) =>
      (
        await tx.query(
          `SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS value`,
          args,
        )
      ).rows[0].value as Record<string, unknown>,
  );
const snapshot = (user: string, j = job) => call(user, "mcp_cost_reconciliation_snapshot", [j]);
async function write(
  user: string,
  purpose: string,
  fn: string,
  p: Record<string, unknown>,
  j = job,
) {
  const t = await call(user, "mcp_cost_review_prepare", [j, purpose, JSON.stringify(p)]);
  return call(user, fn, [j, JSON.stringify(p), t.review_id, true]);
}
const facts = (ref: string, amount = 10000) => ({
  kind: "supplier_bill",
  description: "Synthetic",
  counterparty_name: "Supplier",
  incurred_on: "2026-10-28",
  document_reference: ref,
  amount_cents: amount,
  original: "missing",
  allocations: [
    { job_id: job, cost_code: "A", amount_cents: amount / 2 },
    { job_id: job2, cost_code: "B", amount_cents: amount / 2 },
  ],
});
beforeAll(async () => {
  db = await makeDb();
  await db.exec(
    "CREATE FUNCTION public.get_user_tier(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'circle'::text $$;",
  );
  for (const f of [
    "20261021190000_athena_team_invites.sql",
    "20261022120000_athena_account_team_privacy_terms.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await db.exec(readFileSync("docs/athena/job-cost-submission.schema-draft.sql", "utf8"));
  await db.exec(readFileSync("docs/athena/ap-reconciliation-snapshot.schema-draft.sql", "utf8"));
  for (const u of [owner, ap, pm, outside]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'synthetic@example.invalid')", [u]);
    await db.query("INSERT INTO test_active_members VALUES($1)", [u]);
  }
  for (const [c, o] of [
    [company, owner],
    [otherCompany, outside],
  ]) {
    await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Synthetic',$2)", [
      c,
      o,
    ]);
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Owner')",
      [c, o],
    );
  }
  for (const [u, role] of [
    [ap, "ap"],
    [pm, "pm"],
  ])
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,'Synthetic')",
      [company, u, role],
    );
  for (const [id, c, o, n] of [
    [job, company, owner, "A"],
    [job2, company, owner, "B"],
    [otherJob, otherCompany, outside, "C"],
  ])
    await db.query(
      "INSERT INTO mcp_jobs(id,company_id,user_id,job_number,name) VALUES($1,$2,$3,$4,'Synthetic')",
      [id, c, o, n],
    );
  await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
    job,
    pm,
    owner,
  ]);
}, 30000);
afterAll(async () => db.close());
describe("bounded AP reconciliation snapshot", () => {
  it("returns complete empty coverage only for authorized owner/AP and never for other jobs or roles", async () => {
    const before = (await db.query("SELECT count(*) AS n FROM mcp_gate_cache")).rows[0].n;
    expect(await snapshot(owner)).toMatchObject({
      snapshot_version: 1,
      complete: true,
      ap: {
        cents_encoding: "decimal_string",
        records: [],
        shared_payment_conservation_available: false,
      },
    });
    expect(await snapshot(ap)).toMatchObject({ complete: true });
    for (const [u, j] of [
      [pm, job],
      [outside, job],
      [owner, otherJob],
    ])
      expect(await snapshot(u, j)).toEqual({
        snapshot_version: 1,
        complete: false,
        status: "unavailable",
      });
    expect((await db.query("SELECT count(*) AS n FROM mcp_gate_cache")).rows[0].n).toBe(before);
  });
  it("returns posted history and exact decimal cents without promoting an unposted correction", async () => {
    const p = {
      id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      expected_version: 0,
      facts: facts("BILL-1"),
    };
    p.facts.allocations[1].job_id = job2.toUpperCase();
    await write(owner, "submission", "mcp_cost_submission_save", p);
    const otherJobSnapshot = await snapshot(ap, job2);
    expect(otherJobSnapshot.complete).toBe(true);
    expect(
      (otherJobSnapshot.ap as { records: Array<{ id: string }> }).records.some(
        (x) => x.id === p.id,
      ),
    ).toBe(true);
    for (const action of ["approve", "post"])
      await write(owner, "accounting", "mcp_cost_accounting_action", {
        id: p.id,
        request_id: crypto.randomUUID(),
        expected_version: 1,
        action,
      });
    for (const j of [job, job2])
      await write(
        owner,
        "pm_approval",
        "mcp_cost_pm_approve",
        {
          id: p.id,
          request_id: crypto.randomUUID(),
          expected_version: 1,
          allocated_cents: 5000,
          basis: "owner_exception",
          notes: "Synthetic decision",
        },
        j,
      );
    const paymentId = crypto.randomUUID(),
      correctionId = crypto.randomUUID();
    await write(owner, "accounting", "mcp_cost_accounting_action", {
      id: p.id,
      request_id: crypto.randomUUID(),
      expected_version: 1,
      action: "payment",
      payment_id: paymentId,
      amount_cents: 4000,
      paid_on: "2026-10-29",
      reference: "synthetic check",
    });
    await write(owner, "settlement", "mcp_cost_settlement_action", {
      id: p.id,
      request_id: crypto.randomUUID(),
      action: "correct_payment",
      payment_id: paymentId,
      correction_id: correctionId,
      reason: "Duplicate evidence",
    });
    await write(owner, "submission", "mcp_cost_submission_save", {
      ...p,
      request_id: crypto.randomUUID(),
      expected_version: 1,
      reason: "Correct the amount",
      facts: facts("BILL-1", 12000),
    });
    const s = await snapshot(ap);
    expect(s.complete).toBe(true);
    const data = s.ap as {
      records: Array<{
        id: string;
        posted_version: number;
        versions: Array<{
          version: number;
          amount_cents: string;
          reason: string | null;
          allocations: Array<{ amount_cents: string }>;
        }>;
        posting_events: Array<{ version: number; posted_at: string }>;
        business_approvals: Array<{ job_id: string; allocated_cents: string }>;
        payments: Array<{
          id: string;
          amount_cents: string;
          correction: { id: string; reason: string };
        }>;
      }>;
      settlement_allocation_by_job_available: boolean;
    };
    const r = data.records.find((r) => r.id === p.id)!;
    expect(r.posted_version).toBe(1);
    expect(r.versions.map((v) => v.amount_cents)).toEqual(["10000", "12000"]);
    expect(r.versions[1].reason).toBe("Correct the amount");
    expect(r.versions[1].allocations.map((a) => a.amount_cents)).toEqual(["6000", "6000"]);
    expect(Date.parse(r.posting_events[0].posted_at)).not.toBeNaN();
    expect(r.business_approvals.map((a) => a.allocated_cents)).toEqual(["5000", "5000"]);
    expect(r.payments).toEqual([
      expect.objectContaining({
        id: paymentId,
        amount_cents: "4000",
        correction: expect.objectContaining({ id: correctionId, reason: "Duplicate evidence" }),
      }),
    ]);
    expect(data.settlement_allocation_by_job_available).toBe(false);
  });
  it("returns no partial data when any affected job is unavailable in the same snapshot", async () => {
    const def = (
      await db.query("SELECT pg_get_functiondef('public.mcp_job_scope(uuid)'::regprocedure) AS def")
    ).rows[0].def as string;
    try {
      await db.exec(
        `CREATE OR REPLACE FUNCTION public.mcp_job_scope(_job uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT CASE WHEN _job='${job2}'::uuid THEN NULL ELSE 'full' END $$;`,
      );
      expect(await snapshot(ap)).toEqual({
        snapshot_version: 1,
        complete: false,
        status: "unavailable",
      });
    } finally {
      await db.exec(def);
    }
  });
  it("rejects inconsistent cross-company allocation and stays generic", async () => {
    const id = crypto.randomUUID();
    await db.query(
      "INSERT INTO mcp_cost_submissions(id,company_id,anchor_job_id,kind,created_by) VALUES($1,$2,$3,'supplier_bill',$4)",
      [id, otherCompany, job, outside],
    );
    await db.query(
      "INSERT INTO mcp_cost_submission_versions(record_id,version,facts,recorded_by) VALUES($1,1,$2::jsonb,$3)",
      [id, JSON.stringify(facts("corrupt")), outside],
    );
    expect(await snapshot(owner)).toEqual({
      snapshot_version: 1,
      complete: false,
      status: "unavailable",
    });
    await db.query("DELETE FROM mcp_cost_submission_versions WHERE record_id=$1", [id]);
    await db.query("DELETE FROM mcp_cost_submissions WHERE id=$1", [id]);
  });
  it("does not silently omit a record whose job ID uses a noncanonical UUID spelling", async () => {
    const id = crypto.randomUUID(),
      f = facts("NONCANONICAL");
    f.allocations[1].job_id = job2.replaceAll("-", "");
    await db.query(
      "INSERT INTO mcp_cost_submissions(id,company_id,anchor_job_id,kind,created_by) VALUES($1,$2,$3,'supplier_bill',$4)",
      [id, company, job, owner],
    );
    await db.query(
      "INSERT INTO mcp_cost_submission_versions(record_id,version,facts,recorded_by) VALUES($1,1,$2::jsonb,$3)",
      [id, JSON.stringify(f), owner],
    );
    expect(await snapshot(owner, job2)).toEqual({
      snapshot_version: 1,
      complete: false,
      status: "unavailable",
    });
    await db.query("DELETE FROM mcp_cost_submission_versions WHERE record_id=$1", [id]);
    await db.query("DELETE FROM mcp_cost_submissions WHERE id=$1", [id]);
  });
  it("preserves the maximum supported integer exactly and fails closed above it", async () => {
    const id = crypto.randomUUID(),
      amount = 9000000000000;
    await write(owner, "submission", "mcp_cost_submission_save", {
      id,
      request_id: crypto.randomUUID(),
      expected_version: 0,
      facts: {
        ...facts("MAX", amount),
        kind: "company_paid_expense",
        allocations: [{ job_id: job, cost_code: "FIELD", amount_cents: amount }],
      },
    });
    const data = (await snapshot(owner)).ap as {
      records: Array<{ id: string; kind: string; versions: Array<{ amount_cents: string }> }>;
    };
    expect(data.records.find((r) => r.id === id)).toMatchObject({
      kind: "company_paid_expense",
      versions: [{ amount_cents: "9000000000000" }],
    });
    const bad = crypto.randomUUID();
    await db.query(
      "INSERT INTO mcp_cost_submissions(id,company_id,anchor_job_id,kind,created_by) VALUES($1,$2,$3,'supplier_bill',$4)",
      [bad, company, job, owner],
    );
    await db.query(
      "INSERT INTO mcp_cost_submission_versions(record_id,version,facts,recorded_by) VALUES($1,1,$2::jsonb,$3)",
      [
        bad,
        JSON.stringify({
          ...facts("TOO-LARGE"),
          amount_cents: 9000000000001,
          allocations: [{ job_id: job, cost_code: "A", amount_cents: 9000000000001 }],
        }),
        owner,
      ],
    );
    expect(await snapshot(owner)).toEqual({
      snapshot_version: 1,
      complete: false,
      status: "unavailable",
    });
    await db.query("DELETE FROM mcp_cost_submission_versions WHERE record_id=$1", [bad]);
    await db.query("DELETE FROM mcp_cost_submissions WHERE id=$1", [bad]);
  });
  it("stops returning data immediately when accounting membership is removed", async () => {
    await db.query("DELETE FROM mcp_company_members WHERE company_id=$1 AND user_id=$2", [
      company,
      ap,
    ]);
    expect(await snapshot(ap)).toEqual({
      snapshot_version: 1,
      complete: false,
      status: "unavailable",
    });
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'ap','Synthetic')",
      [company, ap],
    );
  });
  it("fails closed on inactive entitlement without using the mutating active gate", async () => {
    await db.query("DELETE FROM test_active_members WHERE user_id IN ($1,$2)", [owner, ap]);
    expect(await snapshot(ap)).toEqual({
      snapshot_version: 1,
      complete: false,
      status: "unavailable",
    });
    await db.query("INSERT INTO test_active_members(user_id) VALUES($1),($2)", [owner, ap]);
  });
  it("returns only unavailable when the bounded JSON response would exceed two MiB", async () => {
    const id = crypto.randomUUID();
    await db.query(
      "INSERT INTO mcp_cost_submissions(id,company_id,anchor_job_id,kind,created_by) VALUES($1,$2,$3,'supplier_bill',$4)",
      [id, company, job, owner],
    );
    await db.query(
      "INSERT INTO mcp_cost_submission_versions(record_id,version,facts,reason,recorded_by) SELECT $1,g,$2::jsonb,repeat('x',2000),$3 FROM generate_series(1,990) g",
      [id, JSON.stringify(facts("LARGE")), owner],
    );
    expect(await snapshot(owner)).toEqual({
      snapshot_version: 1,
      complete: false,
      status: "unavailable",
    });
    await db.query("DELETE FROM mcp_cost_submission_versions WHERE record_id=$1", [id]);
    await db.query("DELETE FROM mcp_cost_submissions WHERE id=$1", [id]);
  });
  it("fails closed when the bounded record limit is exceeded", async () => {
    await db.query(
      "INSERT INTO mcp_cost_submissions(id,company_id,anchor_job_id,kind,created_by) SELECT gen_random_uuid(),$1,$2,'supplier_bill',$3 FROM generate_series(1,201)",
      [company, job, owner],
    );
    expect(await snapshot(owner)).toEqual({
      snapshot_version: 1,
      complete: false,
      status: "unavailable",
    });
  });
});
