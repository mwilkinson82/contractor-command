import { describe, expect, it, vi } from "vitest";
import { handleResendInboundPost } from "@/lib/resend/inbound-http";
import { computeWebhookSignature } from "@/lib/resend/webhook-signature";
import { SupportDeliveryError } from "@/lib/support/resend-send";

const SECRET = `whsec_${btoa("test-secret-key-for-vitest-only!")}`;

async function signedRequest(body: unknown, secret = SECRET, tamper = false) {
  const payload = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await computeWebhookSignature(secret, "msg_1", timestamp, payload);
  return new Request("https://app.alpcontractorcircle.com/api/public/resend/inbound", {
    method: "POST",
    headers: {
      "svix-id": "msg_1",
      "svix-timestamp": timestamp,
      "svix-signature": tamper ? "v1,not-the-signature" : `v1,${signature}`,
    },
    body: payload,
  });
}

function deps() {
  const forward = vi.fn(async () => ({
    status: "forwarded" as const,
    resendId: "fwd_1",
    attachments: 0,
    droppedAttachments: 0,
  }));
  const processSupport = vi.fn(async () => ({
    status: "processed" as const,
    ticketNumber: "ATH-0001",
    preview: true,
    autoreply: "sent" as const,
    notify: "sent" as const,
  }));
  return { forward, processSupport };
}

