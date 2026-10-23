import { createFileRoute } from "@tanstack/react-router";
import { openShare } from "../lib/file-share-route.server";
// Same approved capability and expiry as /f; /r links work with existing host widgets.
export const Route = createFileRoute("/r/submittal-file/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => openShare(params.token, "GET"),
      HEAD: async ({ params }) => openShare(params.token, "HEAD"),
    },
  },
});
