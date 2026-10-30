import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ToolError } from "@lovable.dev/mcp-js";
import type { PGlite } from "@electric-sql/pglite";
import { paymentCorrectionDb } from "../../../tests/payment-correction-db";
import { asUser, fakeClient } from "../../../tests/mcp-roles/fake-supabase";
import { reconcileApSnapshot } from "./ap-reconciliation-snapshot";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(9001),
  ap = id(9002),
  pm = id(9003),
  outsider = id(9004),
  superUser = id(9005),
  contracts = id(9006),
  locked = id(9007);
const company = id(9010),
  job = id(9011),
  otherJob = id(9012);
const ctxState = vi.hoisted(() => ({ sb: null as unknown }));
vi.mock("./guard", () => ({
  run: async (_n: string, _c: unknown, _o: unknown, fn: (sb: unknown) => unknown) =>
    fn(ctxState.sb),
  text: (text: string) => ({ content: [{ type: "text", text }] }),
  dbError: (e: { message: string }) => {
    if (e.message.startsWith("MCP_BAD:")) throw new ToolError(e.message.slice(8));
    throw new Error(e.message);
  },
}));
vi.mock("./jobs", () => ({
  resolveJob: async () => ({
    job_id: id(9011),
    company_id: id(9010),
    job_number: "CORR-LOCAL",
    scope: "full",
  }),
}));
import { jobCostPaymentCorrection } from "./tools/payment-correction-tools";
import { jobCostAccountingRecord } from "./tools/job-cost-submission-tools";
let db: PGlite;
// SQL/tool fixture envelopes have different RPC shapes; production inputs remain strict.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = Record<string, any>;
const query = (sql: string, values: unknown[] = [], user = owner) =>
  asUser(db, { sub: user, email: "synthetic@example.invalid", role: "authenticated" }, (tx) =>
    tx.query(sql, values),
  ) as Promise<{ rows: Data[] }>;