describe("handleResendInboundPost", () => {
  it("rejects unsigned and invalid webhook signatures", async () => {
    const { forward, processSupport } = deps();
    const unsigned = await handleResendInboundPost(
      new Request("https://app.alpcontractorcircle.com/api/public/resend/inbound", {
        method: "POST",
        body: JSON.stringify({ type: "email.received", data: { email_id: "em_1" } }),
      }),
      {
        env: { RESEND_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: "re_test" },
        forward,
        processSupport,
      },
    );
    expect(unsigned.status).toBe(401);
    expect(forward).not.toHaveBeenCalled();
    expect(processSupport).not.toHaveBeenCalled();

    const { forward: forward2, processSupport: process2 } = deps();
    const invalid = await handleResendInboundPost(
      await signedRequest(
        { type: "email.received", data: { email_id: "em_1", to: ["support@meetathena.io"] } },
        SECRET,
        true,
      ),
      {
        env: { RESEND_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: "re_test" },
        forward: forward2,
        processSupport: process2,
      },
    );
    expect(invalid.status).toBe(401);
    expect(forward2).not.toHaveBeenCalled();
    expect(process2).not.toHaveBeenCalled();

    const missingSecret = await handleResendInboundPost(
      await signedRequest({ type: "email.sent" }),
      {
        env: { RESEND_API_KEY: "re_test" },
        fetchImpl: vi.fn(async () => new Response(null, { status: 503 })),
        forward,
        processSupport,
      },
    );
    expect(missingSecret.status).toBe(500);
    expect(await missingSecret.json()).toEqual({
      ok: false,
      error: "Webhook not configured",
      reason: "resend_http_503",
    });
  });

  it("fetches and caches the signing secret, refreshes it once, and rejects tampering", async () => {
    const handlers = deps();
    const rotatedSecret = `whsec_${btoa("rotated-test-secret-for-vitest!")}`;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ signing_secret: SECRET }))
      .mockResolvedValueOnce(Response.json({ secret: rotatedSecret }))
      .mockResolvedValueOnce(Response.json({ signing_secret: rotatedSecret }));
    const overrides = { env: { RESEND_API_KEY: "re_test" }, fetchImpl, ...handlers };
    const body = { type: "email.received", data: { email_id: "em_fetched" } };
    const valid = await handleResendInboundPost(await signedRequest(body), overrides);
    expect(valid.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
      "https://api.resend.com/webhooks/035b0a5b-a721-48c3-92d6-1bc0304e2c6f",
      { method: "GET", headers: { Authorization: "Bearer re_test" } },
    );
    const cached = await handleResendInboundPost(await signedRequest(body), overrides);
    expect(cached.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const rotated = await handleResendInboundPost(
      await signedRequest(body, rotatedSecret),
      overrides,
    );
    expect(rotated.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const tampered = await handleResendInboundPost(
      await signedRequest(body, rotatedSecret, true),
      overrides,
    );
    expect(tampered.status).toBe(401);
    expect(await tampered.json()).toEqual({ ok: false, error: "Invalid webhook signature" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(handlers.forward).toHaveBeenCalledTimes(3);
    expect(handlers.processSupport).not.toHaveBeenCalled();
  });

  it("opens a support ticket for support inboxes and forwards everything else", async () => {
    const support = deps();
    const supportResponse = await handleResendInboundPost(
      await signedRequest({
        type: "email.received",
        data: { email_id: "em_1", to: ["support@meetathena.io"] },
      }),
      { env: { RESEND_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: "re_test" }, ...support },
    );
    expect(supportResponse.status).toBe(200);
    expect(await supportResponse.json()).toMatchObject({
      ok: true,
      ticketNumber: "ATH-0001",
      preview: true,
    });
    expect(support.processSupport).toHaveBeenCalledOnce();
    expect(support.forward).not.toHaveBeenCalled();

    const other = deps();
    const otherResponse = await handleResendInboundPost(
      await signedRequest({
        type: "email.received",
        data: { email_id: "em_2", to: ["hello@alpcontractorcircle.com"] },
      }),
      { env: { RESEND_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: "re_test" }, ...other },
    );
    expect(otherResponse.status).toBe(200);
    expect(other.forward).toHaveBeenCalledWith("em_2", { apiKey: "re_test" });
    expect(other.processSupport).not.toHaveBeenCalled();
  });

  it("asks Resend to retry when opening a ticket fails", async () => {
    const failing = deps();
    failing.processSupport.mockRejectedValue(new SupportDeliveryError("db down", true));
    const response = await handleResendInboundPost(
      await signedRequest({
        type: "email.received",
        data: { email_id: "em_3", to: ["support@alpcontractorcircle.com"] },
      }),
      { env: { RESEND_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: "re_test" }, ...failing },
    );
    expect(response.status).toBe(500);
    expect(failing.forward).not.toHaveBeenCalled();
  });
});

it("carries mixed-brand webhook routing into review even if received metadata loses a recipient", async () => {
  const mocks = deps();
  const result = await handleResendInboundPost(
    await signedRequest({
      type: "email.received",
      data: {
        email_id: "mixed",
        to: ["support@meetathena.io"],
        bcc: ["support@alpcontractorcircle.com"],
      },
    }),
    { env: { RESEND_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: "re_test" }, ...mocks },
  );
  expect(result.status).toBe(200);
  expect(mocks.processSupport).toHaveBeenCalledWith(
    "mixed",
    expect.objectContaining({ hintReview: "mixed_brand" }),
  );
  expect(mocks.forward).not.toHaveBeenCalled();
});

describe("support cutover hold", () => {
  const env = {
    RESEND_WEBHOOK_SECRET: SECRET,
    RESEND_API_KEY: "re_test",
    SUPPORT_INTAKE_HOLD: "true",
  };
  it.each([
    { to: ["support@meetathena.io"] },
    { cc: ["support@alpcontractorcircle.com"] },
    { bcc: ["support@meetathena.io"] },
    { received_for: ["support@meetathena.io"] },
    { to: ["support@meetathena.io", "support@alpcontractorcircle.com"] },
  ])(
    "holds verified support routing before any processor or forwarder runs: %j",
    async (recipients) => {
      const handlers = deps();
      for (let retry = 0; retry < 2; retry++) {
        const response = await handleResendInboundPost(
          await signedRequest({
            type: "email.received",
            data: { email_id: "held", ...recipients },
          }),
          { env, ...handlers },
        );
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
          ok: false,
          error: "Support intake temporarily held; retry",
        });
      }
      expect(handlers.processSupport).not.toHaveBeenCalled();
      expect(handlers.forward).not.toHaveBeenCalled();
      const resumed = await handleResendInboundPost(
        await signedRequest({ type: "email.received", data: { email_id: "held", ...recipients } }),
        { env: { ...env, SUPPORT_INTAKE_HOLD: "false" }, ...handlers },
      );
      expect(resumed.status).toBe(200);
      expect(handlers.processSupport).toHaveBeenCalledTimes(1);
    },
  );
  it.each([undefined, "false", "1", "TRUE", ""])(
    "preserves behavior unless explicitly true (%s)",
    async (value) => {
      const handlers = deps();
      const response = await handleResendInboundPost(
        await signedRequest({
          type: "email.received",
          data: { email_id: "normal", to: ["support@meetathena.io"] },
        }),
        { env: { ...env, SUPPORT_INTAKE_HOLD: value }, ...handlers },
      );
      expect(response.status).toBe(200);
      expect(handlers.processSupport).toHaveBeenCalledTimes(1);
    },
  );
  it("retains signature verification during hold", async () => {
    const handlers = deps();
    const body = {
      type: "email.received",
      data: { email_id: "held", to: ["support@meetathena.io"] },
    };
    for (const request of [
      await signedRequest(body, SECRET, true),
      new Request("https://example.com", { method: "POST", body: JSON.stringify(body) }),
    ]) {
      expect((await handleResendInboundPost(request, { env, ...handlers })).status).toBe(401);
    }
    expect(handlers.processSupport).not.toHaveBeenCalled();
    expect(handlers.forward).not.toHaveBeenCalled();
  });
  it("leaves non-support mail, unrelated event types and malformed-event validation unchanged", async () => {
    const handlers = deps();
    expect(
      (
        await handleResendInboundPost(
          await signedRequest({
            type: "email.received",
            data: { email_id: "other", to: ["office@example.com"] },
          }),
          { env, ...handlers },
        )
      ).status,
    ).toBe(200);
    expect(handlers.forward).toHaveBeenCalledTimes(1);
    expect(
      (
        await handleResendInboundPost(
          await signedRequest({ type: "email.sent", data: { to: ["support@meetathena.io"] } }),
          { env, ...handlers },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handleResendInboundPost(
          await signedRequest({ type: "email.received", data: { to: ["support@meetathena.io"] } }),
          { env, ...handlers },
        )
      ).status,
    ).toBe(400);
    expect(handlers.forward).toHaveBeenCalledTimes(1);
    expect(handlers.processSupport).not.toHaveBeenCalled();
  });
});
