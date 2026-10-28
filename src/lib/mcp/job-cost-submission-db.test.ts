import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
const owner = "00000000-0000-4000-8000-000000000111",
  pm = "00000000-0000-4000-8000-000000000112",
  estimator = "00000000-0000-4000-8000-000000000113",
  superUser = "00000000-0000-4000-8000-000000000114",
  outsider = "00000000-0000-4000-8000-000000000115",
  ap = "00000000-0000-4000-8000-000000000116",
  allAccess = "00000000-0000-4000-8000-000000000117";
const company = "00000000-0000-4000-8000-000000000121",
  otherCompany = "00000000-0000-4000-8000-000000000122",
  jobA = "00000000-0000-4000-8000-000000000131",
  jobB = "00000000-0000-4000-8000-000000000132",
  otherJob = "00000000-0000-4000-8000-000000000133";
let db: PGlite;
const query = (user: string, sql: string, args: unknown[] = []) =>
  asUser(
    db,
    { sub: user, email: "synthetic@example.test", role: "authenticated" },
    (tx) => tx.query(sql, args) as Promise<{ rows: Array<{ value: unknown }> }>,
  );
const save = async (user: string, p: object) =>
  (
    await query(user, "SELECT public.mcp_cost_submission_save($1,$2::jsonb) AS value", [
      jobA,
      JSON.stringify(p),
    ])
  ).rows[0].value as Record<string, unknown>;
