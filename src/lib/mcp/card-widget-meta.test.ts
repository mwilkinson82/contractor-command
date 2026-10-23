import { describe, expect, it } from "vitest";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import { defineMcp } from "@lovable.dev/mcp-js";
import { EMAIL_CARD_TOOLS, EMAIL_CARD_URI } from "./cards/email-card";
import { NATIVE_CARD_URI, NATIVE_CARD_MIME, NATIVE_CARD_TOOLS } from "./cards/native";
import { CARD_TOOLS } from "./cards/attach";
import { CARD_WIDGET_MIME, CARD_WIDGET_URI } from "./cards/widget";
import { ATHENA_TOOLS } from "./index";
import { readFileSync } from "node:fs";

const CARD_NAMES = new Set<string>([...CARD_TOOLS, "lookahead_list"]);

async function rpc(method: string, id: number, params?: Record<string, unknown>) {
  const m = defineMcp({
    name: "athena",
    title: "Athena powered by ALP, construction agents",
    version: "t",
    instructions: "i",
    tools: ATHENA_TOOLS,
    metrics: false,
  } as never);
  const h = createTanStackMcpHandler(m, { resourcePath: "/mcp" });
  const post = (b: unknown) =>
    h({
      request: new Request("https://x/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify(b),
      }),
    });
  await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  const raw = await (await post({ jsonrpc: "2.0", id, method, params })).text();
  const json = JSON.parse(raw.trimStart().startsWith("{") ? raw : raw.split("\n").find((line) => line.startsWith("data:"))!.slice(5));
  return json.result;
}

describe("ChatGPT card widget stays off tools/list", () => {
  it("lists real drawing markup and import tools with input schemas, without widget metadata", async () => {
    const listed = await rpc("tools/list", 4);
    const tools = listed.tools as { name: string; inputSchema: { properties: Record<string, unknown> }; _meta?: Record<string, unknown> }[];
    const markup = tools.find((tool) => tool.name === "drawing_markup");
    const importer = tools.find((tool) => tool.name === "drawing_set_import");
    expect(markup?.inputSchema.properties).toHaveProperty("sheet");
    expect(markup?.inputSchema.properties).toHaveProperty("annotations");
    expect(importer?.inputSchema.properties).toHaveProperty("drawing");
    expect(markup?._meta?.["openai/outputTemplate"]).toBeUndefined();
    expect(importer?._meta?.["openai/outputTemplate"]).toBeUndefined();
  });
  it("card tools have no openai/outputTemplate in tools/list, and the resource is listed once", async () => {
    const defs = ATHENA_TOOLS.filter((tool) => CARD_NAMES.has(tool.name));
    expect(defs.length).toBeGreaterThan(10);
    for (const tool of defs) {
      expect(tool._meta?.["openai/outputTemplate"], tool.name).toBeUndefined();
    }
    const listed = await rpc("tools/list", 2);
    for (const tool of listed.tools as { name: string; _meta?: Record<string, unknown> }[]) {
      if (!CARD_NAMES.has(tool.name)) continue;
      expect(tool._meta?.["openai/outputTemplate"], tool.name).toBeUndefined();
      expect(JSON.stringify(tool._meta ?? {}), tool.name).not.toContain(CARD_WIDGET_URI);
    }
    const resources = await rpc("resources/list", 3);
    const cards = (resources.resources as { uri: string; mimeType?: string }[]).filter((resource) => resource.uri === CARD_WIDGET_URI);
    expect(cards).toEqual([{ uri: CARD_WIDGET_URI, name: "athena-card", title: "Athena card", mimeType: CARD_WIDGET_MIME }]);
    const instructions = readFileSync("src/lib/mcp/index.ts", "utf8");
    expect(instructions).toContain("How many / list lookaheads → lookahead_list.");
    expect(instructions).not.toContain("leave that section out");
    expect(instructions).not.toContain("leave the section out");
    expect(instructions).not.toContain("Never render an empty heading");
  });
});


describe("native card resource", () => {
  it("links only the affected tools to a distinct standard UI resource, preserving ChatGPT metadata", async () => {
    const listed = await rpc("tools/list", 10);
    for (const tool of listed.tools as { name: string; _meta?: Record<string, unknown> }[]) {
      // The email card takes precedence for a tool in both sets (submittal_delivery).
      expect(tool._meta?.ui, tool.name).toEqual(EMAIL_CARD_TOOLS.has(tool.name) ? { resourceUri: EMAIL_CARD_URI } : NATIVE_CARD_TOOLS.has(tool.name) ? { resourceUri: NATIVE_CARD_URI } : undefined);
      if (CARD_NAMES.has(tool.name)) expect(tool._meta?.["openai/outputTemplate"]).toBeUndefined();
    }
    const resource = await rpc("resources/read", 11, { uri: NATIVE_CARD_URI });
    expect(resource.contents).toHaveLength(1);
    expect(resource.contents[0]).toMatchObject({ uri: NATIVE_CARD_URI, mimeType: NATIVE_CARD_MIME, _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } });
    expect(resource.contents[0].text).toContain("ui/notifications/tool-result");
    const original = await rpc("resources/read", 12, { uri: CARD_WIDGET_URI });
    expect(original.contents[0]).toMatchObject({ uri: CARD_WIDGET_URI, mimeType: CARD_WIDGET_MIME });
    expect(original.contents[0].text).toContain("window.openai");
    expect(original.contents[0].text).not.toContain("ui/initialize");
    // Keep transport/list handlers owned by the SDK.
    const bridge = readFileSync("src/lib/mcp/widget-bridge.ts", "utf8");
    expect(bridge).not.toContain("setToolRequestHandlers");
    expect(bridge).not.toContain("setRequestHandler");
  });
});
