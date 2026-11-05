import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

const company = "00000000-0000-4000-8000-00000000e010";
const job = "00000000-0000-4000-8000-00000000e020";
const other = "00000000-0000-4000-8000-00000000e021";
const owner = "00000000-0000-4000-8000-00000000e001";
const pm = "00000000-0000-4000-8000-00000000e002";
const superOn = "00000000-0000-4000-8000-00000000e003";
const superOff = "00000000-0000-4000-8000-00000000e004";
const estimator = "00000000-0000-4000-8000-00000000e005";
const outsider = "00000000-0000-4000-8000-00000000e006";
const la = "00000000-0000-4000-8000-00000000e030";
const laOther = "00000000-0000-4000-8000-00000000e031";
const item = "00000000-0000-4000-8000-00000000e040";
let db: PGlite;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- results are read field by field
type J = any;
const hash = (n: number) => n.toString(16).padStart(64, "0");
const day = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

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

const create = (
  user: string,
  o: Partial<{
    job: string;
    lookahead: string | null;
    item: string | null;
    activity: string | null;
    kind: string;
    name: string;
    email: string;
    ask: string;
    what: string;
    date: string;
    windowEnd: string | null;
    token: string;
    expires: string;
  }> = {},
) =>
  call(user, "mcp_lookahead_confirm_create", [
    o.job ?? job,
    o.lookahead === undefined ? la : o.lookahead,
    o.item === undefined ? item : o.item,
    o.activity ?? null,
    o.kind ?? "supplier",
    o.name ?? "Acme Supply",
    o.email ?? "Orders@Acme.example",
    o.ask ?? "delivery",
    o.what ?? "Delivery of switchgear",
    o.date ?? day(7),
    o.windowEnd ?? null,
    o.token ?? hash(1),
    o.expires ?? inDays(14),
  ]);
const respond = (
  token: string,
  answer: string,
  date: string | null,
  name: string,
  note: string | null = null,
) =>
  call(null, "mcp_lookahead_confirm_respond", [
    token,
    answer,
    date,
    name,
    note,
    "203.0.113.9",
    "Phone",
  ]);

beforeAll(async () => {
  db = await makeDb();
  const load = (f: string) => db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  await db.exec(
    "CREATE FUNCTION public.get_user_tier(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'circle'::text $$",
  );
  await load("20261021190000_athena_team_invites");
  await load("20261105150000_athena_job_notices");
  await load("20261105162000_athena_lookahead_confirms");
  await db.query(
    "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Northline Electric',$2)",
    [company, owner],
  );
  const people: [string, string, string][] = [
    [owner, "owner", "Sam Owner"],
    [pm, "pm", "Pat Lee"],
    [superOn, "super", "Rico Super"],
    [superOff, "super", "Dee Super"],
    [estimator, "estimating", "Eve Estimator"],
  ];
  for (const [u, role, name] of people) {
    await db.query("INSERT INTO auth.users(id,email) VALUES ($1,$2)", [
      u,
      `${role}-${u.slice(-1)}@example.com`,
    ]);
    await db.query("INSERT INTO test_active_members VALUES ($1)", [u]);
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,$4)",
      [company, u, role, name],
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
  await db.query(
    "INSERT INTO mcp_lookaheads(id,user_id,job_id,start_date,end_date) VALUES($1,$2,$3,$4,$5),($6,$2,$7,$4,$5)",
    [la, pm, job, day(0), day(13), laOther, other],
  );
  await db.query(
    `INSERT INTO mcp_open_items(id,user_id,job_id,lookahead_id,origin_lookahead_id,check_key,check_version,trade,category,severity,action)
     VALUES($1,$2,$3,$4,$4,'deliveries',1,'electrical','procurement','high','Switchgear delivery')`,
    [item, pm, job, la],
  );
});

