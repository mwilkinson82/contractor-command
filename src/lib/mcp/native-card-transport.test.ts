import { describe, expect, it } from "vitest";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import { defineMcp } from "@lovable.dev/mcp-js";
import { ATHENA_TOOLS } from "./index";
import {
  ATHENA_MCP_APPS_CAPABILITIES,
  NativeClientHints,
  nativeCardPayload,
  nativeCardResponse,
  nativeCardVisit,
} from "./native-card-transport";
import { NATIVE_CARD_URI, NATIVE_CARD_MIME } from "./cards/native";
import { CARD_WIDGET_URI } from "./cards/widget";
import { readFileSync } from "node:fs";

const uiCaps = { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [NATIVE_CARD_MIME] } } };
const meta = (name = "claude-ai") => ({
  "io.modelcontextprotocol/clientInfo": { name, version: "test" },
  "io.modelcontextprotocol/clientCapabilities": uiCaps,
});
const makeRequest = (
  method: string,
  params: unknown = {},
  options: { token?: string; ua?: string; envelope?: unknown; url?: string } = {},
) =>
  new Request(options.url ?? "https://app.meetathena.io/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${options.token ?? "fictional-credential"}`,
      "user-agent": options.ua ?? "test-host",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
      ...(options.envelope ? { _meta: options.envelope } : {}),
    }),
  });
const result = <T>(value: T) => ({ jsonrpc: "2.0", id: 1, result: value });
const missing = { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } };
const cardResult = {
  content: [
    {
      type: "text",
      text: "## Athena\n| Item |\n| --- |\n| Full styled fallback |\n<!doctype html>",
    },
    { type: "image", mimeType: "image/png", data: "test" },
  ],
  structuredContent: {
    card: {
      state: "result",
      title: "Open items",
      job: "2701 · Fictional job",
      kpis: [
        { label: "Open", value: "17" },
        { label: "Overdue", value: "3" },
      ],
    },
    html: "<!doctype html><p>Full styled fallback</p>",
    items: Array(17).fill({ action: "Fictional task" }),
  },
  _meta: { "openai/outputTemplate": CARD_WIDGET_URI, retained: true },
};

async function transform(
  method: string,
  params: unknown,
  payload: unknown,
  envelope?: unknown,
  hints = new NativeClientHints(),
) {
  const visit = (await nativeCardVisit(makeRequest(method, params, { envelope })))!;
  return nativeCardPayload(payload, visit, hints);
}

