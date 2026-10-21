import { createFileRoute } from "@tanstack/react-router";

import { openReportShare } from "../lib/report-page-share.server";

// Public, unauthenticated: an owner share link to a living report page (https://app.meetathena.io/r/s/<token>).
// Off by default; exists only when an owner made one. Hash-only lookup, expires, can be turned off.
export const Route = createFileRoute("/r/s/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => openReportShare(params.token, "GET"),
      HEAD: async ({ params }) => openReportShare(params.token, "HEAD"),
    },
  },
});
