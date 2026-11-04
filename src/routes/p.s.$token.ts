import { createFileRoute } from "@tanstack/react-router";

import { openProposalShare } from "../lib/selection-proposal-share.server";

// Public, unauthenticated: a customer's Good, Better, Best proposal link
// (https://app.meetathena.io/p/s/<token>). Exists only when a contractor made one.
// Hash-only lookup of a frozen customer view; it expires and can be turned off.
export const Route = createFileRoute("/p/s/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => openProposalShare(params.token, "GET"),
      HEAD: async ({ params }) => openProposalShare(params.token, "HEAD"),
    },
  },
});
