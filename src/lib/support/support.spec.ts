import { describe, expect, it } from "vitest";
import { sendManualSupportReply, processSupportInbound } from "./process.ts";
import type { OpenedSupportTicket, SupportTicketStore } from "./store.ts";
import { renderSupportAutoreply } from "./template.ts";
import {
  autoreplySubject,
  inboundDisposition,
  isSupportAutoreplyLive,
  SUPPORT_INBOXES,
  SUPPORT_PREVIEW_TO,
  threadHeaders,
  type InboundMail,
} from "./ticket.ts";

const ALLOWED_COLORS = new Set(["#0b1f3a", "#1e5fed", "#eef1f6", "#ffffff", "#4a5568", "#d6e0f0"]);

function memoryStore(): SupportTicketStore & { rows: OpenedSupportTicket[] } {
  const rows: OpenedSupportTicket[] = [];
  const deliveries = new Map<string, { payload: Record<string, unknown>; state: string }>();
  const seq = { athena: 0, circle: 0 };
  const find = (id: string) => rows.find((row) => row.id === id);
  return {
    rows,
    async open(input) {
      const existing = rows.find((row) => row.resend_email_id === input.resendEmailId);
      if (existing) return { ...existing, inserted: false };
      seq[input.brand] += 1;
      const prefix = input.brand === "athena" ? "ATH" : "CIR";
      const row: OpenedSupportTicket = {
        id: `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, "0")}`,
        ticket_number: `${prefix}-${String(seq[input.brand]).padStart(4, "0")}`,
        brand: input.brand,
        from_email: input.fromEmail,
        subject: input.subject,
        message_id: input.messageId,
        received_at: input.receivedAt,
        status: "open",
        raw_summary: input.rawSummary,
        resend_email_id: input.resendEmailId,
        autoreply_sent_at: null,
        notify_sent_at: null,
        autoreply_suppressed_reason: input.suppressedReason ?? null,
        inserted: true,
        messageRecordId: `message-${rows.length + 1}`,
        receiptMessageId: `<support-${rows.length + 1}@meetathena.io>`,
        ackPreview: input.preview ?? true,
        legacyImport: false,
        reviewReason: input.reviewReason ?? null,
      };
      rows.push(row);
      return row;
    },
    async claimDelivery(messageId, kind, payload) {
      const key = messageId + "/" + kind;
      const d = deliveries.get(key) ?? { payload, state: "retry" };
      deliveries.set(key, d);
      return {
        state: d.state === "sent" ? "sent" : d.state === "review" ? "review" : "ready",
        payload: d.payload,
        token: "claim",
      };
    },
    async finishDelivery(messageId, kind, _token, result) {
      const d = deliveries.get(messageId + "/" + kind);
      const row = rows.find((r) => r.messageRecordId === messageId);
      if (!d || !row) throw new Error("Missing delivery fixture");
      d.state = result;
      if (result === "sent") {
        if (kind === "ack") row.autoreply_sent_at = "2026-10-29T00:00:00Z";
        else row.notify_sent_at = "2026-10-29T00:00:00Z";
      }
    },
    async markAutoreplySent(id, at) {
      const row = find(id);
      if (row) row.autoreply_sent_at = at;
    },
    async markNotifySent(id, at) {
      const row = find(id);
      if (row) row.notify_sent_at = at;
    },
    async markAutoreplySuppressed(id, reason) {
      const row = find(id);
      if (row) row.autoreply_suppressed_reason = reason;
    },
    async get(id) {
      const row = find(id);
      return row ? { ...row } : null;
    },
    async markReplied(id) {
      const row = find(id);
      if (row) row.status = "replied";
    },
  };
}

function mockResend(email: InboundMail, sendStatus = 200, sendBody: unknown = { id: "sent_1" }) {
  const sends: Array<{ body: Record<string, unknown>; key: string | null }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET")
      return new Response(JSON.stringify({ id: "em", ...email }), { status: 200 });
    const headers = new Headers(init?.headers);
    sends.push({
      body: JSON.parse(String(init?.body)),
      key: headers.get("Idempotency-Key"),
    });
    const body = sends.length === 1 ? sendBody : { id: `sent_${sends.length}` };
    const status = sends.length === 1 ? sendStatus : 200;
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { sends, fetchImpl };
}

