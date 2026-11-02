const toolState = vi.hoisted(() => ({ sb: null as any }));
vi.mock("../mcp/guard", () => ({
  run: async (_n: unknown, _c: unknown, _o: unknown, fn: any) => fn(toolState.sb),
  text: (t: string) => ({ content: [{ type: "text", text: t }] }),
  dbError: (e: { message: string }) => {
    throw Error(e.message);
  },
}));
vi.mock("../mcp/jobs", () => ({
  resolveJob: async () => ({
    job_id: "00000000-0000-4000-8000-000000000094",
    job_number: "2701",
    scope: "full",
  }),
}));
import {
  paymentApplicationRead,
  paymentApplicationRecord,
  paymentApplicationPrepare,
} from "../mcp/tools/payment-application-tools";
import { applicationFixture } from "./fixtures";
import { calculateApplication } from "./model";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

const owner = "00000000-0000-4000-8000-000000000091";
const outsider = "00000000-0000-4000-8000-000000000092";
const superintendent = "00000000-0000-4000-8000-000000000096";
const estimator = "00000000-0000-4000-8000-000000000097";
const company = "00000000-0000-4000-8000-000000000093";
const job = "00000000-0000-4000-8000-000000000094";
const otherJob = "00000000-0000-4000-8000-000000000095";
let db: PGlite;
const query = (sql: string, values: unknown[] = [], user = owner) =>
  asUser(
    db,
    { sub: user, role: "authenticated", email: `${user.slice(-2)}@example.com` },
    (tx) => tx.query(sql, values) as Promise<{ rows: Record<string, unknown>[] }>,
  );
const record = async (action: string, p: Record<string, unknown>, user = owner) =>
  (
    await query(
      "SELECT public.mcp_billing_evidence_record($1,$2,$3::jsonb) AS data",
      [job, action, JSON.stringify(p)],
      user,
    )
  ).rows[0].data as Record<string, unknown>;
const get = async (user = owner) =>
  (await query("SELECT public.mcp_billing_evidence_get($1) AS data", [job], user)).rows[0].data as {
    invoices: Array<{ versions: Array<{ status: string }> }>;
    receipts: unknown[];
    allocations: unknown[];
  };
const invoice = (extra: Record<string, unknown> = {}) => ({
  request_id: crypto.randomUUID(),
  id: crypto.randomUUID(),
  expected_version: 0,
  kind: "pay_application",
  document_number: crypto.randomUUID(),
  status: "submitted",
  invoice_date: "2026-10-01",
  period_start: "2026-09-01",
  period_end: "2026-09-30",
  effective_date: "2026-10-01",
  source: "Signed pay application 1",
  gross_cents: 100000,
  withheld_cents: 10000,
  released_cents: 0,
  net_due_cents: 90000,
  ...extra,
});
beforeAll(async () => {
  db = await makeDb();
  toolState.sb = {
    rpc: async (_name: string, args: any) => {
      try {
        return {
          data: (
            await query("SELECT mcp_billing_evidence_record($1,$2,$3::jsonb) AS data", [
              args._job,
              args._action,
              JSON.stringify(args._p),
            ])
          ).rows[0].data,
          error: null,
        };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
  };
  for (const user of [owner, outsider, superintendent, estimator]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES ($1,$2)", [
      user,
      `${user.slice(-2)}@example.com`,
    ]);
    await db.query("INSERT INTO test_active_members VALUES ($1)", [user]);
  }
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Fictional Construction',$2)",
    [company, owner],
  );
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','QA Owner')",
    [company, owner],
  );
  for (const [user, role] of [
    [superintendent, "super"],
    [estimator, "estimating"],
  ]) {
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,'QA Member')",
      [company, user, role],
    );
  }
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name,time_zone) VALUES($1,$2,$3,'2701','Synthetic Job','America/Chicago')",
    [job, owner, company],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name,time_zone) VALUES($1,$2,$3,'2702','Other synthetic job','America/Chicago')",
    [otherJob, owner, company],
  );
  await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
    job,
    superintendent,
    owner,
  ]);
  // Minimal rows to exercise the billing reader's contract snapshot; change-order behavior is tested separately with its real migration.
  await db.exec(
    "CREATE TABLE mcp_submittals(id uuid PRIMARY KEY,job_id uuid,number text,revision integer); CREATE TABLE mcp_change_orders(submittal_id uuid PRIMARY KEY,job_id uuid,details jsonb);",
  );
  await db.exec(
    readFileSync("supabase/migrations/20261101120001_athena_project_billing_evidence.sql", "utf8"),
  );
  await db.exec(
    readFileSync("drizzle/migrations/0031_athena_sov_contract_total_guard.sql", "utf8"),
  );
  const attributes = () =>
    db.query(
      "SELECT oid,proowner,proacl,prosecdef,provolatile,proconfig,proargtypes::text,prorettype FROM pg_proc WHERE oid='mcp_billing_evidence_record(uuid,text,jsonb)'::regprocedure",
    );
  const before = (await attributes()).rows;
  await db.exec(readFileSync("release-proposals/sov-payment-applications.sql", "utf8"));
  expect((await attributes()).rows).toEqual(before);
  await db.exec(readFileSync("release-proposals/payment-application-contract-basis.sql", "utf8"));
  expect((await attributes()).rows).toEqual(before);
  await db.exec(readFileSync("release-proposals/conversational-payment-drafts.sql", "utf8"));
  expect((await attributes()).rows).toEqual(before);
  await db.query("UPDATE mcp_jobs SET sov_fee_pct=0 WHERE id=$1", [job]);
  await db.query(
    "INSERT INTO mcp_job_facts(job_id,module,key,value,status,source,updated_by) VALUES($1,'contract','contract_value','100000','known','member_answer',$2)",
    [job, owner],
  );
  await db.query(
    "INSERT INTO mcp_job_facts(job_id,module,key,value,status,source,updated_by) VALUES($1,'sov','01',$2::jsonb,'known','member_answer',$3)",
    [job, JSON.stringify({ description: "Construction work", billable_value: 100000 }), owner],
  );
});
beforeEach(async () => {
  await db.exec(
    "TRUNCATE mcp_payment_application_reviews,mcp_payment_application_versions,mcp_payment_applications,mcp_billing_operations,mcp_billing_allocations,mcp_billing_receipt_reversals,mcp_billing_receipts,mcp_billing_invoice_versions,mcp_billing_invoices CASCADE",
  );
});
afterAll(async () => {
  await db?.close();
});

