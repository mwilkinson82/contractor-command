import { createFileRoute } from "@tanstack/react-router";
import { handleDrawingUpload } from "../lib/drawing-upload-route.server";

export const Route = createFileRoute("/r/drawing-upload/$token")({
  server: {
    handlers: {
      OPTIONS: async ({ params, request }) => handleDrawingUpload(request, params.token),
      PUT: async ({ params, request }) => handleDrawingUpload(request, params.token),
    },
  },
});
