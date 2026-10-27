import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  await db.exec(
    readFileSync("supabase/migrations/20261101120001_athena_project_billing_evidence.sql", "utf8"),
  );
});
afterAll(async () => {
  await db?.close();
});
describe("project billing evidence", () => {
  it("records invoice and independent partial cash with safe retries", async () => {
    const p = invoice();
    const first = await record("invoice", p);
    expect(first.version).toBe(1);
    expect((await record("invoice", p)).already_applied).toBe(true);
    await expect(record("invoice", { ...p, gross_cents: 1 })).rejects.toThrow(/different content/);
    const receipt = {
      request_id: crypto.randomUUID(),
      id: crypto.randomUUID(),
      receipt_date: "2026-10-10",
      source: "check 1",
      amount_cents: 40000,
    };
    await record("receipt", receipt);
    await expect(
      record("receipt", {
        ...receipt,
        request_id: crypto.randomUUID(),
        id: crypto.randomUUID(),
        source: " CHECK 1 ",
      }),
    ).rejects.toThrow();
    const allocation = {
      request_id: crypto.randomUUID(),
      id: crypto.randomUUID(),
      receipt_id: receipt.id,
      invoice_id: p.id,
      effective_date: "2026-10-10",
      source: "remittance",
      amount_cents: 30000,
    };
    await record("allocation", allocation);
    expect((await record("allocation", allocation)).already_applied).toBe(true);
    await expect(
      record("allocation", {
        ...allocation,
        id: crypto.randomUUID(),
        request_id: crypto.randomUUID(),
        amount_cents: 10001,
      }),
    ).rejects.toThrow(/unapplied cash/);
    const result = await get();
    expect(result.invoices).toHaveLength(1);
    expect(result.receipts).toHaveLength(1);
    expect(result.allocations).toHaveLength(1);
    await expect(
      record("invoice", {
        ...p,
        request_id: crypto.randomUUID(),
        expected_version: 1,
        status: "void",
        reason: "void",
      }),
    ).rejects.toThrow(/allocated cash/);
    const reversal = {
      request_id: crypto.randomUUID(),
      id: crypto.randomUUID(),
      allocation_id: allocation.id,
      effective_date: "2026-10-11",
      source: "Correction",
      amount_cents: 30000,
    };
    await record("reverse_allocation", reversal);
    await expect(
      record("reverse_allocation", {
        ...reversal,
        id: crypto.randomUUID(),
        request_id: crypto.randomUUID(),
        amount_cents: 1,
      }),
    ).rejects.toThrow(/reversal exceeds/);
    await record("invoice", {
      ...p,
      request_id: crypto.randomUUID(),
      expected_version: 1,
      status: "void",
      reason: "Source void",
    });
    await expect(
      record("invoice", {
        ...p,
        request_id: crypto.randomUUID(),
        expected_version: 0,
        reason: "stale",
      }),
    ).rejects.toThrow(/version changed/);
  });
  it("preserves revisions and credit evidence, and denies other projects", async () => {
    const p = invoice();
    await record("invoice", p);
    await record("invoice", {
      ...p,
      request_id: crypto.randomUUID(),
      expected_version: 1,
      status: "void",
      reason: "Duplicate source document",
    });
    const credit = invoice({ kind: "credit", credit_for: p.id, document_number: "Credit 1" });
    await record("invoice", credit);
    const data = await get();
    expect(
      data.invoices.find((i) => i.versions.length === 2)?.versions.map((v) => v.status),
    ).toEqual(["void", "submitted"]);
    await expect(get(outsider)).rejects.toThrow();
    await expect(
      record(
        "receipt",
        {
          request_id: crypto.randomUUID(),
          id: crypto.randomUUID(),
          receipt_date: "2026-10-01",
          source: "test",
          amount_cents: 1,
        },
        outsider,
      ),
    ).rejects.toThrow();
  });
  it("rejects cross-project references and malformed monetary facts", async () => {
    const p = invoice();
    await record("invoice", p);
    const receipt = {
      request_id: crypto.randomUUID(),
      id: crypto.randomUUID(),
      receipt_date: "2026-10-10",
      source: "Other project check",
      amount_cents: 100,
    };
    await query("SELECT public.mcp_billing_evidence_record($1,$2,$3::jsonb)", [
      otherJob,
      "receipt",
      JSON.stringify(receipt),
    ]);
    await expect(
      record("allocation", {
        request_id: crypto.randomUUID(),
        id: crypto.randomUUID(),
        receipt_id: receipt.id,
        invoice_id: p.id,
        effective_date: "2026-10-10",
        source: "Cross-project test",
        amount_cents: 100,
      }),
    ).rejects.toThrow(/Receipt unavailable/);
    await expect(record("invoice", invoice({ gross_cents: 1.5 }))).rejects.toThrow(
      /integer USD cents/,
    );
    await expect(query("SELECT * FROM public.mcp_billing_invoices")).rejects.toThrow();
  });
  it("keeps submission, certification, release and cash as separate evidence", async () => {
    const p = invoice({ released_cents: 5000 });
    await record("invoice", p);
    let state = await get();
    const current = state.invoices.find((i) => i.versions.some((v) => v.status === "submitted"));
    expect(current).toBeDefined();
    await record("invoice", {
      ...p,
      request_id: crypto.randomUUID(),
      expected_version: 1,
      status: "certified",
      certified_cents: 95000,
      certified_date: "2026-10-03",
      reason: "Certification received",
    });
    state = await get();
    expect(state.invoices.some((i) => i.versions.some((v) => v.status === "certified"))).toBe(true);
    await expect(
      record("invoice", {
        ...p,
        request_id: crypto.randomUUID(),
        expected_version: 2,
        status: "submitted",
        reason: "Downgrade",
      }),
    ).rejects.toThrow(/transition/);
  });
  it("rolls back failed operations and permits a corrected retry without partial records", async () => {
    const p = invoice({ gross_cents: 1.5 });
    await expect(record("invoice", p)).rejects.toThrow(/integer USD cents/);
    const rows = await db.query("SELECT id FROM mcp_billing_invoices WHERE id=$1", [p.id]);
    expect(rows.rows).toHaveLength(0);
    const operation = await db.query(
      "SELECT request_id FROM mcp_billing_operations WHERE job_id=$1 AND request_id=$2",
      [job, p.request_id],
    );
    expect(operation.rows).toHaveLength(0);
    expect((await record("invoice", { ...p, gross_cents: 100000 })).version).toBe(1);
  });
  it("denies assigned superintendents, estimating, and inactive owners for reads and writes", async () => {
    for (const user of [superintendent, estimator]) {
      await expect(get(user)).rejects.toThrow();
      await expect(record("invoice", invoice(), user)).rejects.toThrow();
    }
    await db.query("DELETE FROM test_active_members WHERE user_id=$1", [owner]);
    await db.query("DELETE FROM mcp_gate_cache WHERE user_id=$1", [owner]);
    try {
      await expect(get(owner)).rejects.toThrow();
      await expect(record("invoice", invoice(), owner)).rejects.toThrow();
    } finally {
      await db.query("INSERT INTO test_active_members VALUES($1)", [owner]);
      await db.query("DELETE FROM mcp_gate_cache WHERE user_id=$1", [owner]);
    }
  });
  it("marks the gated reader volatile so PostgREST uses a writable transaction", async () => {
    const r = await db.query(
      "SELECT provolatile FROM pg_proc WHERE oid='public.mcp_billing_evidence_get(uuid)'::regprocedure",
    );
    expect(r.rows[0].provolatile).toBe("v");
  });
  it("rejects duplicate document identities, missing amounts, and cross-project credit references", async () => {
    const p = invoice({ document_number: "Pay App Unique" });
    await record("invoice", p);
    await expect(
      record("invoice", invoice({ document_number: " PAY APP UNIQUE " })),
    ).rejects.toThrow();
    await expect(record("invoice", invoice({ gross_cents: null }))).rejects.toThrow(
      /integer USD cents/,
    );
    const foreign = invoice();
    await query("SELECT public.mcp_billing_evidence_record($1,$2,$3::jsonb)", [
      otherJob,
      "invoice",
      JSON.stringify(foreign),
    ]);
    await expect(
      record("invoice", invoice({ kind: "credit", credit_for: foreign.id })),
    ).rejects.toThrow(/invoice this credit references/);
  });
  it("does not grant direct member access to evidence tables or operations", async () => {
    for (const table of [
      "mcp_billing_invoices",
      "mcp_billing_invoice_versions",
      "mcp_billing_receipts",
      "mcp_billing_allocations",
      "mcp_billing_operations",
    ]) {
      await expect(query(`SELECT * FROM public.${table}`)).rejects.toThrow(/permission denied/);
      await expect(query(`DELETE FROM public.${table}`)).rejects.toThrow(/permission denied/);
    }
  });
  it("prevents request ID reuse by a different authorized actor", async () => {
    const otherOwner = crypto.randomUUID();
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'other-owner@example.com')", [
      otherOwner,
    ]);
    await db.query("INSERT INTO test_active_members VALUES($1)", [otherOwner]);
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Other owner')",
      [company, otherOwner],
    );
    const p = invoice();
    await record("invoice", p);
    await expect(record("invoice", p, otherOwner)).rejects.toThrow(/different content/);
  });
});