async function context() {
  return await record("payment_application_read", {});
}
async function payload() {
  const ctx = await context();
  const application = applicationFixture();
  application.snapshot = ctx.snapshot as typeof application.snapshot;
  return {
    id: crypto.randomUUID(),
    request_id: crypto.randomUUID(),
    expected_version: 0,
    application,
  };
}
async function save(p: Awaited<ReturnType<typeof payload>>) {
  const r = await record("payment_application_review", p);
  return await record("payment_application_save", { ...p, review_key: r.review_key });
}
describe("versioned payment applications", () => {
  it("allows a documented prior credit and partial certificate without rebilling the old request", async () => {
    const first = await payload();
    first.application.state = "submitted";
    await save(first);
    await save({
      ...first,
      request_id: crypto.randomUUID(),
      expected_version: 1,
      application: {
        ...first.application,
        state: "certified",
        reason: "Actual partial certificate",
        certification: { amount_cents: 1200000, date: "2026-02-02", source: "Partial certificate" },
      },
    });
    const credit = invoice({
      kind: "credit",
      credit_for: first.id,
      status: "posted",
      invoice_date: "2026-01-31",
      period_start: null,
      period_end: null,
      effective_date: "2026-01-31",
      gross_cents: null,
      withheld_cents: null,
      released_cents: null,
      net_due_cents: 150000,
    });
    await record("invoice", credit);
    const next = await payload();
    Object.assign(next.application, {
      number: "Next after reconciled credit",
      state: "submitted",
      period_start: "2026-02-01",
      period_end: "2026-02-28",
      prior_cutoff: "2026-01-31",
      prior_mode: "saved",
      prior_application: { id: first.id, version: 2 },
      prior_certified_net_cents: 1200000,
      evidence: [
        { id: first.id, version: 2, treatment: "prior_billing", reason: "Prior requested amount" },
        {
          id: credit.id,
          version: 1,
          treatment: "prior_billing",
          reason: "Documented credit against that prior request",
        },
      ],
    });
    Object.assign(next.application.lines[0], {
      prior_work_cents: 1000000,
      prior_stored_cents: 500000,
      prior_retained_cents: 150000,
      work_cents: 1800000,
      stored_cents: 200000,
      stored_to_work_cents: 300000,
    });
    await save(next);
    const ledger = (await get()).invoices as any[];
    const net = ledger.reduce(
      (n, i) => n + (i.kind === "credit" ? -1 : 1) * i.versions[0].net_due_cents,
      0,
    );
    expect(net).toBe(1800000);
    const wrong = {
      ...next,
      id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      expected_version: 0,
      application: {
        ...next.application,
        number: "Excluded managed credit",
        evidence: next.application.evidence.map((e) =>
          e.id === credit.id ? { ...e, treatment: "separate" as const } : e,
        ),
      },
    };
    await expect(save(wrong)).rejects.toThrow(/credits|latest/);
  });
  it("continues to permit explicitly unrelated external billing evidence", async () => {
    const external = invoice({
      kind: "invoice",
      document_number: "Separate authorized scope",
      invoice_date: "2025-12-01",
    });
    await record("invoice", external);
    const p = await payload();
    p.application.state = "submitted";
    p.application.evidence = [
      {
        id: external.id,
        version: 1,
        treatment: "separate",
        reason: "Documented independent external scope, excluded from this SOV certificate basis",
      },
    ];
    await expect(save(p)).resolves.toMatchObject({ version: 1, state: "submitted" });
  });

  it("rechecks full access after the job lock before read, outcome, review and idempotent replay", async () => {
    const p = await payload();
    const review = await record("payment_application_review", p);
    const completed = { ...p, review_key: review.review_key };
    await record("payment_application_save", completed);
    const original = (
      await db.query<any>("SELECT pg_get_functiondef('mcp_job_scope(uuid)'::regprocedure) AS sql")
    ).rows[0].sql;
    await db.exec("CREATE TABLE pa_scope_probe(n integer);INSERT INTO pa_scope_probe VALUES(0)");
    try {
      await db.exec(
        `CREATE OR REPLACE FUNCTION mcp_job_scope(_job uuid) RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$ DECLARE count_seen integer;BEGIN UPDATE pa_scope_probe SET n=n+1 RETURNING n INTO count_seen;RETURN CASE WHEN count_seen=1 THEN 'full' ELSE NULL END;END $$`,
      );
      for (const [action, payload] of [
        ["payment_application_read", { id: p.id, version: 1 }],
        ["payment_application_outcome", p],
        ["payment_application_review", p],
        ["payment_application_save", completed],
      ] as const) {
        await db.exec("UPDATE pa_scope_probe SET n=0");
        await expect(record(action, payload)).rejects.toThrow(/full project access/);
      }
    } finally {
      await db.exec(original);
      await db.exec("DROP TABLE pa_scope_probe");
    }
  });
  it("preserves authorized frozen reads when the current SOV is incomplete", async () => {
    const p = await payload();
    await save(p);
    try {
      await db.query("UPDATE mcp_job_facts SET status='unknown' WHERE job_id=$1 AND module='sov'", [
        job,
      ]);
      const r = await record("payment_application_read", { id: p.id, version: 1 });
      expect((r.selected as any).version).toBe(1);
      expect(r.snapshot).toBeNull();
      expect(r.snapshot_issue).toMatch(/known scheduled value/);
    } finally {
      await db.query("UPDATE mcp_job_facts SET status='known' WHERE job_id=$1 AND module='sov'", [
        job,
      ]);
    }
  });
  it("cannot reset managed work through external or older saved predecessors", async () => {
    const first = await payload();
    first.application.state = "submitted";
    await save(first);
    const second = await payload();
    second.application.number = "Reset attempt";
    second.application.state = "submitted";
    second.application.period_start = "2026-02-01";
    second.application.period_end = "2026-02-28";
    second.application.prior_cutoff = "2026-01-31";
    second.application.prior_mode = "external";
    second.application.evidence = [
      { id: first.id, version: 1, treatment: "prior_billing", reason: "Known original request" },
    ];
    await expect(save(second)).rejects.toThrow(/latest saved certified|actual prior certificate/);
    const cert = {
      ...first,
      request_id: crypto.randomUUID(),
      expected_version: 1,
      application: {
        ...first.application,
        state: "certified" as const,
        reason: "Actual certificate",
        certification: { amount_cents: 1350000, date: "2026-02-01", source: "Certificate 1" },
      },
    };
    await save(cert);
    second.application.prior_mode = "saved";
    second.application.prior_application = { id: first.id, version: 2 };
    second.application.prior_certified_net_cents = 1350000;
    second.application.evidence[0].version = 2;
    Object.assign(second.application.lines[0], {
      prior_work_cents: 1000000,
      prior_stored_cents: 500000,
      prior_retained_cents: 150000,
      stored_cents: 500000,
      stored_to_work_cents: 0,
    });
    await save(second);
    const third = await payload();
    third.application.number = "Old predecessor attempt";
    third.application.state = "submitted";
    third.application.period_start = "2026-03-01";
    third.application.period_end = "2026-03-31";
    third.application.prior_cutoff = "2026-01-31";
    third.application.prior_mode = "saved";
    third.application.prior_application = { id: first.id, version: 2 };
    third.application.evidence = [
      { id: first.id, version: 2, treatment: "prior_billing", reason: "Original request" },
      { id: second.id, version: 1, treatment: "prior_billing", reason: "Known request" },
    ];
    await expect(save(third)).rejects.toThrow(/latest saved certified/);
  });
  it("source-only contract updates invalidate pending reviews", async () => {
    const p = await payload();
    const r = await record("payment_application_review", p);
    try {
      await db.query(
        "UPDATE mcp_job_facts SET source='document' WHERE job_id=$1 AND module='contract' AND key='contract_value'",
        [job],
      );
      await expect(
        record("payment_application_save", { ...p, review_key: r.review_key }),
      ).rejects.toThrow(/SOV changed|Review/);
    } finally {
      await db.query(
        "UPDATE mcp_job_facts SET source='member_answer' WHERE job_id=$1 AND module='contract' AND key='contract_value'",
        [job],
      );
    }
  });

  it("freezes the fee and an executed fee-included change without charging its fee twice", async () => {
    const sourceId = crypto.randomUUID();
    try {
      await db.query("UPDATE mcp_jobs SET sov_fee_pct=10 WHERE id=$1", [job]);
      await db.query(
        "UPDATE mcp_job_facts SET value=jsonb_set(value,'{billable_value}','90000') WHERE job_id=$1 AND module='sov' AND key='01'",
        [job],
      );
      await db.query("INSERT INTO mcp_submittals VALUES($1,$2,'CO-1',1)", [sourceId, job]);
      await db.query("INSERT INTO mcp_change_orders VALUES($1,$2,$3::jsonb)", [
        sourceId,
        job,
        JSON.stringify({ state: "executed", total_cents: 1000000 }),
      ]);
      await db.query(
        "INSERT INTO mcp_job_facts(job_id,module,key,value,status,source,updated_by) VALUES($1,'sov','02',$2::jsonb,'known','member_answer',$3)",
        [
          job,
          JSON.stringify({
            description: "Executed addition",
            billable_value: 10000,
            executed_change_order: sourceId,
            fee_included: true,
          }),
          owner,
        ],
      );
      const c = await context();
      expect((c.snapshot as any).provenance.approved_changes[0]).toMatchObject({
        id: sourceId,
        revision: 1,
        state: "executed",
      });
      const pending = await payload();
      pending.application.lines = pending.application.snapshot.lines.map((line) => ({
        ...pending.application.lines[0],
        item: line.item,
        work_cents: 0,
        stored_cents: 0,
      }));
      const sourceReview = await record("payment_application_review", pending);
      await db.query(
        "UPDATE mcp_change_orders SET details=jsonb_set(details,'{references}',$2::jsonb) WHERE submittal_id=$1",
        [sourceId, JSON.stringify([{ kind: "drawing", source_ref: "Revised source reference" }])],
      );
      await expect(
        record("payment_application_save", { ...pending, review_key: sourceReview.review_key }),
      ).rejects.toThrow(/SOV changed|Review/);
      expect(c.snapshot).toMatchObject({
        contract_cents: 11000000,
        lines: [
          { item: "01", scheduled_cents: 9000000 },
          { item: "02", scheduled_cents: 1000000 },
          { item: "CF", scheduled_cents: 1000000 },
        ],
      });
    } finally {
      await db.query("UPDATE mcp_jobs SET sov_fee_pct=0 WHERE id=$1", [job]);
      await db.query(
        "UPDATE mcp_job_facts SET value=jsonb_set(value,'{billable_value}','100000') WHERE job_id=$1 AND module='sov' AND key='01'",
        [job],
      );
      await db.query("DELETE FROM mcp_job_facts WHERE job_id=$1 AND module='sov' AND key='02'", [
        job,
      ]);
      await db.query("DELETE FROM mcp_change_orders WHERE submittal_id=$1", [sourceId]);
      await db.query("DELETE FROM mcp_submittals WHERE id=$1", [sourceId]);
    }
  });

  it("rejects malformed direct-RPC continuation and certificate values at review", async () => {
    const p = await payload();
    const bad = structuredClone(p) as any;
    bad.application.lines[0].item = 1;
    await expect(record("payment_application_review", bad)).rejects.toThrow(/identifier/);
    const q = structuredClone(p) as any;
    q.application.state = "certified";
    q.application.certification = { amount_cents: 1, source: "Certificate without a date" };
    await expect(record("payment_application_review", q)).rejects.toThrow(
      /certificate amount, date and source/,
    );
  });
  it("saves reviewed revisions as new immutable versions of the same application", async () => {
    const p = await payload();
    await save(p);
    const revised = {
      ...p,
      expected_version: 1,
      request_id: crypto.randomUUID(),
      application: {
        ...p.application,
        reason: "Updated source progress",
        lines: p.application.lines.map((l) => ({ ...l, work_cents: 1100000 })),
      },
    };
    await save(revised);
    const old = await record("payment_application_read", { id: p.id, version: 1 });
    const current = await record("payment_application_read", { id: p.id, version: 2 });
    expect((old.selected as any).body.lines[0].work_cents).toBe(1000000);
    expect((current.selected as any).body.lines[0].work_cents).toBe(1100000);
  });

  it("reconciles a lost or expired save outcome without creating a new identity", async () => {
    const p = await payload();
    expect((await record("payment_application_outcome", p)).applied).toBe(false);
    const r = await record("payment_application_review", p);
    await record("payment_application_save", { ...p, review_key: r.review_key });
    const outcome = await record("payment_application_outcome", p);
    expect(outcome).toMatchObject({ applied: true, id: p.id, version: 1 });
    await expect(
      record("payment_application_outcome", {
        ...p,
        application: { ...p.application, source: "different" },
      }),
    ).rejects.toThrow(/different content/);
  });
  it("denies revoked membership and exact cross-job targets", async () => {
    const p = await payload();
    await save(p);
    await expect(
      query("SELECT mcp_billing_evidence_record($1,$2,$3::jsonb)", [
        otherJob,
        "payment_application_read",
        JSON.stringify({ id: p.id, version: 1 }),
      ]),
    ).rejects.toThrow(/unavailable/);
    await db.query("DELETE FROM test_active_members WHERE user_id=$1", [owner]);
    await db.query("DELETE FROM mcp_gate_cache WHERE user_id=$1", [owner]).catch(() => {});
    try {
      await expect(record("payment_application_read", {})).rejects.toThrow();
    } finally {
      await db.query("INSERT INTO test_active_members VALUES($1)", [owner]);
      await db.query("DELETE FROM mcp_gate_cache WHERE user_id=$1", [owner]);
    }
  });

  it("runs the actual conversation tools through review, explicit confirmation, save and exact read", async () => {
    const invoke = (tool: any, args: any) => tool.handler(args, {});
    const p = await payload();
    const args = { ...p, job_number: "2701", step: "review" };
    const review = await invoke(paymentApplicationRecord, args);
    expect(review.content[0].text).not.toContain(p.id);
    expect(review.content[0].text).not.toContain(p.request_id);
    await expect(
      invoke(paymentApplicationRecord, {
        ...args,
        step: "save",
        review_key: review.structuredContent.review_key,
      }),
    ).rejects.toThrow(/confirm/);
    const saved = await invoke(paymentApplicationRecord, {
      ...args,
      step: "save",
      review_key: review.structuredContent.review_key,
      confirmed: true,
    });
    expect(saved.structuredContent.selected.version).toBe(1);
    expect(saved.structuredContent.application_url).toContain(
      "payment-applications?application_id=" + p.id + "&version=1",
    );
    const read = await invoke(paymentApplicationRead, {
      job_number: "2701",
      application_id: p.id,
      version: 1,
    });
    expect(read.structuredContent.selected.body.number).toBe(p.application.number);
    expect(read.structuredContent.document_url).toContain("version=1&download=pdf");
  });

  it("blocks incomplete totals from ready/submitted and preserves exact explicit zero", async () => {
    const p = await payload();
    p.application.state = "ready";
    p.application.lines[0].stored_cents = null;
    await expect(save(p)).rejects.toThrow(/Needed/);
    p.application.lines[0].stored_cents = 0;
    p.application.lines[0].work_cents = 0;
    p.application.state = "ready";
    expect((await save(p)).state).toBe("ready");
    expect((await get()).invoices).toHaveLength(0);
  });
  it("makes concurrent same-request saves idempotent and rejects a stale competing revision", async () => {
    const p = await payload();
    const r = await record("payment_application_review", p);
    const saved = await Promise.all([
      record("payment_application_save", { ...p, review_key: r.review_key }),
      record("payment_application_save", { ...p, review_key: r.review_key }),
    ]);
    expect(saved.map((s) => s.version)).toEqual([1, 1]);
    expect(saved.filter((s) => s.already_applied === true)).toHaveLength(1);
    const stale = { ...p, request_id: crypto.randomUUID() };
    await expect(record("payment_application_review", stale)).rejects.toThrow(/version changed/);
  });
  it("rejects changed evidence after review and missing exact versions", async () => {
    const p = await payload();
    const r = await record("payment_application_review", p);
    await record("invoice", invoice());
    await expect(
      record("payment_application_save", { ...p, review_key: r.review_key }),
    ).rejects.toThrow(/Review expired/);
    await expect(record("payment_application_read", { id: p.id, version: 1 })).rejects.toThrow(
      /unavailable/,
    );
  });
  it("never substitutes cash or a partial certificate for previously requested billing", async () => {
    const prior = invoice({
      invoice_date: "2025-12-20",
      period_start: "2025-12-01",
      period_end: "2025-12-20",
      net_due_cents: 1350000,
      gross_cents: 1500000,
      withheld_cents: 150000,
    });
    await record("invoice", prior);
    const p = await payload();
    p.application.prior_mode = "external";
    p.application.prior_certified_net_cents = 1200000;
    p.application.state = "submitted";
    Object.assign(p.application.lines[0], {
      prior_work_cents: 1000000,
      prior_stored_cents: 500000,
      prior_retained_cents: 150000,
      work_cents: 1800000,
      stored_cents: 200000,
    });
    p.application.evidence = [
      {
        id: prior.id,
        version: 1,
        treatment: "prior_billing",
        reason: "Prior issued request with partial actual certificate",
      },
    ];
    await expect(save(p)).rejects.toThrow(/Needed/);
    const review = await record("payment_application_review", {
      ...p,
      application: { ...p.application, state: "draft" },
    });
    expect((review.calculation as any).issues.join(" ")).toMatch(/Prior issued billing exceeds/);
  });
  it("does not permit inconsistent prior line mapping, over-cap work or malformed rates", async () => {
    for (const patch of [
      { work_cents: 10000001 },
      { work_cents: -1 },
      { work_retainage_bps: 10001 },
      { release_cents: 150001 },
    ]) {
      const p = await payload();
      p.application.state = "submitted";
      Object.assign(p.application.lines[0], patch);
      await expect(save(p)).rejects.toThrow();
    }
  });
  it("keeps legacy billing operations and their access controls intact", async () => {
    const p = invoice();
    await record("invoice", p);
    expect((await get()).invoices).toHaveLength(1);
    await expect(record("invoice", invoice(), outsider)).rejects.toThrow();
  });

  it("reviews and saves a draft exactly once, then reads frozen version", async () => {
    const p = await payload();
    p.application.lines[0].work_cents = null;
    const review = await record("payment_application_review", p);
    expect((review.calculation as any).payment_due_cents).toBeNull();
    const result = await record("payment_application_save", {
      ...p,
      review_key: review.review_key,
    });
    expect(result.version).toBe(1);
    expect(
      (await record("payment_application_save", { ...p, review_key: review.review_key }))
        .already_applied,
    ).toBe(true);
    expect((await get()).invoices).toHaveLength(0);
    const read = await record("payment_application_read", { id: p.id, version: 1 });
    expect((read.selected as any).body.lines[0].work_cents).toBeNull();
    await expect(
      record("payment_application_save", {
        ...p,
        application: { ...p.application, source: "Changed" },
        review_key: review.review_key,
      }),
    ).rejects.toThrow(/different content/);
  });
  it("posts only incremental billing and certifies the same identity", async () => {
    const p = await payload();
    p.application.number = "Issued 1";
    p.application.state = "submitted";
    const result = await save(p);
    expect(result.billing_version).toBe(1);
    let ledger = await get();
    const bill = (ledger.invoices as any[]).find((i) => i.id === p.id);
    expect(bill.versions[0].net_due_cents).toBe(1350000);
    const revised = {
      ...p,
      request_id: crypto.randomUUID(),
      expected_version: 1,
      application: {
        ...p.application,
        state: "certified" as const,
        reason: "Actual certificate recorded",
        certification: { amount_cents: 1350000, date: "2026-02-02", source: "Certificate 1" },
      },
    };
    await save(revised);
    ledger = await get();
    expect((ledger.invoices as any[]).filter((i) => i.id === p.id)).toHaveLength(1);
    const next = await payload();
    next.application.number = "Issued 2";
    next.application.state = "submitted";
    next.application.period_start = "2026-02-01";
    next.application.period_end = "2026-02-28";
    next.application.prior_cutoff = "2026-01-31";
    next.application.prior_mode = "saved";
    next.application.prior_application = { id: p.id, version: 2 };
    next.application.prior_certified_net_cents = 1350000;
    next.application.evidence = [
      { id: p.id, version: 2, treatment: "prior_billing", reason: "Prior actual certificate" },
    ];
    Object.assign(next.application.lines[0], {
      prior_work_cents: 1000000,
      prior_stored_cents: 500000,
      prior_retained_cents: 150000,
      stored_to_work_cents: 300000,
      work_cents: 1800000,
      stored_cents: 200000,
    });
    await save(next);
    const nextBill = (await get()).invoices.find((i: any) => i.id === next.id) as any;
    expect(nextBill.versions[0].net_due_cents).toBe(450000);
    const nextCertificate = {
      ...next,
      request_id: crypto.randomUUID(),
      expected_version: 1,
      application: {
        ...next.application,
        state: "certified" as const,
        reason: "Certificate 2",
        certification: { amount_cents: 450000, date: "2026-03-02", source: "Actual certificate 2" },
      },
    };
    await save(nextCertificate);
    const release = await payload();
    release.application = {
      ...structuredClone(next.application),
      number: "Release 3",
      state: "submitted",
      period_start: "2026-03-01",
      period_end: "2026-03-31",
      prior_cutoff: "2026-02-28",
      prior_application: { id: next.id, version: 2 },
      prior_certified_net_cents: 1800000,
      evidence: [
        { id: p.id, version: 2, treatment: "prior_billing", reason: "Certificate 1" },
        { id: next.id, version: 2, treatment: "prior_billing", reason: "Certificate 2" },
      ],
    };
    Object.assign(release.application.lines[0], {
      prior_work_cents: 1800000,
      prior_stored_cents: 200000,
      prior_retained_cents: 200000,
      stored_to_work_cents: 0,
      release_cents: 100000,
      release_basis: "Approved retainage release",
    });
    await save(release);
    const releaseBill = (await get()).invoices.find((i: any) => i.id === release.id) as any;
    expect(releaseBill.versions[0]).toMatchObject({
      gross_cents: 0,
      released_cents: 100000,
      net_due_cents: 100000,
    });
    await expect(record("invoice", invoice({ id: p.id, expected_version: 2 }))).rejects.toThrow(
      /saved payment application/,
    );
  });
  it("denies unauthorized callers and direct private surfaces", async () => {
    for (const user of [outsider, superintendent, estimator])
      await expect(record("payment_application_read", {}, user)).rejects.toThrow();
    await expect(query("SELECT * FROM mcp_payment_applications")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      query("SELECT mcp_pa_dispatch($1,$2,$3::jsonb)", [job, "payment_application_read", "{}"]),
    ).rejects.toThrow(/permission denied/);
  });
  it("rejects stale source, stale version, absent/expired/changed review and wrong job", async () => {
    const p = await payload();
    p.application.number = "Stale checks";
    p.application.evidence = (await context()).evidence as any; // draft may retain unreconciled evidence as Needed
    p.application.evidence = [];
    const r = await record("payment_application_review", p);
    await expect(record("payment_application_save", p)).rejects.toThrow(/Review expired/);
    await expect(
      record("payment_application_save", {
        ...p,
        application: { ...p.application, source: "altered" },
        review_key: r.review_key,
      }),
    ).rejects.toThrow(/Review expired/);
    await db.query(
      "UPDATE mcp_payment_application_reviews SET expires_at=now()-interval '1 second' WHERE id=$1",
      [r.review_key],
    );
    await expect(
      record("payment_application_save", { ...p, review_key: r.review_key }),
    ).rejects.toThrow(/Review expired/);
    p.application.snapshot.fingerprint = "stale";
    await expect(record("payment_application_review", p)).rejects.toThrow(/SOV changed/);
  });
  it("SQL and TypeScript arithmetic agree on unknowns, storage and release", async () => {
    for (const change of [
      {},
      { work_cents: null },
      { release_cents: 10000, release_basis: "Approved release" },
      { work_cents: 5, stored_cents: 0 },
    ]) {
      const a = applicationFixture();
      Object.assign(a.lines[0], change);
      const q = await db.query<any>("SELECT mcp_pa_calculate($1::jsonb,'[]') AS data", [
        JSON.stringify(a),
      ]);
      const ts = calculateApplication(a);
      for (const k of [
        "gross_cents",
        "retained_cents",
        "payment_due_cents",
        "billing_gross_cents",
        "balance_including_retainage_cents",
      ])
        expect(q.rows[0].data[k]).toBe((ts as any)[k]);
    }
  });
});

