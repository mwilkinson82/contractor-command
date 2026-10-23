import { createFileRoute } from "@tanstack/react-router";

import { athenaIcon64Response } from "../lib/mcp/athena-icon-64";

// Public, unauthenticated: the Athena connector icon listed in serverInfo.icons.
export const Route = createFileRoute("/brand/athena/athena-icon-64.png")({
  server: {
    handlers: {
      GET: async () => athenaIcon64Response(),
      HEAD: async () => {
        const res = athenaIcon64Response();
        return new Response(null, { status: 200, headers: res.headers });
      },
    },
  },
});
