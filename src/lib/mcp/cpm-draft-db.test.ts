import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
import { DRAFT_NOT_OFFICIAL } from "./record-copy";

const owner = "00000000-0000-4000-8000-000000000081";
const company = "00000000-0000-4000-8000-000000000082";
const job = "00000000-0000-4000-8000-000000000083";
let db: PGlite;
const claims = { sub: owner, email: "owner@example.com", role: "authenticated" as const };
const call = (sql: string, values: unknown[] = []) =>
  asUser(db, claims, (tx) => tx.query(sql, values) as Promise<{ rows: Record<string, unknown>[] }>);
const json = (value: unknown) => (typeof value === "string" ? JSON.parse(value) : value) as Record<string, unknown>;
const official = () =>
  db.query<{ version: number; name: string | null; completion: string | null }>(
    `SELECT r.version, r.data->'activities'->0->>'name' AS name, j.contract_completion_date::text AS completion
     FROM mcp_living_reports r JOIN mcp_jobs j ON j.id = r.job_id
     WHERE r.job_id = $1 AND r.report_type = 'cpm' ORDER BY r.version`,
    [job],
  );
const draftRow = () =>
  db.query<{ id: string; version: number; label: string | null; standing: string | null; name: string | null }>(
    `SELECT id::text, version, data->>'label' AS label, data->>'standing' AS standing, data->'activities'->0->>'name' AS name
     FROM mcp_living_reports WHERE job_id = $1 AND report_type = 'cpm_draft'`,
    [job],
  );

beforeAll(async () => {
  db = await makeDb();
  await db.exec(readFileSync("supabase/migrations/20261020213000_athena_living_reports.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261030160000_athena_cpm_draft_copy.sql", "utf8"));
  await db.query("INSERT INTO auth.users(id,email) VALUES ($1,'owner@example.com')", [owner]);
  await db.query("INSERT INTO test_active_members VALUES ($1)", [owner]);
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES ($1,'Fictional Construction',$2)", [company, owner]);
  await db.query("INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES ($1,$2,'owner','QA Owner')", [company, owner]);
  await db.query("INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name,contract_completion_date) VALUES ($1,$2,$3,'2701','Harbor Point','2027-06-01')", [job, owner, company]);
  await db.query(
    `INSERT INTO mcp_living_reports (job_id, report_type, version, data, activity_count, contract_total, forecast_total, change_what, updated_by, updated_by_name)
     VALUES ($1,'cpm',2,$2::jsonb,1,100,100,'Approved baseline',$3,'QA Owner')`,
    [job, JSON.stringify({ activities: [{ id: "A1", name: "Official slab" }] }), owner],
  );
});
afterAll(async () => {
  await db?.close();
});

describe("CPM draft copy", () => {
  it("stores one Draft, not official schedule and leaves the official CPM unchanged", async () => {
    const before = await official();
    const first = json((await call(
      "SELECT public.mcp_cpm_draft_save($1,$2::jsonb,'2026-10-20','Compressed the slab','QA Owner') AS data",
      [job, JSON.stringify({ activities: [{ id: "W1", name: "What-if slab" }] })],
    )).rows[0].data);
    const second = json((await call(
      "SELECT public.mcp_cpm_draft_save($1,$2::jsonb,'2026-10-21','Compressed it again','QA Owner') AS data",
      [job, JSON.stringify({ activities: [{ id: "W1", name: "Compressed again" }] })],
    )).rows[0].data);
    const after = await official();
    const drafts = await draftRow();
    const shown = json((await call("SELECT public.mcp_living_report_get($1,'cpm',NULL) AS data", [job])).rows[0].data);

    expect(before.rows).toEqual([{ version: 2, name: "Official slab", completion: "2027-06-01" }]);
    expect(after.rows).toEqual(before.rows);
    expect(first).toMatchObject({ reused: false, version: 1, label: DRAFT_NOT_OFFICIAL });
    expect(second).toMatchObject({ reused: true, version: 1, id: first.id, label: DRAFT_NOT_OFFICIAL });
    expect(drafts.rows).toEqual([
      { id: String(first.id), version: 1, label: DRAFT_NOT_OFFICIAL, standing: "draft", name: "Compressed again" },
    ]);
    expect(shown.version).toBe(2);
    expect((shown.data as { activities: { name: string }[] }).activities[0].name).toBe("Official slab");
    expect(JSON.stringify(shown)).not.toContain("Compressed again");
  });

  it("still writes the official CPM only through mcp_living_report_save", async () => {
    const draftBefore = await draftRow();
    const saved = json((await call(
      "SELECT public.mcp_living_report_save($1,'cpm',2,$2::jsonb,'2026-10-22',2,100,100,'Added a day',NULL,'QA Owner',NULL,false) AS data",
      [job, JSON.stringify({ activities: [{ id: "A1", name: "Official slab" }, { id: "A2", name: "Added officially" }] })],
    )).rows[0].data);
    const versions = await official();
    const draftAfter = await draftRow();
    expect(saved.version).toBe(3);
    expect(versions.rows.map((row) => row.name)).toEqual(["Official slab", "Official slab"]);
    expect(versions.rows.map((row) => row.version)).toEqual([2, 3]);
    expect(versions.rows.every((row) => row.completion === "2027-06-01")).toBe(true);
    expect(draftAfter.rows).toEqual(draftBefore.rows);
  });
});
