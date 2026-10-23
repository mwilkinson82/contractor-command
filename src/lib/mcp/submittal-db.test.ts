import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
import { SAMPLE_SUBMITTALS_2701, submittalOverdue } from "./submittals";

const owner = "00000000-0000-4000-8000-000000000010";
const company = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const job = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("submittal log and project record on job 2701", () => {
  it("writes samples through the log function and keeps the record append-only", async () => {
    const db = await makeDb();
    const sql = readFileSync("supabase/migrations/20261023220000_athena_submittal_log.sql", "utf8");
    await db.exec(sql.slice(0, sql.indexOf("CREATE OR REPLACE FUNCTION public.mcp_board_link_open")));
    await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [owner, "owner@pm-agent-roles.test.invalid"]);
    await db.query(`INSERT INTO public.test_active_members VALUES ($1)`, [owner]);
    await db.query(
      `INSERT INTO public.mcp_companies (id, name, created_by) VALUES ($1, 'ALP Test', $2)`,
      [company, owner],
    );
    await db.query(
      `INSERT INTO public.mcp_jobs (id, user_id, name, job_number, company_id, time_zone) VALUES ($1, $2, 'Harbor Point', '2701', $3, 'America/New_York')`,
      [job, owner, company],
    );
    await db.query(
      `INSERT INTO public.mcp_company_members (company_id, user_id, display_name, role) VALUES ($1, $2, 'Owner', 'owner')`,
      [company, owner],
    );
    await db.query(
      `INSERT INTO public.mcp_job_flags (job_id, flag_key, value, source, set_by) VALUES ($1, 'public_job', 'yes', 'member_answer', $2)`,
      [job, owner],
    );
    const claims = { sub: owner, email: "owner@pm-agent-roles.test.invalid", role: "authenticated" as const };
    const saved = await asUser(db, claims, async (tx) => {
      const ids: string[] = [];
      for (const sample of SAMPLE_SUBMITTALS_2701) {
        const row = await tx.query(`SELECT public.mcp_submittal_log($1, 'add', $2::jsonb) AS data`, [job, JSON.stringify(sample)]);
        ids.push(row.rows[0].data.saved_id);
      }
      return ids;
    });
    expect(saved).toHaveLength(4);
    const page = await asUser(db, claims, async (tx) => {
      const row = await tx.query(`SELECT public.mcp_submittal_rows($1) AS data`, [job]);
      return row.rows[0].data;
    });
    expect(page.job_number).toBe("2701");
    expect(page.posture).toBe("strict");
    expect(page.submittals).toHaveLength(4);
    expect(page.submittals.map((row: { title: string }) => row.title).every((title: string) => title.startsWith("SAMPLE"))).toBe(true);
    const numbers = page.submittals.map((row: { transmittal_number: number }) => row.transmittal_number).sort();
    expect(new Set(numbers).size).toBe(4);
    const overdue = page.submittals.filter((row: { required_by: string | null; submitted_on: string | null; due_back: string | null; returned_on: string | null }) => submittalOverdue(row, page.today));
    expect(overdue.length).toBeGreaterThan(0);
    const record = await asUser(db, claims, async (tx) => {
      const row = await tx.query(`SELECT public.mcp_project_record_search($1, NULL, NULL, 'submittal_created', 'SAMPLE') AS data`, [job]);
      return row.rows[0].data;
    });
    expect(record.events.length).toBe(4);
    const denied = await asUser(db, claims, async (tx) => {
      try {
        await tx.query(`UPDATE public.mcp_project_record_events SET title = 'changed'`);
        return "updated";
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(denied).toMatch(/permission denied/);
    await expect(db.query(`UPDATE public.mcp_project_record_events SET title = 'changed'`)).rejects.toThrow(/append-only/);
    await db.exec(readFileSync("supabase/migrations/20261024010000_athena_submittal_chase.sql", "utf8"));
    const chase = await asUser(db, claims, async (tx) => {
      const rows = await tx.query(`SELECT public.mcp_submittal_chase_rows($1) AS data`, [job]);
      const first = rows.rows[0].data.chases[0];
      const marked = await tx.query(`SELECT public.mcp_submittal_chase_mark($1, $2, $3, $4, $5) AS data`, [job, first.submittal_id, "sample-chase@example.com", "GearCo", "Job 2701 submittal follow-up"]);
      const logged = await tx.query(`SELECT public.mcp_project_record_search($1, NULL, NULL, 'submittal_chase', 'GearCo') AS data`, [job]);
      return { count: marked.rows[0].data.chase_count, next: marked.rows[0].data.next_chase_at, events: logged.rows[0].data.events.length };
    });
    expect(chase.count).toBe(1);
    expect(String(chase.next).slice(0, 10)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(chase.events).toBe(1);
  });
});
