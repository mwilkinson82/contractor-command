import { createFileRoute } from "@tanstack/react-router";
import { openShare, fileResolver } from "../lib/file-share-route.server";
// Private review capability, expires after ten minutes; it never approves or records a send.
const preview = fileResolver("mcp_submittal_preview_open");
export const Route = createFileRoute("/r/submittal-preview/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => openShare(params.token, "GET", preview),
      HEAD: async ({ params }) => openShare(params.token, "HEAD", preview),
    },
  },
});
