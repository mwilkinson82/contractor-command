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
  const attributes = () =>
    db.query(
      "SELECT oid,proowner,proacl,prosecdef,provolatile,proconfig,proargtypes::text,prorettype FROM pg_proc WHERE oid='mcp_billing_evidence_record(uuid,text,jsonb)'::regprocedure",
    );
  const before = (await attributes()).rows;
  await db.exec(readFileSync("release-proposals/sov-payment-applications.sql", "utf8"));
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