const baseMail: InboundMail = {
  from: "Pat Doe <pat@example.com>",
  to: ["Athena Support <support@meetathena.io>"],
  subject: "Gate code",
  text: "The gate code changed.",
  message_id: "<gate@example.com>",
  headers: { "Message-ID": "<gate@example.com>" },
  created_at: "2026-10-28T12:00:00.000Z",
};

describe("support templates", () => {
  it("renders both brands in navy and blue with the receipt copy and a text part", () => {
    for (const inbox of [SUPPORT_INBOXES.athena, SUPPORT_INBOXES.circle]) {
      const ticket = inbox.brand === "athena" ? "ATH-0001" : "CIR-0001";
      const { html, text } = renderSupportAutoreply({ inbox, ticketNumber: ticket });
      const lower = `${html}\n${text}`.toLowerCase();
      expect(lower).toContain("we've got it");
      expect(lower).toContain("we're on it");
      expect(lower).toContain("we're looking at it");
      expect(lower).toContain("we'll get right back to you");
      expect(html).toContain(ticket);
      expect(text).toContain(ticket);
      expect(html).toContain(inbox.product);
      expect(lower).not.toContain("lovable");
      expect(html).not.toMatch(/\b(red|#f00|#ff0000|#dc2626|#e11d48)\b/i);
      const colors = html.match(/#[0-9a-fA-F]{6}/g) ?? [];
      expect(colors.length).toBeGreaterThan(0);
      for (const color of colors) expect(ALLOWED_COLORS.has(color.toLowerCase())).toBe(true);
    }
    const athena = renderSupportAutoreply({
      inbox: SUPPORT_INBOXES.athena,
      ticketNumber: "ATH-0001",
    });
    const circle = renderSupportAutoreply({
      inbox: SUPPORT_INBOXES.circle,
      ticketNumber: "CIR-0001",
    });
    expect(athena.html).toContain("Athena Support");
    expect(athena.html).not.toContain("Circle Support");
    expect(circle.html).toContain("Circle Support");
    expect(circle.html).not.toContain("Athena");
  });
});

describe("support autoreply rules", () => {
  it("defaults the live flag off and only accepts true or 1", () => {
    expect(isSupportAutoreplyLive({}, "athena")).toBe(false);
    expect(isSupportAutoreplyLive({ ATHENA_SUPPORT_ACK_LIVE: "false" }, "athena")).toBe(false);
    expect(isSupportAutoreplyLive({ ATHENA_SUPPORT_ACK_LIVE: "" }, "athena")).toBe(false);
    expect(isSupportAutoreplyLive({ ATHENA_SUPPORT_ACK_LIVE: "true" }, "athena")).toBe(true);
    expect(isSupportAutoreplyLive({ ATHENA_SUPPORT_ACK_LIVE: "1" }, "athena")).toBe(true);
  });

  it("builds the threaded subject", () => {
    expect(autoreplySubject("Gate code", "ATH-0001")).toBe("Re: Gate code [ATH-0001]");
    expect(autoreplySubject("  ", "CIR-0002")).toBe("Re: (no subject) [CIR-0002]");
    expect(threadHeaders("<gate@example.com>")).toEqual({
      "In-Reply-To": "<gate@example.com>",
      References: "<gate@example.com>",
    });
    expect(threadHeaders(null)).toEqual({});
  });

  it("skips loops from our addresses, mailer-daemon, auto-submitted, and bulk mail", () => {
    expect(inboundDisposition({ from: "Athena Support <support@meetathena.io>" })).toEqual({
      action: "ignore",
      reason: "own_support",
    });
    expect(inboundDisposition({ from: "MAILER-DAEMON@googlemail.com" })).toEqual({
      action: "ignore",
      reason: "mailer_daemon",
    });
    expect(
      inboundDisposition({
        from: "pat@example.com",
        headers: { "Auto-Submitted": "auto-replied" },
      }),
    ).toEqual({ action: "record_only", reason: "auto_submitted" });
    expect(
      inboundDisposition({ from: "pat@example.com", headers: { "Auto-Submitted": "no" } }),
    ).toEqual({ action: "reply" });
    expect(
      inboundDisposition({ from: "pat@example.com", headers: { Precedence: "bulk" } }),
    ).toEqual({
      action: "record_only",
      reason: "precedence_bulk",
    });
    expect(
      inboundDisposition({ from: "pat@example.com", headers: { precedence: "list" } }),
    ).toEqual({
      action: "record_only",
      reason: "precedence_bulk",
    });
    expect(
      inboundDisposition({ from: "pat@example.com", headers: { "X-ALP-Support-Mail": "auto" } }),
    ).toEqual({ action: "record_only", reason: "unverified_loop_header" });
  });
});

describe("processSupportInbound", () => {
  it("threads the auto-reply, notifies Marshall, and does not email the customer while the flag is off", async () => {
    const store = memoryStore();
    const { sends, fetchImpl } = mockResend(baseMail);
    const result = await processSupportInbound("em_1", {
      apiKey: "re_test",
      fetchImpl,
      store,
      env: {},
    });
    expect(result).toMatchObject({
      status: "processed",
      ticketNumber: "ATH-0001",
      preview: true,
      autoreply: "sent",
      notify: "sent",
    });
    expect(sends).toHaveLength(2);
    const [reply, notice] = sends;
    expect(reply?.body.from).toBe("Athena Support <support@meetathena.io>");
    expect(reply?.body.to).toEqual([SUPPORT_PREVIEW_TO]);
    expect(reply?.body.subject).toBe("Re: Gate code [ATH-0001]");
    expect(reply?.body.headers).toMatchObject({
      "In-Reply-To": "<gate@example.com>",
      References: "<gate@example.com>",
      "Auto-Submitted": "auto-replied",
      "X-ALP-Support-Mail": "preview",
    });
    expect(String(reply?.body.from)).not.toMatch(/marshall@/i);
    expect(String(reply?.body.text)).toContain("We've got it.");
    expect(String(reply?.body.text)).toContain("we'll get right back to you.");
    expect(reply?.key).toBe(`support-ack/${store.rows[0]?.messageRecordId}`);
    expect(notice?.body.to).toEqual([SUPPORT_PREVIEW_TO]);
    expect(notice?.body.from).toBe("Athena Support <support@meetathena.io>");
    expect(String(notice?.body.subject)).toContain("[ATH-0001]");
    expect(String(notice?.body.text)).toContain("pat@example.com");
    expect(String(notice?.body.text)).toContain("Gate code");
    expect(notice?.body.headers).toMatchObject({ "X-ALP-Support-Mail": "notice" });
    expect(String(notice?.body.text)).toContain(
      `https://app.meetathena.io/admin/support?ticket=${store.rows[0].id}`,
    );
    expect(String(notice?.body.html)).toContain(
      `href="https://app.meetathena.io/admin/support?ticket=${store.rows[0].id}"`,
    );
    expect(notice?.key).toBe(`support-owner/${store.rows[0]?.messageRecordId}`);

    const again = await processSupportInbound("em_1", {
      apiKey: "re_test",
      fetchImpl,
      store,
      env: {},
    });
    expect(again).toEqual({ status: "duplicate", ticketNumber: "ATH-0001" });
    expect(sends).toHaveLength(2);

  });

  it("supports a separate Circle receipt opt-in", async () => {
    const store = memoryStore();
    const circleMail: InboundMail = {
      ...baseMail,
      to: ["support@alpcontractorcircle.com"],
      message_id: "<circle@example.com>",
      headers: { "Message-ID": "<circle@example.com>" },
    };
    const { sends, fetchImpl } = mockResend(circleMail);
    await processSupportInbound("em_circle", {
      apiKey: "re_test",
      fetchImpl,
      store,
      env: { CIRCLE_SUPPORT_ACK_LIVE: "true" },
    });
    expect(sends).toHaveLength(2);
    expect(sends[0].body.to).toEqual(["pat@example.com"]);
    expect(sends[1].body.to).toEqual([SUPPORT_PREVIEW_TO]);
    expect(store.rows[0].reviewReason).toBeNull();
  });

  it("does not auto-reply to mailer-daemon, our own support address, or bulk mail", async () => {
    const daemon = memoryStore();
    const daemonFetch = mockResend({
      ...baseMail,
      from: "Mailer-Daemon <mailer-daemon@googlemail.com>",
    });
    const skipped = await processSupportInbound("em_daemon", {
      apiKey: "re_test",
      fetchImpl: daemonFetch.fetchImpl,
      store: daemon,
      env: { ATHENA_SUPPORT_ACK_LIVE: "true" },
    });
    expect(skipped).toEqual({ status: "skipped", reason: "mailer_daemon" });
    expect(daemonFetch.sends).toHaveLength(0);
    expect(daemon.rows).toHaveLength(0);

    const own = memoryStore();
    const ownFetch = mockResend({ ...baseMail, from: "support@meetathena.io" });
    expect(
      await processSupportInbound("em_own", {
        apiKey: "re_test",
        fetchImpl: ownFetch.fetchImpl,
        store: own,
        env: { ATHENA_SUPPORT_ACK_LIVE: "true" },
      }),
    ).toEqual({ status: "skipped", reason: "own_support" });
    expect(ownFetch.sends).toHaveLength(0);

    const bulk = memoryStore();
    const bulkFetch = mockResend({
      ...baseMail,
      headers: { ...baseMail.headers, Precedence: "bulk" },
    });
    const recorded = await processSupportInbound("em_bulk", {
      apiKey: "re_test",
      fetchImpl: bulkFetch.fetchImpl,
      store: bulk,
      env: { ATHENA_SUPPORT_ACK_LIVE: "true" },
    });
    expect(recorded).toMatchObject({ autoreply: "suppressed", notify: "sent", preview: false });
    expect(bulkFetch.sends).toHaveLength(1);
    expect(bulkFetch.sends[0]?.body.headers).toMatchObject({ "X-ALP-Support-Mail": "notice" });
    expect(String(bulkFetch.sends[0]?.body.html)).not.toContain("We've got it.");
    expect(bulk.rows[0]?.autoreply_suppressed_reason).toBe("precedence_bulk");
  });

  it("holds a payload conflict for review and still delivers the owner notice", async () => {
    const store = memoryStore();
    const { sends, fetchImpl } = mockResend(baseMail, 409, {
      name: "invalid_idempotent_request",
      message: "used",
    });
    const result = await processSupportInbound("em_1", {
      apiKey: "re_test",
      fetchImpl,
      store,
      env: {},
    });
    expect(result).toMatchObject({ status: "processed", autoreply: "review", notify: "sent" });
    expect(sends).toHaveLength(2);
    expect(store.rows[0]?.autoreply_sent_at).toBeNull();
  });
});

describe("sendManualSupportReply", () => {
  it("replies on the ticket thread from the support address and honors the preview flag", async () => {
    const store = memoryStore();
    await store.open({
      resendEmailId: "em_1",
      brand: "athena",
      fromEmail: "pat@example.com",
      subject: "Gate code",
      messageId: "<gate@example.com>",
      receivedAt: "2026-10-28T12:00:00.000Z",
      rawSummary: "The gate code changed.",
    });
    const ticket = store.rows[0]!;
    const sends: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      sends.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: "manual_1" }), { status: 200 });
    }) as typeof fetch;

    const preview = await sendManualSupportReply({
      ticketId: ticket.id,
      message: "Please <b>see</b> the gate.",
      apiKey: "re_test",
      store,
      env: {},
      fetchImpl,
    });
    expect(preview).toMatchObject({
      ticketNumber: "ATH-0001",
      from: "Athena Support <support@meetathena.io>",
      to: SUPPORT_PREVIEW_TO,
      preview: true,
      resendId: "manual_1",
    });
    expect(sends[0]?.subject).toBe("Re: Gate code [ATH-0001]");
    expect(sends[0]?.headers).toMatchObject({
      "In-Reply-To": "<gate@example.com>",
      References: "<gate@example.com>",
      "X-ALP-Support-Mail": "manual-preview",
    });
    expect(sends[0]?.headers).not.toHaveProperty("Auto-Submitted");
    expect(String(sends[0]?.html)).toContain("Please &lt;b&gt;see&lt;/b&gt; the gate.");
    expect(String(sends[0]?.html)).not.toContain("<b>see</b>");
    expect(String(sends[0]?.from)).not.toMatch(/marshall@/i);
    expect(ticket.status).toBe("open");

    const live = await sendManualSupportReply({
      ticketId: ticket.id,
      message: "The code is posted.",
      apiKey: "re_test",
      store,
      env: { ATHENA_SUPPORT_ACK_LIVE: "true" },
      fetchImpl,
    });
    expect(live.to).toBe(SUPPORT_PREVIEW_TO);
    expect(live.preview).toBe(true);
    expect(ticket.status).toBe("open");
  });
});

