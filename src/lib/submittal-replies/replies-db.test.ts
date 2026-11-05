import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

const company = "00000000-0000-4000-8000-00000000e010";
const job = "00000000-0000-4000-8000-00000000e020";
const owner = "00000000-0000-4000-8000-00000000e001";
const pm = "00000000-0000-4000-8000-00000000e002";
const superOn = "00000000-0000-4000-8000-00000000e003";
const outsider = "00000000-0000-4000-8000-00000000e004";
const reviewer = "jordan@archstudio.example";
let db: PGlite;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- results are read field by field
type J = any;
const claims = (id: string | null) =>
  id
    ? { sub: id, role: "authenticated" as const, email: `${id.slice(-2)}@example.com` }
    : ({ role: "service_role" } as never);
const q = async (user: string | null, sql: string, args: unknown[] = []) =>
  asUser(db, claims(user), async (tx) => (await tx.query(sql, args)).rows as J[]);
const rpc = async (user: string | null, fn: string, args: unknown[]) =>
  (
    await q(
      user,
      `SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS data`,
      args,
    )
  )[0].data as J;
const hash = (c: string) => c.repeat(64).slice(0, 64);

let sid = "";
let pkg = "";
let mailId = "";

async function stored(path: string) {
  await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES ('athena-submittals',$1)", [
    path,
  ]);
}

async function buildAndSend(number: string) {
  const r = await rpc(owner, "mcp_submittal_log", [
    job,
    "add",
    JSON.stringify({
      number,
      title: "Lighting fixtures",
      spec_section: "26 51 00",
      submittal_type: "product_data",
      status: "in_prep",
      ball_in_court: "gc",
      package_items: [
        {
          kind: "product_cut",
          source_party: "Fixture supplier",
          status: "needed",
          required: true,
          chase_role: "supplier",
          chase_name: "Sam Supply",
          chase_email: "sam@supply.example",
        },
      ],
    }),
  ]);
  const id = r.saved_id as string;
  let c = await rpc(owner, "mcp_submittal_package_context", [job, id]);
  for (const item of c.items) {
    const path = `${company}/${job}/pieces/${crypto.randomUUID()}/cut.pdf`;
    await stored(path);
    await rpc(owner, "mcp_submittal_package_write", [
      job,
      id,
      "attach",
      JSON.stringify({ item_id: item.id, path }),
    ]);
  }
  c = await rpc(owner, "mcp_submittal_package_context", [job, id]);
  const pid = crypto.randomUUID();
  const path = `${company}/${job}/packages/${pid}/package.pdf`;
  await stored(path);
  const tok = `${number.replace(/[^A-Za-z0-9]/g, "")}`.padEnd(43, "x").slice(0, 43);
  await rpc(owner, "mcp_submittal_package_write", [
    job,
    id,
    "save",
    JSON.stringify({
      id: pid,
      path,
      filename: "package.pdf",
      fingerprint: c.fingerprint,
      sha256: "a".repeat(64),
      size_bytes: 1200,
      page_count: 3,
      cover_date: c.today,
      manifest: c.items.map((p: J) => ({ item_id: p.id })),
      token_hash: crypto.randomUUID().replace(/-/g, "").repeat(2),
      download_url: `https://app.meetathena.io/r/submittal-file/${tok}`,
      signed_url: `https://test.supabase.co/storage/v1/object/sign/athena-submittals/${path}?token=t`,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }),
  ]);
  // The delivery function itself is covered by its own suite; the reply code reads the saved, sent email.
  const [mail] = (
    await db.query<{ id: string }>(
      `INSERT INTO mcp_submittal_mail(company_id,job_id,submittal_id,package_id,kind,draft,draft_key,context_key,approved_at,sent_at,provider,message_id)
       VALUES ($1,$2,$3,$4,'package',$5,'k','c',now(),now(),'gmail',$6) RETURNING id`,
      [
        company,
        job,
        id,
        pid,
        JSON.stringify({
          to: reviewer,
          cc: ["submittals+0123@meetathena.io"],
          subject: `Submittal ${number} for review`,
          body: "Please review.",
          link: `https://app.meetathena.io/r/submittal-file/${tok}`,
        }),
        `gm-${number}`,
      ],
    )
  ).rows;
  await db.query("UPDATE mcp_submittals SET status='submitted', ball_in_court='architect_engineer' WHERE id=$1", [id]);
  return { id, pid, mail: mail!.id };
}

