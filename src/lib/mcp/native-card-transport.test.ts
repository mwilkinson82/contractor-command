import { TAKEOFF_CARD_URI } from "./cards/takeoff-card";
import { describe, expect, it } from "vitest";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import { defineMcp } from "@lovable.dev/mcp-js";
import { ATHENA_TOOLS } from "./index";
import {
  ATHENA_MCP_APPS_CAPABILITIES,
  nativeCardPayload,
  nativeCardResponse,
  nativeCardVisit,
} from "./native-card-transport";
import { NATIVE_CARD_URI, NATIVE_CARD_MIME } from "./cards/native";
import { EMAIL_CARD_URI } from "./cards/email-card";
import { DRAWING_CARD_URI } from "./cards/drawing-card";
import { HOST_DISPLAY_BLOCK } from "./visible";
import { CARD_WIDGET_URI, cardWidgetMeta } from "./cards/widget";
import { openItemsCard } from "./open-feed";
import { attachAthenaCard } from "./cards/attach";
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

async function transform(method: string, params: unknown, payload: unknown, envelope?: unknown) {
  const visit = (await nativeCardVisit(makeRequest(method, params, { envelope })))!;
  return nativeCardPayload(payload, visit);
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
    expect(list.value).toMatchObject(result({ resources: [{ uri: NATIVE_CARD_URI }, { uri: EMAIL_CARD_URI }, { uri: DRAWING_CARD_URI }, {uri:TAKEOFF_CARD_URI}] }));
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
    "keeps the complete result byte-for-byte when %s advertises Apps support",
    async (name) => {
      const input = result(cardResult);
      const out = await transform("tools/call", { name: "list_open_items" }, input, meta(name));
      expect(out.changed).toBe(false);
      expect(out.value).toBe(input);
    },
  );
  it.each(["claude-ai", "Anthropic/ClaudeAI"])(
    "gives %s every row with no HTML document or display orders",
    async (name) => {
      const input = result({
        ...cardResult,
        structuredContent: {
          ...cardResult.structuredContent,
          assistant_guidance: [HOST_DISPLAY_BLOCK, "Ask which job next.", "Card shown. Do not add text."],
        },
      });
      const out = await transform("tools/call", { name: "list_open_items" }, input, meta(name));
      expect(out.changed).toBe(true);
      const returned = (out.value as { result: typeof cardResult & { structuredContent: { assistant_guidance?: string[]; html?: string } } }).result;
      const text = returned.content[0].text!;
      expect(text).toContain("| Full styled fallback |");
      expect(text).not.toContain("<!doctype");
      expect(text).not.toMatch(/sees this result as an Athena card/);
      expect(returned.content[1]).toEqual(cardResult.content[1]);
      expect(returned.structuredContent.assistant_guidance).toEqual(["Ask which job next."]);
      expect(returned.structuredContent.card).toEqual(cardResult.structuredContent.card);
    },
  );
  it.each(["contract_terms", "report", "morning_brief"])(
    "strips the render orders from Claude's %s reply and keeps its rows",
    async (name) => {
      const html = "<!doctype html><html><body><article class=\"card\">Card</article></body></html>";
      const input = result({
        content: [{ type: "text", text: `## Athena\n- §6.2 Delay notice: 5 calendar days\n\nREQUIRED VIEW: render this HTML card as-is. Do not escape it.\n\n${html}\n\nCard shown. Do not add text.` }],
        structuredContent: { html, assistant_guidance: [HOST_DISPLAY_BLOCK] },
      });
      const out = await transform("tools/call", { name }, input, meta("claude-ai"));
      const returned = (out.value as { result: { content: { text: string }[]; structuredContent: Record<string, unknown> } }).result;
      expect(returned.content[0].text).toBe("## Athena\n- §6.2 Delay notice: 5 calendar days");
      expect(returned.structuredContent).toEqual({ html });
      const chatgpt = await transform("tools/call", { name }, input, meta("ChatGPT"));
      expect(chatgpt.value).toBe(input);
    },
  );
  it.each(["claude-ai", "ChatGPT"])(
    "preserves all 17 open-item rows, three overdue and styled text for %s",
    async (host) => {
      const items = Array.from({ length: 17 }, (_, i) => ({
        id: `item-${i}`,
        action: `Job 2701 task ${i + 1}`,
        owner: "Example PM",
        due: i < 3 ? "2026-10-21" : i < 8 ? "2026-10-23" : "2026-11-02",
      }));
      const card = openItemsCard(
        "2701 · Fictional job",
        items,
        { open: 17, overdue: 3, due_in_7_days: 5 },
        "2026-10-22",
      );
      const fullReply = attachAthenaCard("list_open_items", {
        content: [{ type: "text", text: "Full reply" }],
        structuredContent: { card, items },
      });
      const original = Response.json(result(fullReply));
      const visit = await nativeCardVisit(
        makeRequest("tools/call", { name: "list_open_items", _meta: meta(host) }),
      );
      expect(visit?.calls[0]?.inlineHtml).toBe(true);
      const response = await nativeCardResponse(original, visit);
      const claude = host === "claude-ai";
      if (!claude) expect(response).toBe(original);
      const returned = (await response.json()).result;
      const body = returned.content.map((block: { text?: string }) => block.text ?? "").join("\n");
      for (let i = 1; i <= 17; i++) expect(body).toContain(`Job 2701 task ${i}`);
      expect(returned.structuredContent.card.kpis).toContainEqual({
        label: "Overdue",
        value: "3",
        flag: "overdue",
      });
      expect(returned._meta).toEqual(cardWidgetMeta);
      expect(returned.structuredContent.html).toContain("#1E5FED");
      if (claude) expect(body).not.toContain("<!doctype html");
      else {
        expect(body).toContain(returned.structuredContent.html);
        expect(body).toContain("<!doctype html");
      }
      expect(body).not.toMatch(/REQUIRED VIEW|Card shown/);
    },
  );
  it("drops the HTML document for a host that did not advertise a card", async () => {
    const items = Array.from({ length: 17 }, (_, i) => ({
      id: `item-${i}`,
      action: `Job 2701 task ${i + 1}`,
      owner: "Example PM",
      due: i < 3 ? "2026-10-21" : i < 8 ? "2026-10-23" : "2026-11-02",
    }));
    const card = {
      ...openItemsCard(
        "2701 · Fictional job",
        items,
        { open: 17, overdue: 3, due_in_7_days: 5 },
        "2026-10-22",
      ),
      next_move: "Close the overdue item first.",
    };
    const fullReply = attachAthenaCard("list_open_items", {
      content: [{ type: "text", text: "Full reply" }],
      structuredContent: { card, items },
    });
    const original = Response.json(result(fullReply));
    const request = makeRequest("tools/call", {
      name: "list_open_items",
      _meta: {
        "io.modelcontextprotocol/clientInfo": { name: "Grok", version: "test" },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    });
    const visit = await nativeCardVisit(request);
    const response = await nativeCardResponse(original, visit);
    const returned = await response.json();
    const body = returned.result.content.map((block: { text?: string }) => block.text ?? "").join("\n");
    for (let i = 1; i <= 17; i++) expect(body).toContain(`Job 2701 task ${i}`);
    expect(body).toContain("## 🔵 Open items");
    expect(body).toContain("**17 open · 🔴 3 overdue · 5 due within 7 days**");
    expect(body).toContain("due Oct 21");
    expect(body).toContain("due Oct 23");
    expect(body).toContain("due Nov 2");
    const openHeadings = ["### 🔴 Overdue", "### Due within 7 days", "### Coming up"];
    let openAt = -1;
    for (const heading of openHeadings) {
      const next = body.indexOf(heading);
      expect(next, heading).toBeGreaterThan(openAt);
      openAt = next;
    }
    expect(body.slice(body.indexOf("### Due within 7 days"), body.indexOf("### Coming up"))).not.toContain("🔴");
    expect(body.slice(body.indexOf("### Coming up"))).not.toContain("🔴");
    expect(body).not.toMatch(/^\s*\|/m);
    expect(body.trim().endsWith("**Athena's next move:** Close the overdue item first.")).toBe(true);
    expect(body).not.toContain("<!doctype");
    expect(body).not.toMatch(/\bREQUIRED\b/);
    expect(body).not.toMatch(/\bDo not\b/i);
    expect(returned.result.structuredContent.html).toContain("<!doctype html");
    expect(returned.result._meta).toEqual((fullReply as { _meta?: unknown })._meta);
  });
  it("remembers a Grok initialize and keeps Claude's later reply intact", async () => {
    const grokInit = makeRequest("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "Grok", version: "1" },
    });
    const grokVisit = await nativeCardVisit(grokInit);
    await nativeCardResponse(
      Response.json(
        { jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "athena" } } },
        { headers: { "content-type": "application/json", "mcp-session-id": "sess-grok" } },
      ),
      grokVisit,
    );
    const claudeInit = makeRequest("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-ai", version: "1" },
    });
    await nativeCardResponse(
      Response.json(
        { jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "athena" } } },
        { headers: { "content-type": "application/json", "mcp-session-id": "sess-claude" } },
      ),
      await nativeCardVisit(claudeInit),
    );
    const input = result(cardResult);
    const grokCall = makeRequest("tools/call", { name: "lookahead_get" });
    grokCall.headers.set("mcp-session-id", "sess-grok");
    const grok = await nativeCardPayload(input, await nativeCardVisit(grokCall));
    expect((grok.value as { result: { content: { text: string }[] } }).result.content[0].text).not.toContain("<!doctype");
    const claudeCall = makeRequest("tools/call", { name: "lookahead_get" });
    claudeCall.headers.set("mcp-session-id", "sess-claude");
    const claude = await nativeCardPayload(input, await nativeCardVisit(claudeCall));
    // The remembered session is still Claude's: facts-only text, not Grok's phone list.
    const claudeText = (claude.value as { result: { content: { text: string }[] } }).result.content[0].text;
    expect(claudeText).toContain("| Full styled fallback |");
    expect(claudeText).not.toContain("<!doctype");
  });
  it("keeps unknown/text-only hosts and errors on the full styled fallback", async () => {
    const input = result(cardResult);
    const plain = await transform("tools/call", { name: "list_open_items" }, input);
    expect(plain.changed).toBe(true);
    const text = (plain.value as { result: { content: { text: string }[] } }).result.content[0].text;
    expect(text).toContain("## 🔵 Open items");
    expect(text).toContain("Fictional task");
    expect(text).not.toMatch(/^\s*\|/m);
    expect(text).not.toContain("<!doctype");
    expect((plain.value as { result: { structuredContent: { html: string }; _meta: unknown } }).result.structuredContent.html).toContain("<!doctype html");
    expect((plain.value as { result: { _meta: { retained: boolean } } }).result._meta.retained).toBe(true);
    const noUi = { ...meta("ChatGPT"), "io.modelcontextprotocol/clientCapabilities": {} };
    expect((await transform("tools/call", { name: "lookahead_get" }, input, noUi)).value).toBe(
      input,
    );
    const error = result({ ...cardResult, isError: true });
    expect((await transform("tools/call", { name: "lookahead_get" }, error, meta())).value).toBe(
      error,
    );
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

describe("Claude follow-up arguments in host-readable text", () => {
  const items = [{ item_id: "60fedbcc-24ca-4939-9af9-800099b554b7", item_ref: "#60fedb", action: "QA-237 — Closure confirmation verification" }];
  it("retains every row and exposes item refs without changing the card or ChatGPT", async () => {
    const fixture = { ...cardResult, structuredContent: { ...cardResult.structuredContent, items } };
    const input = result(fixture);
    const out = await transform("tools/call", { name: "list_open_items" }, input, meta("claude-ai"));
    const returned = (out.value as { result: typeof fixture }).result;
    expect(returned.content[0].text).toContain("Full styled fallback");
    expect(returned.content[0].text).toContain('"item_ref":"#60fedb"');
    expect(returned.content[0].text).toContain(items[0].action);
    expect(returned.structuredContent).toEqual(fixture.structuredContent);
    expect(returned._meta).toEqual(fixture._meta);
    expect(returned.content[1]).toEqual(fixture.content[1]);
    const gpt = await transform("tools/call", { name: "list_open_items" }, input, meta("ChatGPT"));
    expect(gpt.value).toBe(input);
    expect(gpt.changed).toBe(false);
  });
  it("makes the current review key readable to Claude while retaining the full review and card", async () => {
    const key = "a".repeat(64);
    const fixture = { ...cardResult, structuredContent: { ...cardResult.structuredContent, confirmation_required: true, confirmation_key: key, closed: false, item_ref: "#60fedb" } };
    const input = result(fixture);
    const out = await transform("tools/call", { name: "resolve_item" }, input, meta("claude-ai"));
    const returned = (out.value as { result: typeof fixture }).result;
    expect(returned.content[0].text).toContain('"confirmation_key":"' + key + '"');
    expect(returned.content[0].text).toContain('"closed":false');
    expect(returned.structuredContent).toEqual(fixture.structuredContent);
    expect(returned.content[0].text).not.toMatch(/REQUIRED VIEW|Card shown|sees this result as/);
    const gpt = await transform("tools/call", { name: "resolve_item" }, input, meta("ChatGPT"));
    expect(gpt.value).toBe(input);
  });
  it("does not duplicate facts on a second presentation pass", async () => {
    const first = await transform("tools/call", { name: "list_open_items" }, result({ ...cardResult, structuredContent: { ...cardResult.structuredContent, items } }), meta("claude-ai"));
    const second = await transform("tools/call", { name: "list_open_items" }, first.value, meta("claude-ai"));
    expect(second.changed).toBe(false);
    expect(second.value).toBe(first.value);
  });
  it("keeps failed calls untouched and never invents a key for missing evidence", async () => {
    const failed = result({ ...cardResult, isError: true, structuredContent: { confirmation_required: true, confirmation_key: "a".repeat(64) } });
    expect((await transform("tools/call", { name: "resolve_item" }, failed, meta("claude-ai"))).value).toBe(failed);
    const noKey = result({ ...cardResult, structuredContent: { confirmation_required: true, confirmation_key: null } });
    const out = await transform("tools/call", { name: "resolve_item" }, noKey, meta("claude-ai"));
    expect(JSON.stringify(out.value)).not.toContain("Athena follow-up references");
  });
});