describe.sequential("look-ahead date confirmations", () => {
  it("lets the job's PM and a super on the job send, and refuses everyone else", async () => {
    const r = await create(pm);
    expect(r).toMatchObject({
      state: "asked",
      party_email: "orders@acme.example",
      what: "Delivery of switchgear",
      company: "Northline Electric",
      job_number: "2810",
      created_by_name: "Pat Lee",
      email_status: "queued",
    });
    const s = await create(superOn, {
      kind: "sub",
      name: "Rivera Drywall",
      email: "office@rivera.example",
      ask: "start",
      what: "Crew start, level 2 drywall",
      item: null,
      activity: "A1040",
      token: hash(2),
    });
    expect(s).toMatchObject({ party_kind: "sub", activity_id: "A1040", item_id: null });
    await expect(create(superOff, { token: hash(90) })).rejects.toThrow(/Only the job's PM/);
    await expect(create(estimator, { token: hash(91) })).rejects.toThrow(/Only the job's PM/);
    await expect(create(outsider, { token: hash(92) })).rejects.toThrow(/Only the job's PM/);
  });

  it("checks the line, the party and the dates", async () => {
    await expect(create(pm, { token: hash(93), lookahead: laOther })).rejects.toThrow(
      /look-ahead isn't on this job/,
    );
    await expect(
      create(pm, { token: hash(94), job: other, lookahead: null, item }),
    ).rejects.toThrow(/line isn't on this job/);
    await expect(create(pm, { token: hash(95), ask: "start" })).rejects.toThrow(
      /supplier confirms a delivery/,
    );
    await expect(create(pm, { token: hash(96), email: "not an email" })).rejects.toThrow(
      /email address/,
    );
    await expect(create(pm, { token: hash(97), date: day(-5) })).rejects.toThrow(/from today/);
    await expect(create(pm, { token: hash(98), expires: inDays(60) })).rejects.toThrow(
      /within 30 days/,
    );
    await expect(create(pm, { token: "short" })).rejects.toThrow(/link could not be made/);
  });

  it("is service role only on the token side", async () => {
    await expect(call(pm, "mcp_lookahead_confirm_open", [hash(1)])).rejects.toThrow();
    await expect(
      call(outsider, "mcp_lookahead_confirm_respond", [hash(1), "confirmed", null, "X Y", null, null, null]),
    ).rejects.toThrow();
  });

  it("opens a link by its hash and shows no team emails or money", async () => {
    const o = await call(null, "mcp_lookahead_confirm_open", [hash(1)]);
    expect(o).toMatchObject({
      status: "ok",
      company: "Northline Electric",
      job_number: "2810",
      job_name: "Willow Creek",
      pm_name: "Pat Lee",
      party_name: "Acme Supply",
      answer: "asked",
    });
    expect(JSON.stringify(o)).not.toMatch(/@|cost|price|amount|token/i);
    expect(await call(null, "mcp_lookahead_confirm_open", [hash(404)])).toEqual({
      status: "unknown",
    });
    expect(await call(null, "mcp_lookahead_confirm_open", ["nope"])).toEqual({
      status: "unknown",
    });
  });

  it("records a confirmation once, with the asked date", async () => {
    expect(await respond(hash(1), "confirmed", null, "x")).toEqual({
      status: "invalid",
      reason: "name",
    });
    const r = await respond(hash(1), "confirmed", null, "  Maria   Lopez ");
    expect(r).toMatchObject({
      status: "ok",
      job_id: job,
      answer: "confirmed",
      responder_name: "Maria Lopez",
      response_date: day(7),
    });
    const again = await respond(hash(1), "declined", null, "Maria Lopez", "Truck broke");
    expect(again).toMatchObject({ status: "answered", answer: "confirmed" });
    await expect(call(pm, "mcp_lookahead_confirm_cancel", [job, r.id])).rejects.toThrow(
      /already answered/,
    );
  });

  it("records a proposed date without moving the date asked, and marks it for a call", async () => {
    expect(await respond(hash(2), "proposed_new_date", null, "Luis Rivera")).toMatchObject({
      status: "invalid",
      reason: "date",
    });
    const asked = (await call(null, "mcp_lookahead_confirm_open", [hash(2)])).asked_date;
    expect(await respond(hash(2), "proposed_new_date", asked, "Luis Rivera")).toMatchObject({
      reason: "same_date",
    });
    const r = await respond(hash(2), "proposed_new_date", day(9), "Luis Rivera", "Crew on another job");
    expect(r).toMatchObject({
      status: "ok",
      answer: "proposed_new_date",
      asked_date: day(7),
      response_date: day(9),
      response_note: "Crew on another job",
    });
    const list = await call(superOn, "mcp_lookahead_confirms_list", [job, null]);
    const row = list.requests.find((x: J) => x.id === r.id);
    expect(row).toMatchObject({ state: "proposed_new_date", asked_date: day(7), needs_call: true });
  });

  it("needs a note to decline", async () => {
    await create(pm, { token: hash(3), name: "Bolt Fasteners", email: "bolt@example.com" });
    expect(await respond(hash(3), "declined", null, "Kim Bolt")).toMatchObject({
      status: "invalid",
      reason: "note",
    });
    expect(await respond(hash(3), "maybe", null, "Kim Bolt")).toMatchObject({
      status: "invalid",
      reason: "answer",
    });
    expect(
      await respond(hash(3), "declined", null, "Kim Bolt", "Out of stock until December"),
    ).toMatchObject({ status: "ok", answer: "declined", response_date: null });
  });

  it("stops an expired or cancelled link and slows down repeated posts", async () => {
    const e = await create(pm, { token: hash(4), name: "Late Supply", email: "late@example.com" });
    await db.query("UPDATE mcp_lookahead_confirms SET expires_at = now() - interval '1 minute' WHERE id = $1", [e.id]);
    expect(await call(null, "mcp_lookahead_confirm_open", [hash(4)])).toMatchObject({
      status: "expired",
      company: "Northline Electric",
    });
    expect(await respond(hash(4), "confirmed", null, "Al Late")).toEqual({ status: "expired" });

    const c = await create(superOn, { token: hash(5), name: "Gone Supply", email: "gone@example.com" });
    await expect(call(superOff, "mcp_lookahead_confirm_cancel", [job, c.id])).rejects.toThrow();
    expect(await call(superOn, "mcp_lookahead_confirm_cancel", [job, c.id])).toMatchObject({
      state: "cancelled",
    });
    expect((await call(null, "mcp_lookahead_confirm_open", [hash(5)])).status).toBe("cancelled");
    expect(await respond(hash(5), "confirmed", null, "Al Gone")).toEqual({ status: "cancelled" });

    await create(pm, { token: hash(6), name: "Busy Supply", email: "busy@example.com" });
    for (let i = 0; i < 20; i++) await respond(hash(6), "declined", null, "Bo Busy");
    expect(await respond(hash(6), "confirmed", null, "Bo Busy")).toEqual({ status: "slow_down" });
  });

  it("lists for anyone on the job, keeps the email result, and refuses outsiders", async () => {
    const list = await call(estimator, "mcp_lookahead_confirms_list", [job, la]);
    expect(list.can_send).toBe(false);
    expect(list.counts).toMatchObject({ confirmed: 1, needs_call: 2 });
    const first = list.requests.find((x: J) => x.party_name === "Acme Supply");
    await call(pm, "mcp_lookahead_confirm_email_result", [job, first.id, "sent"]);
    await expect(
      call(estimator, "mcp_lookahead_confirm_email_result", [job, first.id, "sent"]),
    ).rejects.toThrow();
    const after = await call(pm, "mcp_lookahead_confirms_list", [job, null]);
    expect(after.can_send).toBe(true);
    expect(after.requests.find((x: J) => x.id === first.id).email_status).toBe("sent");
    await expect(call(outsider, "mcp_lookahead_confirms_list", [job, null])).rejects.toThrow();
    await expect(call(superOff, "mcp_lookahead_confirms_list", [job, null])).rejects.toThrow();
  });

  it("records the answer as a field notice the job's PM and the supers on the job get", async () => {
    const n = await call(null, "mcp_job_notice_record", [
      job,
      "field_confirm",
      "lookahead_confirmed",
      "Acme Supply confirmed delivery Nov 12",
      null,
      "Maria Lopez",
      "mcp_lookahead_confirms",
      null,
      "{}",
      "lookahead",
      "lookahead_confirm:x",
    ]);
    expect(n.recipients.map((r: J) => r.email).sort()).toEqual([
      "pm-2@example.com",
      "super-3@example.com",
    ]);
  });
});