// Release regression controls; isolated local fixture only.
describe("independent release controls", () => {
  it("does not issue a second first-application for already applied same SOV work", async () => {
    const first = await payload();
    first.application.state = "submitted";
    await save(first);
    const second = await payload();
    second.application.number = "Application 2";
    second.application.state = "submitted";
    second.application.period_start = "2026-02-01";
    second.application.period_end = "2026-02-28";
    second.application.prior_cutoff = "2026-01-31";
    second.application.evidence = [
      { id: first.id, version: 1, treatment: "separate", reason: "Separate prior billing" },
    ];
    // Same SOV and exactly the same completed/stored work, but a new first-app declaration.
    await expect(save(second)).rejects.toThrow();
  });
  it("does not swallow lost job authorization as a missing current SOV", async () => {
    const p = await payload();
    await save(p);
    const original = (
      await db.query<any>(
        "select pg_get_functiondef('public.mcp_pa_snapshot(uuid)'::regprocedure) as sql",
      )
    ).rows[0].sql;
    try {
      // Model a scope revocation observed at snapshot after the dispatch job-lock boundary.
      await db.exec(
        `CREATE OR REPLACE FUNCTION public.mcp_pa_snapshot(_job uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$ BEGIN RAISE EXCEPTION 'MCP_BAD:Billing evidence requires full project access.'; END $$;`,
      );
      await expect(record("payment_application_read", { id: p.id, version: 1 })).rejects.toThrow(
        /access/,
      );
    } finally {
      await db.exec(original);
    }
  });
});

