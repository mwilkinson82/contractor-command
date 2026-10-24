import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { defineMcp, defineTool } from "@lovable.dev/mcp-js";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import { boundTakeoffResult } from "./widget-bridge";
import { takeoffCardHtml, TAKEOFF_CARD_URI } from "./cards/takeoff-card";
import { nativeCardResponse, nativeCardVisit } from "./native-card-transport";

const preview = "data:image/png;base64," + "A".repeat(525_000);
const fixture = {
  content: [
    { type: "text" as const, text: "L1002 · QA wall\npass_id qa-pass · cursor 0" },
    { type: "image" as const, mimeType: "image/png", data: "iVBORw0KGgo=" },
  ],
  structuredContent: {
    card: { title: "S-100 · Drawing takeoff" },
    engine: { lines: [{ line_no: 1002 }], geometry: [] },
    read_request: { pass_id: "qa-pass", cursor: 0, source_hash: "original-hash" },
    preview,
  },
};

describe("takeoff preview is app data, not model text", () => {
  it("retains the actual images and every factual field without duplicating base64 into structuredContent", () => {
    const result = boundTakeoffResult(fixture);
    expect(result.content).toBe(fixture.content);
    expect(result.structuredContent).toEqual({
      card: fixture.structuredContent.card,
      engine: fixture.structuredContent.engine,
      read_request: fixture.structuredContent.read_request,
    });
    expect(result._meta).toEqual({ "athena/takeoffView": { preview } });
    expect(JSON.stringify(result.structuredContent).length).toBeLessThan(1000);
    expect(fixture.structuredContent.preview).toBe(preview);
  });

  it("leaves unrelated tool results untouched", () => {
    const email = { structuredContent: { preview, draft: { subject: "QA" } } };
    expect(boundTakeoffResult(email)).toBe(email);
  });

  it("reconstructs the same card data from the host's private metadata and ignores incomplete notifications", () => {
    const script = takeoffCardHtml().match(/<script>([\s\S]*?)<\/script>/)![1];
    const fn = script.match(/function takeoffData\(result\) \{[\s\S]*?\n {2}\}/)![0];
    const read = new Script(`(${fn})`).runInNewContext();
    expect(read(boundTakeoffResult(fixture))).toEqual(fixture.structuredContent);
    expect(read(fixture)).toEqual(fixture.structuredContent);
    expect(read(undefined)).toBeNull();
    expect(read({ content: [] })).toBeNull();
    expect(script).toContain("if (!incoming) return;");
  });

  it.each(["ChatGPT", "Claude"])(
    "preserves private preview metadata through the real SDK on %s",
    async (host) => {
      const tool = defineTool({
        name: "takeoff_geometry",
        title: "QA takeoff",
        description: "Fictional QA",
        inputSchema: {},
        handler: async () => fixture,
      });
      const mcp = defineMcp({
        name: "athena",
        title: "Athena",
        instructions: "Fictional QA",
        version: "test",
        tools: [tool],
        metrics: false,
      });
      const handler = createTanStackMcpHandler(mcp, { resourcePath: "/mcp" });
      const request = new Request("https://athena.example.com/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "takeoff_geometry",
            arguments: {},
            _meta: {
              "io.modelcontextprotocol/clientInfo": { name: host, version: "test" },
              "io.modelcontextprotocol/clientCapabilities": {
                extensions: {
                  "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
                },
              },
            },
          },
        }),
      });
      const response = await nativeCardResponse(
        await handler({ request }),
        await nativeCardVisit(request),
      );
      const raw = await response.text();
      const payload = JSON.parse(
        raw.trimStart().startsWith("{")
          ? raw
          : raw
              .split("\n")
              .find((s) => s.startsWith("data:"))!
              .slice(5),
      );
      expect(payload.error).toBeUndefined();
      expect(payload.result._meta["athena/takeoffView"]).toEqual({ preview });
      expect(payload.result._meta["openai/outputTemplate"]).toBe(TAKEOFF_CARD_URI);
      expect(payload.result.structuredContent.preview).toBeUndefined();
      expect(payload.result.structuredContent.read_request).toEqual(
        fixture.structuredContent.read_request,
      );
      expect(
        payload.result.content.some(
          (c: { type: string; data?: string }) =>
            c.type === "image" && c.data === fixture.content[1].data,
        ),
      ).toBe(true);
    },
  );
});
