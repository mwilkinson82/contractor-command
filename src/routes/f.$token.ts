import { createFileRoute } from "@tanstack/react-router";

import { openShare } from "../lib/file-share-route.server";

// Public, unauthenticated: an Athena file link (https://app.meetathena.io/f/<token>). The token is checked
// in the database (hash only, expiry, turned off); the file is streamed as a download.
export const Route = createFileRoute("/f/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => openShare(params.token, "GET"),
      HEAD: async ({ params }) => openShare(params.token, "HEAD"),
    },
  },
});
