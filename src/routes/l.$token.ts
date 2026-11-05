import { createFileRoute } from "@tanstack/react-router";
import { liveConfirmDeps } from "../lib/lookahead-confirm/deps.server";
import { handleConfirmPage } from "../lib/lookahead-confirm/server";

// Public: a supplier's or sub's look-ahead date confirmation link (https://app.meetathena.io/l/<token>). Exists only
// when the team sent one. Hash-only lookup; it expires and can be cancelled. Shows the job's name and the date asked,
// never cost.
export const Route = createFileRoute("/l/$token")({
  server: {
    handlers: {
      GET: async ({ params, request }) => handleConfirmPage(request, params.token, liveConfirmDeps),
      POST: async ({ params, request }) => handleConfirmPage(request, params.token, liveConfirmDeps),
    },
  },
});