describe("independent delivery recovery", () => {
  it("notifies owner after failed receipt, then retries only the receipt", async () => {
    const store = memoryStore();
    const { sends, fetchImpl } = mockResend(baseMail, 503, {});
    await expect(
      processSupportInbound("em_retry", {
        apiKey: "re_test",
        fetchImpl,
        store,
        env: {},
      }),
    ).rejects.toThrow(/pending retry/);
    expect(sends).toHaveLength(2);
    expect(store.rows[0].notify_sent_at).toBeTruthy();
    expect(store.rows[0].autoreply_sent_at).toBeNull();
    await processSupportInbound("em_retry", {
      apiKey: "re_test",
      fetchImpl,
      store,
      env: {},
    });
    expect(sends).toHaveLength(3);
    expect(sends[2].body).toEqual(sends[0].body);
    expect(sends[2].key).toBe(sends[0].key);
  });
  it("quarantines references with unknown identity despite forged authentication headers", async () => {
    const store = memoryStore();
    const { sends, fetchImpl } = mockResend({
      ...baseMail,
      headers: {
        ...baseMail.headers,
        "Authentication-Results": "trusted.example; dmarc=pass; spf=pass",
        References: "<stolen-receipt@meetathena.io>",
      },
    });
    const result = await processSupportInbound("unverified", {
      apiKey: "re_test",
      fetchImpl,
      store,
      env: { ATHENA_SUPPORT_ACK_LIVE: "true" },
    });
    expect(result).toMatchObject({ autoreply: "suppressed", notify: "sent" });
    expect(store.rows[0].reviewReason).toBe("unverified_sender_for_correlation");
    expect(sends).toHaveLength(1);
    expect(sends[0].body.to).toEqual([SUPPORT_PREVIEW_TO]);
  });
  it("retains spoofable loop-header evidence without sending recursive mail", async () => {
    for (const header of ["X-ALP-Support-Mail", "X-ALP-Inbox-Relay"]) {
      const store = memoryStore();
      const { sends, fetchImpl } = mockResend({ ...baseMail, headers: { [header]: "notice" } });
      const result = await processSupportInbound(header, {
        apiKey: "re_test",
        fetchImpl,
        store,
        env: {},
      });
      expect(result).toMatchObject({ autoreply: "suppressed", notify: "review" });
      expect(store.rows).toHaveLength(1);
      expect(store.rows[0].autoreply_suppressed_reason).toBe("unverified_loop_header");
      expect(sends).toHaveLength(0);
      const replay = mockResend(baseMail);
      const replayResult = await processSupportInbound(header, {
        apiKey: "re_test",
        fetchImpl: replay.fetchImpl,
        store,
        env: {},
      });
      expect(replayResult).toMatchObject({ autoreply: "suppressed", notify: "review" });
      expect(replay.sends).toHaveLength(0);
    }
  });
  it("mixed-brand mail creates review evidence but no customer acknowledgment", async () => {
    const store = memoryStore();
    const { sends, fetchImpl } = mockResend({
      ...baseMail,
      to: ["support@meetathena.io", "support@alpcontractorcircle.com"],
    });
    const result = await processSupportInbound("mixed", {
      apiKey: "re_test",
      fetchImpl,
      store,
      env: { ATHENA_SUPPORT_ACK_LIVE: "true", CIRCLE_SUPPORT_ACK_LIVE: "true" },
    });
    expect(result).toMatchObject({ autoreply: "suppressed", notify: "sent" });
    expect(sends).toHaveLength(1);
    expect(sends[0].body.to).toEqual([SUPPORT_PREVIEW_TO]);
    expect(sends[0].body.text).toContain("mixed_brand");
  });
});

