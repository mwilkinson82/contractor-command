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
  await db.query("INSERT INTO auth.users(id,email) VALUES ($1,'owner@example.com')", [owner]);
  await db.query("INSERT INTO test_active_members VALUES ($1)", [owner]);
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES ($1,'Fictional Construction',$2)", [company, owner]);
  await db.query("INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES ($1,$2,'owner','QA Owner')", [company, owner]);
  await db.query("INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name) VALUES ($1,$2,$3,'2701','Harbor Point'),($4,$2,$3,'2702','Second job')", [job, owner, company, fresh]);
});
afterAll(async () => {
  await db?.close();
});

describe("SOV total guard", () => {
  it("allows the first SOV, refuses a line that moves $1,400,000.00 to $1,450,000.00, and allows a rebalance", async () => {
    await facts({
      "26.01": { description: "Mobilization", billable_value: 1145000 },
      "26.06": { description: "Branch circuit rough-in and devices", billable_value: 255000 },
    });
    await call("SELECT public.mcp_job_sov_terms($1,0,'Exhibit B')", [job]);
    await expect(facts({ "26.06": { description: "Branch circuit rough-in and devices", billable_value: 305000 } })).rejects.toThrow(
      "Contract value changes only by change order. Nothing was saved.",
    );
    expect(await valueOf("26.06")).toBe(255000);
    await facts({
      "26.06": { description: "Branch circuit rough-in and devices", billable_value: 305000 },
      "26.01": { description: "Mobilization", billable_value: 1095000 },
    });
    expect(await valueOf("26.06")).toBe(305000);
    expect(await valueOf("26.01")).toBe(1095000);
    await facts({ "26.06": { description: "Renamed branch rough-in", billable_value: 305000 } });
    const renamed = await db.query<{ description: string }>("SELECT value->>'description' AS description FROM mcp_job_facts WHERE job_id=$1 AND key='26.06'", [job]);
    expect(renamed.rows[0].description).toBe("Renamed branch rough-in");
    await expect(call("SELECT public.mcp_job_sov_terms($1,10,NULL)", [job])).rejects.toThrow(
      "Contract value changes only by change order. Nothing was saved.",
    );
    const fee = await db.query<{ fee: string }>("SELECT sov_fee_pct::text AS fee FROM mcp_jobs WHERE id=$1", [job]);
    expect(Number(fee.rows[0].fee)).toBe(0);
    await call("SELECT public.mcp_set_facts($1,'sov',$2::jsonb,'member_answer')", [fresh, JSON.stringify({ "01.01": { description: "First line", billable_value: 1000 } })]);
    await call("SELECT public.mcp_job_sov_terms($1,10,'Schedule A')", [fresh]);
    const second = await db.query<{ fee: string }>("SELECT sov_fee_pct::text AS fee FROM mcp_jobs WHERE id=$1", [fresh]);
    expect(Number(second.rows[0].fee)).toBe(10);
  });
});
