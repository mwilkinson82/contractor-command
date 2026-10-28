import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
import { reconcileBilling } from "./reconciliation";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const owner = id(71),
  outsider = id(72),
  pm = id(73),
  superId = id(74),
  estimator = id(75),
  company = id(76),
  job = id(77),
  otherJob = id(78),
  otherCompany = id(79),
  hiddenJob = id(80);
let db: PGlite;
const query = (sql: string, args: unknown[] = [], user = owner) =>
  asUser(
    db,
    { sub: user, email: `synthetic-${user.slice(-2)}@example.test`, role: "authenticated" },
    (tx) => tx.query(sql, args) as Promise<{ rows: Record<string, unknown>[] }>,
  );
const get = async (user = owner, target = job) =>
  (await query("SELECT public.mcp_billing_evidence_get($1) AS value", [target], user)).rows[0]
    .value;
const record = async (action: string, facts: object) =>
  (
    await query("SELECT public.mcp_billing_evidence_record($1,$2,$3::jsonb) AS value", [
      job,
      action,
      JSON.stringify({ request_id: crypto.randomUUID(), ...facts }),
    ])
  ).rows[0].value;
beforeAll(async () => {
  db = await makeDb();
  for (const user of [owner, outsider, pm, superId, estimator]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [
      user,
      `synthetic-${user.slice(-2)}@example.test`,
    ]);
    await db.query("INSERT INTO test_active_members VALUES($1)", [user]);
  }
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Synthetic A',$3),($2,'Synthetic B',$4)",
    [company, otherCompany, owner, outsider],
  );
  for (const [user, role, c] of [
    [owner, "owner", company],
    [outsider, "owner", otherCompany],
    [pm, "pm", company],
    [superId, "super", company],
    [estimator, "estimating", company],
  ])
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,'Synthetic member')",
      [c, user, role],
    );
  for (const [target, c, number, user] of [
    [job, company, "SYN-A", owner],
    [otherJob, company, "SYN-B", owner],
    [hiddenJob, otherCompany, "SYN-A", outsider],
  ])
    await db.query(
      "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name,time_zone) VALUES($1,$2,$3,$4,'Synthetic job','UTC')",
      [target, user, c, number],
    );
  for (const user of [pm, superId])
    await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
      job,
      user,
      owner,
    ]);
  await db.exec(
    "CREATE TABLE mcp_submittals(id uuid PRIMARY KEY,job_id uuid,number text,revision integer); CREATE TABLE mcp_change_orders(submittal_id uuid PRIMARY KEY,job_id uuid,details jsonb);",
  );
  await db.exec(
    readFileSync("supabase/migrations/20261101120001_athena_project_billing_evidence.sql", "utf8"),
  );
  await record("invoice", {
    id: id(81),
    expected_version: 0,
    kind: "invoice",
    document_number: "SYN-INV",
    status: "submitted",
    invoice_date: "2026-10-01",
    effective_date: "2026-10-01",
    source: "Synthetic invoice",
    gross_cents: 10000,
    withheld_cents: 0,
    released_cents: 0,
    net_due_cents: 10000,
  });
  await record("receipt", {
    id: id(82),
    receipt_date: "2026-10-02",
    source: "Synthetic check",
    amount_cents: 4000,
  });
  await record("allocation", {
    id: id(83),
    receipt_id: id(82),
    invoice_id: id(81),
    effective_date: "2026-10-02",
    source: "Synthetic allocation",
    amount_cents: 4000,
  });
});
afterAll(async () => {
  await db?.close();
});
it("accepts the actual gated RPC schema and reconciles a partial payment with immutable reversal evidence", async () => {
  const before = await get();
  const r = reconcileBilling(before, null, { job_id: job, company_id: company });
  expect(r.coverage.state).toBe("checked");
  expect(r.findings.find((f) => f.code === "invoice_unmatched")?.amount_cents).toBe("6000");
  await record("reverse_allocation", {
    id: id(85),
    allocation_id: id(83),
    receipt_id: id(82),
    amount_cents: 1000,
    effective_date: "2026-10-03",
    source: "Synthetic correction",
  });
  const after = await get();
  const corrected = reconcileBilling(after, null, { job_id: job, company_id: company });
  expect(corrected.coverage.state).toBe("checked");
  expect(corrected.findings.find((f) => f.code === "invoice_unmatched")?.amount_cents).toBe("7000");
  expect(corrected.findings.find((f) => f.code === "receipt_unapplied")?.amount_cents).toBe("1000");
  expect((after as { allocations: unknown[] }).allocations).toHaveLength(2);
});
it("enforces assigned full scope and excludes foreign companies and jobs at the database", async () => {
  expect(
    reconcileBilling(await get(pm), null, { job_id: job, company_id: company }).coverage.state,
  ).toBe("checked");
  for (const user of [outsider, superId, estimator])
    await expect(get(user)).rejects.toThrow(/full project access/i);
  await expect(get(pm, otherJob)).rejects.toThrow(/full project access/i);
  await expect(get(owner, hiddenJob)).rejects.toThrow(/full project access/i);
  expect(((await get(owner, otherJob)) as { invoices: unknown[] }).invoices).toEqual([]);
  await db.query("DELETE FROM test_active_members WHERE user_id=$1", [pm]);
  await db.query("DELETE FROM mcp_gate_cache WHERE user_id=$1", [pm]);
  await expect(get(pm)).rejects.toThrow(/MCP_INACTIVE/);
});
