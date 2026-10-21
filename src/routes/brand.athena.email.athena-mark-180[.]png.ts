import { createFileRoute } from "@tanstack/react-router";

import { athenaEmailMarkResponse } from "../lib/email/athena-email-mark";

// Public, unauthenticated: the Athena mark shown in Athena auth emails.
export const Route = createFileRoute("/brand/athena/email/athena-mark-180.png")({
  server: {
    handlers: {
      GET: async () => athenaEmailMarkResponse(),
      HEAD: async () => {
        const res = athenaEmailMarkResponse();
        return new Response(null, { status: 200, headers: res.headers });
      },
    },
  },
});
