import { afterEach, describe, expect, it, vi } from "vitest";
import { defineMcp } from "@lovable.dev/mcp-js";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import { McpServer } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import "./widget-bridge";
import { nativeCardResponse, nativeCardVisit } from "./native-card-transport";
import {
  LEGACY_NATIVE_CARD_URI,
  NATIVE_CARD_MIME,
  NATIVE_CARD_URI,
  nativeCardHtml,
} from "./cards/native";
import { CARD_WIDGET_URI } from "./cards/widget";

afterEach(() => vi.restoreAllMocks());

const missing = { jsonrpc: "2.0", id: 2, error: { code: -32601, message: "Method not found" } };
function request(
  uri = NATIVE_CARD_URI,
  accept = "application/json, text/event-stream",
  modern = false,
) {
  return new Request("https://app.meetathena.io/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept,
      "MCP-Protocol-Version": modern ? "2026-07-28" : "2025-11-25",
      "Mcp-Method": "resources/read",
      "Mcp-Name": uri,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "resources/read",
      params: {
        uri,
        ...(modern
          ? {
              _meta: {
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientInfo": { name: "ClaudeAI", version: "test" },
                "io.modelcontextprotocol/clientCapabilities": {
                  extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [NATIVE_CARD_MIME] } },
                },
              },
            }
          : {}),
      },
    }),
  });
}