const read = async (user: string, job = jobA) =>
  (await query(user, "SELECT public.mcp_cost_submission_read($1) AS value", [job])).rows[0]
    .value as { records: Array<{ id: string; versions: unknown[] }>; posting_available: boolean };
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
  for (const u of [owner, pm, estimator, superUser, outsider, ap, allAccess]) {
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
    [ap, "ap"],
    [allAccess, "all_access"],
    [estimator, "estimating"],
    [superUser, "super"],
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
  for (const u of [pm, superUser])
    await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES ($1,$2,$3)", [
      jobA,
      u,
      owner,
    ]);
}, 30000);
afterAll(async () => db?.close());
describe("staged job cost submission SQL", () => {
  it("persists split facts once, limits retries and detects historical references", async () => {
    const p = makePayload();
    expect((await save(owner, p)).version).toBe(1);
    expect((await save(owner, p)).already_applied).toBe(true);
    await expect(
      save(owner, { ...p, facts: { ...p.facts, description: "Different" } }),
    ).rejects.toThrow(/different content/);
    await expect(
      save(owner, {
        ...makePayload(),
        facts: { ...makeFacts(), document_reference: " receipt 1 " },
      }),
    ).rejects.toThrow(/Duplicate/);
    expect((await read(owner)).records.find((r) => r.id === p.id)?.versions).toHaveLength(1);
    expect((await read(owner)).posting_available).toBe(false);
    await expect(
      save(owner, {
        ...p,
        request_id: crypto.randomUUID(),
        expected_version: 1,
        reason: "Fix",
        facts: { ...p.facts, amount_cents: 1 },
      }),
    ).rejects.toThrow(/equal/);
    const revised = {
      ...p,
      request_id: crypto.randomUUID(),
      expected_version: 1,
      reason: "Correct description",
      facts: { ...p.facts, description: "Gas" },
    };
    expect((await save(owner, revised)).version).toBe(2);
    await expect(save(owner, { ...revised, request_id: crypto.randomUUID() })).rejects.toThrow(
      /version/,
    );
    expect((await read(owner)).records.find((r) => r.id === p.id)?.versions).toHaveLength(2);
  });
  it("enforces the actual membership gate and all historical and proposed job scopes", async () => {
    const p = makePayload();
    await expect(save(pm, p)).rejects.toThrow(/every allocated/);
    await expect(save(estimator, p)).rejects.toThrow(/Full project/);
    await expect(save(superUser, p)).rejects.toThrow(/Full project/);
    await expect(save(outsider, p)).rejects.toThrow(/Full project/);
    const foreign = {
      ...p,
      facts: {
        ...p.facts,
        allocations: [{ job_id: otherJob, cost_code: "X", amount_cents: 10000 }],
      },
    };
    await expect(save(owner, foreign)).rejects.toThrow(/every allocated/);
    const ownerRecord = { ...p, facts: { ...p.facts, document_reference: "receipt 2" } };
    await save(owner, ownerRecord);
    expect((await read(pm)).records).toEqual([]);
    await expect(
      save(pm, {
        ...ownerRecord,
        request_id: crypto.randomUUID(),
        expected_version: 1,
        reason: "Correction",
        facts: {
          ...ownerRecord.facts,
          allocations: [{ job_id: jobA, cost_code: "X", amount_cents: 10000 }],
        },
      }),
    ).rejects.toThrow(/unavailable/);
    await expect(query(pm, "SELECT * FROM public.mcp_cost_submissions")).rejects.toThrow(
      /permission denied/,
    );
    await db.query("DELETE FROM test_active_members WHERE user_id IN ($1,$2)", [pm, owner]);
    await db.query("DELETE FROM mcp_gate_cache WHERE user_id IN ($1,$2)", [pm, owner]);
    await expect(read(pm)).rejects.toThrow(/MCP_INACTIVE/);
    for (const u of [pm, owner]) await db.query("INSERT INTO test_active_members VALUES ($1)", [u]);
    await db.query("DELETE FROM mcp_gate_cache WHERE user_id IN ($1,$2)", [pm, owner]);
  });
  it("permits only existing full-scope roles to submit and read", async () => {
    for (const user of [pm, ap, allAccess]) {
      const p = makePayload();
      p.facts.document_reference = `unique ${user}`;
      p.facts.allocations = [{ job_id: jobA, cost_code: "FUEL", amount_cents: 10000 }];
      expect((await save(user, p)).status).toBe("submitted");
      expect((await read(user)).records.some((r) => r.id === p.id)).toBe(true);
    }
  });
  it("keeps accounting actions disabled by default and exercises the transition contract with a synthetic authority hook", async () => {
    const p = makePayload();
    p.facts.document_reference = "Transition receipt";
    await save(owner, p);
    const action = async (body: object) =>
      (
        await query(owner, "SELECT public.mcp_cost_accounting_action($1,$2::jsonb) AS value", [
          jobA,
          JSON.stringify(body),
        ])
      ).rows[0].value as Record<string, unknown>;
    const cmd = (actionName: string, extra: Record<string, unknown> = {}) => ({
      action: actionName,
      id: p.id,
      request_id: crypto.randomUUID(),
      expected_version: 1,
      ...extra,
    });
    await expect(action(cmd("approve"))).rejects.toThrow(/not available/);
    // TEST ONLY: production draft remains fail-closed until an authorized policy is chosen.
    await db.exec(
      "CREATE OR REPLACE FUNCTION public.mcp_cost_accounting_authorized(_company uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT true $$;",
    );
    try {
      await expect(action(cmd("post"))).rejects.toThrow(/Approval/);
      const approval = cmd("approve");
      expect((await action(approval)).status).toBe("approved");
      expect((await action(approval)).already_applied).toBe(true);
      const posting = cmd("post");
      expect((await action(posting)).status).toBe("posted");
      const payment = cmd("payment", {
        payment_id: crypto.randomUUID(),
        amount_cents: 4000,
        paid_on: "2026-10-29",
        reference: "check 1",
      });
      expect((await action(payment)).status).toBe("payment_recorded");
      expect((await action(payment)).already_applied).toBe(true);
      await expect(
        action(
          cmd("payment", {
            payment_id: crypto.randomUUID(),
            amount_cents: 6001,
            paid_on: "2026-10-29",
            reference: "check 2",
          }),
        ),
      ).rejects.toThrow(/exceeds/);
      await expect(
        action(
          cmd("payment", {
            payment_id: crypto.randomUUID(),
            amount_cents: 1,
            paid_on: "2026-10-29",
            reference: " CHECK 1 ",
          }),
        ),
      ).rejects.toThrow(/already recorded/);
      const revision = {
        ...p,
        request_id: crypto.randomUUID(),
        expected_version: 1,
        reason: "Correction",
        facts: {
          ...p.facts,
          amount_cents: 3000,
          allocations: [{ job_id: jobA, cost_code: "FUEL", amount_cents: 3000 }],
        },
      };
      await save(owner, revision);
      const current = (await read(owner)).records.find((r) => r.id === p.id) as unknown as {
        posted_version: number;
        payments: unknown[];
      };
      expect(current.posted_version).toBe(1);
      expect(current.payments).toHaveLength(1);
      await expect(
        action(
          cmd("payment", {
            expected_version: 2,
            payment_id: crypto.randomUUID(),
            amount_cents: 1,
            paid_on: "2026-10-29",
            reference: "check 3",
          }),
        ),
      ).rejects.toThrow(/pending correction/);
      await action(cmd("approve", { expected_version: 2 }));
      await expect(action(cmd("post", { expected_version: 2 }))).rejects.toThrow(/below recorded/);
      const changed = {
        ...revision,
        request_id: crypto.randomUUID(),
        expected_version: 2,
        reason: "Correct payee",
        facts: { ...p.facts, counterparty_name: "Different payee" },
      };
      await save(owner, changed);
      await action(cmd("approve", { expected_version: 3 }));
      await expect(action(cmd("post", { expected_version: 3 }))).rejects.toThrow(
        /changing the payee/,
      );
      const corrected = {
        ...p,
        request_id: crypto.randomUUID(),
        expected_version: 3,
        reason: "Correct amount",
        facts: {
          ...p.facts,
          amount_cents: 12000,
          allocations: [{ job_id: jobA, cost_code: "FUEL", amount_cents: 12000 }],
        },
      };
      await save(owner, corrected);
      await action(cmd("approve", { expected_version: 4 }));
      await action(cmd("post", { expected_version: 4 }));
      const after = (await read(owner)).records.find((r) => r.id === p.id) as unknown as {
        posted_version: number;
        payments: unknown[];
      };
      expect(after.posted_version).toBe(4);
      expect(after.payments).toHaveLength(1);
      const companyPaid = {
        ...makePayload(),
        facts: {
          ...makeFacts(),
          kind: "company_paid_expense",
          document_reference: "Company card receipt",
        },
      };
      await save(owner, companyPaid);
      const cp = (actionName: string, extra: Record<string, unknown> = {}) => ({
        action: actionName,
        id: companyPaid.id,
        request_id: crypto.randomUUID(),
        expected_version: 1,
        ...extra,
      });
      await action(cp("approve"));
      await action(cp("post"));
      await expect(
        action(
          cp("payment", {
            payment_id: crypto.randomUUID(),
            amount_cents: 1,
            paid_on: "2026-10-29",
            reference: "payment",
          }),
        ),
      ).rejects.toThrow(/no supplier payable/);
    } finally {
      await db.exec(
        "CREATE OR REPLACE FUNCTION public.mcp_cost_accounting_authorized(_company uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT false $$;",
      );
    }
  });
  it("rejects unverified PO or supplier IDs and attachment claims", async () => {
    for (const patch of [
      { party_id: crypto.randomUUID() },
      { purchase_order_id: crypto.randomUUID() },
    ])
      await expect(
        save(owner, { ...makePayload(), facts: { ...makeFacts(), ...patch } }),
      ).rejects.toThrow(/links are not available/);
    await expect(
      save(owner, { ...makePayload(), facts: { ...makeFacts(), original: "stored" } }),
    ).rejects.toThrow(/missing original/);
  });
});
