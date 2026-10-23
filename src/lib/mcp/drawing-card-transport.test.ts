import { describe, expect, it } from "vitest";
import { defineMcp, defineTool } from "@lovable.dev/mcp-js";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import { z } from "zod";
import "./widget-bridge";
import {
  DRAWING_CARD_URI,
  LEGACY_DRAWING_CARD_URI,
  drawingCardResultMeta,
} from "./cards/drawing-card";
import { NATIVE_CARD_URI } from "./cards/native";
import { CARD_WIDGET_URI } from "./cards/widget";
import { nativeCardPayload, nativeCardResponse, nativeCardVisit } from "./native-card-transport";

const fixture = {
  content: [
    {
      type: "text" as const,
      text: "S-100 · 2 dated versions\n<!doctype html><html><body>Legacy fallback</body></html>",
    },
    { type: "image" as const, mimeType: "image/png", data: "iVBORw0KGgo=" },
  ],
  structuredContent: {
    saved: true,
    drawing_preview: { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
    original_unchanged: true,
    card: {
      title: "S-100 drawing markup",
      state: "result",
      sections: [{ heading: "Callout key", rows: [{ cells: ["QA pin", "Not a measurement"] }] }],
    },
  },
};
const caps = {
  extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } },
};
describe("drawing UI through the real MCP SDK", () => {
  it.each(["ChatGPT", "Claude"])(
    "keeps the complete data and links the same template on %s",
    async (host) => {
      const tool = defineTool({
        name: "drawing_markup",
        title: "Mark up a stored drawing",
        description: "Fictional test",
        inputSchema: { sheet: z.string() },
        handler: async () => fixture,
      });
      const mcp = defineMcp({
        name: "athena",
        title: "Athena",
        instructions: "Fictional test fixture",
        version: "test",
        tools: [tool],
        metrics: false,
      });
      const handler = createTanStackMcpHandler(mcp, { resourcePath: "/mcp" });
      let id = 0;
      const post = async (method: string, params: Record<string, unknown>) => {
        const request = new Request("https://athena.example.com/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: ++id,
            method,
            params: {
              ...params,
              _meta: {
                "io.modelcontextprotocol/clientInfo": { name: host, version: "test" },
                "io.modelcontextprotocol/clientCapabilities": caps,
              },
            },
          }),
        });
        const visit = await nativeCardVisit(request);
        const response = await nativeCardResponse(await handler({ request }), visit);
        const raw = await response.text();
        return JSON.parse(
          raw.trimStart().startsWith("{")
            ? raw
            : raw
                .split("\n")
                .find((line) => line.startsWith("data:"))!
                .slice(5),
        );
      };
      await post("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: caps,
        clientInfo: { name: host, version: "test" },
      });
      const listed = await post("tools/list", {});
      expect(listed.result.tools[0]._meta.ui.resourceUri).toBe(DRAWING_CARD_URI);
      expect(listed.result.tools[0]._meta["openai/outputTemplate"]).toBeUndefined();
      const read = await post("resources/read", { uri: DRAWING_CARD_URI });
      expect(read.result.contents[0]).toMatchObject({
        uri: DRAWING_CARD_URI,
        mimeType: "text/html;profile=mcp-app",
      });
      expect(read.result.contents[0].text).toContain("Zoom in");
      const oldRead = await post("resources/read", { uri: LEGACY_DRAWING_CARD_URI });
      expect(oldRead.result.contents[0]).toMatchObject({
        uri: LEGACY_DRAWING_CARD_URI,
        mimeType: "text/html;profile=mcp-app",
      });
      const call = await post("tools/call", {
        name: "drawing_markup",
        arguments: { sheet: "S-100" },
      });
      expect(call.error).toBeUndefined();
      expect(call.result._meta).toMatchObject(drawingCardResultMeta);
      expect(call.result.structuredContent).toEqual(fixture.structuredContent);
      expect(call.result.content[1]).toEqual(fixture.content[1]);
      expect(call.result.content[0].text).toContain("2 dated versions");
      if (host === "Claude") expect(call.result.content[0].text).not.toContain("<!doctype html");
    },
  );
  it("repairs only the new drawing metadata while preserving existing templates and file handoff", async () => {
    const request = new Request("https://athena.example.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    const legacy = {
      name: "contract_terms",
      _meta: { ui: { resourceUri: NATIVE_CARD_URI }, "openai/outputTemplate": CARD_WIDGET_URI },
    };
    const payload = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [
          { name: "drawing_set_import", _meta: { "openai/fileParams": ["file"] } },
          { name: "drawing_markup" },
          legacy,
        ],
      },
    };
    const { value } = nativeCardPayload(payload, await nativeCardVisit(request));
    const tools = (value as typeof payload).result.tools;
    expect(tools[0]._meta).toEqual({
      ui: { resourceUri: DRAWING_CARD_URI },
      "openai/fileParams": ["file"],
    });
    expect(tools[1]._meta).toEqual({ ui: { resourceUri: DRAWING_CARD_URI } });
    expect(tools[2]).toEqual(legacy);
    const unauthorized = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32001, message: "Not authorized" },
    };
    const readRequest = new Request("https://athena.example.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: DRAWING_CARD_URI },
      }),
    });
    expect(nativeCardPayload(unauthorized, await nativeCardVisit(readRequest))).toEqual({
      value: unauthorized,
      changed: false,
    });
  });
});
