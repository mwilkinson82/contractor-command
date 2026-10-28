import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
import { readAccountingReport, type AccountingIO } from "../accounting-report-read";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(810),
  outsider = id(811),
  superUser = id(812),
  estimating = id(813),
  company = id(814),
  job = id(815),
  foreignCompany = id(816),
  foreignJob = id(817),
  inactive = id(818);
let db: PGlite;
function ioFor(user: string): AccountingIO {
  const query = (sql: string, values: unknown[]) =>
    asUser(
      db,
      { sub: user, role: "authenticated", email: "synthetic@example.test" },
      (tx) => tx.query(sql, values) as Promise<{ rows: Record<string, unknown>[] }>,
    );
  return {
    rpc: async (name, args) => {
      if (!["mcp_billing_evidence_get"].includes(name))
        return { data: null, error: { code: "PGRST202", message: "optional integration absent" } };
      try {
        const r = await query("SELECT public.mcp_billing_evidence_get($1) AS data", [args._job]);
        return { data: r.rows[0].data, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
    budgetPage: async (j, start, end) => {
      const r = await query(
        "SELECT job_id,key,value,status FROM public.mcp_job_facts WHERE job_id=$1 AND module='budget' ORDER BY key LIMIT $2 OFFSET $3",
        [j, end - start + 1, start],
      );
      return { data: r.rows, error: null };
    },
  };
}
beforeAll(async () => {
  db = await makeDb();
  for (const user of [owner, outsider, superUser, estimating, inactive]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [
      user,
      `${user}@example.test`,
    ]);
    if (user !== inactive) await db.query("INSERT INTO test_active_members VALUES($1)", [user]);
  }
  for (const c of [company, foreignCompany])
    await db.query(
      "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Synthetic company',$2)",
      [c, owner],
    );
  for (const [user, role] of [
    [owner, "owner"],
    [superUser, "super"],
    [estimating, "estimating"],
    [inactive, "owner"],
  ])
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,'Synthetic')",
      [company, user, role],
    );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name) VALUES($1,$2,$3,'SYN-REPORT','Synthetic report job'),($4,$2,$5,'SYN-FOREIGN','Foreign job')",
    [job, owner, company, foreignJob, foreignCompany],
  );
  await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
    job,
    superUser,
    owner,
  ]);
  await db.exec(
    "CREATE TABLE mcp_submittals(id uuid PRIMARY KEY,job_id uuid,number text,revision integer); CREATE TABLE mcp_change_orders(submittal_id uuid PRIMARY KEY,job_id uuid,details jsonb);",
  );
  await db.exec(
    readFileSync("supabase/migrations/20261101120001_athena_project_billing_evidence.sql", "utf8"),
  );
  await db.query(
    "INSERT INTO mcp_job_facts(job_id,module,key,value,status,source,internal_only,updated_by) VALUES($1,'budget','03-100','{\"amount\":100}'::jsonb,'known','member_answer',true,$3),($2,'budget','FOREIGN-SECRET','{\"amount\":999999}'::jsonb,'known','member_answer',true,$3)",
    [job, foreignJob, owner],
  );
});
afterAll(async () => {
  await db?.close();
});
describe("accounting reads through real membership and full-job database gate", () => {
  it("owner receives only the exact job's budget and unknown absent cost data", async () => {
    const report = await readAccountingReport(
      ioFor(owner),
      job,
      { asOf: "2026-10-28" },
      company,
      new Date("2026-10-28T14:00:00Z"),
    );
    expect(report.costCodes.map((r) => r.code)).toEqual(["03-100"]);
    expect(report.metrics.find((r) => r.key === "actual_costs")?.cents).toBeNull();
    expect(JSON.stringify(report)).not.toContain("FOREIGN-SECRET");
  });
  for (const [role, user] of [
    ["outsider", outsider],
    ["superintendent", superUser],
    ["estimating", estimating],
    ["inactive owner", inactive],
  ])
    it(`denies ${role} before budgets or optional financial sources`, async () => {
      await expect(readAccountingReport(ioFor(user), job, { asOf: "2026-10-28" })).rejects.toThrow(
        /full access/,
      );
    });
  it("denies a foreign company's job despite a known job UUID", async () => {
    await expect(
      readAccountingReport(ioFor(owner), foreignJob, { asOf: "2026-10-28" }),
    ).rejects.toThrow(/full access/);
  });
});
