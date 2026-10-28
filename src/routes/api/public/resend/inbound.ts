import { createFileRoute } from "@tanstack/react-router";
import { handleResendInboundPost } from "@/lib/resend/inbound-http";
import { sendSupportTicketReply } from "@/lib/support/manual-reply.functions";

// Referenced so the admin reply server function stays in the server bundle.
void sendSupportTicketReply;

// Resend Receiving webhook (`email.received`) for the disabled endpoint at
// /api/public/resend/inbound. Verifies the Svix signature with
// RESEND_WEBHOOK_SECRET. Mail for support@meetathena.io and
// support@alpcontractorcircle.com opens a ticket and sends the branded
// auto-reply. Every other recipient is still forwarded to Marshall.

export const Route = createFileRoute("/api/public/resend/inbound")({
  server: {
    handlers: {
      GET: async () => {
        return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
      },
      POST: async ({ request }) => handleResendInboundPost(request),
    },
  },
});
