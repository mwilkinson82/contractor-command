import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

const owner = "00000000-0000-4000-8000-000000000071";
const company = "00000000-0000-4000-8000-000000000072";
const job = "00000000-0000-4000-8000-000000000073";
const fresh = "00000000-0000-4000-8000-000000000074";
let db: PGlite;
const claims = { sub: owner, email: "owner@example.com", role: "authenticated" as const };
const call = (sql: string, values: unknown[] = []) =>
  asUser(db, claims, (tx) => tx.query(sql, values) as Promise<{ rows: Record<string, unknown>[] }>);
const facts = (lines: Record<string, unknown>) =>
  call("SELECT public.mcp_set_facts($1,'sov',$2::jsonb,'member_answer') AS data", [job, JSON.stringify(lines)]);
const valueOf = async (key: string) => {
  const row = await db.query<{ billable: number }>("SELECT (value->>'billable_value')::numeric AS billable FROM mcp_job_facts WHERE job_id=$1 AND module='sov' AND key=$2", [job, key]);
  return Number(row.rows[0].billable);
};

beforeAll(async () => {
  db = await makeDb();
  await db.exec(readFileSync("supabase/migrations/20261030140000_athena_sov_contract_total_guard.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261030150000_athena_sov_official_lock.sql", "utf8"));
  await db.query("INSERT INTO auth.users(id,email) VALUES ($1,'owner@example.com')", [owner]);
  await db.query("INSERT INTO test_active_members VALUES ($1)", [owner]);
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES ($1,'Fictional Construction',$2)", [company, owner]);
  await db.query("INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES ($1,$2,'owner','QA Owner')", [company, owner]);
  await db.query("INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name) VALUES ($1,$2,$3,'2701','Harbor Point'),($4,$2,$3,'2702','Second job')", [job, owner, company, fresh]);
});
afterAll(async () => {
  await db?.close();
});

const REFUSAL = "SOV changes only by approved change order. Nothing was saved.";

describe("SOV official lock and draft copy", () => {
  it("locks official dollars, allows text, and lets a draft change without touching the official SOV", async () => {
    await facts({
      "26.01": { description: "Mobilization", billable_value: 1145000, cost_codes: ["26-100"] },
      "26.06": { description: "Branch circuit rough-in and devices", billable_value: 255000, cost_codes: ["26-600"] },
    });
    await call("SELECT public.mcp_job_sov_terms($1,0,'Exhibit B')", [job]);
    await expect(facts({ "26.06": { description: "Branch circuit rough-in and devices", billable_value: 305000, cost_codes: ["26-600"] } })).rejects.toThrow(REFUSAL);
    await expect(facts({
      "26.06": { description: "Branch circuit rough-in and devices", billable_value: 305000, cost_codes: ["26-600"] },
      "26.01": { description: "Mobilization", billable_value: 1095000, cost_codes: ["26-100"] },
    })).rejects.toThrow(REFUSAL);
    expect(await valueOf("26.06")).toBe(255000);
    expect(await valueOf("26.01")).toBe(1145000);
    await facts({ "26.06": { description: "Renamed branch rough-in", billable_value: 255000, cost_codes: ["26-610"] } });
    const renamed = await db.query<{ description: string; code: string }>("SELECT value->>'description' AS description, value->'cost_codes'->>0 AS code FROM mcp_job_facts WHERE job_id=$1 AND module='sov' AND key='26.06'", [job]);
    expect(renamed.rows[0]).toEqual({ description: "Renamed branch rough-in", code: "26-610" });
    await expect(call("SELECT public.mcp_job_sov_terms($1,10,NULL)", [job])).rejects.toThrow(REFUSAL);
    await call("SELECT public.mcp_set_facts($1,'sov_draft',$2::jsonb,'member_answer')", [job, JSON.stringify({
      "26.01": { description: "Mobilization", billable_value: 1145000 },
      "26.06": { description: "Branch circuit rough-in and devices", billable_value: 255000 },
      "26.90": { description: "Expected change order", billable_value: 50000 },
    })]);
    expect(await valueOf("26.06")).toBe(255000);
    const draft = await db.query<{ n: string }>("SELECT (value->>'billable_value')::text AS n FROM mcp_job_facts WHERE job_id=$1 AND module='sov_draft' AND key='26.90'", [job]);
    expect(draft.rows[0].n).toBe("50000");
    const contract = await db.query("SELECT key FROM mcp_job_facts WHERE job_id=$1 AND module='contract'", [job]);
    expect(contract.rows).toHaveLength(0);
    await call("SELECT public.mcp_set_facts($1,'sov',$2::jsonb,'member_answer')", [fresh, JSON.stringify({ "01.01": { description: "First line", billable_value: 1000 } })]);
    await call("SELECT public.mcp_job_sov_terms($1,10,'Schedule A')", [fresh]);
    const second = await db.query<{ fee: string }>("SELECT sov_fee_pct::text AS fee FROM mcp_jobs WHERE id=$1", [fresh]);
    expect(Number(second.rows[0].fee)).toBe(10);
  });
});
