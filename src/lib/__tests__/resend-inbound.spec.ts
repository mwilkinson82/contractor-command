import { describe, expect, it } from "vitest";
import {
  buildForwardPayload,
  forwardReceivedEmail,
  INBOUND_FORWARD_TO,
  INBOUND_RELAY_FROM,
  INBOUND_RELAY_HEADER,
  type ReceivedEmail,
} from "@/lib/resend/inbound-forward";
import { computeWebhookSignature, verifyResendWebhook } from "@/lib/resend/webhook-signature";

// Test-only secret (base64 of "test-secret-key-for-vitest-only!").
const SECRET = `whsec_${btoa("test-secret-key-for-vitest-only!")}`;

describe("verifyResendWebhook", () => {
  const payload = JSON.stringify({ type: "email.received", data: { email_id: "abc" } });
  const now = 1_800_000_000;

  it("accepts a valid Svix signature", async () => {
    const sig = await computeWebhookSignature(SECRET, "msg_1", String(now), payload);
    const result = await verifyResendWebhook({
      payload,
      headers: { id: "msg_1", timestamp: String(now), signature: `v1,bogus v1,${sig}` },
      secret: SECRET,
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects missing headers, tampered bodies, and stale timestamps", async () => {
    const sig = await computeWebhookSignature(SECRET, "msg_1", String(now), payload);
    expect(
      await verifyResendWebhook({
        payload,
        headers: { id: null, timestamp: null, signature: null },
        secret: SECRET,
        nowSeconds: now,
      }),
    ).toEqual({ ok: false, reason: "missing_headers" });
    expect(
      await verifyResendWebhook({
        payload: payload.replace("abc", "xyz"),
        headers: { id: "msg_1", timestamp: String(now), signature: `v1,${sig}` },
        secret: SECRET,
        nowSeconds: now,
      }),
    ).toEqual({ ok: false, reason: "invalid_signature" });
    expect(
      await verifyResendWebhook({
        payload,
        headers: { id: "msg_1", timestamp: String(now), signature: `v1,${sig}` },
        secret: SECRET,
        nowSeconds: now + 3600,
      }),
    ).toEqual({ ok: false, reason: "stale_timestamp" });
    expect(
      await verifyResendWebhook({
        payload,
        headers: { id: "msg_1", timestamp: String(now), signature: `v1,${sig}` },
        secret: "",
        nowSeconds: now,
      }),
    ).toEqual({ ok: false, reason: "missing_secret" });
  });
});

const EMAIL: ReceivedEmail = {
  id: "em_1",
  from: "pat@example.com",
  to: ["marshall@alpcontractorcircle.com"],
  cc: ["welcome@alpcontractorcircle.com"],
  bcc: [],
  reply_to: [],
  received_for: ["marshall@alpcontractorcircle.com"],
  subject: "Re: Butler <gap> analysis",
  html: "<html><body><p>Hi Marshall</p><img src=\"cid:img001\"></body></html>",
  text: "Hi Marshall",
  headers: { from: "Pat Doe <pat@example.com>", date: "Sun, 27 Sep 2026 21:18:06 -0400" },
  created_at: "2026-09-28T01:18:06.486Z",
  attachments: [
    { id: "att_1", filename: "plan.pdf", content_type: "application/pdf" },
    { id: "att_2", filename: "logo.png", content_type: "image/png", content_disposition: "inline", content_id: "img001" },
  ],
};

describe("buildForwardPayload", () => {
  it("keeps the subject, sets reply-to to the sender, and prepends a header block", () => {
    const payload = buildForwardPayload(EMAIL, []);
    expect(payload.from).toBe(INBOUND_RELAY_FROM);
    expect(payload.to).toEqual([INBOUND_FORWARD_TO]);
    expect(payload.subject).toBe("Re: Butler <gap> analysis");
    expect(payload.reply_to).toEqual(["pat@example.com"]);
    const html = String(payload.html);
    expect(html.startsWith("<html><body><div")).toBe(true);
    expect(html).toContain("Pat Doe &lt;pat@example.com&gt;");
    expect(html).toContain("marshall@alpcontractorcircle.com");
    expect(html).toContain("welcome@alpcontractorcircle.com");
    expect(html).toContain("Sun, 27 Sep 2026 21:18:06 -0400");
    expect(html).toContain("<p>Hi Marshall</p>");
    expect(String(payload.text)).toContain("Original From: Pat Doe <pat@example.com>");
    expect(String(payload.text)).toContain("Hi Marshall");
    expect((payload.headers as Record<string, string>)[INBOUND_RELAY_HEADER]).toBe("1");
  });

  it("prefers the sender's own Reply-To and wraps text-only mail", () => {
    const payload = buildForwardPayload(
      { ...EMAIL, html: null, reply_to: ["office@example.com"], subject: "" },
      [],
    );
    expect(payload.reply_to).toEqual(["office@example.com"]);
    expect(payload.subject).toBe("(no subject)");
    expect(String(payload.html)).toContain("<pre");
  });
});

describe("forwardReceivedEmail", () => {
  function fakeResend(sendStatus = 200, sendBody: unknown = { id: "sent_1" }) {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: any }> = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        url: String(url),
        method,
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (method === "GET" && String(url).endsWith("/attachments")) {
        return new Response(
          JSON.stringify({
            object: "list",
            has_more: false,
            data: [
              { ...EMAIL.attachments![0], download_url: "https://inbound-cdn.resend.com/a1" },
              { ...EMAIL.attachments![1], download_url: "https://inbound-cdn.resend.com/a2" },
            ],
          }),
          { status: 200 },
        );
      }
      if (method === "GET") return new Response(JSON.stringify(EMAIL), { status: 200 });
      return new Response(JSON.stringify(sendBody), { status: sendStatus });
    }) as unknown as typeof fetch;
    return { calls, fetchFn };
  }

  it("fetches the message + attachments and sends one idempotent forward", async () => {
    const { calls, fetchFn } = fakeResend();
    const result = await forwardReceivedEmail("em_1", { apiKey: "re_test", fetch: fetchFn });
    expect(result).toEqual({ status: "forwarded", resendId: "sent_1", attachments: 2, droppedAttachments: 0 });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET https://api.resend.com/emails/receiving/em_1?html_format=cid",
      "GET https://api.resend.com/emails/receiving/em_1/attachments",
      "POST https://api.resend.com/emails",
    ]);
    const send = calls[2]!;
    expect(send.headers["Idempotency-Key"]).toBe("alp-inbound-forward/em_1");
    expect(send.body.attachments).toEqual([
      { filename: "plan.pdf", path: "https://inbound-cdn.resend.com/a1", content_type: "application/pdf" },
      {
        filename: "logo.png",
        path: "https://inbound-cdn.resend.com/a2",
        content_type: "image/png",
        content_id: "img001",
      },
    ]);
  });

  it("treats a reused idempotency key as already forwarded", async () => {
    const { fetchFn } = fakeResend(409, { name: "invalid_idempotent_request", message: "used" });
    const result = await forwardReceivedEmail("em_1", { apiKey: "re_test", fetch: fetchFn });
    expect(result).toEqual({ status: "duplicate" });
  });

  it("throws a retryable error on provider 5xx", async () => {
    const { fetchFn } = fakeResend(503, { name: "internal_server_error" });
    await expect(forwardReceivedEmail("em_1", { apiKey: "re_test", fetch: fetchFn })).rejects.toMatchObject({
      name: "InboundForwardError",
      retryable: true,
    });
  });

  it("skips mail that the relay itself sent", async () => {
    const looped = { ...EMAIL, headers: { ...EMAIL.headers, [INBOUND_RELAY_HEADER]: "1" } };
    const fetchFn = (async () => new Response(JSON.stringify(looped), { status: 200 })) as unknown as typeof fetch;
    const result = await forwardReceivedEmail("em_1", { apiKey: "re_test", fetch: fetchFn });
    expect(result).toEqual({ status: "skipped", reason: "relay_loop" });
  });
});
