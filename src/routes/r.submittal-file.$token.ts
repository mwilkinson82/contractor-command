import { createFileRoute } from "@tanstack/react-router";
import { openSubmittalFile } from "../lib/submittal-file-route.server";
// Same approved capability and expiry as /f; /r links work with existing host widgets.
export const Route = createFileRoute("/r/submittal-file/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => openSubmittalFile(params.token, "GET"),
      HEAD: async ({ params }) => openSubmittalFile(params.token, "HEAD"),
    },
  },
});