describe("independent saved-source provenance", () => {
  it("invalidates review when the source fact changes while its value stays the same", async () => {
    const p = await payload();
    const r = await record("payment_application_review", p);
    try {
      await db.query(
        "UPDATE mcp_job_facts SET source='document' WHERE job_id=$1 AND module='sov' AND key='01'",
        [job],
      );
      await expect(
        record("payment_application_save", { ...p, review_key: r.review_key }),
      ).rejects.toThrow(/changed|stale|Review/);
    } finally {
      await db.query(
        "UPDATE mcp_job_facts SET source='member_answer' WHERE job_id=$1 AND module='sov' AND key='01'",
        [job],
      );
    }
  });
});

describe("independent issued-certificate lifecycle", () => {
  it("can record an actual certificate for frozen issued work after a later SOV update", async () => {
    const p = await payload();
    p.application.state = "submitted";
    await save(p);
    try {
      await db.query(
        "UPDATE mcp_job_facts SET value='110000'::jsonb WHERE job_id=$1 AND module='contract' AND key='contract_value'",
        [job],
      );
      await db.query(
        "UPDATE mcp_job_facts SET value=jsonb_set(value,'{billable_value}','110000') WHERE job_id=$1 AND module='sov' AND key='01'",
        [job],
      );
      const cert = {
        ...p,
        request_id: crypto.randomUUID(),
        expected_version: 1,
        application: {
          ...p.application,
          state: "certified",
          reason: "Received actual certificate for original issued period",
          certification: {
            amount_cents: 1350000,
            date: "2026-02-02",
            source: "Certificate against submitted January application",
          },
        },
      };
      const changed = {
        ...cert,
        application: {
          ...cert.application,
          lines: cert.application.lines.map((l) => ({ ...l, work_cents: 1100000 })),
        },
      };
      await expect(save(changed as any)).rejects.toThrow(/SOV changed/);
      await expect(save(cert as any)).resolves.toMatchObject({ version: 2, state: "certified" });
      const ledger = (await get()).invoices as any[];
      expect(ledger).toHaveLength(1);
      expect(ledger[0].versions[0].net_due_cents).toBe(1350000);
    } finally {
      await db.query(
        "UPDATE mcp_job_facts SET value='100000'::jsonb WHERE job_id=$1 AND module='contract' AND key='contract_value'",
        [job],
      );
      await db.query(
        "UPDATE mcp_job_facts SET value=jsonb_set(value,'{billable_value}','100000') WHERE job_id=$1 AND module='sov' AND key='01'",
        [job],
      );
    }
  });
});

