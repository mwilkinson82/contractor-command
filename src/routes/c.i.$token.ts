import { createFileRoute } from "@tanstack/react-router";
import { liveDeps } from "../lib/customer-portal/deps.server";
import { handleInvite } from "../lib/customer-portal/server";

// Public: a customer's invite link to their project page (https://app.meetathena.io/c/i/<token>).
// The link alone shows nothing private; signing in needs a code emailed to the invited address.
export const Route = createFileRoute("/c/i/$token")({
  server: {
    handlers: {
      GET: async ({ params, request }) => handleInvite(request, params.token, liveDeps),
      POST: async ({ params, request }) => handleInvite(request, params.token, liveDeps),
    },
  },
});
