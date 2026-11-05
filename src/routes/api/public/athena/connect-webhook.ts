// Stripe's events for client payments on contractors' connected accounts. Athena creates this endpoint on its
// Connect platform account when a contractor first connects; events are re-read from Stripe, so no signing secret.
import { createFileRoute } from "@tanstack/react-router";
import { handleConnectWebhook } from "@/lib/client-payments/webhook";

export const Route = createFileRoute("/api/public/athena/connect-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { webhookDeps } = await import("@/lib/client-payments/deps.server");
        const body = await request.text();
        if (body.length > 512_000) return new Response("Too large", { status: 413 });
        const r = await handleConnectWebhook(body, webhookDeps());
        return new Response(r.body, { status: r.status, headers: { "cache-control": "no-store" } });
      },
    },
  },
});
