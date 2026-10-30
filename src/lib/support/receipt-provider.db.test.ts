import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { processSupportInbound } from "./process.ts";
import { SupportDeliveryError } from "./resend-send.ts";
import type { OpenedSupportTicket, SupportTicketStore } from "./store.ts";
import type { InboundMail } from "./ticket.ts";

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;",
  );
  for (const path of [
    "supabase/migrations/20261028194500_support_tickets.sql",
    "drizzle/migrations/0043_support_conversations_owner_review.sql",
    "docs/migrations/support_receipt_provider_identity.sql",
  ])
    await db.exec(readFileSync(path, "utf8"));
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(
    "reset role; truncate support_messages,support_deliveries,support_tickets cascade; update support_ticket_counters set last_number=0;",
  );
});
async function rpc<T = unknown>(name: string, values: unknown[]) {
  return (
    await db.query<{ r: T }>(
      `select ${name}(${values.map((_, i) => "$" + (i + 1)).join(",")}) r`,
      values,
    )
  ).rows[0].r;
}
const store: SupportTicketStore = {
  async open(i) {
    const r = await rpc<
      OpenedSupportTicket & {
        message_record_id: string;
        receipt_message_id: string;
        review_reason: string | null;
        ack_preview: boolean;
        legacy_import: boolean;
      }
    >("record_support_message", [
      i.resendEmailId,
      i.brand,
      i.fromEmail,
      i.subject,
      i.messageId,
      i.receivedAt,
      i.rawSummary,
      i.evidence,
      i.references,
      i.reviewReason,
      i.preview,
      i.suppressedReason,
      i.senderVerified,
    ]);
    return {
      ...r,
      messageRecordId: r.message_record_id,
      receiptMessageId: r.receipt_message_id,
      reviewReason: r.review_reason,
      ackPreview: r.ack_preview,
      legacyImport: r.legacy_import,
    };
  },
  async claimDelivery(id, kind, payload) {
    const r = await rpc<{
      state: "ready" | "sent" | "busy" | "review";
      token: string | null;
      payload: Record<string, unknown>;
      provider_email_id: string | null;
    }>("claim_support_delivery", [id, kind, payload]);
    return { ...r, providerEmailId: r.provider_email_id ?? null };
  },
  async rememberDelivery(id, kind, token, providerId) {
    try {
      await rpc("remember_support_delivery", [id, kind, token, providerId]);
    } catch (e) {
      throw new SupportDeliveryError(
        "Acceptance persistence failed: " + (e as Error).message,
        !["23505", "P0001"].includes((e as { code: string }).code),
      );
    }
  },
  async completeDelivery(id, kind, token, providerMessageId) {
    try {
      await rpc("complete_support_delivery", [id, kind, token, providerMessageId]);
    } catch (e) {
      throw new SupportDeliveryError(
        "Identity completion failed: " + (e as Error).message,
        !["23505", "P0001"].includes((e as { code: string }).code),
      );
    }
  },
  async finishDelivery(id, kind, token, result) {
    await rpc("finish_support_delivery", [id, kind, token, result]);
  },
  async get() {
    throw Error("unused");
  },
  async markReplied() {
    throw Error("unused");
  },
  async markAutoreplySent() {
    throw Error("unused");
  },
  async markNotifySent() {
    throw Error("unused");
  },
  async markAutoreplySuppressed() {
    throw Error("unused");
  },
};
const mail = (id: string, options: Partial<InboundMail> = {}): InboundMail => ({
  from: "Pat <pat@example.com>",
  to: ["support@meetathena.io"],
  subject: "Synthetic",
  text: "Full original " + id,
  message_id: `<${id}@sender.example>`,
  created_at: "2026-10-30T12:00:00Z",
  authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
  ...options,
});
function provider(inbound: Record<string, InboundMail>) {
  const sends: Array<{
    id: string;
    body: Record<string, unknown> & {
      to: string[];
      headers: Record<string, string>;
    };
    key: string | null;
  }> = [];
  const posts: string[] = [],
    gets: string[] = [];
  let missingMetadata = 0;
  let transform = (r: Record<string, unknown>) => r;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/receiving/"))
      return Response.json(inbound[decodeURIComponent(u.split("/").at(-1)!)]);
    if (init?.method === "POST") {
      const key = new Headers(init.headers).get("Idempotency-Key");
      posts.push(key!);
      let sent = sends.find((s) => s.key === key);
      if (!sent) {
        sent = { id: "accepted_" + (sends.length + 1), key, body: JSON.parse(String(init.body)) };
        sends.push(sent);
      }
      return Response.json({ id: sent.id });
    }
    const id = decodeURIComponent(u.split("/").at(-1)!);
    gets.push(id);
    if (missingMetadata > 0) {
      missingMetadata--;
      return new Response(null, { status: 503 });
    }
    const sent = sends.find((s) => s.id === id)!;
    return Response.json(
      transform({
        id,
        from: sent.body.from,
        to: sent.body.to,
        cc: [],
        bcc: [],
        message_id: `<ses-${id}@provider.example>`,
      }),
    );
  }) as typeof fetch;
  return {
    sends,
    posts,
    gets,
    fetchImpl,
    failLookups(n: number) {
      missingMetadata = n;
    },
    transformMetadata(fn: typeof transform) {
      transform = fn;
    },
  };
}
function run(id: string, p: ReturnType<typeof provider>, custom = store, live = true) {
  return processSupportInbound(id, {
    apiKey: "synthetic",
    fetchImpl: p.fetchImpl,
    store: custom,
    env: live ? { ATHENA_SUPPORT_ACK_LIVE: "true", CIRCLE_SUPPORT_ACK_LIVE: "true" } : {},
  });
}
async function messages() {
  return (
    await db.query<{
      receipt_message_id: string;
      ack_sent_at: string | null;
      review_reason: string | null;
      evidence: { text: string };
    }>("select * from support_messages order by received_at,id")
  ).rows;
}

