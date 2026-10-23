// This host is not an authorization server. Answer with a plain JSON 404
// instead of the HTML app shell so OAuth clients follow the protected
// resource metadata to the real authorization server.

import { createFileRoute } from "@tanstack/react-router";

const notFound = () =>
  new Response(JSON.stringify({ error: "not_found" }), {
    status: 404,
    headers: { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" },
  });

export const Route = createFileRoute("/.well-known/openid-configuration")({
  server: {
    handlers: {
      ANY: notFound,
    },
  },
});
