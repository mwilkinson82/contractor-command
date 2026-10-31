import { createFileRoute } from "@tanstack/react-router";
import { handleFileUpload } from "../lib/file-upload-route.server";

export const Route = createFileRoute("/r/file-upload/$token")({
  server: {
    handlers: {
      OPTIONS: async ({ params, request }) => handleFileUpload(request, params.token),
      GET: async ({ params, request }) => handleFileUpload(request, params.token),
      HEAD: async ({ params, request }) => handleFileUpload(request, params.token),
      PUT: async ({ params, request }) => handleFileUpload(request, params.token),
      POST: async ({ params, request }) => handleFileUpload(request, params.token),
    },
  },
});