describe("native card presentation after the SDK", () => {
  it.each(["server/discover", "resources/list", "resources/templates/list", "resources/read"])(
    "returns a complete modern-protocol %s reply through the actual SDK",
    async (method) => {
      const mcp = defineMcp({
        name: "athena",
        title: "Athena",
        version: "test",
        instructions: "test",
        tools: [],
        metrics: false,
      });
      const handler = createTanStackMcpHandler(mcp, { resourcePath: "/mcp" });
      const params = method === "resources/read" ? { uri: NATIVE_CARD_URI } : {};
      const request = makeRequest(method, {
        ...params,
        _meta: {
          ...meta(),
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        },
      });
      request.headers.set("accept", "application/json, text/event-stream");
      request.headers.set("MCP-Protocol-Version", "2026-07-28");
      request.headers.set("Mcp-Method", method);
      if (method === "resources/read") request.headers.set("Mcp-Name", NATIVE_CARD_URI);
      const visit = await nativeCardVisit(request);
      const response = await nativeCardResponse(await handler({ request }), visit);
      const raw = await response.text();
      expect(response.status, raw).toBe(200);
      const json = JSON.parse(
        raw.startsWith("{")
          ? raw
          : raw
              .split("\n")
              .find((line) => line.startsWith("data:"))!
              .slice(5),
      );
      expect(json.error).toBeUndefined();
      expect(json.result).toMatchObject({
        resultType: "complete",
        ttlMs: 0,
        cacheScope: "private",
      });
      if (method === "server/discover")
        expect(json.result.capabilities).toMatchObject({
          resources: { listChanged: false },
          ...ATHENA_MCP_APPS_CAPABILITIES,
        });
      if (method === "resources/read")
        expect(json.result.contents[0].text).toContain("ui/initialize");
    },
  );
  it("repairs the authenticated live discovery snapshot that exposed the deployment failure", async () => {
    const snapshot = JSON.parse(
      readFileSync("docs/athena/claude-native-discovery-before.json", "utf8"),
    );
    expect(snapshot.discovery.authStatus).toBe("oAuth");
    expect(snapshot.discovery.serverCapabilities.resources).toBeUndefined();
    const wire = result({ tools: Object.values(snapshot.discovery.tools) });
    expect(JSON.stringify(wire)).not.toContain("resourceUri");
    const out = await transform("tools/list", {}, wire);
    expect(out.changed).toBe(true);
    for (const name of ["lookahead_get", "lookahead_list", "list_open_items"]) {
      expect(JSON.stringify(out.value)).toContain(name);
    }
    expect(JSON.stringify(out.value).match(/resourceUri/g)).toHaveLength(3);
    const request = makeRequest("resources/read", { uri: NATIVE_CARD_URI });
    const visit = (await nativeCardVisit(request))!;
    const resource = nativeCardPayload({ ...snapshot.native_resource_read, id: 1 }, visit);
    expect(resource.value).toMatchObject({
      id: 1,
      result: { contents: [{ uri: NATIVE_CARD_URI, mimeType: NATIVE_CARD_MIME }] },
    });
  });

  it("repairs the actual SDK response when no resource handlers were registered", async () => {
    const mcp = defineMcp({
      name: "athena",
      title: "Athena",
      version: "test",
      instructions: "test",
      tools: [],
      metrics: false,
    });
    const handler = createTanStackMcpHandler(mcp, { resourcePath: "/mcp" });
    const request = makeRequest("resources/read", { uri: NATIVE_CARD_URI });
    request.headers.set("accept", "application/json, text/event-stream");
    const visit = await nativeCardVisit(request);
    const original = await handler({ request });
    expect(original.status).toBe(200);
    const response = await nativeCardResponse(original, visit);
    const raw = await response.text();
    const json = JSON.parse(
      raw.startsWith("{")
        ? raw
        : raw
            .split("\n")
            .find((s) => s.startsWith("data:"))!
            .slice(5),
    );
    expect(json.error).toBeUndefined();
    expect(json.result.contents[0]).toMatchObject({
      uri: NATIVE_CARD_URI,
      mimeType: NATIVE_CARD_MIME,
    });
  });

  it("advertises UI support without replacing other server capabilities", async () => {
    const out = await transform(
      "initialize",
      { clientInfo: { name: "claude", version: "1" }, capabilities: uiCaps },
      result({
        serverInfo: { name: "athena" },
        capabilities: { tools: { listChanged: false }, extensions: { other: {} } },
      }),
    );
    expect(out.value).toMatchObject(
      result({
        capabilities: {
          tools: { listChanged: false },
          resources: {},
          extensions: { ...ATHENA_MCP_APPS_CAPABILITIES.extensions, other: {} },
        },
      }),
    );
  });
  it("repairs only missing native metadata, preserving every existing outputTemplate and unrelated tool", async () => {
    const input = result({
      tools: [
        {
          name: "lookahead_get",
          _meta: { "openai/outputTemplate": "keep-this-exactly", ui: { visibility: ["model"] } },
        },
        { name: "list_open_items" },
        { name: "lookahead_list", _meta: { ui: { resourceUri: NATIVE_CARD_URI } } },
        { name: "living_report_get", _meta: { other: true } },
      ],
    });
    const { value } = await transform("tools/list", {}, input);
    expect(value).toEqual(
      result({
        tools: [
          {
            name: "lookahead_get",
            _meta: {
              "openai/outputTemplate": "keep-this-exactly",
              ui: { visibility: ["model"], resourceUri: NATIVE_CARD_URI },
            },
          },
          { name: "list_open_items", _meta: { ui: { resourceUri: NATIVE_CARD_URI } } },
          input.result.tools[2],
          input.result.tools[3],
        ],
      }),
    );
  });
  it("repairs a missing static native resource handler and discovery, never the ChatGPT widget", async () => {
    const read = await transform("resources/read", { uri: NATIVE_CARD_URI }, missing);
    expect(read.value).toMatchObject(
      result({ contents: [{ uri: NATIVE_CARD_URI, mimeType: NATIVE_CARD_MIME }] }),
    );
    const html = JSON.stringify(read.value);
    expect(html).toContain("ui/notifications/initialized");
    expect(html).not.toContain("protocolVersion!==");
    const list = await transform("resources/list", {}, missing);
    expect(list.value).toMatchObject(result({ resources: [{ uri: NATIVE_CARD_URI }] }));
    expect(
      await nativeCardVisit(makeRequest("resources/read", { uri: CARD_WIDGET_URI })),
    ).toBeNull();
  });
  it("does not mask resource permission errors or unknown URIs", async () => {
    const denied = { jsonrpc: "2.0", id: 1, error: { code: -32001, message: "Access denied" } };
    expect((await transform("resources/read", { uri: NATIVE_CARD_URI }, denied)).changed).toBe(
      false,
    );
    expect(
      await nativeCardVisit(makeRequest("resources/read", { uri: "ui://other/private.html" })),
    ).toBeNull();
  });
  it("uses a short meaningful native-host reply, preserving all six/seventeen rows, backend HTML, images and metadata", async () => {
    const { value } = await transform(
      "tools/call",
      { name: "list_open_items" },
      result(cardResult),
      meta(),
    );
    expect(value).toEqual(
      result({
        ...cardResult,
        content: [
          {
            ...cardResult.content[0],
            text: "Athena · Open items · 2701 · Fictional job\nOpen: 17\nOverdue: 3",
          },
          cardResult.content[1],
        ],
      }),
    );
  });
  it("keeps every backend row in the compact native reply if Claude cannot display the app", async () => {
    for (const count of [6, 17]) {
      const input = {
        ...cardResult,
        structuredContent: {
          ...cardResult.structuredContent,
          card: {
            ...cardResult.structuredContent.card,
            sections: [
              {
                heading: "Saved items",
                rows: Array.from({ length: count }, (_, i) => ({
                  cells: [`Fictional item ${i + 1}`, "Example PM", "2026-11-02"],
                })),
              },
            ],
          },
        },
      };
      const out = await transform("tools/call", { name: "list_open_items" }, result(input), meta());
      const reply = out.value as ReturnType<typeof result<typeof input>>;
      for (let i = 1; i <= count; i++)
        expect(reply.result.content[0].text).toContain(
          `Fictional item ${i} · Example PM · 2026-11-02`,
        );
      expect(reply.result.structuredContent).toBe(input.structuredContent);
      expect(reply.result.content[0].text).not.toContain("| --- |");
    }
  });
  it("repairs only exact method-not-found resource errors at HTTP 404", async () => {
    const visit = await nativeCardVisit(makeRequest("resources/read", { uri: NATIVE_CARD_URI }));
    for (const error of [
      { code: -32001, message: "Access denied" },
      { code: -32602, message: "Invalid params" },
    ]) {
      const original = Response.json({ jsonrpc: "2.0", id: 1, error }, { status: 404 });
      expect(await nativeCardResponse(original, visit)).toBe(original);
    }
    const html = new Response("Page not found", {
      status: 404,
      headers: { "content-type": "text/html" },
    });
    expect(await nativeCardResponse(html, visit)).toBe(html);
    const otherId = Response.json({ ...missing, id: 100 }, { status: 404 });
    expect(await nativeCardResponse(otherId, visit)).toBe(otherId);
  });
  it.each(["ChatGPT", "openai-mcp"])(
    "keeps ChatGPT result byte-for-byte even when %s advertises Apps support",
    async (name) => {
      const input = result(cardResult);
      const out = await transform("tools/call", { name: "list_open_items" }, input, meta(name));
      expect(out.changed).toBe(false);
      expect(out.value).toBe(input);
    },
  );
  it("keeps unknown/text-only hosts and errors on the full styled fallback", async () => {
    const input = result(cardResult);
    expect((await transform("tools/call", { name: "list_open_items" }, input)).value).toBe(input);
    const noUi = { ...meta(), "io.modelcontextprotocol/clientCapabilities": {} };
    expect((await transform("tools/call", { name: "lookahead_get" }, input, noUi)).value).toBe(
      input,
    );
    const error = result({ ...cardResult, isError: true });
    expect((await transform("tools/call", { name: "lookahead_get" }, error, meta())).value).toBe(
      error,
    );
  });
  it("binds legacy negotiation to its bearer fingerprint and agent, and expires it without hiding fallback", async () => {
    let now = 0;
    const hints = new NativeClientHints(() => now, 100, 2);
    const initVisit = (await nativeCardVisit(
      makeRequest("initialize", {
        clientInfo: { name: "claude", version: "1" },
        capabilities: uiCaps,
      }),
    ))!;
    const callVisit = (await nativeCardVisit(
      makeRequest("tools/call", { name: "list_open_items" }),
    ))!;
    expect(initVisit.cacheKey).not.toContain("fictional-credential");
    nativeCardPayload(result({ serverInfo: { name: "athena" } }), initVisit, hints);
    expect(nativeCardPayload(result(cardResult), callVisit, hints).changed).toBe(true);
    const otherToken = (await nativeCardVisit(
      makeRequest("tools/call", { name: "list_open_items" }, { token: "other-credential" }),
    ))!;
    const otherAgent = (await nativeCardVisit(
      makeRequest("tools/call", { name: "list_open_items" }, { ua: "other-agent" }),
    ))!;
    expect(nativeCardPayload(result(cardResult), otherToken, hints).changed).toBe(false);
    expect(nativeCardPayload(result(cardResult), otherAgent, hints).changed).toBe(false);
    now = 101;
    expect(nativeCardPayload(result(cardResult), callVisit, hints).changed).toBe(false);
  });
  it("bounds legacy presentation hints and never learns from an initialization error", async () => {
    const hints = new NativeClientHints(() => 0, 100, 2);
    hints.remember("a", { name: "claude", native: true });
    hints.remember("b", { name: "claude", native: true });
    hints.remember("c", { name: "claude", native: true });
    expect(hints.get("a")).toBeNull();
    expect(hints.get("b")).not.toBeNull();
    const visit = (await nativeCardVisit(
      makeRequest("initialize", {
        clientInfo: { name: "claude", version: "1" },
        capabilities: uiCaps,
      }),
    ))!;
    nativeCardPayload(missing, visit, hints);
    expect(hints.get(visit.cacheKey)).toBeNull();
  });
  it.each([401, 403, 429, 500])("leaves HTTP %i errors completely untouched", async (status) => {
    const res = new Response(JSON.stringify(missing), {
      status,
      headers: { "content-type": "application/json", "www-authenticate": "unchanged" },
    });
    const visit = await nativeCardVisit(makeRequest("resources/read", { uri: NATIVE_CARD_URI }));
    expect(await nativeCardResponse(res, visit)).toBe(res);
  });
  it("preserves SSE framing and removes stale encoding/length headers only when rewriting", async () => {
    const visit = (await nativeCardVisit(makeRequest("resources/read", { uri: NATIVE_CARD_URI })))!;
    const wire = `event: message\r\nid: abc\r\ndata: ${JSON.stringify(missing)}\r\n\r\n`;
    const res = new Response(wire, {
      headers: {
        "content-type": "text/event-stream",
        "content-length": "1",
        "content-encoding": "gzip",
      },
    });
    const out = await nativeCardResponse(res, visit);
    expect(out.headers.has("content-length")).toBe(false);
    expect(out.headers.has("content-encoding")).toBe(false);
    const text = await out.text();
    expect(text).toContain("event: message\r\nid: abc\r\ndata: ");
    expect(text).toContain(NATIVE_CARD_MIME);
  });
  it("leaves unrelated routes, the Gantt, invalid bodies and large uploads out of the pass", async () => {
    expect(
      await nativeCardVisit(makeRequest("tools/call", { name: "living_report_get" })),
    ).toBeNull();
    expect(
      await nativeCardVisit(
        makeRequest("tools/list", {}, { url: "https://app.meetathena.io/login" }),
      ),
    ).toBeNull();
    expect(
      await nativeCardVisit(
        new Request("https://app.meetathena.io/mcp", { method: "POST", body: "invalid" }),
      ),
    ).toBeNull();
    expect(
      await nativeCardVisit(
        makeRequest("tools/call", { name: "lookahead_get", payload: "x".repeat(70_000) }),
      ),
    ).toBeNull();
    expect(readFileSync("src/lib/mcp/widget-bridge.ts", "utf8")).not.toContain("setRequestHandler");
  });
  it("exercises actual SDK initialization/list/resource responses with the scoped presentation seam", async () => {
    const mcp = defineMcp({
      name: "athena",
      title: "Athena",
      version: "test",
      instructions: "test",
      tools: ATHENA_TOOLS,
      metrics: false,
    } as never);
    const handler = createTanStackMcpHandler(mcp, { resourcePath: "/mcp" });
    for (const [method, params] of [
      [
        "initialize",
        {
          protocolVersion: "2025-06-18",
          capabilities: uiCaps,
          clientInfo: { name: "claude", version: "1" },
        },
      ],
      ["tools/list", {}],
      ["resources/read", { uri: NATIVE_CARD_URI }],
    ] as const) {
      const request = makeRequest(method, params);
      request.headers.set("accept", "application/json, text/event-stream");
      const visit = await nativeCardVisit(request);
      const response = await nativeCardResponse(await handler({ request }), visit);
      const raw = await response.text();
      const json = JSON.parse(
        raw.startsWith("{")
          ? raw
          : raw
              .split("\n")
              .find((s) => s.startsWith("data:"))!
              .slice(5),
      );
      expect(json.error).toBeUndefined();
      if (method === "initialize")
        expect(json.result.capabilities.extensions).toMatchObject(
          ATHENA_MCP_APPS_CAPABILITIES.extensions,
        );
      if (method === "tools/list") {
        for (const tool of json.result.tools)
          if (["lookahead_get", "lookahead_list", "list_open_items"].includes(tool.name)) {
            expect(tool._meta.ui.resourceUri).toBe(NATIVE_CARD_URI);
            expect(tool._meta["openai/outputTemplate"]).toBeUndefined();
          }
      }
      if (method === "resources/read")
        expect(json.result.contents[0].mimeType).toBe(NATIVE_CARD_MIME);
    }
  });
});