describe("first native card resource read", () => {
  it("loads the first resource through a real MCP HTTP client without a prior tool call", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const mcp = defineMcp({
      name: "local-card-test",
      title: "Local card test",
      version: "test",
      instructions: "Fictional test",
      tools: [],
      metrics: false,
    });
    const handler = createTanStackMcpHandler(mcp, { resourcePath: "/mcp" });
    const client = new Client({ name: "ClaudeAI", version: "test" });
    const transport = new StreamableHTTPClientTransport(new URL("https://athena.example.com/mcp"), {
      fetch: async (input, init) => {
        // All requests remain in process; no credentials, database or network.
        const req = new Request(input, init);
        const visit = await nativeCardVisit(req);
        return nativeCardResponse(await handler({ request: req }), visit);
      },
    });
    try {
      await client.connect(transport);
      const shell = await client.readResource({ uri: NATIVE_CARD_URI });
      expect(shell.contents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ uri: NATIVE_CARD_URI, text: nativeCardHtml() }),
        ]),
      );
    } finally {
      await client.close();
    }
  });

  it.each([false, true])(
    "returns a finite JSON shell on the first actual SDK read (modern=%s)",
    async (modern) => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      // No preceding tools/list or tools/call registers a resource on this server.
      const mcp = defineMcp({
        name: "local-card-test",
        title: "Local card test",
        version: "test",
        instructions: "Fictional test",
        tools: [],
        metrics: false,
      });
      const handler = createTanStackMcpHandler(mcp, { resourcePath: "/mcp" });
      const req = request(NATIVE_CARD_URI, undefined, modern);
      const visit = await nativeCardVisit(req);
      const sdk = await handler({ request: req });
      const res = await nativeCardResponse(sdk, visit);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.has("connection")).toBe(false);
      expect(res.headers.has("x-accel-buffering")).toBe(false);
      const body = await res.json();
      expect(body).toMatchObject({
        jsonrpc: "2.0",
        id: 2,
        result: {
          contents: [{ uri: NATIVE_CARD_URI, mimeType: NATIVE_CARD_MIME, text: nativeCardHtml() }],
        },
      });
      expect(body.error).toBeUndefined();
      if (modern)
        expect(body.result).toMatchObject({
          resultType: "complete",
          ttlMs: 0,
          cacheScope: "private",
        });
    },
  );

  it("keeps cached old conversations readable while advertising a new resource identity", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(NATIVE_CARD_URI).not.toBe(LEGACY_NATIVE_CARD_URI);
    const req = request(LEGACY_NATIVE_CARD_URI);
    const res = await nativeCardResponse(
      Response.json(missing, { status: 404 }),
      await nativeCardVisit(req),
    );
    expect((await res.json()).result.contents[0]).toMatchObject({
      uri: LEGACY_NATIVE_CARD_URI,
      text: nativeCardHtml(),
    });
    const server = new McpServer({ name: "local-card-test", version: "test" });
    server.registerTool("contract_terms", { description: "Fictional read" }, async () => ({
      content: [],
    }));
    const resources = (server as unknown as { _registeredResources: Record<string, unknown> })
      ._registeredResources;
    expect(Object.keys(resources)).toEqual(
      expect.arrayContaining([NATIVE_CARD_URI, LEGACY_NATIVE_CARD_URI, CARD_WIDGET_URI]),
    );
  });

  it.each([
    "text/event-stream",
    "application/json;q=0, text/event-stream",
    "application/json;q=0, */*;q=1",
    "application/json;q=invalid, text/event-stream",
  ])("preserves a stream-only client: %s", async (accept) => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const req = request(NATIVE_CARD_URI, accept);
    const raw = `event: message\r\nid: fixture\r\ndata: ${JSON.stringify(missing)}\r\n\r\n`;
    const res = await nativeCardResponse(
      new Response(raw, { headers: { "content-type": "text/event-stream" } }),
      await nativeCardVisit(req),
    );
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await res.text()).toContain("event: message\r\nid: fixture\r\ndata: ");
  });

  it("does not discard additional messages from an SDK stream", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const req = request();
    const notice = {
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { level: "info", data: "fixture" },
    };
    const raw = `data: ${JSON.stringify(notice)}\n\ndata: ${JSON.stringify(missing)}\n\n`;
    const res = await nativeCardResponse(
      new Response(raw, { headers: { "content-type": "text/event-stream" } }),
      await nativeCardVisit(req),
    );
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await res.text()).toContain(JSON.stringify(notice));
  });

  it.each([401, 403, 429, 500])("preserves SDK rejection %s byte for byte", async (status) => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const req = request();
    const sdk = Response.json(missing, {
      status,
      headers: { "www-authenticate": "unchanged", "cache-control": "private" },
    });
    expect(await nativeCardResponse(sdk, await nativeCardVisit(req))).toBe(sdk);
    expect(log).toHaveBeenCalledWith("[athena] card.resource", {
      protocol: "legacy",
      sdkStatus: status,
      status,
      outcome: "sdk-rejected",
    });
  });

  it("records only static resource delivery facts, never credentials or job content", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const req = request();
    req.headers.set("authorization", "Bearer fictional-secret");
    await nativeCardResponse(Response.json(missing, { status: 404 }), await nativeCardVisit(req));
    expect(log).toHaveBeenCalledExactlyOnceWith("[athena] card.resource", {
      protocol: "legacy",
      sdkStatus: 404,
      status: 200,
      outcome: "served",
      format: "json",
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/fictional-secret|2701|<html|bearer/i);
  });

  it("records a bodyless SDK challenge while preserving the original response", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const req = request();
    const sdk = new Response(null, { status: 401, headers: { "www-authenticate": "unchanged" } });
    expect(await nativeCardResponse(sdk, await nativeCardVisit(req))).toBe(sdk);
    expect(log).toHaveBeenCalledWith("[athena] card.resource", {
      protocol: "legacy",
      sdkStatus: 401,
      status: 401,
      outcome: "sdk-rejected",
    });
  });

  it("keeps the ChatGPT resource completely outside this transport change", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const req = request(CARD_WIDGET_URI);
    expect(await nativeCardVisit(req)).toBeNull();
    const sdk = Response.json({
      jsonrpc: "2.0",
      id: 2,
      result: { contents: [{ uri: CARD_WIDGET_URI, text: "Existing ChatGPT view" }] },
    });
    expect(await nativeCardResponse(sdk, await nativeCardVisit(req))).toBe(sdk);
    expect(log).not.toHaveBeenCalled();
  });
});
