import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

const company = "00000000-0000-4000-8000-00000000d010";
const job = "00000000-0000-4000-8000-00000000d020";
const other = "00000000-0000-4000-8000-00000000d021";
const owner = "00000000-0000-4000-8000-00000000d001";
const pm = "00000000-0000-4000-8000-00000000d002";
const superOn = "00000000-0000-4000-8000-00000000d003";
const superOff = "00000000-0000-4000-8000-00000000d004";
const allAccess = "00000000-0000-4000-8000-00000000d005";
const outsider = "00000000-0000-4000-8000-00000000d006";
let db: PGlite;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- results are read field by field
type J = any;
const call = async (user: string | null, fn: string, values: unknown[]) =>
  (
    await asUser(
      db,
      user
        ? { sub: user, role: "authenticated", email: `${user.slice(-2)}@example.com` }
        : ({ role: "service_role" } as never),
      (tx) =>
        tx.query(
          `SELECT public.${fn}(${values.map((_, i) => `$${i + 1}`).join(",")}) AS data`,
          values,
        ) as Promise<{ rows: { data: J }[] }>,
    )
  ).rows[0]!.data as J;
const record = (
  topic: string,
  kind: string,
  title: string,
  dedupe: string | null = null,
  at = job,
) =>
  call(null, "mcp_job_notice_record", [
    at,
    topic,
    kind,
    title,
    null,
    "Rosa Delgado",
    "mcp_change_orders",
    null,
    JSON.stringify({ amount_cents: 267192, days: 2 }),
    "cos",
    dedupe,
  ]);

beforeAll(async () => {
  db = await makeDb();
  const load = (f: string) => db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  await db.exec(
    "CREATE FUNCTION public.get_user_tier(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'circle'::text $$",
  );
  await load("20261021190000_athena_team_invites");
  await load("20261105150000_athena_job_notices");
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Northline Electric',$2)",
    [company, owner],
  );
  const people: [string, string][] = [
    [owner, "owner"],
    [pm, "pm"],
    [superOn, "super"],
    [superOff, "super"],
    [allAccess, "all_access"],
  ];
  for (const [u, role] of people) {
    await db.query("INSERT INTO auth.users(id,email) VALUES ($1,$2)", [
      u,
      `${role}-${u.slice(-1)}@example.com`,
    ]);
    await db.query("INSERT INTO test_active_members VALUES ($1)", [u]);
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,$3)",
      [company, u, role],
    );
  }
  await db.query("INSERT INTO auth.users(id,email) VALUES ($1,'outsider@example.com')", [outsider]);
  await db.query("INSERT INTO test_active_members VALUES ($1)", [outsider]);
  for (const [id, n] of [
    [job, "2810"],
    [other, "2811"],
  ])
    await db.query(
      "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name,pm_user_id,pm_email) VALUES($1,$2,$3,$4,'Willow Creek',$5,'pat@example.com')",
      [id, owner, company, n, pm],
    );
  await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
    job,
    superOn,
    owner,
  ]);
});

