import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

let db: PGlite;
const observed = "2026-10-04T12:00:00Z";
const episode = "sub_test:1791072000";
const payload = (channel = "member") => ({
  to: channel === "owner" ? "wilkinson.marshall@gmail.com" : "member@example.test",
  label: channel === "owner" ? "circle-cancellation-owner" : "circle-cancellation-confirmation",
  circle_cancellation_subscription_id: "sub_test",
  circle_cancellation_episode: episode,
  html: "<p>Synthetic only</p>",
  text: "Synthetic only",
  subject: "Synthetic cancellation",
});
async function enqueue(channel = "member", overrides = {}) {
  return (
    await db.query<{ value: string }>(
      "select enqueue_circle_cancellation_notice('sub_test',$1,$2,$3,$4) as value",
      [observed, episode, channel, { ...payload(channel), ...overrides }],
    )
  ).rows[0].value;
}
async function count(table: string) {
  return (await db.query<{ n: number }>(`select count(*)::int n from ${table}`)).rows[0].n;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role;
    CREATE TABLE subscriptions(stripe_subscription_id text PRIMARY KEY,tier text,email text,metadata jsonb);
    CREATE TABLE circle_subscription_evidence(stripe_subscription_id text PRIMARY KEY,observed_at timestamptz);
    CREATE TABLE suppressed_emails(email text PRIMARY KEY);
    CREATE TABLE email_unsubscribe_tokens(email text PRIMARY KEY,token text,used_at timestamptz);
    CREATE TABLE email_send_log(message_id text,template_name text,recipient_email text,status text,error_message text,metadata jsonb);
    CREATE TABLE synthetic_queue(payload jsonb);
    CREATE TABLE synthetic_controls(fail boolean);
    INSERT INTO synthetic_controls VALUES(false);
    CREATE FUNCTION enqueue_email(queue_name text,payload jsonb) RETURNS void LANGUAGE plpgsql AS $$
      BEGIN
        IF (SELECT fail FROM synthetic_controls) THEN RAISE EXCEPTION 'synthetic queue failure'; END IF;
        INSERT INTO synthetic_queue VALUES(payload);
      END;
    $$;
  `);
  await db.exec(
    readFileSync(
      new URL(
        "../../../supabase/migrations/20261005000946_circle_cancellation_notices.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
});
afterAll(async () => db?.close());
beforeEach(async () => {
  await db.exec(
    "truncate subscriptions,circle_subscription_evidence,circle_cancellation_notices,suppressed_emails,email_unsubscribe_tokens,email_send_log,synthetic_queue; update synthetic_controls set fail=false;",
  );
  await db.query("insert into subscriptions values('sub_test','circle','member@example.test',$1)", [
    {
      circle_cancellation_notice: { episode, memberAllowed: true, neverEmail: false },
    },
  ]);
  await db.query("insert into circle_subscription_evidence values('sub_test',$1)", [observed]);
});
describe("atomic cancellation queue migration", () => {
  it("queues exactly one confirmation and one owner alert across retries/end events", async () => {
    expect(await enqueue()).toBe("queued");
    expect(await enqueue("owner")).toBe("queued");
    expect(await enqueue()).toBe("duplicate");
    expect(await enqueue("owner")).toBe("duplicate");
    expect(await count("synthetic_queue")).toBe(2);
    expect(await count("circle_cancellation_notices")).toBe(2);
    const rows = (
      await db.query<{ payload: Record<string, unknown> }>("select payload from synthetic_queue")
    ).rows;
    for (const { payload } of rows) {
      expect(payload.idempotency_key).toBe(
        `circle-cancellation:${episode}:${payload.label === "circle-cancellation-owner" ? "owner" : "member"}`,
      );
      expect(payload.message_id).toBeTruthy();
      expect(payload.unsubscribe_token).toBeTruthy();
    }
  });
  it("rolls back ledger, audit and token when queue fails; retry succeeds", async () => {
    await db.exec("update synthetic_controls set fail=true");
    await expect(enqueue()).rejects.toThrow("synthetic queue failure");
    for (const table of [
      "circle_cancellation_notices",
      "email_send_log",
      "email_unsubscribe_tokens",
      "synthetic_queue",
    ])
      expect(await count(table)).toBe(0);
    await db.exec("update synthetic_controls set fail=false");
    expect(await enqueue()).toBe("queued");
  });
  it("does not lose the owner notice when the member channel is already committed", async () => {
    expect(await enqueue()).toBe("queued");
    await db.exec("update synthetic_controls set fail=true");
    await expect(enqueue("owner")).rejects.toThrow();
    await db.exec("update synthetic_controls set fail=false");
    expect(await enqueue()).toBe("duplicate");
    expect(await enqueue("owner")).toBe("queued");
    expect(await count("synthetic_queue")).toBe(2);
  });
  it("holds stale refreshes, resumed subscriptions and other programs", async () => {
    await db.exec(
      "update circle_subscription_evidence set observed_at=observed_at+interval '1 second'",
    );
    expect(await enqueue()).toBe("stale");
    await db.query("update circle_subscription_evidence set observed_at=$1", [observed]);
    await db.exec("update subscriptions set metadata='{}'");
    expect(await enqueue()).toBe("stale");
    await db.exec("update subscriptions set tier='book_buyer'");
    expect(await enqueue()).toBe("stale");
    expect(await count("synthetic_queue")).toBe(0);
  });
  it("rejects forged recipient, program label and source bindings", async () => {
    for (const overrides of [
      { to: "wrong@example.test" },
      { label: "circle-welcome" },
      { circle_cancellation_episode: "wrong" },
      { circle_cancellation_subscription_id: "sub_other" },
    ])
      await expect(enqueue("member", overrides)).rejects.toThrow(
        "Cancellation recipient/source mismatch",
      );
    expect(await count("circle_cancellation_notices")).toBe(0);
  });
  it("honors suppression and unsubscribe while owner alert remains independent", async () => {
    await db.exec("insert into suppressed_emails values('member@example.test')");
    expect(await enqueue()).toBe("suppressed");
    expect(await enqueue("owner")).toBe("queued");
    expect(await count("synthetic_queue")).toBe(1);
    await db.exec(
      "truncate circle_cancellation_notices,suppressed_emails; insert into email_unsubscribe_tokens values('member@example.test','used',now())",
    );
    expect(await enqueue()).toBe("suppressed");
  });
  it("withholds ambiguous and excluded identities without changing membership or grants", async () => {
    const before = (await db.query<{ tier: string; email: string }>("select * from subscriptions"))
      .rows;
    await db.exec(
      `update subscriptions set metadata=jsonb_set(metadata,'{circle_cancellation_notice,memberAllowed}','false')`,
    );
    expect(await enqueue()).toBe("suppressed");
    expect(await enqueue("owner")).toBe("queued");
    expect((await db.query("select tier,email from subscriptions")).rows).toEqual(
      before.map(({ tier, email }) => ({ tier, email })),
    );
  });
  it("revokes permissive hosted defaults from public callers and exposes minimal service privileges", async () => {
    for (const role of ["anon", "authenticated"])
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"])
        expect(
          (
            await db.query<{ allowed: boolean }>(
              "select has_table_privilege($1,'circle_cancellation_notices',$2) allowed",
              [role, privilege],
            )
          ).rows[0].allowed,
        ).toBe(false);
    for (const role of ["anon", "authenticated"])
      expect(
        (
          await db.query<{ allowed: boolean }>(
            "select has_function_privilege($1,'enqueue_circle_cancellation_notice(text,timestamptz,text,text,jsonb)','EXECUTE') allowed",
            [role],
          )
        ).rows[0].allowed,
      ).toBe(false);
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "select has_table_privilege('service_role','circle_cancellation_notices','DELETE') allowed",
        )
      ).rows[0].allowed,
    ).toBe(false);
  });
});