describe("reviewed contract basis", () => {
  const readBasis = () => record("contract_basis_read", {});
  const proposal = async () => ({
    request_id: crypto.randomUUID(),
    expected_version: (await readBasis()).version,
    original_cents: 10000000,
    basis: "Owner-provided original contract amount",
  });
  it("establishes missing canonical facts through the real review/save path and enables the application snapshot", async () => {
    await db.query("DELETE FROM mcp_job_facts WHERE job_id=$1 AND module='contract'", [job]);
    expect((await context()).snapshot).toBeNull();
    const p = await proposal();
    const reviewed = await record("contract_basis_review", p);
    expect((await context()).snapshot).toBeNull();
    const saveRequest = { ...p, review_key: reviewed.review_key };
    expect(await record("contract_basis_outcome", saveRequest)).toEqual({ applied: false });
    const result = await record("contract_basis_save", saveRequest);
    expect(result).toMatchObject({
      saved: true,
      original_cents: 10000000,
      approved_cents: 10000000,
    });
    expect((await context()).snapshot).toMatchObject({ contract_cents: 10000000 });
    expect(await record("contract_basis_save", saveRequest)).toMatchObject({
      already_applied: true,
    });
    expect(await record("contract_basis_outcome", saveRequest)).toMatchObject({ applied: true });
    expect(await record("contract_basis_review", p)).toMatchObject({
      applied: true,
      already_applied: true,
    });
    const facts = await db.query(
      "SELECT key,source,value FROM mcp_job_facts WHERE job_id=$1 AND module='contract' ORDER BY key",
      [job],
    );
    expect(facts.rows).toHaveLength(2);
    expect(facts.rows.every((r: any) => r.source === "member_answer")).toBe(true);
    expect((await get()).invoices).toEqual([]);
    const application = await payload();
    application.application.state = "draft";
    await save(application);
    expect(
      await record("payment_application_read", { id: application.id, version: 1 }),
    ).toMatchObject({ selected: { version: 1 } });
    expect((await get()).invoices).toEqual([]);
  });
  it("rejects an absent-fact review after another amount/source appears without overwriting it", async () => {
    await db.query("DELETE FROM mcp_job_facts WHERE job_id=$1 AND module='contract'", [job]);
    const p = await proposal();
    const review = await record("contract_basis_review", p);
    await query(
      'SELECT mcp_set_facts($1,\'contract\',\'{"contract_value":100000,"contract_value_basis":{"reference":"newer source"}}\',\'member_answer\')',
      [job],
    );
    await expect(
      record("contract_basis_save", { ...p, review_key: review.review_key }),
    ).rejects.toThrow(/changed/);
    expect((await readBasis()).basis).toBe("newer source");
  });
  it("invalidates review on same-value provenance or SOV changes, leaving all writes atomic", async () => {
    const p = await proposal();
    const review = await record("contract_basis_review", p);
    await db.query(
      "UPDATE mcp_job_facts SET source='document' WHERE job_id=$1 AND module='contract' AND key='contract_value'",
      [job],
    );
    await expect(
      record("contract_basis_save", { ...p, review_key: review.review_key }),
    ).rejects.toThrow(/changed/);
    const p2 = await proposal();
    const r2 = await record("contract_basis_review", p2);
    await db.query(
      "UPDATE mcp_job_facts SET updated_at=now()+interval '1 second' WHERE job_id=$1 AND module='sov'",
      [job],
    );
    await expect(
      record("contract_basis_save", { ...p2, review_key: r2.review_key }),
    ).rejects.toThrow(/changed/);
  });
  it("rejects mismatched amount, unknown changes, changed payload, expired review and unauthorized callers", async () => {
    const p = await proposal();
    await expect(record("contract_basis_review", { ...p, original_cents: 100 })).rejects.toThrow(
      /Reconcile/,
    );
    const review = await record("contract_basis_review", p);
    await expect(
      record("contract_basis_save", {
        ...p,
        basis: "Different basis",
        review_key: review.review_key,
      }),
    ).rejects.toThrow(/Review expired or changed/);
    await db.query(
      "UPDATE mcp_payment_application_reviews SET expires_at=now()-interval '1 second' WHERE id=$1",
      [review.review_key],
    );
    await expect(
      record("contract_basis_save", { ...p, review_key: review.review_key }),
    ).rejects.toThrow(/Review expired/);
    for (const user of [outsider, superintendent, estimator])
      await expect(record("contract_basis_read", {}, user)).rejects.toThrow();
  });
  it("rolls back the fact and review consumption if the full canonical snapshot is still invalid", async () => {
    const p = await proposal();
    const r = await record("contract_basis_review", p);
    await db.query(
      "UPDATE mcp_job_facts SET key='CF' WHERE job_id=$1 AND module='sov' AND key='01'",
      [job],
    );
    const p2 = await proposal();
    const r2 = await record("contract_basis_review", p2);
    await expect(
      record("contract_basis_save", { ...p2, review_key: r2.review_key }),
    ).rejects.toThrow(/Reconcile/);
    expect(
      (
        await db.query<{ consumed_at: unknown }>(
          "SELECT consumed_at FROM mcp_payment_application_reviews WHERE id=$1",
          [r2.review_key],
        )
      ).rows[0].consumed_at,
    ).toBeNull();
    await db.query(
      "UPDATE mcp_job_facts SET key='01' WHERE job_id=$1 AND module='sov' AND key='CF'",
      [job],
    );
  });
  it("preserves approved changes separately and stales an earlier application review after a source change", async () => {
    const application = await payload();
    const priorReview = await record("payment_application_review", application);
    const p = await proposal();
    const r = await record("contract_basis_review", p);
    await record("contract_basis_save", { ...p, review_key: r.review_key });
    await expect(
      record("payment_application_save", { ...application, review_key: priorReview.review_key }),
    ).rejects.toThrow(/SOV changed/);
    const co = crypto.randomUUID();
    await db.query("INSERT INTO mcp_submittals VALUES($1,$2,'CO-01',1)", [co, job]);
    await db.query(
      'INSERT INTO mcp_change_orders VALUES($1,$2,\'{"state":"approved","total_cents":100000}\')',
      [co, job],
    );
    try {
      const p2 = { ...(await proposal()), original_cents: 9900000 };
      const r2 = await record("contract_basis_review", p2);
      expect(r2.approved_cents).toBe(10000000);
      await record("contract_basis_save", { ...p2, review_key: r2.review_key });
      expect(await readBasis()).toMatchObject({
        original_cents: 9900000,
        change_cents: 100000,
        approved_cents: 10000000,
      });
      await db.query(
        'UPDATE mcp_change_orders SET details=\'{"state":"approved","total_cents":10000000}\' WHERE submittal_id=$1',
        [co],
      );
      const zero = { ...(await proposal()), original_cents: 0 };
      const zeroReview = await record("contract_basis_review", zero);
      await record("contract_basis_save", { ...zero, review_key: zeroReview.review_key });
      expect(await readBasis()).toMatchObject({ original_cents: 0, approved_cents: 10000000 });
      await db.query(
        'UPDATE mcp_change_orders SET details=\'{"state":"approved"}\' WHERE submittal_id=$1',
        [co],
      );
      await expect(record("contract_basis_review", await proposal())).rejects.toThrow(/Reconcile/);
    } finally {
      await db.query("DELETE FROM mcp_change_orders WHERE submittal_id=$1", [co]);
      await db.query("DELETE FROM mcp_submittals WHERE id=$1", [co]);
      await query(
        "SELECT mcp_set_facts($1,'contract','{\"contract_value\":100000}','member_answer')",
        [job],
      );
    }
  });
  it("keeps the helper private and refuses membership-revoked cached outcomes", async () => {
    const p = await proposal();
    const r = await record("contract_basis_review", p);
    const save = { ...p, review_key: r.review_key };
    await record("contract_basis_save", save);
    await expect(
      query("SELECT mcp_pa_contract_basis($1,'contract_basis_read','{}')", [job]),
    ).rejects.toThrow(/permission denied/);
    await db.query("DELETE FROM test_active_members WHERE user_id=$1", [owner]);
    await db.query("DELETE FROM mcp_gate_cache WHERE user_id=$1", [owner]);
    try {
      await expect(record("contract_basis_outcome", save)).rejects.toThrow();
    } finally {
      await db.query("INSERT INTO test_active_members VALUES($1)", [owner]);
    }
  });
});

