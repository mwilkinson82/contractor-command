import { createFileRoute } from "@tanstack/react-router";
import { syntheticCardReviewResponse } from "../lib/card-review-preview";

// Synthetic preview branch only; this route must never be merged into the release.
export const Route = createFileRoute("/card-review")({
  server: { handlers: { GET: () => syntheticCardReviewResponse() } },
});
