import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

const owner = "00000000-0000-4000-8000-000000000091";
const outsider = "00000000-0000-4000-8000-000000000092";
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
  for (const user of [owner, outsider]) {
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
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name,time_zone) VALUES($1,$2,$3,'2701','Synthetic Job','America/Chicago')",
    [job, owner, company],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name,time_zone) VALUES($1,$2,$3,'2702','Other synthetic job','America/Chicago')",
    [otherJob, owner, company],
  );
  await db.exec(
    readFileSync("supabase/migrations/20261027215632_athena_project_billing_evidence.sql", "utf8"),
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
});
