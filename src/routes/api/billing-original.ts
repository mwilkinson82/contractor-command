import { createFileRoute } from "@tanstack/react-router";
import { handleBillingOriginalDownload } from "../../lib/billing-original-route.server";

export const Route = createFileRoute("/api/billing-original")({
  server: { handlers: { GET: async ({ request }) => handleBillingOriginalDownload(request) } },
});