async function rpc(
  step: string,
  p: Data,
  user = owner,
  key: string | null = null,
  confirmed = false,
) {
  return (
    await query(
      "SELECT public.mcp_cost_payment_correction($1,$2,$3::jsonb,$4,$5) AS data",
      [job, step, JSON.stringify(p), key, confirmed],
      user,
    )
  ).rows[0].data as Data;
}
async function tool(args: Data, user = owner) {
  ctxState.sb = fakeClient(db, {
    sub: user,
    email: "synthetic@example.invalid",
    role: "authenticated",
  });
  return (
    jobCostPaymentCorrection as unknown as {
      handler: (
        args: Data,
        ctx: unknown,
      ) => Promise<{ content: Array<{ text: string }>; structuredContent: Data }>;
    }
  ).handler({ job_number: "CORR-LOCAL", ...args }, {}) as Promise<{
    content: Array<{ text: string }>;
    structuredContent: Data;
  }>;
}
async function fixture(total = 1000000, paid = 620000, j = job) {
  const record = crypto.randomUUID(),
    payment = crypto.randomUUID();
  const facts = {
    kind: "supplier_bill",
    description: "Electrical material",
    counterparty_name: "Synthetic Supply",
    incurred_on: "2026-10-01",
    currency_code: "USD",
    amount_cents: total,
    original: "missing",
    document_reference: crypto.randomUUID(),
    allocations: [{ job_id: j, cost_code: "26-100", amount_cents: total }],
  };
  await db.query(
    "INSERT INTO mcp_cost_submissions(id,company_id,anchor_job_id,kind,created_by) VALUES($1,$2,$3,'supplier_bill',$4)",
    [record, company, j, owner],
  );
  await db.query(
    "INSERT INTO mcp_cost_submission_versions(record_id,version,facts,recorded_by,recorded_at) VALUES($1,1,$2,$3,'2026-10-01T12:00:00Z')",
    [record, JSON.stringify(facts), owner],
  );
  await db.query("INSERT INTO mcp_cost_approvals(record_id,version,approved_by) VALUES($1,1,$2)", [
    record,
    owner,
  ]);
  await db.query(
    "INSERT INTO mcp_cost_posting_events(record_id,version,posted_by,posted_at,accounting_effective_on) VALUES($1,1,$2,'2026-10-01T12:00:00Z','2026-10-01')",
    [record, owner],
  );
  const approval = crypto.randomUUID();
  await db.query(
    "INSERT INTO mcp_cost_business_approvals(id,record_id,version,job_id,allocated_cents,bill_total_cents,basis,approved_by) VALUES($1,$2,1,$3,$4,$4,'owner_exception',$5)",
    [approval, record, j, total, owner],
  );
  if (paid)
    await db.query(
      "INSERT INTO mcp_cost_payment_evidence(id,record_id,amount_cents,paid_on,reference,recorded_by,recorded_at) VALUES($1,$2,$3,'2026-10-20',$4,$5,'2026-10-20T12:00:00Z')",
      [payment, record, paid, `CHECK-${payment}`, owner],
    );
  return { record, payment, facts, approval };
}
async function review(f: Awaited<ReturnType<typeof fixture>>, extra: Data = {}) {
  const read = await rpc("read", { id: f.record, payment_id: f.payment });
  return rpc("review", {
    id: f.record,
    payment_id: f.payment,
    expected_state: read.expected_state,
    mode: "replace",
    reason: "Correct transcription of check amount",
    revised: {
      amount_cents: 520000,
      paid_on: "2026-10-21",
      reference: read.state.payment.reference,
      allocations: [{ record_id: f.record, expected_version: 1, amount_cents: 520000 }],
    },
    ...extra,
  });
}
async function saved(r: Data, user = owner) {
  return rpc("save", r.payload, user, r.review_key, true);
}
beforeAll(async () => {
  db = await paymentCorrectionDb();
  await db.exec(
    "CREATE FUNCTION public.get_user_tier(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'circle'::text $$;",
  );
  for (const path of [
    "supabase/migrations/20261021190000_athena_team_invites.sql",
    "supabase/migrations/20261022120000_athena_account_team_privacy_terms.sql",
    "drizzle/migrations/0035_accounting_purchase_orders.sql",
    "drizzle/migrations/0036_accounting_ap.sql",
    "drizzle/migrations/0039_accounting_ap_snapshot.sql",
    "docs/athena/payment-correction-proposal.sql",
  ])
    await db.exec(readFileSync(path, "utf8"));
  for (const user of [owner, ap, pm, outsider, superUser, contracts, locked]) {
    await db.query("INSERT INTO auth.users VALUES($1,'synthetic@example.invalid')", [user]);
    if (user !== locked) await db.query("INSERT INTO test_active_members VALUES($1)", [user]);
  }
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Synthetic Correction Local Only',$2)",
    [company, owner],
  );
  for (const [u, role] of [
    [owner, "owner"],
    [ap, "ap"],
    [pm, "pm"],
    [superUser, "super"],
    [contracts, "contracts"],
  ])
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,'Synthetic')",
      [company, u, role],
    );
  for (const [j, num] of [
    [job, "CORR-LOCAL"],
    [otherJob, "CORR-RESTRICTED"],
  ])
    await db.query(
      "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name,restricted) VALUES($1,$2,$3,$4,'Synthetic correction',true)",
      [j, owner, company, num],
    );
  await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
    job,
    ap,
    owner,
  ]);
});
afterAll(async () => {
  await db?.close();
});
describe("recorded payment correction: real isolated PostgreSQL and mocked tool transport", () => {
  it("reviews before saving, preserves original identity and reconciles a partial payment", async () => {
    const f = await fixture();
    const read = await tool({ step: "read", id: f.record, payment_id: f.payment }, ap);
    expect(read.structuredContent.state.payment.id).toBe(f.payment);
    const r = await tool(
      {
        step: "review",
        id: f.record,
        payment_id: f.payment,
        expected_state: read.structuredContent.expected_state,
        mode: "replace",
        reason: "Amount was transcribed incorrectly",
        revised: {
          amount_cents: 520000,
          paid_on: "2026-10-21",
          reference: "REVISED-LOCAL",
          allocations: [{ record_id: f.record, expected_version: 1, amount_cents: 520000 }],
        },
      },
      ap,
    );
    expect(r.content[0].text).toContain("USD 6,200.00");
    expect(r.content[0].text).toContain("USD 5,200.00");
    expect(r.content[0].text).toContain("USD 4,800.00");
    expect(
      (
        await db.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM mcp_cost_payment_corrections WHERE payment_id=$1",
          [f.payment],
        )
      ).rows[0].n,
    ).toBe(0);
    await expect(
      tool(
        {
          step: "save",
          payload: r.structuredContent.payload,
          review_key: r.structuredContent.review_key,
        },
        ap,
      ),
    ).rejects.toThrow(/explicitly confirm/);
    const result = await tool(
      {
        step: "save",
        payload: r.structuredContent.payload,
        review_key: r.structuredContent.review_key,
        confirmed: true,
      },
      ap,
    );
    expect(result.structuredContent.result.payment_id).toBe(f.payment);
    expect(result.structuredContent.result.effects[0]).toMatchObject({
      prior_paid_cents: "620000",
      revised_paid_cents: "520000",
      revised_unpaid_cents: "480000",
    });
    expect(
      (
        await db.query<{ amount: string }>(
          "SELECT amount_cents::text AS amount FROM mcp_cost_payment_evidence WHERE id=$1",
          [f.payment],
        )
      ).rows[0].amount,
    ).toBe("620000");
    const history = await rpc("read", { id: f.record, payment_id: f.payment }, ap);
    expect(history.history).toHaveLength(1);
    expect(history.state.correction.corrected_by).toBe(ap);
    const snapshot = (await query("SELECT mcp_cost_reconciliation_snapshot($1) AS data", [job]))
      .rows[0].data;
    const record = snapshot.ap.records.find((x: Data) => x.id === f.record);
    expect(
      record.payments.filter((p: Data) => !p.correction).map((p: Data) => p.amount_cents),
    ).toEqual(["520000"]);
    expect(record.posted_version).toBe(1);
    const reconciliation = reconcileApSnapshot(snapshot, {
      company_id: company,
      job_id: job,
    } as never);
    expect(JSON.stringify(reconciliation)).toContain("480000");
  });
  it("rejects unknown/mismatched identity and never substitutes a new payment", async () => {
    const f = await fixture();
    await expect(rpc("read", { id: f.record, payment_id: crypto.randomUUID() })).rejects.toThrow(
      /unavailable/,
    );
    const missing = await tool({ step: "review", id: f.record, mode: "replace" });
    expect(missing.structuredContent.saved).toBe(false);
    expect(missing.structuredContent.missing).toContain("existing recorded payment");
    await expect(
      (
        jobCostAccountingRecord as unknown as {
          handler: (args: Data, ctx: unknown) => Promise<unknown>;
        }
      ).handler(
        {
          job_number: "CORR-LOCAL",
          step: "review",
          action: "payment",
          id: f.record,
          payment_id: f.payment,
          expected_version: 1,
          amount_cents: 520000,
          paid_on: "2026-10-21",
          reference: "CORRECTION",
        },
        {},
      ),
    ).rejects.toThrow(/job_cost_payment_correction/);
  });
  it("closes new legacy void-only writes while preserving completed legacy retries", async () => {
    const f = await fixture();
    const p = {
      action: "correct_payment",
      id: f.record,
      payment_id: f.payment,
      request_id: crypto.randomUUID(),
      correction_id: crypto.randomUUID(),
      reason: "Legacy caller",
    };
    const ticket = (
      await query("SELECT mcp_cost_review_prepare($1,'settlement',$2::jsonb) AS data", [
        job,
        JSON.stringify(p),
      ])
    ).rows[0].data;
    await expect(
      query("SELECT mcp_cost_settlement_action($1,$2::jsonb,$3,true)", [
        job,
        JSON.stringify(p),
        ticket.review_id,
      ]),
    ).rejects.toThrow(/reviewed payment correction workflow/);
    await db.query(
      "INSERT INTO mcp_cost_submission_operations(company_id,request_id,actor_id,signature,result) VALUES($1,$2,$3,$4::jsonb::text,$5::jsonb)",
      [
        company,
        p.request_id,
        owner,
        JSON.stringify(p),
        JSON.stringify({
          id: f.record,
          payment_id: f.payment,
          correction_id: p.correction_id,
          status: "evidence_corrected",
        }),
      ],
    );
    const retry = (
      await query("SELECT mcp_cost_settlement_action($1,$2::jsonb,$3,true) AS data", [
        job,
        JSON.stringify(p),
        ticket.review_id,
      ])
    ).rows[0].data;
    expect(retry.already_applied).toBe(true);
  });
  it("rejects PM, contracts, super, outsider and inactive identities at SQL boundaries", async () => {
    const f = await fixture();
    for (const user of [pm, contracts, superUser, outsider, locked])
      await expect(rpc("read", { id: f.record, payment_id: f.payment }, user)).rejects.toThrow();
    const r = await review(f);
    for (const user of [pm, contracts, superUser, outsider, locked])
      await expect(saved(r, user)).rejects.toThrow();
    await expect(saved(r, ap)).rejects.toThrow(/review|Review/); // another accountant cannot consume owner's ticket
  });
  it("deduplicates identical retries and rejects changed content under the same request", async () => {
    const f = await fixture(),
      r = await review(f);
    const a = await saved(r),
      b = await saved(r);
    expect(b.already_applied).toBe(true);
    expect(b.replacement_id).toBe(a.replacement_id);
    await expect(
      rpc("save", { ...r.payload, reason: "changed" }, owner, r.review_key, true),
    ).rejects.toThrow(/different content/);
    expect(
      (
        await db.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM mcp_cost_payment_corrections WHERE payment_id=$1",
          [f.payment],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("lets only one of two reviewed corrections replace the same evidence", async () => {
    const f = await fixture(),
      first = await review(f),
      second = await review(f);
    await saved(first);
    await expect(saved(second)).rejects.toThrow(/already corrected/);
    expect(
      (
        await db.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM mcp_cost_payment_corrections WHERE payment_id=$1",
          [f.payment],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("does not remove the original if a duplicate reference appears after review", async () => {
    const f = await fixture(),
      r = await review(f),
      other = await fixture(1000000, 0);
    await db.query(
      "INSERT INTO mcp_cost_payment_evidence(id,record_id,amount_cents,paid_on,reference,recorded_by) VALUES($1,$2,100000,'2026-10-21',$3,$4)",
      [crypto.randomUUID(), other.record, r.payload.revised.reference, owner],
    );
    await expect(saved(r)).rejects.toThrow(/reference already recorded/);
    const current = await rpc("read", { id: f.record, payment_id: f.payment });
    expect(current.state.correction).toBeNull();
    expect(current.state.records[0].active_paid_cents).toBe("620000");
  });
  it("recovers an uncertain tool response by retrying exactly the same confirmed request", async () => {
    const f = await fixture(),
      r = await review(f);
    const client = fakeClient(db, {
      sub: owner,
      email: "synthetic@example.invalid",
      role: "authenticated",
    });
    ctxState.sb = {
      ...client,
      rpc: async (name: string, args: Data) => {
        const out = await client.rpc(name, args);
        if (!out.error) throw new Error("connection lost after commit");
        return out;
      },
    };
    const uncertain = await (
      jobCostPaymentCorrection as unknown as {
        handler: (
          args: Data,
          ctx: unknown,
        ) => Promise<{ content: Array<{ text: string }>; structuredContent: Data }>;
      }
    ).handler(
      {
        job_number: "CORR-LOCAL",
        step: "save",
        payload: r.payload,
        review_key: r.review_key,
        confirmed: true,
      },
      {},
    );
    expect(uncertain.structuredContent.outcome_unknown).toBe(true);
    expect(uncertain.structuredContent.payload.request_id).toBe(r.payload.request_id);
    const result = await tool({
      step: "save",
      payload: r.payload,
      review_key: r.review_key,
      confirmed: true,
    });
    expect(result.structuredContent.result.already_applied).toBe(true);
  });
  it("rejects stale payable versions, changed balances and withdrawn PM coverage", async () => {
    const f = await fixture(),
      r = await review(f);
    await db.query(
      "INSERT INTO mcp_cost_submission_versions(record_id,version,facts,reason,recorded_by) VALUES($1,2,$2,'Correction pending',$3)",
      [f.record, JSON.stringify(f.facts), owner],
    );
    await expect(saved(r)).rejects.toThrow(/changed since review/);
    const b = await fixture(),
      br = await review(b);
    await db.query(
      "INSERT INTO mcp_cost_payment_evidence(id,record_id,amount_cents,paid_on,reference,recorded_by) VALUES($1,$2,1000,'2026-10-22',$3,$4)",
      [crypto.randomUUID(), b.record, crypto.randomUUID(), owner],
    );
    await expect(saved(br)).rejects.toThrow(/changed since review/);
    const c = await fixture(),
      cr = await review(c);
    await db.query(
      "INSERT INTO mcp_cost_business_withdrawals(approval_id,reason,withdrawn_by) VALUES($1,'Not delivered',$2)",
      [c.approval, owner],
    );
    await expect(saved(cr)).rejects.toThrow(/changed since review/);
  });
  it("rejects changed review payloads, expired reviews, overpayments, invalid dates and duplicate references", async () => {
    const f = await fixture(),
      r = await review(f);
    await expect(saved({ ...r, payload: { ...r.payload, reason: "tampered" } })).rejects.toThrow(
      /Review the exact action/,
    );
    await db.query(
      "UPDATE mcp_cost_review_tickets SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [r.review_key],
    );
    await expect(saved(r)).rejects.toThrow(/Review the exact action/);
    for (const revised of [
      { amount_cents: 1000001, paid_on: "2026-10-21", reference: "X" },
      { amount_cents: 500000, paid_on: "2026-02-30", reference: "X" },
    ])
      await expect(
        review(f, {
          revised: {
            ...revised,
            allocations: [
              { record_id: f.record, expected_version: 1, amount_cents: revised.amount_cents },
            ],
          },
        }),
      ).rejects.toThrow();
    const other = await fixture();
    const otherRead = await rpc("read", { id: other.record, payment_id: other.payment });
    await expect(
      review(f, {
        revised: { ...r.payload.revised, reference: otherRead.state.payment.reference },
      }),
    ).rejects.toThrow(/reference already recorded/);
  });
  it("voids erroneous evidence without requiring or granting new posting/payment approval", async () => {
    const f = await fixture();
    await db.query(
      "INSERT INTO mcp_cost_business_withdrawals(approval_id,reason,withdrawn_by) VALUES($1,'Withdrawn',$2)",
      [f.approval, owner],
    );
    const r = await review(f, {
        mode: "void",
        revised: null,
        reason: "Duplicate record, no actual second payment",
      }),
      result = await saved(r);
    expect(result.replacement_id).toBeNull();
    expect(result.effects[0].revised_paid_cents).toBe("0");
    expect(result.effects[0].revised_unpaid_cents).toBe("1000000");
    await expect(review(f)).rejects.toThrow(/already corrected/);
  });
  it("corrects shared payment allocations atomically with header conservation and every-record scope", async () => {
    const a = await fixture(1000000, 0),
      b = await fixture(1000000, 0, otherJob),
      payment = crypto.randomUUID();
    await db.query(
      "INSERT INTO mcp_cost_shared_payments(id,company_id,amount_cents,paid_on,reference,recorded_by) VALUES($1,$2,900000,'2026-10-20',$3,$4)",
      [payment, company, crypto.randomUUID(), owner],
    );
    for (const [record, amount] of [
      [a.record, 600000],
      [b.record, 300000],
    ])
      await db.query("INSERT INTO mcp_cost_shared_allocations VALUES($1,$2,$3)", [
        payment,
        record,
        amount,
      ]);
    const f = { ...a, payment };
    const read = await rpc("read", { id: a.record, payment_id: payment });
    expect(
      (await rpc("read", { id: a.record, payment_id: payment }, ap)).state.records,
    ).toHaveLength(2); // Existing AP role has full company scope.
    const revised = {
      amount_cents: 800000,
      paid_on: "2026-10-21",
      reference: read.state.payment.reference,
      allocations: [
        { record_id: a.record, expected_version: 1, amount_cents: 500000 },
        { record_id: b.record, expected_version: 1, amount_cents: 300000 },
      ],
    };
    await expect(review(f, { revised: { ...revised, amount_cents: 800001 } })).rejects.toThrow(
      /equal the payment/,
    );
    await expect(
      review(f, {
        revised: { ...revised, allocations: [revised.allocations[0], revised.allocations[0]] },
      }),
    ).rejects.toThrow(/Allocations/);
    const r = await review(f, { revised }),
      result = await saved(r);
    expect(result.effects.map((e: Data) => e.revised_paid_cents).sort()).toEqual([
      "300000",
      "500000",
    ]);
    const conservation = (
      await db.query(
        "SELECT p.amount_cents::text AS header,sum(a.amount_cents)::text AS allocated FROM mcp_cost_shared_payments p JOIN mcp_cost_shared_allocations a ON a.payment_id=p.id WHERE p.id=$1 GROUP BY p.id",
        [result.replacement_id],
      )
    ).rows[0];
    expect(conservation).toEqual({ header: "800000", allocated: "800000" });
    await expect(saved(r, outsider)).rejects.toThrow(); // idempotent replay still authorizes the caller
  });
  it("blocks privileged updates/deletes of originals, corrections and audit operations", async () => {
    const f = await fixture(),
      r = await review(f),
      result = await saved(r);
    for (const sql of [
      "UPDATE mcp_cost_payment_evidence SET amount_cents=1 WHERE id=$1",
      "DELETE FROM mcp_cost_payment_evidence WHERE id=$1",
    ])
      await expect(db.query(sql, [f.payment])).rejects.toThrow();
    await expect(
      db.query("DELETE FROM mcp_cost_payment_corrections WHERE id=$1", [result.correction_id]),
    ).rejects.toThrow();
    await expect(
      db.query("DELETE FROM mcp_cost_submission_operations WHERE request_id=$1", [
        r.payload.request_id,
      ]),
    ).rejects.toThrow();
  });
  it("retains historical paid/unpaid balances before the correction and reports new evidence after it", async () => {
    const f = await fixture(),
      r = await review(f),
      result = await saved(r);
    const before = await rpc("read", { id: f.record, payment_id: f.payment, as_of: "2026-10-22" });
    expect(before.balances_as_of[0]).toMatchObject({
      posted_cents: "1000000",
      recorded_paid_cents: "620000",
      unpaid_cents: "380000",
      posted_version: 1,
    });
    const after = await rpc("read", {
      id: f.record,
      payment_id: f.payment,
      as_of: result.corrected_at.slice(0, 10),
    });
    expect(after.balances_as_of[0]).toMatchObject({
      posted_cents: "1000000",
      recorded_paid_cents: "520000",
      unpaid_cents: "480000",
    });
    await expect(
      rpc("read", { id: f.record, payment_id: f.payment, as_of: "2026-02-30" }),
    ).rejects.toThrow(/Valid as-of/);
  });
  it("rejects cross-company shared allocations and private helper/direct-table access", async () => {
    const a = await fixture(1000000, 0),
      b = await fixture(1000000, 0);
    const foreign = crypto.randomUUID();
    await db.query(
      "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Other synthetic company',$2)",
      [foreign, outsider],
    );
    await db.query("UPDATE mcp_cost_submissions SET company_id=$1 WHERE id=$2", [
      foreign,
      b.record,
    ]);
    const payment = crypto.randomUUID();
    await db.query(
      "INSERT INTO mcp_cost_shared_payments(id,company_id,amount_cents,paid_on,reference,recorded_by) VALUES($1,$2,200000,'2026-10-20',$3,$4)",
      [payment, company, crypto.randomUUID(), owner],
    );
    for (const f of [a, b])
      await db.query("INSERT INTO mcp_cost_shared_allocations VALUES($1,$2,100000)", [
        payment,
        f.record,
      ]);
    await expect(rpc("read", { id: a.record, payment_id: payment })).rejects.toThrow(/unavailable/);
    await expect(
      query("SELECT mcp_cost_payment_correction_state($1,$2,$3)", [job, a.record, payment]),
    ).rejects.toThrow(/permission denied/);
    await expect(query("SELECT * FROM mcp_cost_payment_corrections")).rejects.toThrow(
      /permission denied/,
    );
  });
});