it("survives provider Message-ID replacement end to end with two messages, one ticket, four emails and no replay sends", async () => {
  const inbound = {
    first: mail("first"),
    reply: mail("reply", { headers: { "In-Reply-To": "<ses-accepted_1@provider.example>" } }),
  };
  const p = provider(inbound);
  expect(await run("first", p)).toMatchObject({
    ticketNumber: "ATH-0001",
    autoreply: "sent",
    notify: "sent",
    preview: false,
  });
  const first = (await messages())[0];
  expect(p.sends[0].body.headers["Message-ID"]).toMatch(/^<support-/);
  expect(first.receipt_message_id).toBe("<ses-accepted_1@provider.example>");
  expect(first.receipt_message_id).not.toBe(p.sends[0].body.headers["Message-ID"]);
  expect(await run("reply", p)).toMatchObject({
    ticketNumber: "ATH-0001",
    autoreply: "sent",
    notify: "sent",
  });
  const before = await messages();
  expect(before).toHaveLength(2);
  expect(before.every((m) => m.review_reason === null)).toBe(true);
  expect(before.map((m) => m.evidence.text).sort()).toEqual([
    "Full original first",
    "Full original reply",
  ]);
  expect((await db.query("select * from support_tickets")).rows).toHaveLength(1);
  for (const id of ["first", "reply"])
    expect(await run(id, p)).toMatchObject({ status: "duplicate", ticketNumber: "ATH-0001" });
  expect(p.posts).toHaveLength(4);
  expect(p.sends).toHaveLength(4);
  expect(await messages()).toEqual(before);
  expect(p.sends.filter((s) => s.body.to[0] === "pat@example.com")).toHaveLength(2);
  expect(p.sends.filter((s) => s.body.to[0] === "marshall@marshallwilkinson.com")).toHaveLength(2);
});

it("recovers accepted delivery metadata after an outage without POSTing again, even after the idempotency window", async () => {
  const p = provider({
    first: mail("first"),
    reply: mail("reply", { headers: { References: "<ses-accepted_1@provider.example>" } }),
  });
  p.failLookups(1);
  await expect(run("first", p)).rejects.toThrow(/pending retry/);
  expect(p.sends).toHaveLength(2);
  expect((await messages())[0].ack_sent_at).toBeNull();
  // Reply arrives before metadata is resolved: retry without creating a split ticket.
  await expect(run("reply", p)).rejects.toThrow(/identity pending/);
  expect((await db.query("select * from support_tickets")).rows).toHaveLength(1);
  await db.exec(
    "update support_deliveries set first_attempt_at=now()-interval '25 hours' where kind='ack'",
  );
  expect(await run("first", p)).toMatchObject({ autoreply: "sent", notify: "already" });
  expect(p.posts).toHaveLength(2);
  expect(p.gets).toEqual(["accepted_1", "accepted_1"]);
  expect(await run("reply", p)).toMatchObject({ ticketNumber: "ATH-0001" });
});

