import { siteIconResponse } from "../site-icons";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { defineMcp, defineTool } from "@lovable.dev/mcp-js";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import { z } from "zod";
import { athenaIcon64Bytes, athenaIcon64Response } from "./athena-icon-64";
import {
  ATHENA_DESCRIPTION,
  ATHENA_SERVER_ICONS,
  ATHENA_WEBSITE_URL,
  brandInitializeResponse,
  initializeRequestIds,
  isMcpPost,
} from "./server-info-branding";

const init = (id: unknown = 1) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
  });
const initResult = (id: unknown = 1, extra: Record<string, unknown> = {}) => ({
  jsonrpc: "2.0",
  id,
  result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "contractor-circle-hub", title: "Athena powered by ALP, construction agents", version: "0.4.0", ...extra } },
});

describe("initializeRequestIds", () => {
  it("finds initialize ids in single and batch bodies", () => {
    expect(initializeRequestIds(init(7))).toEqual([7]);
    expect(initializeRequestIds(`[${init("a")},{"jsonrpc":"2.0","id":2,"method":"tools/list"}]`)).toEqual(["a"]);
  });
  it("ignores other methods, notifications and junk", () => {
    expect(initializeRequestIds('{"jsonrpc":"2.0","id":1,"method":"tools/call"}')).toEqual([]);
    expect(initializeRequestIds('{"jsonrpc":"2.0","method":"initialize"}')).toEqual([]);
    expect(initializeRequestIds("not json")).toEqual([]);
    expect(initializeRequestIds("")).toEqual([]);
  });
});

