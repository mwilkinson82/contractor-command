import { createFileRoute } from "@tanstack/react-router";
import { handlePaymentProofUpload } from "../../lib/payment-proof-route.server";

export const Route = createFileRoute("/api/payment-proof")({
  server: { handlers: { POST: async ({ request }) => handlePaymentProofUpload(request) } },
});
