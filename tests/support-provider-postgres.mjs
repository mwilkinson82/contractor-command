// Synthetic-only opt-in parity check. No database URL, key or existing cluster accepted.
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
const runtime = process.env.ATHENA_EMBEDDED_PG_MODULE;
assert.ok(runtime, "An already installed embedded-postgres runtime is required");
const { default: EmbeddedPostgres } = await import(pathToFileURL(resolve(runtime)).href);
const root = await realpath(await mkdtemp("/tmp/athena-support-provider-pg-"));
const port = 55487;
const server = new EmbeddedPostgres({
  databaseDir: join(root, "data"),
  user: "synthetic",
  password: "synthetic-only",
  port,
  persistent: false,
  postgresFlags: ["-c", "listen_addresses=", "-c", `unix_socket_directories=${root}`],
  onLog: () => {},
  onError: (message) => console.error(message),
});
const connections = [];
const connect = () => {
  const c = postgres({
    host: root,
    port,
    username: "synthetic",
    password: "synthetic-only",
    database: "postgres",
    max: 1,
    prepare: false,
    onnotice: () => {},
  });
  connections.push(c);
  return c;
};
const rpc = async (c, name, args) =>
  (
    await c.unsafe(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) r`,
      args.map((x) =>
        Array.isArray(x)
          ? "{" + x.map((v) => JSON.stringify(String(v))).join(",") + "}"
          : x && typeof x === "object"
            ? c.json(x)
            : x,
      ),
    )
  )[0].r;
const cases = [];
try {
  await server.initialise();
  await server.start();
  const db = connect(),
    a = connect(),
    b = connect();
  const [state] =
    await db`select version() version,current_setting('data_directory') dir,current_setting('listen_addresses') listeners,inet_server_addr() address`;
  assert.match(state.version, /PostgreSQL 17\./);
  assert.equal(state.dir, join(root, "data"));
  assert.equal(state.listeners, "");
  assert.equal(state.address, null);
  await db.unsafe(
    "create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;",
  );
  for (const path of [
    "supabase/migrations/20261028194500_support_tickets.sql",
    "drizzle/migrations/0043_support_conversations_owner_review.sql",
    "docs/migrations/support_receipt_provider_identity.sql",
  ]) {
    const sql = await readFile(path, "utf8");
    await db.begin(async (tx) => tx.unsafe(sql));
  }
  cases.push("exact reviewed migration applies atomically on PostgreSQL 17");
  const record = (c, id, refs = [], sender = "pat@example.com", verified = true) =>
    rpc(c, "record_support_message", [
      id,
      "athena",
      sender,
      "Synthetic",
      `<${id}@sender.example>`,
      "2026-10-30T00:00:00Z",
      "Full original",
      { text: "Full original" },
      refs,
      null,
      false,
      null,
      verified,
    ]);
  const first = await record(db, "first");
  const payload = {
    from: "Athena Support <support@meetathena.io>",
    to: ["pat@example.com"],
    text: "frozen",
  };
  const claims = await Promise.all([
    rpc(a, "claim_support_delivery", [first.message_record_id, "ack", payload]),
    rpc(b, "claim_support_delivery", [first.message_record_id, "ack", payload]),
  ]);
  assert.deepEqual(claims.map((x) => x.state).sort(), ["busy", "ready"]);
  const claim = claims.find((x) => x.state === "ready");
  cases.push("concurrent delivery claims yield one lease");
  await assert.rejects(
    rpc(db, "remember_support_delivery", [
      first.message_record_id,
      "ack",
      "00000000-0000-4000-8000-000000000000",
      "accepted_1",
    ]),
    /stale/,
  );
  const accepted = await Promise.allSettled([
    rpc(a, "remember_support_delivery", [
      first.message_record_id,
      "ack",
      claim.token,
      "accepted_1",
    ]),
    rpc(b, "remember_support_delivery", [
      first.message_record_id,
      "ack",
      claim.token,
      "accepted_conflict",
    ]),
  ]);
  assert.equal(accepted.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(accepted.filter((x) => x.status === "rejected").length, 1);
  cases.push("accepted provider identity is immutable and token-bound under race");
  await assert.rejects(record(db, "early", ["<ses-actual@provider.example>"]), /identity pending/);
  assert.equal((await db`select count(*)::int n from support_tickets`)[0].n, 1);
  cases.push("early reply defers without splitting ticket or advancing counter");
  await rpc(db, "complete_support_delivery", [
    first.message_record_id,
    "ack",
    claim.token,
    "<ses-actual@provider.example>",
  ]);
  assert.equal(
    (
      await db`select receipt_message_id from support_messages where id=${first.message_record_id}`
    )[0].receipt_message_id,
    "<ses-actual@provider.example>",
  );
  const reply = await record(db, "reply", ["<ses-actual@provider.example>"]);
  assert.equal(reply.id, first.id);
  assert.equal(reply.review_reason, null);
  cases.push("actual provider Message-ID continues verified same-sender ticket");
  for (const [id, sender, verified] of [
    ["foreign", "other@example.com", true],
    ["unverified", "pat@example.com", false],
  ]) {
    const r = await record(db, id, ["<ses-actual@provider.example>"], sender, verified);
    assert.notEqual(r.id, first.id);
    assert.ok(r.review_reason);
  }
  cases.push("foreign and unverified senders never join");
  const duplicate = await Promise.all([record(a, "replay"), record(b, "replay")]);
  assert.deepEqual(duplicate.map((x) => x.inserted).sort(), [false, true]);
  cases.push("concurrent receiving replay creates one message and ticket");
  const pending = await record(db, "pending");
  const c = await rpc(db, "claim_support_delivery", [pending.message_record_id, "ack", payload]);
  await rpc(db, "remember_support_delivery", [
    pending.message_record_id,
    "ack",
    c.token,
    "accepted_pending",
  ]);
  await rpc(db, "finish_support_delivery", [pending.message_record_id, "ack", c.token, "retry"]);
  await db`update support_deliveries set first_attempt_at=now()-interval '25 hours' where message_id=${pending.message_record_id}`;
  const recovery = await rpc(db, "claim_support_delivery", [
    pending.message_record_id,
    "ack",
    payload,
  ]);
  assert.equal(recovery.state, "ready");
  assert.equal(recovery.provider_email_id, "accepted_pending");
  cases.push("accepted delivery recovers by known provider identity beyond send-key lifetime");
  for (const role of ["anon", "authenticated"]) {
    await db.unsafe("set role " + role);
    await assert.rejects(
      rpc(db, "remember_support_delivery", [
        pending.message_record_id,
        "ack",
        recovery.token,
        "accepted_pending",
      ]),
      /permission denied/,
    );
    await assert.rejects(
      rpc(db, "complete_support_delivery", [
        pending.message_record_id,
        "ack",
        recovery.token,
        "<actual@provider.example>",
      ]),
      /permission denied/,
    );
    await db.unsafe("reset role");
  }
  await db.unsafe("set role service_role");
  await rpc(db, "complete_support_delivery", [
    pending.message_record_id,
    "ack",
    recovery.token,
    "<pending@provider.example>",
  ]);
  await db.unsafe("reset role");
  cases.push("application roles denied; existing service role can complete claimed delivery");
  console.log(
    JSON.stringify(
      { postgres: state.version, synthetic: true, socket_only: true, cases, passed: cases.length },
      null,
      2,
    ),
  );
} finally {
  for (const c of connections) await c.end({ timeout: 2 });
  await server.stop().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