describe("shared conversational working draft", () => {
  it("preserves an unresolved this-period request, deduplicates, rejects stale writes, and never issues billing", async () => {
    const ctx = await context();
    const a = applicationFixture();
    a.snapshot = ctx.snapshot as typeof a.snapshot;
    Object.assign(a, {
      number: "",
      source: "Member request",
      period_start: "",
      period_end: "",
      prior_cutoff: "",
      state: "draft",
      certification: null,
    });
    a.lines[0].prior_work_cents = null;
    a.lines[0].work_cents = null;
    const id = crypto.randomUUID(),
      request_id = crypto.randomUUID();
    const p = {
      id,
      request_id,
      request_hash: "a".repeat(64),
      expected_version: 0,
      operation: "save",
      application: a,
      intent: { [a.lines[0].item]: { basis: "this_period", amount_cents: 3000000 } },
    };
    const saved = await record("payment_application_working", p);
    expect(saved).toMatchObject({ id, version: 1, working_state: "open" });
    const read = await record("payment_application_read", { id, version: 1 });
    const selected = read.selected as any;
    expect(selected.body.lines[0].work_cents).toBeNull();
    expect(selected.working_intent[a.lines[0].item].amount_cents).toBe(3000000);
    expect(selected.calculation.complete).toBe(false);
    expect(selected.calculation.payment_due_cents).toBeNull();
    expect(await record("payment_application_working", p)).toMatchObject({
      version: 1,
      already_applied: true,
    });
    expect(
      await record("payment_application_working_outcome", {
        id,
        request_id,
        request_hash: p.request_hash,
      }),
    ).toMatchObject({ version: 1, applied: true });
    await expect(
      record("payment_application_working", {
        ...p,
        request_id: crypto.randomUUID(),
        request_hash: "b".repeat(64),
      }),
    ).rejects.toThrow(/changed/);
    expect((await get()).invoices).toEqual([]);
    const cancel = {
      id,
      request_id: crypto.randomUUID(),
      request_hash: "c".repeat(64),
      expected_version: 1,
      operation: "cancel",
    };
    expect(await record("payment_application_working", cancel)).toMatchObject({
      version: 2,
      working_state: "cancelled",
    });
    await expect(
      record("payment_application_review", {
        id,
        request_id: crypto.randomUUID(),
        expected_version: 2,
        application: a,
      }),
    ).rejects.toThrow();
    expect(
      await record("payment_application_working", {
        ...cancel,
        request_id: crypto.randomUUID(),
        request_hash: "d".repeat(64),
        expected_version: 2,
        operation: "resume",
      }),
    ).toMatchObject({ version: 3, working_state: "open" });
    for (const user of [outsider, superintendent, estimator])
      await expect(record("payment_application_working", p, user)).rejects.toThrow();
  });
});