describe("support email logos", () => {
  it("uses each brand's logo in its emails", async () => {
    const { renderSupportAutoreply, CIRCLE_LOGO_URL, ATHENA_LOGO_URL } =
      await import("./template.ts");
    expect(ATHENA_LOGO_URL.endsWith("/brand/athena-v1/email-ink.png")).toBe(true);
    const { SUPPORT_INBOXES } = await import("./ticket.ts");
    const circle = renderSupportAutoreply({ inbox: SUPPORT_INBOXES.circle, ticketNumber: "CIR-1" });
    expect(circle.html).toContain(`src="${CIRCLE_LOGO_URL}"`);
    expect(circle.html).toContain('alt="Contractor Circle"');
    const athena = renderSupportAutoreply({ inbox: SUPPORT_INBOXES.athena, ticketNumber: "ATH-1" });
    expect(athena.html).toContain(`src="${ATHENA_LOGO_URL}"`);
    expect(athena.html).toContain('alt="Athena"');
  });
});

it("retries a failed owner notice without repeating an accepted receipt", async () => {
  const store = memoryStore();
  const sends: Array<{ body: unknown; key: string | null }> = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    if (!init?.method || init.method === "GET") return Response.json(baseMail);
    sends.push({
      body: JSON.parse(String(init.body)),
      key: new Headers(init.headers).get("Idempotency-Key"),
    });
    return sends.length === 2
      ? new Response(null, { status: 503 })
      : Response.json({ id: "sent-" + sends.length });
  }) as typeof fetch;
  const options = { apiKey: "re_test", fetchImpl, store, env: {} };
  await expect(processSupportInbound("owner-retry", options)).rejects.toThrow(/pending retry/);
  expect(store.rows[0].autoreply_sent_at).toBeTruthy();
  expect(store.rows[0].notify_sent_at).toBeNull();
  await processSupportInbound("owner-retry", options);
  expect(sends).toHaveLength(3);
  expect(sends[2]).toEqual(sends[1]);
});

