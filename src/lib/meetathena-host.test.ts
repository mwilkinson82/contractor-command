import { describe, expect, it } from "vitest";
import {
  createTanStackMcpHandler,
  createTanStackOAuthProtectedResourceMetadataHandler,
} from "@lovable.dev/mcp-js/stacks/tanstack";
import mcp from "./mcp/index";
import { isTrustedHost, TRUSTED_HOSTS } from "./trusted-hosts";

// Same options as the generated routes in src/routes.
const meta = createTanStackOAuthProtectedResourceMetadataHandler(mcp, {
  resourcePath: "/mcp",
  metadataPath: "/.well-known/oauth-protected-resource",
  trustForwardedHost: true,
  forwardedHostTrustedByPlatform: true,
  trustForwardedProto: true,
});
const mcpHandler = createTanStackMcpHandler(mcp, {
  resourcePath: "/mcp",
  metadataPath: "/.well-known/oauth-protected-resource",
  trustForwardedHost: true,
  trustForwardedProto: true,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (h: any, request: Request) => Promise.resolve(h({ request }) as Response);

const HOSTS = ["meetathena.io", "www.meetathena.io", "app.alpcontractorcircle.com"];

describe("meetathena.io host", () => {
  it("is trusted by the CSRF guard; old hosts stay trusted; lookalikes are not", () => {
    for (const h of ["meetathena.io", "www.meetathena.io", "MeetAthena.io", "app.alpcontractorcircle.com", "contractor-command.lovable.app"]) {
      expect(isTrustedHost(h)).toBe(true);
    }
    for (const h of ["evilmeetathena.io", "meetathena.io.evil.com", "meetathena.com", "x.meetathena.io"]) {
      expect(isTrustedHost(h)).toBe(false);
    }
    expect(TRUSTED_HOSTS.has("meetathena.io")).toBe(true);
  });

  it("metadata on meetathena.io reports resource https://meetathena.io/mcp (direct and forwarded host)", async () => {
    for (const req of [
      new Request("https://meetathena.io/.well-known/oauth-protected-resource"),
      new Request("http://internal:8080/.well-known/oauth-protected-resource", {
        headers: { "x-forwarded-host": "meetathena.io", "x-forwarded-proto": "https" },
      }),
    ]) {
      const res = await call(meta, req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.resource).toBe("https://meetathena.io/mcp");
      expect(body.authorization_servers).toEqual(["https://qcbbjjjxcacrscfhgfmf.supabase.co/auth/v1"]);
    }
  });

  it("each host gets its own resource, so old-host connectors keep working", async () => {
    for (const host of HOSTS) {
      const res = await call(meta, new Request(`https://${host}/.well-known/oauth-protected-resource`));
      expect((await res.json()).resource).toBe(`https://${host}/mcp`);
    }
  });

  it("no host is redirected: metadata and unauthenticated /mcp answer in place on every host", async () => {
    for (const host of HOSTS) {
      const m = await call(meta, new Request(`https://${host}/.well-known/oauth-protected-resource`));
      expect(m.status).toBeLessThan(300);
      expect(m.headers.get("location")).toBeNull();

      const r = await call(
        mcpHandler,
        new Request(`https://${host}/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
        }),
      );
      expect(r.status).toBe(401);
      expect(r.headers.get("location")).toBeNull();
      expect(r.headers.get("www-authenticate") ?? "").toContain(
        `https://${host}/.well-known/oauth-protected-resource`,
      );
    }
  });
});