beforeAll(async () => {
  db = await makeDb();
  const load = (f: string) => db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  await db.exec(
    "CREATE FUNCTION public.get_user_tier(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'circle'::text $$",
  );
  const pages = readFileSync("supabase/migrations/20261021120000_athena_report_pages.sql", "utf8");
  const leaderStart = pages.indexOf("CREATE OR REPLACE FUNCTION public.mcp_is_company_leader");
  await db.exec(
    pages.slice(
      leaderStart,
      pages.indexOf("TO authenticated;", leaderStart) + "TO authenticated;".length,
    ),
  );
  await load("20261023070000_athena_board_links");
  await load("20261023220000_athena_submittal_log");
  await load("20261024010000_athena_submittal_chase");
  await db.exec(
    `CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;GRANT USAGE ON SCHEMA storage TO authenticated, service_role;GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated, service_role;`,
  );
  await load("20261021000000_athena_file_shares");
  await load("20261028120000_athena_submittal_packages");
  await load("20261029120000_athena_submittal_record_page");
  await load("20261021190000_athena_team_invites");
  await load("20261105150000_athena_job_notices");
  await load("20261105161000_athena_submittal_replies");
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Northline Electric',$2)", [
    company,
    owner,
  ]);
  for (const [u, role] of [
    [owner, "owner"],
    [pm, "pm"],
    [superOn, "super"],
  ] as const) {
    await db.query("INSERT INTO auth.users(id,email) VALUES ($1,$2)", [u, `${role}@northline.example`]);
    await db.query("INSERT INTO test_active_members VALUES ($1)", [u]);
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,$3)",
      [company, u, role],
    );
  }
  await db.query("INSERT INTO auth.users(id,email) VALUES ($1,'out@example.com')", [outsider]);
  await db.query("INSERT INTO test_active_members VALUES ($1)", [outsider]);
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name,pm_user_id,pm_email,time_zone) VALUES($1,$2,$3,'2810','Willow Creek',$4,'pat@northline.example','America/Chicago')",
    [job, owner, company, pm],
  );
  for (const u of [pm, superOn])
    await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
      job,
      u,
      owner,
    ]);
  const sent = await buildAndSend("26 51 00-01");
  sid = sent.id;
  pkg = sent.pid;
  mailId = sent.mail;
}, 60000);

afterAll(async () => {
  await db?.close();
});

