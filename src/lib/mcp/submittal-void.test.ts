import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
import { renderReportBody } from "../report-pages";
import { renderSubmittalRecordBody } from "../submittal-record-page";
import { SUBMITTAL_DRAFT_LABEL, presentSubmittalLog, submittalDisplayStatus, type SubmittalRecord } from "./submittals";
import { pickSubmittal, voidConfirmKey, voidDecision } from "./submittal-void";

const owner = "00000000-0000-4000-8000-000000000010";
const company = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const job = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function row(over: Partial<SubmittalRecord> & Pick<SubmittalRecord, "id" | "number" | "revision" | "status">): SubmittalRecord {
  return {
    transmittal_number: 1,
    spec_section: "26 24 16",
    title: "Switchgear",
    submittal_type: "product_data",
    ball_in_court: "gc",
    source: "user",
    required: true,
    package_items: [],
    ...over,
  };
}

describe("submittal void", () => {
  const target = { id: "11111111-1111-4111-8111-111111111111", number: "001", revision: 0, title: "Switchgear", status: "approved" };

  it("asks before writing and then voids any status", () => {
    expect(voidDecision(target, {}).write).toBe(false);
    expect(voidDecision(target, { reason: "duplicate entry" }).write).toBe(false);
    const key = voidConfirmKey(target.id, "duplicate entry");
    expect(voidDecision(target, { reason: "duplicate entry", confirmed: true, confirm_key: "nope" }).write).toBe(false);
    const yes = voidDecision({ ...target, status: "in_prep" }, { reason: "duplicate entry", confirmed: true, confirm_key: key });
    expect(yes.write).toBe(true);
    if (yes.write) expect(yes.payload).toMatchObject({ submittal_id: target.id, reason: "duplicate entry", confirmed: true });
    expect(voidDecision({ ...target, status: "void" }, { reason: "duplicate entry", confirmed: true, confirm_key: key }).write).toBe(false);
    expect(pickSubmittal([
      { ...target, revision: 0 },
      { ...target, id: "22222222-2222-4222-8222-222222222222", revision: 1 },
    ], { number: "001" })?.revision).toBe(1);
  });

  it("shows Void on the log, the hosted log, and the record page without editing the page template", () => {
    const open = row({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", number: "002", revision: 0, status: "submitted", title: "Lighting" });
    const voided = row({
      id: target.id,
      number: "001",
      revision: 0,
      status: "void",
      title: "Switchgear",
      built_package: { id: "pkg", filename: "f.pdf", page_count: 1, sent_at: null },
    });
    expect(submittalDisplayStatus(voided)).toBe("Void");
    expect(submittalDisplayStatus({ ...voided, status: "in_review" })).toBe(SUBMITTAL_DRAFT_LABEL);
    const presented = presentSubmittalLog({ jobNumber: "2701", jobName: "Harbor", rows: [open, voided], today: "2026-10-25", boardUrl: null });
    const log = presented.card.sections?.find((section) => section.heading === "Log");
    const history = presented.card.sections?.find((section) => section.heading === "History");
    expect(log?.rows.map((line) => line.cells[0])).toEqual(["002"]);
    expect(history?.rows[0].cells).toEqual(["001", "Switchgear", "Void"]);
    expect(presented.text).toContain("Status Void");
    const html = renderReportBody({ page: "submittals", job_number: "2701", job_name: "Harbor", today: "2026-10-25", submittals: [open, voided] });
    expect(html.match(/data-submittal-row=/g)).toHaveLength(1);
    expect(html).toContain("Void");
    expect(html).toContain("data-submittal-history");
    const page = renderSubmittalRecordBody({
      page: "submittal",
      job_number: "2701",
      job_name: "Harbor",
      number: "001",
      today: "2026-10-25",
      current: { ...voided, submitted_on: "2026-10-01" },
      packages: [{ id: "pkg", submittal_id: voided.id, revision: 0, is_current: true, filename: "f.pdf", path: "c/j/p.pdf", created_at: "2026-10-25T00:00:00Z", sent_at: null }],
      events: [{
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        occurred_at: "2026-10-25T19:00:00Z",
        actor: "user",
        actor_name: "Fictional PM",
        kind: "submittal_voided",
        title: "Submittal 001 revision 0",
        summary: "Status Void. Reason: duplicate entry.",
      }],
    });
    expect(page).toContain("Void");
    expect(page).toContain("Fictional PM");
    expect(page).toContain("duplicate entry");
    expect(page).not.toContain(SUBMITTAL_DRAFT_LABEL);
    const source = readFileSync("src/lib/submittal-record-page.ts", "utf8");
    expect(source).toContain("submittalDisplayStatus(row, p.packages)");
    expect(source).toContain("` · Submitted ${esc(when)}`");
  });

  it("marks the row void in the database and keeps who, when, and the reason", async () => {
    const db = await makeDb();
    const sql = readFileSync("supabase/migrations/20261023220000_athena_submittal_log.sql", "utf8");
    await db.exec(sql.slice(0, sql.indexOf("CREATE OR REPLACE FUNCTION public.mcp_board_link_open")));
    await db.exec(readFileSync("supabase/migrations/20261025193000_athena_submittal_void.sql", "utf8"));
    await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [owner, "owner@pm-agent-roles.test.invalid"]);
    await db.query(`INSERT INTO public.test_active_members VALUES ($1)`, [owner]);
    await db.query(`INSERT INTO public.mcp_companies (id, name, created_by) VALUES ($1, 'ALP Test', $2)`, [company, owner]);
    await db.query(
      `INSERT INTO public.mcp_jobs (id, user_id, name, job_number, company_id, time_zone) VALUES ($1, $2, 'Harbor Point', '2701', $3, 'America/Manaus')`,
      [job, owner, company],
    );
    await db.query(
      `INSERT INTO public.mcp_company_members (company_id, user_id, display_name, role) VALUES ($1, $2, 'Fictional PM', 'owner')`,
      [company, owner],
    );
    const claims = { sub: owner, email: "owner@pm-agent-roles.test.invalid", role: "authenticated" as const };
    const saved = await asUser(db, claims, async (tx) => {
      const added = await tx.query(`SELECT public.mcp_submittal_log($1, 'add', $2::jsonb) AS data`, [job, JSON.stringify({
        number: "001", spec_section: "26 24 16", title: "Switchgear", submittal_type: "product_data", status: "approved", ball_in_court: "gc",
      })]);
      const draft = await tx.query(`SELECT public.mcp_submittal_log($1, 'add', $2::jsonb) AS data`, [job, JSON.stringify({
        number: "002", spec_section: "26 51 00", title: "Lighting", submittal_type: "product_data", status: "in_prep", ball_in_court: "sub",
      })]);
      return { approved: added.rows[0].data.saved_id as string, draft: draft.rows[0].data.saved_id as string };
    });
    const refused = await asUser(db, claims, async (tx) => {
      try {
        await tx.query(`SELECT public.mcp_submittal_log($1, 'void', $2::jsonb)`, [job, JSON.stringify({ submittal_id: saved.approved, reason: "duplicate entry" })]);
        return "wrote";
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(refused).toMatch(/Confirm before voiding/);
    const still = await asUser(db, claims, async (tx) => {
      const row = await tx.query(`SELECT status FROM public.mcp_submittals WHERE id = $1`, [saved.approved]);
      return row.rows[0].status;
    });
    expect(still).toBe("approved");
    await asUser(db, claims, async (tx) => {
      await tx.query(`SELECT public.mcp_submittal_log($1, 'void', $2::jsonb)`, [job, JSON.stringify({ submittal_id: saved.approved, reason: "duplicate entry", confirmed: true })]);
      await tx.query(`SELECT public.mcp_submittal_log($1, 'void', $2::jsonb)`, [job, JSON.stringify({ submittal_id: saved.draft, reason: "wrong number", confirmed: true })]);
    });
    const after = await asUser(db, claims, async (tx) => {
      const rows = await tx.query(`SELECT id, status FROM public.mcp_submittals WHERE job_id = $1 ORDER BY number`, [job]);
      const events = await tx.query(`SELECT kind, summary, actor_id, occurred_at FROM public.mcp_project_record_events WHERE job_id = $1 AND kind = 'submittal_voided' ORDER BY summary`, [job]);
      return { rows: rows.rows, events: events.rows };
    });
    expect(after.rows).toHaveLength(2);
    expect(after.rows.every((row: { status: string }) => row.status === "void")).toBe(true);
    expect(after.events).toHaveLength(2);
    expect(after.events[0].summary).toContain("Status Void. Reason: duplicate entry.");
    expect(after.events[0].actor_id).toBe(owner);
    expect(after.events[0].occurred_at).toBeTruthy();
  });
});
