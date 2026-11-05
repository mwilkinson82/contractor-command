import { createFileRoute } from "@tanstack/react-router";
import { liveReturnDeps } from "../lib/submittal-replies/deps.server";
import { handleSubmittalReturn } from "../lib/submittal-replies/page";

// Public, unauthenticated: the architect or engineer's return page for one submittal package
// (https://app.meetathena.io/r/submittal-return/<code>), sent with the package email. Hash-only lookup; it
// expires, stops when the package is turned off or revised, and records one decision.
export const Route = createFileRoute("/r/submittal-return/$code")({
  server: {
    handlers: {
      GET: async ({ params, request }) =>
        handleSubmittalReturn(request, params.code, liveReturnDeps),
      HEAD: async ({ params, request }) =>
        handleSubmittalReturn(request, params.code, liveReturnDeps),
      POST: async ({ params, request }) =>
        handleSubmittalReturn(request, params.code, liveReturnDeps),
    },
  },
});