describe.sequential("job notices", () => {
  it("emails the job's PM every topic, owners client messages and supers on the job the field topics", async () => {
    const decision = await record("client_decision", "co_approved", "Rosa signed CO-003");
    expect(decision.created).toBe(true);
    expect(decision.recipients).toEqual([{ email: "pm-2@example.com", role: "job_pm" }]);
    const message = await record("client_message", "client_message", "Rosa asked about CO-004");
    expect(message.recipients.map((r: J) => r.email).sort()).toEqual([
      "owner-1@example.com",
      "pm-2@example.com",
    ]);
    const field = await record(
      "submittal_reply",
      "submittal_returned",
      "Architect returned 26 51 00-1",
    );
    expect(field.recipients.map((r: J) => r.email).sort()).toEqual([
      "pm-2@example.com",
      "super-3@example.com",
    ]);
  });

  it("records a notice once per dedupe key", async () => {
    const a = await record(
      "client_decision",
      "pay_app_approved",
      "Owner approved it",
      "decision:1",
    );
    const b = await record(
      "client_decision",
      "pay_app_approved",
      "Owner approved it",
      "decision:1",
    );
    expect(b).toMatchObject({ notice_id: a.notice_id, created: false, recipients: [] });
    await expect(
      record("client_decision", "x_y", "Other job", "decision:1", other),
    ).rejects.toThrow(/another job/);
  });

  it("lets only the job's PM, an owner or all access choose who gets emails, and keeps supers off money", async () => {
    await expect(
      call(superOn, "mcp_job_notice_prefs_set", [job, "owner", "client_decision", true]),
    ).rejects.toThrow();
    const prefs = await call(pm, "mcp_job_notice_prefs_set", [
      job,
      "owner",
      "client_message",
      false,
    ]);
    expect(prefs.can_change).toBe(true);
    expect(
      prefs.prefs.find((p: J) => p.role === "owner" && p.topic === "client_message"),
    ).toMatchObject({ email: false, default: true });
    await expect(
      call(owner, "mcp_job_notice_prefs_set", [job, "super", "client_decision", true]),
    ).rejects.toThrow(/field notices only/);
    await call(owner, "mcp_job_notice_prefs_set", [job, "all_access", "client_decision", true]);
    const next = await record("client_message", "client_message", "Rosa asked again");
    expect(next.recipients.map((r: J) => r.email)).toEqual(["pm-2@example.com"]);
    const signed = await record("client_decision", "co_approved", "Rosa signed CO-005");
    expect(signed.recipients.map((r: J) => r.email).sort()).toEqual([
      "all_access-5@example.com",
      "pm-2@example.com",
    ]);
  });

  it("shows the board its notices with unread marks, and supers only the field ones", async () => {
    const list = await call(pm, "mcp_job_notices_list", [job, 50]);
    expect(list.unread).toBe(list.notices.length);
    expect(list.notices[0]).toMatchObject({ topic: "client_decision", read: false });
    expect(list.notices[0].facts).toEqual({ amount_cents: 267192, days: 2 });
    const sup = await call(superOn, "mcp_job_notices_list", [job, 50]);
    expect(sup.notices.map((n: J) => n.topic)).toEqual(["submittal_reply"]);
    await expect(call(superOff, "mcp_job_notices_list", [job, 50])).rejects.toThrow();
    await expect(call(outsider, "mcp_job_notices_list", [job, 50])).rejects.toThrow();
    expect(await call(pm, "mcp_job_notices_mark_read", [job, [list.notices[0].id]])).toBe(1);
    expect((await call(pm, "mcp_job_notices_list", [job, 50])).unread).toBe(
      list.notices.length - 1,
    );
    expect((await call(owner, "mcp_job_notices_list", [job, 50])).unread).toBe(list.notices.length);
    await call(pm, "mcp_job_notices_mark_read", [job, null]);
    expect((await call(pm, "mcp_job_notices_list", [job, 50])).unread).toBe(0);
  });

  it("lists the caller's notices across jobs for the account page and the brief", async () => {
    await record(
      "field_confirm",
      "lookahead_confirmed",
      "Acme Supply confirmed Nov 12",
      null,
      other,
    );
    const mine = await call(owner, "mcp_my_notices", [null, true, 50]);
    expect(mine.notices.map((n: J) => n.job_number)).toContain("2811");
    expect(mine.notices.every((n: J) => n.read === false)).toBe(true);
    const sup = await call(superOn, "mcp_my_notices", [null, false, 50]);
    expect(sup.notices.map((n: J) => n.title)).toEqual(["Architect returned 26 51 00-1"]);
    expect((await call(outsider, "mcp_my_notices", [null, false, 50])).notices).toEqual([]);
  });

  it("keeps each email's outcome, and only server code records a notice", async () => {
    const n = await record("client_decision", "co_declined", "Rosa declined CO-006");
    await call(null, "mcp_job_notice_email_result", [n.notice_id, "PM-2@example.com", "sent"]);
    const row = await db.query<{ email: string; status: string }>(
      "SELECT email,status FROM mcp_job_notice_emails WHERE notice_id=$1 ORDER BY email",
      [n.notice_id],
    );
    expect(row.rows).toEqual([
      { email: "all_access-5@example.com", status: "queued" },
      { email: "pm-2@example.com", status: "sent" },
    ]);
    await expect(
      call(pm, "mcp_job_notice_record", [
        job,
        "client_decision",
        "x_y",
        "T",
        null,
        null,
        null,
        null,
        "{}",
        null,
        null,
      ]),
    ).rejects.toThrow();
  });
});