it("acknowledges a new sender without app authentication or provider verdict", async () => {
  const store = memoryStore();
  const { sends, fetchImpl } = mockResend(baseMail);
  const result = await processSupportInbound("new-customer", {
    apiKey: "re_test",
    fetchImpl,
    store,
    env: { ATHENA_SUPPORT_ACK_LIVE: "true" },
  });
  expect(result).toMatchObject({ autoreply: "sent", notify: "sent", preview: false });
  expect(sends[0].body.to).toEqual(["pat@example.com"]);
  expect(sends[0].body.text).not.toContain(baseMail.text);
  expect(sends[0].body).not.toHaveProperty("attachments");
});
it("quarantines an explicit provider DMARC failure even with forged pass headers", async () => {
  const store = memoryStore();
  const { sends, fetchImpl } = mockResend({
    ...baseMail,
    authentication: { dmarc: "fail", dkim: "pass" },
    headers: { "Authentication-Results": "dmarc=pass" },
  });
  const result = await processSupportInbound("failed-auth", {
    apiKey: "re_test",
    fetchImpl,
    store,
    env: { ATHENA_SUPPORT_ACK_LIVE: "true" },
  });
  expect(result).toMatchObject({ autoreply: "suppressed", notify: "sent" });
  expect(store.rows[0].reviewReason).toBe("sender_authentication_failed");
  expect(sends).toHaveLength(1);
  expect(sends[0].body.to).toEqual([SUPPORT_PREVIEW_TO]);
});

it("passes only provider verification into conversation persistence", async () => {
  const store = memoryStore();
  const originalOpen = store.open.bind(store);
  let verified: boolean | undefined;
  store.open = async (input) => {
    verified = input.senderVerified;
    return originalOpen(input);
  };
  const { sends, fetchImpl } = mockResend({
    ...baseMail,
    authentication: { dkim: "pass", dmarc: "gray" },
    headers: { References: "<receipt@meetathena.io>" },
  });
  await processSupportInbound("verified-followup", {
    apiKey: "re_test",
    fetchImpl,
    store,
    env: { ATHENA_SUPPORT_ACK_LIVE: "true" },
  });
  expect(verified).toBe(true);
  expect(store.rows[0].reviewReason).toBeNull();
  expect(sends[0].body.to).toEqual(["pat@example.com"]);
});
