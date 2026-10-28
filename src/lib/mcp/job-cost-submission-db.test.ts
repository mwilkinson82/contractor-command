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
  return rawQuery(user, sql.replace("($1,$2::jsonb)", "($1,$2::jsonb,$3,true)"), [...args, review]);
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
    .value as { records: Array<{ id: string; versions: unknown[] }>; posting_available: boolean };
const makeFacts = () => ({
  kind: "reimbursable_expense",
  description: "Fuel",
  counterparty_name: "Synthetic Employee",
  incurred_on: "2026-10-28",
  currency_code: "USD",
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
  await db.exec(readFileSync("docs/athena/job-cost-submission.schema-draft.sql", "utf8"));
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
    expect((await read(owner)).posting_available).toBe(true);
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
    for (const table of [
      "mcp_cost_payment_evidence",
      "mcp_cost_shared_payments",
      "mcp_cost_shared_allocations",
      "mcp_cost_payment_corrections",
    ]) {
      await expect(query(pm, `SELECT * FROM public.${table}`)).rejects.toThrow(/permission denied/);
    }
    await expect(
      query(pm, "SELECT public.mcp_cost_active_paid($1)", [ownerRecord.id]),
    ).rejects.toThrow(/permission denied/);
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
  it("enforces accounting roles and fails closed on unknown authority while exercising transitions", async () => {
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
      ...(actionName === "post" ? { accounting_effective_on: "2026-10-28" } : {}),
      id: p.id,
      request_id: crypto.randomUUID(),
      expected_version: 1,
      ...extra,
    });
    await expect(
      query(pm, "SELECT public.mcp_cost_accounting_action($1,$2::jsonb) AS value", [
        jobA,
        JSON.stringify(cmd("approve")),
      ]),
    ).rejects.toThrow(/not available/);
    await db.exec(
      "CREATE OR REPLACE FUNCTION public.mcp_cost_accounting_authorized(_company uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT NULL::boolean $$;",
    );
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
      await approveJob(p.id, jobA, 1, 6000);
      await approveJob(p.id, jobB, 1, 4000);
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
        posting_events: Array<{ version: number; posted_by: string; posted_at: string }>;
        settlement_allocation_available: boolean;
      };
      expect(current.posted_version).toBe(1);
      expect(current.payments).toHaveLength(1);
      expect(current.posting_events).toEqual([
        expect.objectContaining({ version: 1, posted_by: owner, posted_at: expect.any(String) }),
      ]);
      expect(current.settlement_allocation_available).toBe(false);
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
        posting_events: Array<{ version: number; posted_at: string }>;
      };
      expect(after.posted_version).toBe(4);
      expect(after.posting_events.map((e) => e.version)).toEqual([1, 4]);
      expect(after.posting_events.every((e) => !Number.isNaN(Date.parse(e.posted_at)))).toBe(true);
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
        ...(actionName === "post" ? { accounting_effective_on: "2026-10-28" } : {}),
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
        "CREATE OR REPLACE FUNCTION public.mcp_cost_accounting_authorized(_company uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.mcp_company_members m WHERE m.company_id=_company AND m.user_id=auth.uid() AND m.role IN ('owner','ap') AND public.mcp_role_allowed(m.company_id,m.role)) $$;",
      );
    }
  });
  it("conserves a shared payment and safely corrects the whole evidence entry", async () => {
    const a = makePayload();
    a.facts.document_reference = "Shared A";
    a.facts.allocations = [{ job_id: jobA, cost_code: "FUEL", amount_cents: 10000 }];
    const b = makePayload();
    b.facts.document_reference = "Shared B";
    b.facts.allocations = [{ job_id: jobB, cost_code: "FUEL", amount_cents: 10000 }];
    await save(owner, a);
    await save(owner, b);
    await db.exec(
      "CREATE OR REPLACE FUNCTION public.mcp_cost_accounting_authorized(_company uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT true $$;",
    );
    const accounting = async (id: string, action: string) =>
      query(owner, "SELECT public.mcp_cost_accounting_action($1,$2::jsonb)", [
        jobA,
        JSON.stringify({
          id,
          action,
          request_id: crypto.randomUUID(),
          expected_version: 1,
          ...(action === "post" ? { accounting_effective_on: "2026-10-28" } : {}),
        }),
      ]);
    const settlement = async (user: string, p: object) =>
      (
        await query(user, "SELECT public.mcp_cost_settlement_action($1,$2::jsonb) AS value", [
          jobA,
          JSON.stringify(p),
        ])
      ).rows[0].value as Record<string, unknown>;
    try {
      await accounting(a.id, "approve");
      await accounting(a.id, "post");
      await accounting(b.id, "approve");
      await accounting(b.id, "post");
      await approveJob(a.id, jobA, 1, 10000);
      await approveJob(b.id, jobB, 1, 10000);
      const shared = {
        action: "shared_payment",
        id: a.id,
        request_id: crypto.randomUUID(),
        payment_id: crypto.randomUUID(),
        amount_cents: 12000,
        paid_on: "2026-10-29",
        reference: "shared check",
        allocations: [
          { record_id: a.id, expected_version: 1, amount_cents: 7000 },
          { record_id: b.id, expected_version: 1, amount_cents: 5000 },
        ],
      };
      await expect(settlement(owner, { ...shared, amount_cents: 11999 })).rejects.toThrow(/equal/);
      await expect(settlement(pm, shared)).rejects.toThrow(/full project access/);
      await expect(settlement(owner, shared)).rejects.toThrow(/identity is not validated/);
      // TEST ONLY: the production draft cannot trust matching names as an identity.
      await db.exec(
        "CREATE OR REPLACE FUNCTION public.mcp_cost_shared_identity_validated(_company uuid,_records uuid[]) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT true $$;",
      );
      expect((await settlement(owner, shared)).status).toBe("payment_recorded");
      expect((await settlement(owner, shared)).already_applied).toBe(true);
      await expect(settlement(owner, { ...shared, amount_cents: 1 })).rejects.toThrow(
        /different content/,
      );
      const row = (await read(owner)).records.find((r) => r.id === a.id) as unknown as {
        active_settlement_cents: number;
        payments: Array<{ amount_cents: number; corrected: boolean }>;
      };
      expect(row.active_settlement_cents).toBe(7000);
      expect(row.payments[0]).toMatchObject({ amount_cents: 7000, corrected: false });
      const pmRow = (await read(pm)).records.find((r) => r.id === a.id) as unknown as {
        payments: Array<Record<string, unknown>>;
      };
      expect(pmRow.payments[0].amount_cents).toBe(7000);
      expect(pmRow.payments[0]).not.toHaveProperty("company_id");
      const duplicate = {
        ...shared,
        id: a.id,
        request_id: crypto.randomUUID(),
        payment_id: crypto.randomUUID(),
      };
      await expect(settlement(owner, duplicate)).rejects.toThrow(/duplicate payment/);
      const correction = {
        action: "correct_payment",
        id: a.id,
        request_id: crypto.randomUUID(),
        payment_id: shared.payment_id,
        correction_id: crypto.randomUUID(),
        reason: "Entered in error",
      };
      await expect(settlement(pm, correction)).rejects.toThrow(/full project access/);
      expect((await settlement(owner, correction)).status).toBe("evidence_corrected");
      expect((await settlement(owner, correction)).already_applied).toBe(true);
      const after = (await read(owner)).records.find((r) => r.id === a.id) as unknown as {
        active_settlement_cents: number;
        payments: Array<{ corrected: boolean }>;
      };
      expect(after.active_settlement_cents).toBe(0);
      expect(after.payments[0].corrected).toBe(true);
      expect((await settlement(owner, duplicate)).status).toBe("payment_recorded");
    } finally {
      await db.exec(
        "CREATE OR REPLACE FUNCTION public.mcp_cost_shared_identity_validated(_company uuid,_records uuid[]) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT false $$;",
      );
      await db.exec(
        "CREATE OR REPLACE FUNCTION public.mcp_cost_accounting_authorized(_company uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.mcp_company_members m WHERE m.company_id=_company AND m.user_id=auth.uid() AND m.role IN ('owner','ap') AND public.mcp_role_allowed(m.company_id,m.role)) $$;",
      );
    }
  });
  it("serializes competing settlement entries and corrects a single erroneous entry", async () => {
    const p = makePayload();
    p.facts.document_reference = "Concurrent receipt";
    await save(owner, p);
    await db.exec(
      "CREATE OR REPLACE FUNCTION public.mcp_cost_accounting_authorized(_company uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT true $$;",
    );
    const action = async (body: object) =>
      (
        await query(owner, "SELECT public.mcp_cost_accounting_action($1,$2::jsonb) AS value", [
          jobA,
          JSON.stringify(body),
        ])
      ).rows[0].value as Record<string, unknown>;
    const settlement = async (body: object) =>
      (
        await query(owner, "SELECT public.mcp_cost_settlement_action($1,$2::jsonb) AS value", [
          jobA,
          JSON.stringify(body),
        ])
      ).rows[0].value as Record<string, unknown>;
    const cmd = (name: string, extra: Record<string, unknown> = {}) => ({
      action: name,
      ...(name === "post" ? { accounting_effective_on: "2026-10-28" } : {}),
      id: p.id,
      request_id: crypto.randomUUID(),
      expected_version: 1,
      ...extra,
    });
    try {
      await action(cmd("approve"));
      await action(cmd("post"));
      await approveJob(p.id, jobA, 1, 6000);
      await approveJob(p.id, jobB, 1, 4000);
      const firstId = crypto.randomUUID();
      const secondId = crypto.randomUUID();
      const first = cmd("payment", {
        payment_id: firstId,
        amount_cents: 6000,
        paid_on: "2026-10-29",
        reference: "attempt 1",
      });
      const second = cmd("payment", {
        payment_id: secondId,
        amount_cents: 6000,
        paid_on: "2026-10-29",
        reference: "attempt 2",
      });
      const results = await Promise.allSettled([action(first), action(second)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      const winnerId = results[0].status === "fulfilled" ? firstId : secondId;
      const correction = {
        action: "correct_payment",
        id: p.id,
        request_id: crypto.randomUUID(),
        payment_id: winnerId,
        correction_id: crypto.randomUUID(),
        reason: "Duplicate entry; no bank reversal",
      };
      expect((await settlement(correction)).status).toBe("evidence_corrected");
      expect((await settlement(correction)).already_applied).toBe(true);
      const state = (await read(owner)).records.find((r) => r.id === p.id) as unknown as {
        active_settlement_cents: number;
        payments: Array<{ corrected: boolean; correction: { reason: string } }>;
      };
      expect(state.active_settlement_cents).toBe(0);
      expect(state.payments[0].corrected).toBe(true);
      expect(state.payments[0].correction.reason).toContain("no bank reversal");
    } finally {
      await db.exec(
        "CREATE OR REPLACE FUNCTION public.mcp_cost_accounting_authorized(_company uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.mcp_company_members m WHERE m.company_id=_company AND m.user_id=auth.uid() AND m.role IN ('owner','ap') AND public.mcp_role_allowed(m.company_id,m.role)) $$;",
      );
    }
  });
  it("requires separate job-specific PM approval for each split before AP records payment", async () => {
    const p = makePayload();
    p.facts.kind = "supplier_bill";
    p.facts.document_reference = "PM split fixture";
    await save(owner, p);
    const accounting = async (user: string, action: string, extra: Record<string, unknown> = {}) =>
      (
        await query(user, "SELECT public.mcp_cost_accounting_action($1,$2::jsonb) AS value", [
          jobA,
          JSON.stringify({
            action,
            ...(action === "post" ? { accounting_effective_on: "2026-10-28" } : {}),
            id: p.id,
            request_id: crypto.randomUUID(),
            expected_version: 1,
            ...extra,
          }),
        ])
      ).rows[0].value as Record<string, unknown>;
    await expect(accounting(pm, "approve")).rejects.toThrow(/not available/);
    expect((await accounting(ap, "approve")).status).toBe("approved");
    expect((await accounting(ap, "post")).status).toBe("posted");
    const payment = {
      payment_id: crypto.randomUUID(),
      amount_cents: 1000,
      paid_on: "2026-10-29",
      reference: "PM split check",
    };
    await expect(accounting(ap, "payment", payment)).rejects.toThrow(/PM approval/);
    const pmView = (await rawQuery(pm, "SELECT public.mcp_cost_pm_review($1) AS value", [jobA]))
      .rows[0].value as {
      records: Array<{
        id: string;
        allocations: Array<{ amount_cents: number }>;
        bill_total_cents?: number;
      }>;
    };
    const visible = pmView.records.find((r) => r.id === p.id)!;
    expect(visible.allocations).toHaveLength(1);
    expect(visible.allocations[0].amount_cents).toBe(6000);
    expect(visible).not.toHaveProperty("bill_total_cents");
    const approve = async (user: string, job: string, basis: string, notes?: string) =>
      (
        await query(user, "SELECT public.mcp_cost_pm_approve($1,$2::jsonb) AS value", [
          job,
          JSON.stringify({
            id: p.id,
            request_id: crypto.randomUUID(),
            expected_version: 1,
            allocated_cents: job === jobA ? 6000 : 4000,
            basis,
            notes,
          }),
        ])
      ).rows[0].value;
    await expect(approve(ap, jobA, "work_verified")).rejects.toThrow(/PM or owner/);
    await expect(approve(allAccess, jobA, "work_verified")).rejects.toThrow(/PM or owner/);
    await expect(approve(pm, jobB, "work_verified")).rejects.toThrow(/Full project/);
    await expect(approve(pm, jobA, "deposit")).rejects.toThrow(/Explain/);
    expect(
      (
        (await approve(pm, jobA, "deposit", "Deposit needed for delivery")) as {
          status: string;
        }
      ).status,
    ).toBe("pm_approved_for_payment");
    await expect(accounting(ap, "payment", payment)).rejects.toThrow(/PM approval/);
    await expect(approve(owner, jobB, "owner_exception")).rejects.toThrow(/Explain/);
    await approve(owner, jobB, "owner_exception", "Owner reviewed second job");
    expect((await accounting(ap, "payment", payment)).status).toBe("payment_recorded");
    const correction = {
      ...p,
      request_id: crypto.randomUUID(),
      expected_version: 1,
      reason: "Correct amount",
      facts: {
        ...p.facts,
        amount_cents: 11000,
        allocations: [
          { job_id: jobA, cost_code: "FUEL", amount_cents: 7000 },
          { job_id: jobB, cost_code: "FUEL", amount_cents: 4000 },
        ],
      },
    };
    await save(owner, correction);
    await accounting(ap, "approve", { expected_version: 2 });
    await accounting(ap, "post", { expected_version: 2 });
    await expect(
      accounting(ap, "payment", {
        ...payment,
        payment_id: crypto.randomUUID(),
        reference: "PM split new",
        expected_version: 2,
      }),
    ).rejects.toThrow(/PM approval/);
  });
  it("withdraws a PM approval without erasing prior payments and requires renewed coverage", async () => {
    const p = makePayload();
    p.facts.kind = "supplier_bill";
    p.facts.document_reference = "Withdrawal fixture";
    p.facts.allocations = [{ job_id: jobA, cost_code: "FUEL", amount_cents: 10000 }];
    await save(owner, p);
    const accounting = async (action: string, extra: Record<string, unknown> = {}) =>
      (
        await query(ap, "SELECT public.mcp_cost_accounting_action($1,$2::jsonb) AS value", [
          jobA,
          JSON.stringify({
            action,
            ...(action === "post" ? { accounting_effective_on: "2026-10-28" } : {}),
            id: p.id,
            request_id: crypto.randomUUID(),
            expected_version: 1,
            ...extra,
          }),
        ])
      ).rows[0].value;
    const approve = async () =>
      query(pm, "SELECT public.mcp_cost_pm_approve($1,$2::jsonb) AS value", [
        jobA,
        JSON.stringify({
          id: p.id,
          request_id: crypto.randomUUID(),
          expected_version: 1,
          allocated_cents: 10000,
          basis: "work_verified",
        }),
      ]);
    const active = async () =>
      (
        (await rawQuery(pm, "SELECT public.mcp_cost_pm_review($1) AS value", [jobA])).rows[0]
          .value as {
          records: Array<{
            id: string;
            approval: { id: string } | null;
            approval_history: unknown[];
          }>;
        }
      ).records.find((r) => r.id === p.id)!;
    const withdraw = async (user: string, approvalId: string, requestId = crypto.randomUUID()) =>
      (
        await query(user, "SELECT public.mcp_cost_pm_withdraw($1,$2::jsonb) AS value", [
          jobA,
          JSON.stringify({
            id: p.id,
            request_id: requestId,
            expected_version: 1,
            approval_id: approvalId,
            reason: "Work needs another review",
          }),
        ])
      ).rows[0].value as Record<string, unknown>;
    await accounting("approve");
    await accounting("post");
    await approve();
    const first = (await active()).approval!.id;
    await expect(withdraw(pm2, first)).rejects.toThrow(/Approval unavailable/);
    const request = crypto.randomUUID();
    expect((await withdraw(pm, first, request)).status).toBe("payment_approval_withdrawn");
    expect((await withdraw(pm, first, request)).already_applied).toBe(true);
    await expect(
      accounting("payment", {
        payment_id: crypto.randomUUID(),
        amount_cents: 1000,
        paid_on: "2026-10-29",
        reference: "withdrawal check",
      }),
    ).rejects.toThrow(/PM approval/);
    await approve();
    const second = (await active()).approval!.id;
    expect(second).not.toBe(first);
    await accounting("payment", {
      payment_id: crypto.randomUUID(),
      amount_cents: 1000,
      paid_on: "2026-10-29",
      reference: "withdrawal check",
    });
    await withdraw(pm, second);
    const row = (await read(owner)).records.find((r) => r.id === p.id) as unknown as {
      active_settlement_cents: number;
      payments: unknown[];
    };
    expect(row.active_settlement_cents).toBe(1000);
    expect(row.payments).toHaveLength(1);
    expect((await active()).approval).toBeNull();
    expect((await active()).approval_history).toHaveLength(2);
    await expect(
      accounting("payment", {
        payment_id: crypto.randomUUID(),
        amount_cents: 1,
        paid_on: "2026-10-29",
        reference: "later check",
      }),
    ).rejects.toThrow(/PM approval/);
  });
  it("lets assigned superintendents submit and see only their own field entries", async () => {
    const single = {
      ...makeFacts(),
      kind: "reimbursable_expense",
      counterparty_name: "Member",
      document_reference: "Field receipt",
      allocations: [{ job_id: jobA, cost_code: "FUEL", amount_cents: 10000 }],
    };
    const p = { ...makePayload(), facts: single };
    const submit = async (user: string, job: string, data: object) =>
      (
        await query(user, "SELECT public.mcp_cost_field_submit($1,$2::jsonb) AS value", [
          job,
          JSON.stringify(data),
        ])
      ).rows[0].value as Record<string, unknown>;
    const own = async (user: string, job: string) =>
      (await rawQuery(user, "SELECT public.mcp_cost_field_own_read($1) AS value", [job])).rows[0]
        .value as { submissions: Array<{ id: string; facts: Record<string, unknown> }> };
    expect((await submit(superUser, jobA, p)).status).toBe("submitted");
    expect((await submit(superUser, jobA, p)).already_applied).toBe(true);
    expect((await own(superUser, jobA)).submissions.map((r) => r.id)).toContain(p.id);
    expect((await own(super2, jobA)).submissions).toEqual([]);
    expect((await read(owner)).records.some((r) => r.id === p.id)).toBe(true);
    await expect(own(superUser, jobB)).rejects.toThrow(/superintendent/);
    await expect(
      rawQuery(superUser, "SELECT public.mcp_cost_submission_read($1)", [jobA]),
    ).rejects.toThrow(/Full project/);
    await expect(rawQuery(superUser, "SELECT * FROM public.mcp_cost_submissions")).rejects.toThrow(
      /permission denied/,
    );
    expect(
      (
        await submit(superUser, jobA, {
          ...makePayload(),
          facts: {
            ...single,
            counterparty_name: "Another employee",
            document_reference: "other payee",
          },
        })
      ).status,
    ).toBe("submitted");
    await expect(
      submit(superUser, jobA, {
        ...makePayload(),
        facts: { ...single, kind: "supplier_bill", document_reference: "bill" },
      }),
    ).rejects.toThrow(/expense type/);
    await expect(
      submit(superUser, jobA, {
        ...makePayload(),
        facts: { ...single, original: "stored", document_reference: "upload" },
      }),
    ).rejects.toThrow(/missing original/);
    await expect(
      submit(superUser, jobA, {
        ...makePayload(),
        facts: {
          ...single,
          allocations: [{ job_id: jobB, cost_code: "FUEL", amount_cents: 10000 }],
          document_reference: "other job",
        },
      }),
    ).rejects.toThrow(/assigned job/);
    await expect(submit(super2, jobA, p)).rejects.toThrow(/different content/);
    const secondSuper = {
      ...makePayload(),
      facts: { ...single, document_reference: "Second super receipt" },
    };
    await submit(super2, jobA, secondSuper);
    expect((await own(super2, jobA)).submissions.map((r) => r.id)).toEqual([secondSuper.id]);
    expect((await own(superUser, jobA)).submissions.some((r) => r.id === secondSuper.id)).toBe(
      false,
    );
    await db.query("DELETE FROM public.mcp_job_access WHERE job_id=$1 AND user_id=$2", [
      jobA,
      super2,
    ]);
    await expect(own(super2, jobA)).rejects.toThrow(/superintendent/);
  });
  it("requires a server review bound to actor, exact payload, purpose and expiry", async () => {
    const p = makePayload();
    p.facts.document_reference = "Ticket fixture";
    const prepare = async (user: string, purpose: string, data: object) =>
      (
        await rawQuery(user, "SELECT public.mcp_cost_review_prepare($1,$2,$3::jsonb) AS value", [
          jobA,
          purpose,
          JSON.stringify(data),
        ])
      ).rows[0].value as { review_id: string };
    const write = async (user: string, data: object, ticket: string | null) =>
      (
        await rawQuery(
          user,
          "SELECT public.mcp_cost_submission_save($1,$2::jsonb,$3::uuid,true) AS value",
          [jobA, JSON.stringify(data), ticket],
        )
      ).rows[0].value;
    await expect(write(owner, p, null)).rejects.toThrow(/Review the exact action/);
    const ticket = await prepare(owner, "submission", p);
    await expect(
      write(owner, { ...p, facts: { ...p.facts, description: "changed" } }, ticket.review_id),
    ).rejects.toThrow(/Review the exact action/);
    await expect(write(ap, p, ticket.review_id)).rejects.toThrow(/Review the exact action/);
    const otherJobTicket = (
      await rawQuery(owner, "SELECT public.mcp_cost_review_prepare($1,$2,$3::jsonb) AS value", [
        jobB,
        "submission",
        JSON.stringify(p),
      ])
    ).rows[0].value as { review_id: string };
    await expect(write(owner, p, otherJobTicket.review_id)).rejects.toThrow(
      /Review the exact action/,
    );
    const wrongPurpose = crypto.randomUUID();
    await db.query(
      "INSERT INTO public.mcp_cost_review_tickets(id,company_id,job_id,actor_id,purpose,payload) VALUES($1,$2,$3,$4,'accounting',$5::jsonb)",
      [wrongPurpose, company, jobA, owner, JSON.stringify(p)],
    );
    await expect(write(owner, p, wrongPurpose)).rejects.toThrow(/Review the exact action/);
    await expect(
      prepare(owner, "submission", { ...p, facts: { ...p.facts, file_bytes: "not allowed" } }),
    ).rejects.toThrow(/Invalid review metadata/);
    await db.query(
      "UPDATE public.mcp_cost_review_tickets SET expires_at=now()-interval '1 second' WHERE id=$1",
      [ticket.review_id],
    );
    await expect(write(owner, p, ticket.review_id)).rejects.toThrow(/Review the exact action/);
    const valid = await prepare(owner, "submission", p);
    await expect(
      rawQuery(owner, "SELECT public.mcp_cost_submission_save($1,$2::jsonb,$3::uuid,false)", [
        jobA,
        JSON.stringify(p),
        valid.review_id,
      ]),
    ).rejects.toThrow(/Confirm the reviewed action/);
    expect(((await write(owner, p, valid.review_id)) as { version: number }).version).toBe(1);
    expect(
      ((await write(owner, p, valid.review_id)) as { already_applied: boolean }).already_applied,
    ).toBe(true);
    await expect(
      write(
        owner,
        { ...p, id: crypto.randomUUID(), request_id: crypto.randomUUID() },
        valid.review_id,
      ),
    ).rejects.toThrow(/Review the exact action/);
    await expect(rawQuery(owner, "SELECT * FROM public.mcp_cost_review_tickets")).rejects.toThrow(
      /permission denied/,
    );
  });
  it("rejects unverified PO or supplier IDs and attachment claims", async () => {
    for (const patch of [
      { party_id: crypto.randomUUID() },
      {
        party_id: crypto.randomUUID(),
        purchase_order_id: crypto.randomUUID(),
        purchase_order_version: 1,
      },
    ])
      await expect(
        save(owner, {
          ...makePayload(),
          facts: {
            ...makeFacts(),
            kind: "supplier_bill",
            allocations: [{ job_id: jobA, cost_code: "FUEL", amount_cents: 10000 }],
            ...patch,
          },
        }),
      ).rejects.toThrow(/links are not available/);
    await expect(
      save(owner, { ...makePayload(), facts: { ...makeFacts(), original: "stored" } }),
    ).rejects.toThrow(/missing original/);
  });
  it("validates project-linked party and exact PO revisions against the staged PO schema", async () => {
    const party = crypto.randomUUID(),
      otherParty = crypto.randomUUID(),
      wrongJobParty = crypto.randomUUID(),
      po = crypto.randomUUID(),
      foreignPo = crypto.randomUUID(),
      terms = crypto.randomUUID();
    await db.exec(readFileSync("tests/fixtures/purchase-order-contract.sql", "utf8"));
    await db.query(
      "INSERT INTO public.mcp_project_parties(id,company_id,job_id,name,kind,created_by) VALUES ($1,$2,$3,'Synthetic Supplier','supplier',$7),($4,$2,$3,'Different Supplier','supplier',$7),($5,$2,$6,'Other Job Supplier','supplier',$7)",
      [party, company, jobA, otherParty, wrongJobParty, jobB, owner],
    );
    await db.query(
      "INSERT INTO public.mcp_po_terms_versions(id,company_id,scope,state,title,body,source,approved_by,created_by) VALUES ($1,$2,'company','approved','Terms','Synthetic terms','fixture',$3,$3)",
      [terms, company, owner],
    );
    await db.query(
      "INSERT INTO public.mcp_purchase_orders(id,company_id,job_id,party_id,number,created_by) VALUES ($1,$2,$3,$4,'PO-1',$8),($5,$6,$7,$4,'Foreign',$8)",
      [po, company, jobA, party, foreignPo, otherCompany, otherJob, owner],
    );
    await db.query(
      "INSERT INTO public.mcp_purchase_order_versions(po_id,version,status,terms_id,party_snapshot,lines,order_date,needed_by,created_by) VALUES ($1,1,'draft',$4,jsonb_build_object('id',$2::text),'[]','2026-10-28','2026-11-01',$5),($3,1,'draft',$4,jsonb_build_object('id',$2::text),'[]','2026-10-28','2026-11-01',$5),($1,2,'draft',$4,jsonb_build_object('id',$6::text),'[]','2026-10-28','2026-11-01',$5)",
      [po, party, foreignPo, terms, owner, otherParty],
    );
    const f = {
      ...makeFacts(),
      kind: "supplier_bill",
      document_reference: "Linked bill",
      allocations: [{ job_id: jobA, cost_code: "MATERIAL", amount_cents: 10000 }],
    };
    expect(
      (
        await save(owner, {
          ...makePayload(),
          facts: { ...f, party_id: party, purchase_order_id: po, purchase_order_version: 1 },
        })
      ).status,
    ).toBe("submitted");
    for (const patch of [
      { party_id: wrongJobParty },
      { party_id: party, purchase_order_id: foreignPo, purchase_order_version: 1 },
      { party_id: otherParty, purchase_order_id: po, purchase_order_version: 1 },
      { party_id: party, purchase_order_id: po, purchase_order_version: 9 },
      { party_id: party, purchase_order_id: po, purchase_order_version: 2 },
    ])
      await expect(
        save(owner, {
          ...makePayload(),
          facts: { ...f, document_reference: crypto.randomUUID(), ...patch },
        }),
      ).rejects.toThrow(/unavailable/);
    await expect(
      save(owner, {
        ...makePayload(),
        facts: {
          ...makeFacts(),
          kind: "supplier_bill",
          document_reference: "Split linked",
          party_id: party,
        },
      }),
    ).rejects.toThrow(/cannot apply to other jobs/);
    await expect(
      query(owner, "SELECT public.mcp_cost_validate_project_refs($1,$2,$3,$4,1)", [
        company,
        jobA,
        party,
        po,
      ]),
    ).rejects.toThrow(/permission denied/);
  });
});
