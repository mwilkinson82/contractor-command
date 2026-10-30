import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;",
  );
  await db.exec(readFileSync("supabase/migrations/20261028194500_support_tickets.sql", "utf8"));
  await db.exec(
    readFileSync(
      "supabase/migrations/20261029125856_support_conversations_owner_review.sql",
      "utf8",
    ),
  );
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(
    "reset role; truncate support_messages, support_deliveries, support_tickets cascade; update support_ticket_counters set last_number=0;",
  );
});
async function record(
  id: string,
  options: {
    brand?: string;
    sender?: string;
    refs?: readonly string[];
    preview?: boolean;
    subject?: string;
    messageId?: string;
    review?: string;
    verified?: boolean;
    evidence?: Record<string, unknown>;
  } = {},
) {
  const result = await db.query<{ r: any }>(
    "select record_support_message($1,$2,$3,$4,$5,now(),$6,$7,$8,$9,$10,null,$11) r",
    [
      id,
      options.brand ?? "athena",
      options.sender ?? "pat@example.com",
      options.subject ?? "Help",
      options.messageId ?? `<${id}@example.com>`,
      "summary",
      options.evidence ?? { text: "complete body", html_source: "<b>original</b>" },
      options.refs ?? [],
      options.review ?? null,
      options.preview ?? false,
      options.verified ?? true,
    ],
  );
  return result.rows[0].r;
}
function payload(row: any, kind = "ack") {
  return {
    from:
      row.brand === "athena"
        ? "Athena Support <support@meetathena.io>"
        : "Circle Support <support@alpcontractorcircle.com>",
    to: [kind === "owner" || row.ack_preview ? "marshall@marshallwilkinson.com" : row.from_email],
    text: "frozen",
  };
}
async function claim(row: any, kind = "ack", value = payload(row, kind)) {
  return (
    await db.query<{ r: any }>("select claim_support_delivery($1,$2,$3) r", [
      row.message_record_id,
      kind,
      value,
    ])
  ).rows[0].r;
}
async function finish(row: any, token: string, result = "sent", kind = "ack") {
  await db.query("select finish_support_delivery($1,$2,$3,$4)", [
    row.message_record_id,
    kind,
    token,
    result,
  ]);
}
it("continues live receipts for matching sender/brand, stores follow-ups, and deduplicates retries", async () => {
  const first = await record("em1");
  const delivery = await claim(first);
  await finish(first, delivery.token);
  const follow = await record("em2", { refs: [first.receipt_message_id] });
  expect(follow.ticket_number).toBe(first.ticket_number);
  expect(follow.message_record_id).not.toBe(first.message_record_id);
  expect(follow.notify_sent_at).toBeNull();
  expect(follow.review_reason).toBeNull();
  expect((await record("em2", { refs: [first.receipt_message_id] })).inserted).toBe(false);
  expect((await record("em3", { messageId: "<em2@example.com>" })).review_reason).toBe(
    "message_id_reuse_requires_review",
  );
  const bodies = await db.query<{ evidence: any }>(
    "select evidence from support_messages order by received_at",
  );
  expect(bodies.rows).toHaveLength(3);
  expect(bodies.rows[1].evidence.text).toBe("complete body");
});
it("does not trust subject numbers, customer Message-IDs, preview references, or other customers/brands", async () => {
  const first = await record("first");
  await finish(first, (await claim(first)).token);
  for (const [id, options] of [
    ["subject", { subject: "[ATH-0001] spoof" }],
    ["message", { refs: ["<first@example.com>"] }],
    ["sender", { sender: "other@example.com", refs: [first.receipt_message_id] }],
    ["brand", { brand: "circle", refs: [first.receipt_message_id] }],
  ] as const) {
    const row = await record(id, options);
    expect(row.id).not.toBe(first.id);
    expect(row.review_reason).toBeTruthy();
    expect((await claim(row)).state).toBe("review");
  }
  const preview = await record("preview", { preview: true });
  await finish(preview, (await claim(preview)).token);
  expect(
    (await record("preview-reply", { refs: [preview.receipt_message_id] })).review_reason,
  ).toBe("unverified_references");
  await expect(record("first", { sender: "other@example.com" })).rejects.toThrow(
    /identity mismatch/,
  );
});
it("scopes message dedupe by sender and brand and freezes mode on replay", async () => {
  const first = await record("em1", { preview: true });
  expect((await record("em1", { preview: false })).ack_preview).toBe(true);
  const other = await record("em2", {
    sender: "other@example.com",
    messageId: "<em1@example.com>",
  });
  expect(other.id).not.toBe(first.id);
  const brand = await record("em3", { brand: "circle", messageId: "<em1@example.com>" });
  expect(brand.ticket_number).toBe("CIR-0001");
});
it("leases independently, freezes payload, and holds expired uncertain sends for review", async () => {
  const row = await record("em1");
  const ack = await claim(row);
  expect(ack.state).toBe("ready");
  expect((await claim(row)).state).toBe("busy");
  expect((await claim(row, "owner")).state).toBe("ready");
  await finish(row, ack.token, "retry");
  const retry = await claim(row, "ack", { ...payload(row), text: "changed" });
  expect(retry.payload.text).toBe("frozen");
  await expect(finish(row, ack.token)).rejects.toThrow(/stale/);
  await db.exec(
    "update support_deliveries set first_attempt_at=now()-interval '25 hours',lease_until=now()-interval '1 hour' where kind='ack'",
  );
  expect((await claim(row)).state).toBe("review");
});
it("enforces private tables, RPC permissions and exact delivery recipients", async () => {
  const row = await record("em1");
  await expect(
    claim(row, "owner", { ...payload(row, "owner"), to: ["attacker@example.com"] }),
  ).rejects.toThrow(/recipients/);
  await db.exec("set role anon");
  await expect(record("anon")).rejects.toThrow(/permission denied/);
  await db.exec("reset role; set role authenticated");
  await expect(db.query("select * from support_messages")).rejects.toThrow(/permission denied/);
  await expect(db.query("select * from support_deliveries")).rejects.toThrow(/permission denied/);
  await db.exec("reset role; set role service_role");
  expect((await record("service")).ticket_number).toBe("ATH-0002");
});

