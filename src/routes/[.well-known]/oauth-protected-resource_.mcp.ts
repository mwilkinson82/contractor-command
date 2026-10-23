// Path-suffixed protected resource metadata (RFC 9728 section 3.1): clients
// such as ChatGPT fetch /.well-known/oauth-protected-resource/mcp for the
// resource at /mcp. Same handler and options as the root metadata route, so
// the body is identical and the resource is derived from the request host.

import { createFileRoute } from "@tanstack/react-router";

import { createTanStackOAuthProtectedResourceMetadataHandler } from "@lovable.dev/mcp-js/stacks/tanstack";

import mcp from "../../lib/mcp/index";

export const Route = createFileRoute("/.well-known/oauth-protected-resource_/mcp")({
  server: {
    handlers: {
      ANY: createTanStackOAuthProtectedResourceMetadataHandler(mcp, {
        resourcePath: "/mcp",
        metadataPath: "/.well-known/oauth-protected-resource",
        trustForwardedHost: true,
        forwardedHostTrustedByPlatform: true,
        trustForwardedProto: true,
      }),
    },
  },
});
