import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
import { reconcileCosts } from "./reconciliation";

describe("PR351 provisional contract (synthetic external fixture)", () => {
  const owner = "00000000-0000-4000-8000-000000000111",
    pm = "00000000-0000-4000-8000-000000000112",
    estimator = "00000000-0000-4000-8000-000000000113",
    superUser = "00000000-0000-4000-8000-000000000114",
    outsider = "00000000-0000-4000-8000-000000000115",
    ap = "00000000-0000-4000-8000-000000000116",
    allAccess = "00000000-0000-4000-8000-000000000117",
    super2 = "00000000-0000-4000-8000-000000000118",
    pm2 = "00000000-0000-4000-8000-000000000119";
  const company = "00000000-0000-4000-8000-000000000121",
    otherCompany = "00000000-0000-4000-8000-000000000122",
    jobA = "00000000-0000-4000-8000-000000000131",
    jobB = "00000000-0000-4000-8000-000000000132",
    otherJob = "00000000-0000-4000-8000-000000000133";
  let db: PGlite;
  const rawQuery = (user: string, sql: string, args: unknown[] = []) =>
    asUser(
      db,
      { sub: user, email: "synthetic@example.test", role: "authenticated" },
      (tx) => tx.query(sql, args) as Promise<{ rows: Array<{ value: unknown }> }>,
    );
  // Normal test commands explicitly create a review ticket, then call the guarded write.
  const query = async (user: string, sql: string, args: unknown[] = []) => {
    const m = sql.match(
      /public\.mcp_cost_(submission_save|accounting_action|settlement_action|pm_approve|pm_withdraw|field_submit)\(\$1,\$2::jsonb\)/,
    );
    if (!m) return rawQuery(user, sql, args);
    const purpose =
      m[1] === "field_submit"
        ? "field"
        : m[1] === "submission_save"
          ? "submission"
          : m[1] === "accounting_action"
            ? "accounting"
            : m[1] === "pm_approve"
              ? "pm_approval"
              : m[1] === "pm_withdraw"
                ? "pm_withdraw"
                : "settlement";
    const prep = await rawQuery(
      user,
      "SELECT public.mcp_cost_review_prepare($1,$2,$3::jsonb) AS value",
      [args[0], purpose, args[1]],
    );
    const review = (prep.rows[0].value as { review_id: string }).review_id;
    return rawQuery(user, sql.replace("($1,$2::jsonb)", "($1,$2::jsonb,$3,true)"), [
      ...args,
      review,
    ]);
  };
  const save = async (user: string, p: object) =>
    (
      await query(user, "SELECT public.mcp_cost_submission_save($1,$2::jsonb) AS value", [
        jobA,
        JSON.stringify(p),
      ])
    ).rows[0].value as Record<string, unknown>;
  const read = async (user: string, job = jobA) =>
    (await query(user, "SELECT public.mcp_cost_submission_read($1) AS value", [job])).rows[0]
      .value as {
      records: Array<{ id: string; versions: unknown[] }>;
      posting_available: boolean;
    };
  const makeFacts = () => ({
    kind: "reimbursable_expense",
    description: "Fuel",
    counterparty_name: "Synthetic Employee",
    incurred_on: "2026-10-28",
    amount_cents: 10000,
    document_reference: "Receipt 1",
    original: "missing",
    allocations: [
      { job_id: jobA, cost_code: "FUEL", amount_cents: 6000 },
      { job_id: jobB, cost_code: "FUEL", amount_cents: 4000 },
    ],
  });
  const makePayload = () => ({
    id: crypto.randomUUID(),
    request_id: crypto.randomUUID(),
    expected_version: 0,
    facts: makeFacts(),
  });
  const approveJob = async (recordId: string, jobId: string, version: number, allocated: number) =>
    query(owner, "SELECT public.mcp_cost_pm_approve($1,$2::jsonb) AS value", [
      jobId,
      JSON.stringify({
        id: recordId,
        request_id: crypto.randomUUID(),
        expected_version: version,
        allocated_cents: allocated,
        basis: "owner_exception",
        notes: "Owner decision",
      }),
    ]);
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
    await db.exec(readFileSync("tests/fixtures/pr351-cost-read-contract.sql", "utf8"));
    for (const u of [owner, pm, estimator, superUser, outsider, ap, allAccess, super2, pm2]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES ($1,'synthetic@example.test')", [u]);
      await db.query("INSERT INTO test_active_members VALUES ($1)", [u]);
    }
    for (const [c, u] of [
      [company, owner],
      [otherCompany, outsider],
    ]) {
      await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES ($1,'Synthetic',$2)", [
        c,
        u,
      ]);
      await db.query(
        "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES ($1,$2,'owner','Owner')",
        [c, u],
      );
    }
    for (const [u, role] of [
      [pm, "pm"],
      [pm2, "pm"],
      [ap, "ap"],
      [allAccess, "all_access"],
      [estimator, "estimating"],
      [superUser, "super"],
      [super2, "super"],
    ])
      await db.query(
        "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES ($1,$2,$3,'Member')",
        [company, u, role],
      );
    for (const [id, c, u, n] of [
      [jobA, company, owner, "A"],
      [jobB, company, owner, "B"],
      [otherJob, otherCompany, outsider, "C"],
    ])
      await db.query(
        "INSERT INTO mcp_jobs(id,company_id,user_id,job_number,name) VALUES ($1,$2,$3,$4,'Synthetic')",
        [id, c, u, n],
      );
    for (const u of [pm, pm2, superUser, super2])
      await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES ($1,$2,$3)", [
        jobA,
        u,
        owner,
      ]);
  }, 30000);
  afterAll(async () => db?.close());

  it("adapts the staged RPC response and retains the latest posted payable over an unposted correction", async () => {
    const p = makePayload();
    await db.query(
      "INSERT INTO public.mcp_cost_submissions(id,company_id,anchor_job_id,kind,created_by) VALUES($1,$2,$3,'reimbursable_expense',$4)",
      [p.id, company, jobA, owner],
    );
    await db.query(
      "INSERT INTO public.mcp_cost_submission_versions(record_id,version,facts,recorded_by) VALUES($1,1,$2::jsonb,$3)",
      [p.id, JSON.stringify(p.facts), owner],
    );
    await db.query(
      "INSERT INTO public.mcp_cost_approvals(record_id,version,approved_by) VALUES($1,1,$2)",
      [p.id, owner],
    );
    await db.query(
      "INSERT INTO public.mcp_cost_posting_events(record_id,version,posted_by) VALUES($1,1,$2)",
      [p.id, owner],
    );
    await db.query(
      "INSERT INTO public.mcp_cost_payment_evidence(id,record_id,amount_cents,paid_on,reference,recorded_by) VALUES($1,$2,4000,'2026-10-28','Synthetic check',$3)",
      [crypto.randomUUID(), p.id, owner],
    );
    await db.query(
      "INSERT INTO public.mcp_cost_submission_versions(record_id,version,facts,reason,recorded_by) VALUES($1,2,$2::jsonb,'Corrected amount',$3)",
      [
        p.id,
        JSON.stringify({
          ...p.facts,
          amount_cents: 20000,
          allocations: [
            { job_id: jobA, cost_code: "FUEL", amount_cents: 12000 },
            { job_id: jobB, cost_code: "FUEL", amount_cents: 8000 },
          ],
        }),
        owner,
      ],
    );
    const raw = await read(owner);
    const result = reconcileCosts(raw, { company_id: company, job_id: jobA });
    expect(result.coverage.state).toBe("checked");
    expect(result.findings.find((f) => f.code === "ap_unmatched")?.amount_cents).toBe("6000");
    expect(result.findings.map((f) => f.code)).toContain("ap_pending_correction");
    expect(JSON.stringify(result)).not.toContain("Synthetic Employee");
    expect((await read(pm)).records).toEqual([]);
    await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
      jobB,
      pm,
      owner,
    ]);
    expect((await read(pm)).records.map((r) => r.id)).toContain(p.id);
    for (const user of [estimator, superUser, outsider])
      await expect(read(user)).rejects.toThrow(/Full project access/);
    await expect(read(owner, otherJob)).rejects.toThrow(/Full project access/);
    const bad = { ...raw, records: [{ ...raw.records[0], posted_version: "unsupported" }] };
    expect(reconcileCosts(bad, { company_id: company, job_id: jobA }).coverage.state).toBe(
      "unavailable",
    );
    expect(reconcileCosts(null, { company_id: company, job_id: jobA }).coverage.state).toBe(
      "unavailable",
    );
  });
});
