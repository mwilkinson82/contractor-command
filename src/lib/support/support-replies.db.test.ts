import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

let db: PGlite;
const STAFF = "00000000-0000-4000-8000-000000000001";
const FROM = "Athena Support <support@meetathena.io>";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  `);
  await db.exec(readFileSync("supabase/migrations/20261028194500_support_tickets.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261106210000_support_replies.sql", "utf8"));
  // Safe to apply twice.
  await db.exec(readFileSync("supabase/migrations/20261106210000_support_replies.sql", "utf8"));
});

afterAll(async () => {
  await db.close();
});

let ticketId = "";
beforeEach(async () => {
  await db.exec("reset role");
  await db.exec("truncate public.support_replies, public.support_tickets");
  const t = await db.query<{ id: string }>(
    `select id from public.open_support_ticket('em_1','athena','luis@example.com','Contract value',
      '<m1@example.com>','2026-11-06T12:00:00Z','Contract value error')`,
  );
  ticketId = t.rows[0]!.id;
  await db.exec("set role service_role");
});

function claim(mode: string, to: string, key = "k1", from = FROM) {
  return db.query<{ claim_support_reply: { state: string; id: string } }>(
    `select public.claim_support_reply($1,$2,$3,$4,$5,'Re: Contract value [ATH-0001]','Fixed.',
      '<m1@example.com>','<m1@example.com>',$6)`,
    [ticketId, STAFF, mode, to, from, key],
  );
}

it("fixes the recipient: Marshall for a test copy, the ticket's sender for a customer reply", async () => {
  await expect(claim("preview", "luis@example.com")).rejects.toThrow(/recipients/);
  await expect(claim("customer", "marshall@marshallwilkinson.com")).rejects.toThrow(/recipients/);
  await expect(
    claim("customer", "luis@example.com", "k1", "Marshall <marshall@marshallwilkinson.com>"),
  ).rejects.toThrow(/recipients/);
  const ok = await claim("customer", "Luis@Example.com");
  expect(ok.rows[0]!.claim_support_reply.state).toBe("ready");
  const preview = await claim("preview", "marshall@marshallwilkinson.com", "k2");
  expect(preview.rows[0]!.claim_support_reply.state).toBe("ready");
});

it("sends once per key and marks the ticket replied only for a customer reply", async () => {
  const test = (await claim("preview", "marshall@marshallwilkinson.com", "kp")).rows[0]!
    .claim_support_reply;
  await db.query(`select public.finish_support_reply($1,'sent','re_p','<p@resend.dev>',null)`, [
    test.id,
  ]);
  let status = await db.query<{ status: string }>(
    "select status from public.support_tickets where id=$1",
    [ticketId],
  );
  expect(status.rows[0]!.status).toBe("open");

  const first = (await claim("customer", "luis@example.com")).rows[0]!.claim_support_reply;
  expect((await claim("customer", "luis@example.com")).rows[0]!.claim_support_reply.state).toBe(
    "busy",
  );
  await db.query(`select public.finish_support_reply($1,'accepted','re_1',null,null)`, [first.id]);
  await db.query(`select public.finish_support_reply($1,'sent','re_1','<d@resend.dev>',null)`, [
    first.id,
  ]);
  const again = (await claim("customer", "luis@example.com")).rows[0]!.claim_support_reply;
  expect(again).toMatchObject({ state: "sent", provider_email_id: "re_1" });
  status = await db.query<{ status: string }>(
    "select status from public.support_tickets where id=$1",
    [ticketId],
  );
  expect(status.rows[0]!.status).toBe("replied");
  const log = await db.query<{ state: string; to_email: string; sent_at: string | null }>(
    "select state, to_email, sent_at from public.support_replies where id=$1",
    [first.id],
  );
  expect(log.rows[0]).toMatchObject({ state: "sent", to_email: "luis@example.com" });
  expect(log.rows[0]!.sent_at).toBeTruthy();
});

it("lets a failed send retry with the same key", async () => {
  const first = (await claim("customer", "luis@example.com")).rows[0]!.claim_support_reply;
  await db.query(`select public.finish_support_reply($1,'failed',null,null,'Resend 503')`, [
    first.id,
  ]);
  const retry = (await claim("customer", "luis@example.com")).rows[0]!.claim_support_reply;
  expect(retry).toMatchObject({ state: "ready", id: first.id });
});

it("keeps replies closed to members", async () => {
  await db.exec("reset role");
  await db.exec("set role authenticated");
  await expect(db.query("select * from public.support_replies")).rejects.toThrow(/permission/);
  await expect(claim("customer", "luis@example.com")).rejects.toThrow(/permission/);
  await db.exec("reset role");
  await db.exec("set role anon");
  await expect(
    db.query(`select public.finish_support_reply(gen_random_uuid(),'sent',null,null,null)`),
  ).rejects.toThrow(/permission/);
});
