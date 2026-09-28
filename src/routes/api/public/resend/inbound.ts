import { createFileRoute } from "@tanstack/react-router";
import {
  forwardReceivedEmail,
  InboundForwardError,
} from "@/lib/resend/inbound-forward";
import {
  hasWebhookSignatureHeaders,
  verifyResendWebhook,
} from "@/lib/resend/webhook-signature";

// Resend Receiving webhook (`email.received`) for alpcontractorcircle.com.
// Verifies the Svix signature with RESEND_WEBHOOK_SECRET, then forwards the
// full message (html/text/attachments) to Marshall via the Resend send API
// using RESEND_API_KEY. See src/lib/resend/inbound-forward.ts.

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type ReceivedEvent = {
  type?: unknown;
  data?: { email_id?: unknown } | null;
};

export const Route = createFileRoute("/api/public/resend/inbound")({
  server: {
    handlers: {
      GET: async () => {
        return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
      },
      POST: async ({ request }) => {
        const payload = await request.text();
        const headers = {
          id: request.headers.get("svix-id"),
          timestamp: request.headers.get("svix-timestamp"),
          signature: request.headers.get("svix-signature"),
        };

        if (!hasWebhookSignatureHeaders(headers)) {
          return json({ ok: false, error: "Missing webhook signature" }, 401);
        }

        const secret = process.env.RESEND_WEBHOOK_SECRET;
        if (!secret) {
          // 500 so Resend keeps retrying; deliveries succeed once the secret is set.
          console.error("[resend-inbound] RESEND_WEBHOOK_SECRET is not configured");
          return json({ ok: false, error: "Webhook not configured" }, 500);
        }

        const verified = await verifyResendWebhook({ payload, headers, secret });
        if (!verified.ok) {
          console.warn("[resend-inbound] rejected webhook", {
            reason: verified.reason,
            svixId: headers.id,
          });
          return json({ ok: false, error: "Invalid webhook signature" }, 401);
        }

        let event: ReceivedEvent;
        try {
          event = JSON.parse(payload) as ReceivedEvent;
        } catch {
          return json({ ok: false, error: "Invalid JSON" }, 400);
        }

        if (event.type !== "email.received") {
          return json({ ok: true, ignored: true, type: event.type ?? null }, 200);
        }

        const emailId = event.data?.email_id;
        if (typeof emailId !== "string" || !emailId) {
          return json({ ok: false, error: "Missing data.email_id" }, 400);
        }

        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) {
          console.error("[resend-inbound] RESEND_API_KEY is not configured", { emailId });
          return json({ ok: false, error: "Forwarder not configured" }, 500);
        }

        try {
          const result = await forwardReceivedEmail(emailId, { apiKey });
          console.log("[resend-inbound] processed", { emailId, svixId: headers.id, ...result });
          return json({ ok: true, emailId, ...result }, 200);
        } catch (err) {
          const retryable = err instanceof InboundForwardError ? err.retryable : true;
          const message = err instanceof Error ? err.message : String(err);
          console.error("[resend-inbound] forward failed", {
            emailId,
            svixId: headers.id,
            retryable,
            error: message.slice(0, 1000),
          });
          if (retryable) {
            return json({ ok: false, error: "Forward failed; retry" }, 500);
          }
          // Permanent failure: acknowledge so Resend stops retrying. The
          // original stays in Resend > Emails > Receiving.
          return json({ ok: false, emailId, error: "Forward failed permanently" }, 200);
        }
      },
    },
  },
});