describe("brandInitializeResponse", () => {
  it("adds icons and websiteUrl to a JSON initialize result", async () => {
    const res = new Response(JSON.stringify(initResult()), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s1" } });
    const out = await brandInitializeResponse(res, [1]);
    const body = await out.json();
    expect(body.result.serverInfo.icons).toEqual(ATHENA_SERVER_ICONS);
    expect(body.result.serverInfo.websiteUrl).toBe(ATHENA_WEBSITE_URL);
    expect(body.result.serverInfo.title).toBe("Athena powered by ALP, construction agents");
    expect(out.headers.get("mcp-session-id")).toBe("s1");
    expect(out.headers.get("content-length")).toBeNull();
  });

  it("adds icons inside an SSE initialize stream", async () => {
    const sse = `event: message\ndata: ${JSON.stringify(initResult(3))}\n\n`;
    const res = new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    const text = await (await brandInitializeResponse(res, [3])).text();
    const data = JSON.parse(text.split("\n").find((l) => l.startsWith("data:"))!.slice(5));
    expect(data.result.serverInfo.icons[0].src).toBe("https://app.meetathena.io/brand/athena/athena-mono-blue-64.png");
    expect(text.startsWith("event: message\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(true);
  });

  it("never overwrites icons the server already declares", async () => {
    const own = [{ src: "https://x.test/i.png" }];
    const res = new Response(JSON.stringify(initResult(1, { icons: own })), { status: 200, headers: { "content-type": "application/json" } });
    const body = await (await brandInitializeResponse(res, [1])).json();
    expect(body.result.serverInfo.icons).toEqual(own);
  });

  it("passes 401, 403 and non-initialize responses through untouched", async () => {
    for (const status of [401, 403, 500]) {
      const res = new Response('{"error":"unauthorized"}', { status, headers: { "content-type": "application/json", "www-authenticate": "Bearer realm=\"mcp\"" } });
      expect(await brandInitializeResponse(res, [1])).toBe(res);
    }
    const ok = new Response(JSON.stringify(initResult()), { status: 200, headers: { "content-type": "application/json" } });
    expect(await brandInitializeResponse(ok, [])).toBe(ok);
    const other = new Response(JSON.stringify({ jsonrpc: "2.0", id: 9, result: { tools: [] } }), { status: 200, headers: { "content-type": "application/json" } });
    expect(await brandInitializeResponse(other, [1])).toBe(other);
  });

  it("only targets POST /mcp", () => {
    expect(isMcpPost(new Request("https://app.alpcontractorcircle.com/mcp", { method: "POST" }))).toBe(true);
    expect(isMcpPost(new Request("https://app.alpcontractorcircle.com/mcp", { method: "GET" }))).toBe(false);
    expect(isMcpPost(new Request("https://app.alpcontractorcircle.com/oauth/consent", { method: "POST" }))).toBe(false);
    expect(isMcpPost(new Request("https://app.alpcontractorcircle.com/.well-known/oauth-protected-resource", { method: "POST" }))).toBe(false);
  });
});

describe("with the real MCP toolkit handler", () => {
  const probe = defineMcp({
    name: "contractor-circle-hub",
    title: "Athena powered by ALP, construction agents",
    version: "0.4.0",
    instructions: "",
    tools: [
      defineTool({
        name: "ping",
        title: "Ping",
        description: "Ping.",
        inputSchema: { x: z.string().optional() },
        annotations: { readOnlyHint: true },
        handler: async () => ({ content: [{ type: "text", text: "pong" }] }),
      }),
    ],
    metrics: false,
  });
  const handler = createTanStackMcpHandler(probe, { resourcePath: "/mcp" });

  it("brands the toolkit's initialize response (JSON or SSE)", async () => {
    const body = init(1);
    const request = new Request("https://app.alpcontractorcircle.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body,
    });
    const raw = await handler({ request });
    expect(raw.status).toBe(200);
    const out = await brandInitializeResponse(raw, initializeRequestIds(body));
    const text = await out.text();
    const json = text.trimStart().startsWith("{")
      ? JSON.parse(text)
      : JSON.parse(text.split("\n").find((l) => l.startsWith("data:"))!.slice(5));
    expect(json.result.serverInfo.title).toBe("Athena powered by ALP, construction agents");
    expect(json.result.serverInfo.icons.map((i: { sizes: string[] }) => i.sizes[0])).toEqual(["64x64", "64x64", "512x512", "any"]);
    expect(json.result.serverInfo.description).toBe(ATHENA_DESCRIPTION);
    expect(json.result.serverInfo.websiteUrl).toBe("https://app.meetathena.io");
  });
});

describe("icon files", () => {
  const png = (name: string) => readFileSync(resolve(__dirname, "../../../public/brand/athena", name));
  it.each([
    ["athena-primary-512.png", 512],
  ])("%s is a %ipx square PNG", (name, size) => {
    const b = png(name);
    expect(b.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(b.readUInt32BE(16)).toBe(size);
    expect(b.readUInt32BE(20)).toBe(size);
  });
  it("every declared icon is served (public file, site-icons PNG or inline)", () => {
    for (const icon of ATHENA_SERVER_ICONS) {
      if (icon.src.startsWith("data:")) continue;
      const path = new URL(icon.src).pathname;
      if (icon.mimeType === "image/png") {
        const res = siteIconResponse(new Request(`https://app.meetathena.io${path}`));
        expect(res?.headers.get("content-type")).toBe("image/png");
        continue;
      }
      const name = path.split("/brand/athena/")[1];
      expect(() => png(name)).not.toThrow();
    }
  });
});

describe("athena-icon-64 route payload", () => {
  it("is a 64x64 PNG under 4 KB", () => {
    const b = Buffer.from(athenaIcon64Bytes());
    expect(b.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(b.readUInt32BE(16)).toBe(64);
    expect(b.readUInt32BE(20)).toBe(64);
    expect(b.length).toBeLessThan(4096);
  });
  it("is served public with image/png and open CORS", () => {
    const res = athenaIcon64Response();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("inline icon (retest 4)", () => {
  it("second icon is the same 64x64 PNG as a data: URI", () => {
    const d = ATHENA_SERVER_ICONS[1];
    expect(d.src.startsWith("data:image/png;base64,")).toBe(true);
    expect(d.mimeType).toBe("image/png");
    expect(Buffer.from(d.src.split(",")[1], "base64").equals(Buffer.from(athenaIcon64Bytes()))).toBe(true);
  });
});