it("uses the same idempotency key if acceptance persistence failed before it could retain the provider ID", async () => {
  const p = provider({
    first: mail("first"),
    reply: mail("reply", { headers: { References: "<ses-accepted_1@provider.example>" } }),
  });
  let fail = true;
  const flaky = {
    ...store,
    async rememberDelivery(...args: Parameters<SupportTicketStore["rememberDelivery"]>) {
      if (args[1] === "ack" && fail) {
        fail = false;
        throw Error("temporary database response loss");
      }
      await store.rememberDelivery(...args);
    },
  };
  await expect(run("first", p, flaky)).rejects.toThrow(/pending retry/);
  await expect(run("reply", p)).rejects.toThrow(/identity pending/);
  await run("first", p, flaky);
  expect(p.posts).toHaveLength(3);
  expect(p.posts[2]).toBe(p.posts[0]);
  expect(p.sends).toHaveLength(2);
});

it("never joins a foreign sender, brand, unverified sender, subject number, or requested-but-undelivered Message-ID", async () => {
  const inbound: Record<string, InboundMail> = { first: mail("first") };
  const p = provider(inbound);
  await run("first", p);
  const intended = p.sends[0].body.headers["Message-ID"];
  const actual = "<ses-accepted_1@provider.example>";
  const cases: Partial<InboundMail>[] = [
    { from: "other@example.com", headers: { References: actual } },
    { to: ["support@alpcontractorcircle.com"], headers: { References: actual } },
    { authentication: { dmarc: "unknown", dkim: "unknown" }, headers: { References: actual } },
    { subject: "[ATH-0001] claimed ticket" },
    { headers: { References: intended } },
  ];
  for (const [i, c] of cases.entries()) {
    inbound["negative" + i] = mail("negative" + i, c);
    const r = await run("negative" + i, p);
    expect(r).toMatchObject({ autoreply: "suppressed", notify: "sent" });
    expect("ticketNumber" in r && r.ticketNumber).not.toBe("ATH-0001");
  }
  expect(p.sends.filter((s) => s.body.to[0] === "pat@example.com")).toHaveLength(1);
});

it("does not correlate to a preview receipt even when the actual provider identifier is known", async () => {
  const p = provider({
    first: mail("first"),
    reply: mail("reply", { headers: { References: "<ses-accepted_1@provider.example>" } }),
  });
  await run("first", p, store, false);
  expect(await run("reply", p)).toMatchObject({
    ticketNumber: "ATH-0002",
    autoreply: "suppressed",
  });
});

it.each(["id", "from", "to", "bcc", "message_id"])(
  "refuses unsafe provider metadata field %s without losing the owner notice",
  async (field) => {
    const p = provider({ first: mail("first") });
    p.transformMetadata((r) => ({
      ...r,
      [field]:
        field === "to" || field === "bcc"
          ? ["foreign@example.com"]
          : field === "message_id"
            ? "bad\r\nMessage-ID"
            : "foreign",
    }));
    if (field === "message_id") await expect(run("first", p)).rejects.toThrow(/pending retry/);
    else expect(await run("first", p)).toMatchObject({ autoreply: "review", notify: "sent" });
    expect((await messages())[0].ack_sent_at).toBeNull();
    expect(p.sends).toHaveLength(2);
  },
);

it("requires current lease tokens and accepted provider identity; private RPC access remains denied", async () => {
  const r = await store.open({
    resendEmailId: "first",
    brand: "athena",
    fromEmail: "pat@example.com",
    subject: "Test",
    messageId: "<first@example.com>",
    receivedAt: new Date().toISOString(),
    rawSummary: "Full",
    evidence: { text: "Full" },
    references: [],
    preview: false,
    senderVerified: true,
  });
  const payload = { from: "Athena Support <support@meetathena.io>", to: ["pat@example.com"] };
  const c = await store.claimDelivery(r.messageRecordId, "ack", payload);
  await expect(
    store.completeDelivery(r.messageRecordId, "ack", c.token!, "<actual@provider.example>"),
  ).rejects.toThrow(/completion/);
  await expect(
    rpc("remember_support_delivery", [
      r.messageRecordId,
      "ack",
      "00000000-0000-4000-8000-000000000000",
      "accepted_1",
    ]),
  ).rejects.toThrow(/stale/);
  await store.rememberDelivery(r.messageRecordId, "ack", c.token!, "accepted_1");
  await expect(
    rpc("remember_support_delivery", [r.messageRecordId, "ack", c.token!, "accepted_changed"]),
  ).rejects.toThrow(/cannot change/);
  await store.completeDelivery(r.messageRecordId, "ack", c.token!, "<actual@provider.example>");
  expect((await messages())[0].receipt_message_id).toBe("<actual@provider.example>");
  for (const role of ["anon", "authenticated"]) {
    await db.exec("set role " + role);
    await expect(
      rpc("remember_support_delivery", [r.messageRecordId, "ack", c.token!, "accepted_1"]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      rpc("complete_support_delivery", [
        r.messageRecordId,
        "ack",
        c.token!,
        "<actual@provider.example>",
      ]),
    ).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  }
});
