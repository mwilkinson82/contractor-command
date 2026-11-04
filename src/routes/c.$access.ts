import { createFileRoute } from "@tanstack/react-router";
import { liveDeps } from "../lib/customer-portal/deps.server";
import { handlePortal } from "../lib/customer-portal/server";

// The customer's project page (https://app.meetathena.io/c/<access id>). Shows only what the contractor shared,
// to a signed-in customer session; the access id alone opens nothing.
export const Route = createFileRoute("/c/$access")({
  server: {
    handlers: {
      GET: async ({ params, request }) => handlePortal(request, params.access, liveDeps),
      POST: async ({ params, request }) => handlePortal(request, params.access, liveDeps),
    },
  },
});