it("quarantines Message-ID collisions without substituting pending evidence", async () => {
  const first = await record("original");
  for (const [index, evidence] of [
    { text: "different body" },
    { attachments: [{ id: "foreign-attachment" }] },
    { references: "<forged>" },
    { to: ["support@meetathena.io", "support@alpcontractorcircle.com"] },
  ].entries()) {
    const reused = await record("collision-" + index, {
      messageId: "<original@example.com>",
      evidence,
    });
    expect(reused.message_record_id).not.toBe(first.message_record_id);
    expect(reused.review_reason).toBe("message_id_reuse_requires_review");
    expect((await claim(reused)).state).toBe("review");
  }
  const original = await db.query<{ evidence: any }>(
    "select evidence from support_messages where id=$1",
    [first.message_record_id],
  );
  expect(original.rows[0].evidence.text).toBe("complete body");
  expect((await claim(first, "owner")).state).toBe("ready");
  await expect(record("original", { evidence: { text: "replacement" } })).rejects.toThrow(
    /evidence mismatch/,
  );
});

it("unverified sender cannot join a live receipt in preview or live mode", async () => {
  const original = await record("verified-fixture");
  await finish(original, (await claim(original)).token);
  for (const preview of [true, false]) {
    const unverified = await record("unverified-" + preview, {
      refs: [original.receipt_message_id],
      preview,
      verified: false,
    });
    expect(unverified.id).not.toBe(original.id);
    expect(unverified.review_reason).toBe("unverified_sender_for_correlation");
    expect((await claim(unverified)).state).toBe("review");
  }
});