describe("conversation to a shared application draft", () => {
  const invoke = (args: any) => (paymentApplicationPrepare as any).handler(args, {});
  it("keeps the requested this-period amount pending until prior work is known, supports retry and exact revisions without issuing billing", async () => {
    const request = {
      job_number: "2701",
      operation: "prepare",
      request_id: crypto.randomUUID(),
      request_text: "Bill 30000 this period for construction work",
      changes: [{ line: "Construction work", basis: "this_period", amount_cents: 3000000 }],
    };
    const first = await invoke(request);
    const selected = first.structuredContent.selected;
    expect(selected.body.source).toBe("");
    expect(selected.version).toBe(1);
    expect(selected.body.lines[0].work_cents).toBeNull();
    expect(selected.working_intent["01"]).toEqual({ basis: "this_period", amount_cents: 3000000 });
    expect(first.structuredContent.application_url).toContain(
      `application_id=${request.request_id}&version=1`,
    );
    expect(first.content[0].text).toMatch(/No billing was submitted or certified/);
    expect(first.structuredContent.questions.join(" ")).toMatch(/prior installed work is needed/);
    const retry = await invoke(request);
    expect(retry.structuredContent).toMatchObject({
      already_applied: true,
      selected: { version: 1 },
    });
    await expect(
      invoke({ ...request, changes: [{ ...request.changes[0], amount_cents: 4000000 }] }),
    ).rejects.toThrow(/different content/);
    const revise = {
      ...request,
      request_id: crypto.randomUUID(),
      application_id: request.request_id,
      expected_version: 1,
      changes: [{ ...request.changes[0], prior_work_cents: 1000000 }],
    };
    const updated = await invoke(revise);
    expect(updated.structuredContent.selected.body.lines[0].work_cents).toBe(4000000);
    expect(updated.structuredContent.selected.version).toBe(2);
    await expect(invoke({ ...revise, request_id: crypto.randomUUID() })).rejects.toThrow(/changed/);
    expect((await get()).invoices).toEqual([]);
    const read = await (paymentApplicationRead as any).handler(
      { job_number: "2701", application_id: request.request_id, version: 2 },
      {},
    );
    expect(read.structuredContent.document_url).toBeNull();
  });
  it("does not lose unresolved intent or review unsaved changes when finalizing a working draft", async () => {
    const ctx = await context();
    const a = applicationFixture();
    a.snapshot = ctx.snapshot as typeof a.snapshot;
    a.lines[0].prior_work_cents = null;
    a.lines[0].work_cents = null;
    const id = crypto.randomUUID();
    const working = {
      id,
      request_id: crypto.randomUUID(),
      request_hash: "9".repeat(64),
      expected_version: 0,
      operation: "save",
      application: a,
      intent: { [a.lines[0].item]: { basis: "this_period", amount_cents: 3000000 } },
    };
    await record("payment_application_working", working);
    const review = { id, request_id: crypto.randomUUID(), expected_version: 1, application: a };
    await expect(record("payment_application_review", review)).rejects.toThrow(
      /Prior installed work is Needed/,
    );
    const changed = { ...a, source: "A change not yet saved" };
    await expect(
      record("payment_application_review", { ...review, application: changed }),
    ).rejects.toThrow(/Save the working changes/);
    const read = await record("payment_application_read", { id, version: 1 });
    expect((read.selected as any).working_intent[a.lines[0].item].amount_cents).toBe(3000000);
    expect((await get()).invoices).toEqual([]);
  });
  it("invalidates stale final reviews and issues exactly once only after a new exact review", async () => {
    const base = await payload();
    const draft = {
      ...base,
      request_hash: "e".repeat(64),
      operation: "save",
      application: { ...base.application, state: "draft" },
      intent: {},
    };
    await record("payment_application_working", draft);
    const formal = {
      id: base.id,
      request_id: crypto.randomUUID(),
      expected_version: 1,
      application: { ...base.application, state: "submitted" },
    };
    const staleReview = await record("payment_application_review", formal);
    expect((await get()).invoices).toHaveLength(0);
    const next = {
      ...draft,
      request_id: crypto.randomUUID(),
      request_hash: "f".repeat(64),
      expected_version: 1,
      application: { ...draft.application, source: "Updated actual source" },
    };
    await record("payment_application_working", next);
    await expect(
      record("payment_application_save", { ...formal, review_key: staleReview.review_key }),
    ).rejects.toThrow();
    expect((await get()).invoices).toHaveLength(0);
    const current = {
      ...formal,
      request_id: crypto.randomUUID(),
      expected_version: 2,
      application: { ...formal.application, source: "Updated actual source" },
    };
    const reviewed = await record("payment_application_review", current);
    const result = await record("payment_application_save", {
      ...current,
      review_key: reviewed.review_key,
    });
    expect(result).toMatchObject({ id: base.id, version: 3, state: "submitted" });
    expect(
      await record("payment_application_save", { ...current, review_key: reviewed.review_key }),
    ).toMatchObject({ version: 3, already_applied: true });
    expect((await get()).invoices).toHaveLength(1);
  });
  it("carries only an explicitly selected current actual certificate into a new chat draft", async () => {
    const first = await payload();
    first.application.state = "submitted";
    await save(first);
    const certified = {
      ...first,
      request_id: crypto.randomUUID(),
      expected_version: 1,
      application: {
        ...first.application,
        state: "certified" as const,
        reason: "Record actual certificate",
        certification: { amount_cents: 1200000, date: "2026-02-02", source: "Actual certificate" },
      },
    };
    await save(certified);
    const request = {
      job_number: "2701",
      operation: "prepare",
      request_id: crypto.randomUUID(),
      request_text: "Continue from the saved certificate and bill 3000 this period",
      patch: { prior_mode: "saved", prior_application: { id: first.id, version: 2 } },
      changes: [{ line: "Construction work", basis: "this_period", amount_cents: 300000 }],
    };
    const result = await invoke(request);
    const body = result.structuredContent.selected.body;
    expect(body.prior_application).toEqual({ id: first.id, version: 2 });
    expect(body.prior_certified_net_cents).toBe(1200000);
    expect(body.lines[0].prior_work_cents).toBe(1000000);
    expect(body.lines[0].work_cents).toBe(1300000);
    expect((await get()).invoices).toHaveLength(1);
    await expect(
      invoke({
        ...request,
        request_id: crypto.randomUUID(),
        patch: { prior_mode: "saved", prior_application: { id: first.id, version: 1 } },
      }),
    ).rejects.toThrow(/latest saved actual certificate/);
  });
  it("asks before saving when line, amount basis or line capacity is unclear", async () => {
    const args = {
      job_number: "2701",
      operation: "prepare",
      request_id: crypto.randomUUID(),
      request_text: "Bill it",
      changes: [{ line: "unknown", basis: "this_period", amount_cents: 100 }],
    };
    expect((await invoke(args)).structuredContent).toMatchObject({ saved: false });
    expect(
      (
        await invoke({
          ...args,
          request_id: crypto.randomUUID(),
          changes: [{ line: "Construction work", amount_cents: 100 }],
        })
      ).structuredContent,
    ).toMatchObject({ saved: false });
    expect(
      (
        await invoke({
          ...args,
          request_id: crypto.randomUUID(),
          changes: [{ line: "Construction work", basis: "cumulative", amount_cents: 10000001 }],
        })
      ).structuredContent,
    ).toMatchObject({ saved: false });
    expect((await context()).applications).toEqual([]);
  });
});