describe.sequential("submittal replies", () => {
  it("issues a reply code only to full-access members, and the same code twice is one link", async () => {
    const a = await rpc(owner, "mcp_submittal_reply_link_issue", [job, sid, pkg, hash("a")]);
    const b = await rpc(owner, "mcp_submittal_reply_link_issue", [job, sid, pkg, hash("a")]);
    expect(b.link_id).toBe(a.link_id);
    await expect(rpc(superOn, "mcp_submittal_reply_link_issue", [job, sid, pkg, hash("b")])).rejects.toThrow(
      /Full job access/,
    );
    await expect(rpc(outsider, "mcp_submittal_reply_link_issue", [job, sid, pkg, hash("b")])).rejects.toThrow();
    await expect(q(null, "SELECT * FROM mcp_submittal_responses")).resolves.toBeDefined();
    await expect(q(owner, "SELECT * FROM mcp_submittal_reply_links")).rejects.toThrow(/permission/);
    await expect(q(owner, "SELECT * FROM mcp_submittal_responses")).rejects.toThrow(/permission/);
    await expect(
      q(owner, "SELECT public.mcp_submittal_reply_page_open($1)", [hash("a")]),
    ).rejects.toThrow(/permission/);
  });

  it("opens the return page with the brand, number and title, and refuses unknown or expired codes", async () => {
    const open = await rpc(null, "mcp_submittal_reply_page_open", [hash("a")]);
    expect(open).toMatchObject({
      status: "ok",
      company: "Northline Electric",
      number: "26 51 00-01",
      title: "Lighting fixtures",
      returned: null,
    });
    expect(JSON.stringify(open)).not.toMatch(/signed_url|download_url|cost|markup/);
    expect((await rpc(null, "mcp_submittal_reply_page_open", [hash("9")])).status).toBe("unknown");
    expect((await rpc(null, "mcp_submittal_reply_page_open", ["nope"])).status).toBe("unknown");
    await rpc(owner, "mcp_submittal_reply_link_issue", [job, sid, pkg, hash("e")]);
    await db.query(
      "UPDATE mcp_submittal_reply_links SET expires_at = now() - interval '1 minute' WHERE token_hash = $1",
      [hash("e")],
    );
    expect((await rpc(null, "mcp_submittal_reply_page_open", [hash("e")])).status).toBe("expired");
  });

  it("slows a link down after twenty page tries in an hour", async () => {
    await rpc(owner, "mcp_submittal_reply_link_issue", [job, sid, pkg, hash("f")]);
    for (let i = 0; i < 20; i++)
      expect((await rpc(null, "mcp_submittal_reply_page_try", [hash("f")])).status).toBe("ok");
    expect((await rpc(null, "mcp_submittal_reply_page_try", [hash("f")])).status).toBe("slow_down");
  });

  it("records a page decision once: status, returned date, ball in court and history", async () => {
    const rid = crypto.randomUUID();
    const bad = await rpc(null, "mcp_submittal_reply_page_submit", [
      hash("a"), rid, "maybe", "Jordan Lee", reviewer, "", "[]", null, null,
    ]);
    expect(bad.status).toBe("invalid");
    const outside = await rpc(null, "mcp_submittal_reply_page_submit", [
      hash("a"), rid, "approved", "Jordan Lee", reviewer, "",
      JSON.stringify([{ path: `${company}/${job}/pieces/x/a.pdf`, filename: "a.pdf", content_type: "application/pdf", size_bytes: 10 }]),
      null, null,
    ]);
    expect(outside.status).toBe("invalid");
    const path = `${company}/${job}/returns/${rid}/stamped.pdf`;
    await stored(path);
    const ok = await rpc(null, "mcp_submittal_reply_page_submit", [
      hash("a"), rid, "approved_as_noted", "  Jordan   Lee ", reviewer, "See note on sheet 2.",
      JSON.stringify([{ path, filename: "stamped.pdf", content_type: "application/pdf", size_bytes: 2048 }]),
      "203.0.113.9", "test",
    ]);
    expect(ok).toMatchObject({
      status: "ok",
      response_id: rid,
      action: "approved_as_noted",
      action_label: "Approved as noted",
      reviewer_name: "Jordan Lee",
      number: "26 51 00-01",
      job_number: "2810",
      file_count: 1,
    });
    const [s] = await q(null, "SELECT status, ball_in_court, returned_on FROM mcp_submittals WHERE id = $1", [sid]);
    expect(s).toMatchObject({ status: "approved_as_noted", ball_in_court: "gc" });
    expect(s.returned_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const history = await q(
      null,
      "SELECT kind, actor, counterparty_name, payload FROM mcp_project_record_events WHERE ref_id = $1 ORDER BY occurred_at DESC LIMIT 1",
      [sid],
    );
    expect(history[0]).toMatchObject({ kind: "submittal_status", actor: "athena", counterparty_name: "Jordan Lee" });
    expect(history[0].payload).toMatchObject({ status: "approved_as_noted", source: "page", response_id: rid });
    const again = await rpc(null, "mcp_submittal_reply_page_submit", [
      hash("a"), crypto.randomUUID(), "rejected", "Someone Else", null, "", "[]", null, null,
    ]);
    expect(again.status).toBe("already");
    const open = await rpc(null, "mcp_submittal_reply_page_open", [hash("a")]);
    expect(open.returned).toMatchObject({ action: "approved_as_noted", reviewer_name: "Jordan Lee" });
  });

  it("keeps an emailed reply as needs review, ignores the team's own copy and repeats", async () => {
    const own = await rpc(null, "mcp_submittal_reply_email", [
      hash("a"), "em-own", "<own@x>", "owner@northline.example", "Owner", "Re: anything", "hi", true, null,
    ]);
    expect(own.status).toBe("own_copy");
    const copy = await rpc(null, "mcp_submittal_reply_email", [
      hash("a"), "em-copy", "<copy@x>", "marshall@gmail.example", "Marshall", "Submittal 26 51 00-01 for review", "Please review.", false, null,
    ]);
    expect(copy.status).toBe("own_copy");
    const first = await rpc(null, "mcp_submittal_reply_email", [
      hash("a"), "em-1", "<r1@arch>", reviewer.toUpperCase(), "Jordan Lee", "Re: Submittal 26 51 00-01 for review",
      "Revise and resubmit, see comments.", true, "2026-11-05T15:00:00Z",
    ]);
    expect(first).toMatchObject({
      status: "ok",
      created: true,
      source: "email",
      action: null,
      action_label: "Received, needs review",
      review_status: "needs_review",
      sender_known: true,
    });
    const repeat = await rpc(null, "mcp_submittal_reply_email", [
      hash("a"), "em-1", "<r1@arch>", reviewer, "Jordan Lee", "Re: x", "x", true, null,
    ]);
    expect(repeat).toMatchObject({ created: false, response_id: first.response_id });
    const stranger = await rpc(null, "mcp_submittal_reply_email", [
      hash("a"), "em-2", "<r2@arch>", "assistant@archstudio.example", null, "Re: x", "Stamped copy attached", true, null,
    ]);
    expect(stranger).toMatchObject({ status: "ok", sender_known: false });
    expect((await rpc(null, "mcp_submittal_reply_email", [hash("9"), "em-3", null, reviewer, null, "x", "x", true, null])).status).toBe(
      "unknown",
    );
    const [s] = await q(null, "SELECT status FROM mcp_submittals WHERE id = $1", [sid]);
    expect(s.status).toBe("approved_as_noted");
    // Files attach once, and only from this reply's folder.
    const path = `${company}/${job}/returns/${stranger.response_id}/stamp.png`;
    await stored(path);
    const file = { path, filename: "stamp.png", content_type: "image/png", size_bytes: 99 };
    expect((await rpc(null, "mcp_submittal_reply_files", [stranger.response_id, JSON.stringify([{ ...file, path: `${company}/${job}/returns/${first.response_id}/x.png` }])])).status).toBe("invalid");
    expect((await rpc(null, "mcp_submittal_reply_files", [stranger.response_id, JSON.stringify([file])])).files).toHaveLength(1);
    expect((await rpc(null, "mcp_submittal_reply_files", [stranger.response_id, "[]"])).files).toHaveLength(1);
    void mailId;
  });

  it("lists replies for the board, and lets only a full-access member confirm an emailed one", async () => {
    const list = await rpc(superOn, "mcp_submittal_replies_list", [job, null, false, 50]);
    expect(list.can_confirm).toBe(false);
    expect(list.needs_review).toBe(2);
    expect(list.replies.map((r: J) => r.source)).toEqual(["email", "email", "page"]);
    await expect(rpc(outsider, "mcp_submittal_replies_list", [job, null, false, 50])).rejects.toThrow(/access/);
    const pending = await rpc(pm, "mcp_submittal_replies_list", [job, sid, true, 50]);
    expect(pending.replies).toHaveLength(2);
    const target = pending.replies.find((r: J) => r.sender_known);
    await expect(rpc(superOn, "mcp_submittal_reply_confirm", [job, target.id, "revise_and_resubmit"])).rejects.toThrow(
      /Full job access/,
    );
    await expect(rpc(pm, "mcp_submittal_reply_confirm", [job, target.id, "sideways"])).rejects.toThrow(/Pick approved/);
    const done = await rpc(pm, "mcp_submittal_reply_confirm", [job, target.id, "revise_and_resubmit"]);
    expect(done).toMatchObject({ status: "ok", review_status: "confirmed", action: "revise_and_resubmit" });
    const [s] = await q(null, "SELECT status, returned_on FROM mcp_submittals WHERE id = $1", [sid]);
    expect(s).toMatchObject({ status: "revise_and_resubmit", returned_on: "2026-11-05" });
    const history = await q(
      null,
      "SELECT kind, actor, actor_id, payload FROM mcp_project_record_events WHERE ref_id = $1 ORDER BY occurred_at DESC LIMIT 1",
      [sid],
    );
    expect(history[0]).toMatchObject({ kind: "submittal_status", actor: "user", actor_id: pm });
    expect(history[0].payload.status).toBe("revise_and_resubmit");
    await expect(rpc(pm, "mcp_submittal_reply_confirm", [job, target.id, "approved"])).rejects.toThrow(/already on the log/);
    const other = pending.replies.find((r: J) => !r.sender_known);
    const none = await rpc(owner, "mcp_submittal_reply_confirm", [job, other.id, "none"]);
    expect(none.review_status).toBe("dismissed");
    const after = await rpc(pm, "mcp_submittal_replies_list", [job, null, false, 50]);
    expect(after.needs_review).toBe(0);
    expect(after.replies.find((r: J) => r.id === target.id).confirmed_by_name).toBe("pm");
  });

  it("records the notice for the job's PM and supers through the job notice record", async () => {
    const n = await rpc(null, "mcp_job_notice_record", [
      job, "submittal_reply", "submittal_returned", "Jordan Lee returned submittal 26 51 00-01", null, "Jordan Lee",
      "mcp_submittal_responses", null, "{}", "submittals", "submittal-reply:test",
    ]);
    expect(n.recipients.map((r: J) => r.email).sort()).toEqual(["pm@northline.example", "super@northline.example"]);
  });
});
