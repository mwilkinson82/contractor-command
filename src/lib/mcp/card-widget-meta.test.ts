import { describe, expect, it } from "vitest";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import { defineMcp } from "@lovable.dev/mcp-js";
import { runInNewContext } from "node:vm";
import { CARD_TOOLS } from "./cards/attach";
import { ATHENA_SERVER_ICONS } from "./server-info-branding";
import {
  CARD_WIDGET_DOMAIN,
  CARD_WIDGET_MIME,
  CARD_WIDGET_URI,
  cardToolDescriptorMeta,
  cardWidgetHtml,
  cardWidgetResourceMeta,
} from "./cards/widget";
import { ATHENA_TOOLS } from "./index";
import { readFileSync } from "node:fs";

const CARD_NAMES = new Set<string>([...CARD_TOOLS, "lookahead_list"]);

async function rpc(method: string, id: number, params?: unknown) {
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
  const raw = await (await post({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })).text();
  const json = JSON.parse(raw.trimStart().startsWith("{") ? raw : raw.split("\n").find((line) => line.startsWith("data:"))!.slice(5));
  return json.result;
}

describe("ChatGPT card widget matches the Apps SDK descriptor", () => {
  it("card tools carry ui.resourceUri and the outputTemplate alias, and leave icons alone", async () => {
    expect(cardToolDescriptorMeta["openai/toolInvocation/invoking"].length).toBeLessThanOrEqual(64);
    expect(cardToolDescriptorMeta["openai/toolInvocation/invoked"].length).toBeLessThanOrEqual(64);
    expect(JSON.stringify(cardToolDescriptorMeta)).not.toContain("widgetAccessible");
    expect(JSON.stringify(cardToolDescriptorMeta)).not.toContain("icons");

    const listed = await rpc("tools/list", 2);
    const tools = listed.tools as { name: string; icons?: unknown; _meta?: Record<string, unknown> }[];
    const cards = tools.filter((tool) => CARD_NAMES.has(tool.name));
    expect(cards.length).toBeGreaterThan(10);
    for (const tool of cards) {
      expect(tool._meta, tool.name).toMatchObject({
        ui: { resourceUri: CARD_WIDGET_URI, visibility: ["model", "app"] },
        "openai/outputTemplate": CARD_WIDGET_URI,
        "openai/toolInvocation/invoking": "Opening the Athena card",
        "openai/toolInvocation/invoked": "Athena card ready",
      });
      expect(tool._meta?.["openai/widgetAccessible"], tool.name).toBeUndefined();
      expect(tool.icons, tool.name).toBeUndefined();
    }
    for (const name of ["cpm_activities", "team_list"]) {
      const tool = tools.find((row) => row.name === name);
      expect(tool, name).toBeTruthy();
      expect(JSON.stringify(tool?._meta ?? {}), name).not.toContain(CARD_WIDGET_URI);
    }
    expect(ATHENA_SERVER_ICONS.map((icon) => icon.src)).toEqual([
      "https://app.meetathena.io/brand/athena/athena-mono-blue-64.png",
      "https://app.meetathena.io/brand/athena/athena-mono-blue-128.png",
      "https://app.meetathena.io/brand/athena/athena-mono-blue-256.png",
    ]);
    const instructions = readFileSync("src/lib/mcp/index.ts", "utf8");
    expect(instructions).toContain("How many / list lookaheads → lookahead_list.");
    expect(instructions).not.toContain("leave that section out");
    expect(instructions).not.toContain("leave the section out");
    expect(instructions).not.toContain("Never render an empty heading");
  });

  it("resources/read returns the mcp-app mimeType and widget CSP metadata", async () => {
    const resources = await rpc("resources/list", 3);
    const cards = (resources.resources as { uri: string; name?: string; mimeType?: string; _meta?: Record<string, unknown> }[]).filter(
      (resource) => resource.uri === CARD_WIDGET_URI,
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      uri: CARD_WIDGET_URI,
      name: "athena-card",
      title: "Athena card",
      mimeType: CARD_WIDGET_MIME,
    });
    expect(cards[0].mimeType).toBe("text/html;profile=mcp-app");
    expect(cards[0]._meta).toMatchObject(cardWidgetResourceMeta);

    const read = await rpc("resources/read", 4, { uri: CARD_WIDGET_URI });
    const contents = read.contents as { uri: string; mimeType?: string; text?: string; _meta?: Record<string, unknown> }[];
    expect(contents).toHaveLength(1);
    const item = contents[0];
    expect(item.uri).toBe(CARD_WIDGET_URI);
    expect(item.mimeType).toBe("text/html;profile=mcp-app");
    expect(item.mimeType).toBe(CARD_WIDGET_MIME);
    const meta = item._meta as {
      ui: { domain: string; csp: { connectDomains: string[]; resourceDomains: string[] } };
      "openai/widgetCSP": { connect_domains: string[]; resource_domains: string[] };
      "openai/widgetDomain": string;
    };
    expect(meta["openai/widgetDomain"]).toBe(CARD_WIDGET_DOMAIN);
    expect(meta["openai/widgetCSP"].connect_domains).toEqual([CARD_WIDGET_DOMAIN]);
    expect(meta["openai/widgetCSP"].resource_domains).toEqual([CARD_WIDGET_DOMAIN]);
    expect(meta.ui.domain).toBe(CARD_WIDGET_DOMAIN);
    expect(meta.ui.csp.connectDomains).toEqual([CARD_WIDGET_DOMAIN]);
    expect(meta.ui.csp.resourceDomains).toEqual([CARD_WIDGET_DOMAIN]);
    expect(item.text).toContain("#1E3A5F");
    expect(item.text).toContain("#1E5FED");
    expect(item.text).toContain("<style>");
    expect(item.text).toContain("<script>");
    expect(item.text).not.toMatch(/<script[^>]+src=/);
    expect(item.text).not.toMatch(/<link[^>]+href=/);
    expect(Buffer.byteLength(item.text ?? "")).toBeLessThan(100_000);
    expect(item.text).toContain("window.openai");
    expect(item.text).toContain("toolOutput");
    expect(item.text).toContain("ui/notifications/tool-result");
    expect(item.text).toContain("ui/initialize");
    expect(item.text).toContain("openai:set_globals");
  });

  it("paints after the host delivers structuredContent, not from an empty first read", () => {
    const html = cardWidgetHtml();
    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    const app = { innerHTML: "", scrollHeight: 48, offsetHeight: 48, dataset: {} as Record<string, string> };
    const listeners: Record<string, ((ev: { source?: unknown; data?: unknown; detail?: unknown }) => void)[]> = {};
    const posted: { method?: string; id?: number }[] = [];
    const parent = { postMessage(msg: { method?: string; id?: number }) { posted.push(msg); } };
    const windowStub = {
      openai: {} as { toolOutput?: unknown; notifyIntrinsicHeight?: (h: number) => void },
      parent,
      document: {
        getElementById: () => app,
        documentElement: { scrollHeight: 48 },
        body: { scrollHeight: 48 },
      },
      addEventListener(type: string, fn: (ev: { source?: unknown; data?: unknown }) => void) {
        (listeners[type] ??= []).push(fn);
      },
    };
    const heights: number[] = [];
    windowStub.openai.notifyIntrinsicHeight = (h) => heights.push(h);
    runInNewContext(script!, { window: windowStub, document: windowStub.document, requestAnimationFrame: (fn: () => void) => fn() });
    expect(app.innerHTML).toBe("");
    expect(posted[0]).toMatchObject({ method: "ui/initialize", id: 1 });

    for (const fn of listeners.message ?? []) {
      fn({ source: parent, data: { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2026-01-26" } } });
    }
    expect(posted.some((msg) => msg.method === "ui/notifications/initialized")).toBe(true);
    expect(app.innerHTML).toBe("");

    for (const fn of listeners.message ?? []) {
      fn({
        source: parent,
        data: {
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: { structuredContent: { card: { title: "Open items", state: "result", sections: [] } } },
        },
      });
    }
    expect(app.innerHTML).toContain("Open items");
    expect(app.innerHTML).toContain("Athena");
    expect(heights.length).toBeGreaterThan(0);

    app.innerHTML = "";
    windowStub.openai.toolOutput = { card: { title: "Which job?", state: "ask" } };
    for (const fn of listeners["openai:set_globals"] ?? []) fn({ detail: { globals: { toolOutput: windowStub.openai.toolOutput } } });
    expect(app.innerHTML).toContain("Which job?");
  });
});
