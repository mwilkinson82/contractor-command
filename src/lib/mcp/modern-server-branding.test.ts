import { describe, expect, it } from "vitest";
import { defineMcp, defineTool } from "@lovable.dev/mcp-js";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import {
  ATHENA_SERVER_ICONS,
  ATHENA_WEBSITE_URL,
  brandJsonRpcPayload,
  brandInitializeResponse,
  serverInfoRequestIds,
} from "./server-info-branding";

const key = "io.modelcontextprotocol/serverInfo";
const handler = createTanStackMcpHandler(
  defineMcp({
    name: "athena",
    title: "Athena",
    version: "test",
    instructions: "",
    metrics: false,
    tools: [
      defineTool({
        name: "ping",
        title: "Read-only branding probe",
        description: "Read-only probe.",
        handler: async () => ({ content: [{ type: "text", text: "pong" }] }),
      }),
    ],
  }),
  { resourcePath: "/mcp" },
);

describe("modern server branding through the real SDK", () => {
  it.each(["server/discover", "tools/list", "tools/call"])(
    "keeps Athena identity on %s",
    async (method) => {
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method,
        params: {
          ...(method === "tools/call" ? { name: "ping", arguments: {} } : {}),
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": { name: "test-host", version: "test" },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      });
      const request = new Request("https://app.meetathena.io/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2026-07-28",
          "Mcp-Method": method,
          ...(method === "tools/call" ? { "Mcp-Name": "ping" } : {}),
        },
        body,
      });
      const raw = await handler({ request });
      expect(raw.status).toBe(200);
      const out = await brandInitializeResponse(raw, serverInfoRequestIds(body));
      const wire = await out.text();
      const json = JSON.parse(
        wire.startsWith("{")
          ? wire
          : wire
              .split("\n")
              .find((l) => l.startsWith("data:"))!
              .slice(5),
      );
      expect(json.error).toBeUndefined();
      expect(json.result._meta[key]).toMatchObject({
        name: "athena",
        icons: ATHENA_SERVER_ICONS,
        websiteUrl: ATHENA_WEBSITE_URL,
      });
      expect(json.result.resultType).toBe("complete");
      if (method === "tools/call")
        expect(json.result.content).toEqual([{ type: "text", text: "pong" }]);
    },
  );

  it("preserves custom branding, cache metadata and every non-identity field", () => {
    const icons = [{ src: "https://example.com/approved.png" }];
    const payload = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        resultType: "complete",
        ttlMs: 0,
        cacheScope: "private",
        tools: [{ name: "read" }],
        _meta: {
          other: { keep: true },
          [key]: {
            name: "athena",
            version: "test",
            icons,
            websiteUrl: "https://example.com",
            description: "Approved description",
          },
        },
      },
    };
    const out = brandJsonRpcPayload(payload, [1]);
    expect(out.value).toEqual(payload);
    expect(payload.result._meta[key].icons).toBe(icons);
  });

  it("does not brand mismatched ids, identity-free replies or JSON-RPC errors", () => {
    const identity = { jsonrpc: "2.0", id: 2, result: { _meta: { [key]: { name: "athena" } } } };
    expect(brandJsonRpcPayload(identity, [1])).toEqual({ value: identity, changed: false });
    const plain = { jsonrpc: "2.0", id: 1, result: { tools: [], _meta: { retained: true } } };
    expect(brandJsonRpcPayload(plain, [1])).toEqual({ value: plain, changed: false });
    const error = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000 },
      result: { _meta: { [key]: { name: "athena" } } },
    };
    expect(brandJsonRpcPayload(error, [1])).toEqual({ value: error, changed: false });
  });

  it("brands modern SSE identity without changing tool content or stream framing", async () => {
    const payload = {
      jsonrpc: "2.0",
      id: "sse",
      result: {
        content: [{ type: "text", text: "unchanged" }],
        _meta: { [key]: { name: "athena" } },
      },
    };
    const response = new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
      headers: { "content-type": "text/event-stream" },
    });
    const wire = await (await brandInitializeResponse(response, ["sse"])).text();
    const parsed = JSON.parse(
      wire
        .split("\n")
        .find((line) => line.startsWith("data:"))!
        .slice(5),
    );
    expect(parsed.result._meta[key].icons).toEqual(ATHENA_SERVER_ICONS);
    expect(parsed.result.content).toEqual(payload.result.content);
    expect(wire.startsWith("event: message\n")).toBe(true);
    expect(wire.endsWith("\n\n")).toBe(true);
  });

  it("tracks mixed request ids while ignoring notifications and invalid bodies", () => {
    expect(
      serverInfoRequestIds(
        JSON.stringify([
          { id: 1, method: "initialize" },
          { id: "modern", method: "server/discover" },
          { method: "notifications/initialized" },
          { id: 3, result: {} },
          null,
        ]),
      ),
    ).toEqual([1, "modern"]);
    expect(serverInfoRequestIds("not json")).toEqual([]);
    expect(serverInfoRequestIds("null")).toEqual([]);
  });
});
