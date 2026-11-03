import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { canonicalBidFiles } from "./estimating-bid-files";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { auth, defineMcp, ToolError } from "@lovable.dev/mcp-js";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
const state = vi.hoisted(() => ({ prepared: vi.fn(), writes: vi.fn(), allowed: true }));
vi.mock("./guard", () => ({
  guard: async (ctx: { isAuthenticated(): boolean }) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    return { rpc: state.writes };
  }, run: state.writes, text: (text: string) => ({ content: [{ type: "text", text }] }), dbError: vi.fn(), isMissingFunction: () => false,
}));
vi.mock("./jobs", () => ({ resolveJob: async () => {
  if (!state.allowed) throw new ToolError("No job access");
  return { job_id: "job", company_id: "company", job_number: "SYNTHETIC", scope: "full" };
}, audit: state.writes, named: () => "SYNTHETIC" }));
vi.mock("./estimating-plan", () => ({ estimatingUpgrade: async () => null }));
vi.mock("./security", () => ({ getCallSignals: () => null, securityTouch: async () => ({ ok: true }), enforceTouch: vi.fn() }));
vi.mock("./estimating-local-export", () => ({ prepareLocalBidDownload: state.prepared }));
import { estimateBidSummary } from "./tools/estimate-bid-tools";
import "./widget-bridge";
import { nativeCardVisit, nativeCardResponse } from "./native-card-transport";
const issuer = "https://synthetic-issuer.example";
async function transport(protectedServer = true) {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = { ...await exportJWK(publicKey), kid: "synthetic" };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ keys: [jwk] })));
  const token = await new SignJWT({ client_id: "synthetic-client" }).setProtectedHeader({ alg: "ES256", kid: "synthetic", typ: "at+jwt" })
    .setIssuer(issuer).setAudience("synthetic-mcp").setSubject("synthetic-user").setIssuedAt().setExpirationTime("5m").sign(privateKey);
  const server = defineMcp({ name: "synthetic", title: "Synthetic", version: "test", instructions: "Synthetic only", metrics: false,
    tools: [estimateBidSummary], ...(protectedServer ? { auth: auth.oauth.issuer({ issuer, jwksUri: issuer + "/jwks", acceptedAudiences: "synthetic-mcp", requireOAuthClientClaim: true }) } : {}) });
  const handler = createTanStackMcpHandler(server, { resourcePath: "/mcp" });
  let id = 0;
  return async (method: string, params: Record<string, unknown> = {}, signed = true) => {
    const request = new Request("https://synthetic-app.example/mcp", { method: "POST", headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream", ...(signed ? { authorization: `Bearer ${token}` } : {}),
    }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
    const visit = await nativeCardVisit(request);
    const response = await nativeCardResponse(await handler({ request }), visit);
    const raw = await response.text();
    const data = raw.trimStart().startsWith("{") ? raw : raw.split("\n").find((line) => line.startsWith("data:"))?.slice(5);
    return { status: response.status, body: data ? JSON.parse(data) : null };
  };
}
beforeEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); state.allowed = true; state.prepared.mockResolvedValue({ delivery: "local", filename: "Bid-summary-v7.pdf" }); });
describe("local estimate real SDK discovery and widget contract", () => {
  it.each(["pdf", "xlsx"] as const)("carries an actual card %s click through authenticated SDK validation and back to the card", async (format) => {
    const files = canonicalBidFiles({ job: "Synthetic", version: 7, ready: true, breakdown: {
      direct: [{ ref: "T-1", basis: "direct", quoteId: null, amountCents: 10000 }], directCents: 10000, generalConditions: [], requirements: [], generalConditionsCents: 0,
      requirementsCents: 0, overheadCents: 0, profitCents: 0, totalCents: 10000,
    } });
    if (!files) throw Error("Synthetic export unavailable");
    const bytes = files[format];
    state.prepared.mockResolvedValue({ delivery: "local", filename: `Bid-summary-v7.${format}`,
      mime_type: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: bytes.length, content_base64: Buffer.from(bytes).toString("base64"), sha256: Buffer.from(await webcrypto.subtle.digest("SHA-256", new Uint8Array(bytes))).toString("hex"),
      snapshot_version: 7, source_sha256: "a".repeat(64), company_id: "company", job_id: "job" });
    class Node {
      children: Node[] = []; textContent = ""; disabled = false; clickHandler?: () => void;
      constructor(public tag: string) {}
      append(...nodes: Node[]) { this.children.push(...nodes); }
      replaceChildren(...nodes: Node[]) { this.children = nodes; }
      addEventListener(_type: string, handler: () => void) { this.clickHandler = handler; }
      querySelectorAll(tag: string): Node[] { return this.children.flatMap((n) => [...(n.tag === tag ? [n] : []), ...n.querySelectorAll(tag)]); }
    }
    const root = new Node("root"), status = new Node("status");
    const post = await transport(); let listener: ((event: unknown) => void) | undefined;
    let forwarded: Promise<unknown> | undefined;
    const parent = { postMessage: (message: { method?: string; id?: number; params?: Record<string, unknown> }) => {
      if (message.method === "tools/call") forwarded = post(message.method, message.params).then((result) =>
        listener?.({ source: parent, origin: "https://synthetic-host.example", data: { jsonrpc: "2.0", id: message.id, result: result.body.result } }));
    } };
    const window: Record<string, unknown> = { parent, top: parent, frameElement: null,
      addEventListener: (_type: string, handler: typeof listener) => { listener = handler; } };
    runInNewContext(readFileSync("src/lib/mcp/cards/takeoff-client.js", "utf8"), {
      window, document: { getElementById: (id: string) => id === "app" ? root : status, createElement: (tag: string) => new Node(tag), body: new Node("body") },
      Blob, Uint8Array, TextDecoder, crypto: webcrypto, atob, btoa, URL, setTimeout, clearTimeout,
    });
    const receive = (data: unknown) => listener?.({ source: parent, origin: "https://synthetic-host.example", data });
    receive({ jsonrpc: "2.0", id: 1, result: { hostCapabilities: { serverTools: {} }, hostContext: {} } });
    receive({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: {
      local_export_context: { company_id: "company", job_id: "job", job_number: "SYNTHETIC", snapshot_version: 7, source_sha256: "a".repeat(64) },
      card: { title: "Bid", sections: [] },
    } } });
    const button = root.querySelectorAll("button").find((node) => node.textContent === (format === "pdf" ? "Prepare PDF" : "Prepare XLSX"));
    if (!button?.clickHandler) throw Error("Actual prepare control missing");
    button.clickHandler(); await forwarded;
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.prepared).toHaveBeenCalledOnce();
    expect(state.prepared.mock.calls[0][2]).toEqual({ format, expectedVersion: 7, expectedSource: "a".repeat(64) });
    expect(state.writes).not.toHaveBeenCalled();
    expect(root.querySelectorAll("button").some((node) => node.textContent === "Download local copy")).toBe(false);
    receive({ jsonrpc: "2.0", id: 99, method: "ui/resource-teardown" });
  });
  it("advertises the canonical strict schema through transported tools/list", async () => {
    const post = await transport();
    const listed = await post("tools/list");
    expect(listed.status).toBe(200);
    const schema = listed.body.result.tools[0].inputSchema;
    const manifest = JSON.parse(readFileSync(".lovable/mcp/manifest.json", "utf8"));
    expect(schema).toEqual(manifest.mcp.tools.find((tool: { name: string }) => tool.name === "estimate_bid_summary").inputSchema);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.export_delivery.enum).toEqual(["local", "stored"]);
    expect(schema.properties.expected_version).toMatchObject({ type: "integer", minimum: 0 });
    expect(schema.properties.expected_source_sha256.pattern).toBe("^[a-f0-9]{64}$");
  });
  it.each(["pdf", "xlsx"])("accepts the widget's %s arguments and preserves authenticated expectations and template", async (format) => {
    const post = await transport();
    const result = await post("tools/call", { name: "estimate_bid_summary", arguments: {
      job_number: "SYNTHETIC", company_id: "company", export_format: format, export_delivery: "local", expected_version: 7, expected_source_sha256: "a".repeat(64),
    } });
    expect(result.body.error).toBeUndefined(); expect(result.body.result.isError).not.toBe(true);
    expect(state.prepared).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ company_id: "company" }),
      { format, expectedVersion: 7, expectedSource: "a".repeat(64) }, expect.any(Function));
    expect(result.body.result._meta["openai/outputTemplate"]).toBe("ui://athena/takeoff-v8.html");
    expect(state.writes).not.toHaveBeenCalled();
  });
  it.each(["pdf", "xlsx"])("routes ordinary format-only %s requests to local without technical arguments", async (format) => {
    const post = await transport(); const result = await post("tools/call", { name: "estimate_bid_summary", arguments: { job_number: "SYNTHETIC", export_format: format } });
    expect(result.body.result.structuredContent.estimate_local_export).toBe(true); expect(state.prepared).toHaveBeenCalledOnce(); expect(state.writes).not.toHaveBeenCalled();
  });
  it.each([{ export_delivery: "other" }, { expected_version: -1 }, { expected_version: 1.5 }, { expected_source_sha256: "invalid" }, { unknown_argument: true }])("rejects schema-invalid widget arguments %j before preparation", async (invalid) => {
    const post = await transport(); const result = await post("tools/call", { name: "estimate_bid_summary", arguments: { job_number: "SYNTHETIC", export_format: "pdf", ...invalid } });
    expect(result.status).toBe(200); expect(Boolean(result.body.error || result.body.result?.isError)).toBe(true); expect(state.prepared).not.toHaveBeenCalled();
  });
  it("rejects unsigned transport and unauthorized jobs", async () => {
    const post = await transport();
    const denied = await post("tools/call", { name: "estimate_bid_summary", arguments: { job_number: "SYNTHETIC", export_format: "pdf" } }, false);
    expect(denied.status).toBe(401); expect(state.prepared).not.toHaveBeenCalled();
    state.allowed = false;
    const forbidden = await post("tools/call", { name: "estimate_bid_summary", arguments: { job_number: "SYNTHETIC", export_format: "pdf" } });
    expect(forbidden.body.result.isError).toBe(true); expect(state.prepared).not.toHaveBeenCalled();
  });
  it("explicit stored delivery stays out of the local branch", async () => {
    const post = await transport(); await post("tools/call", { name: "estimate_bid_summary", arguments: { job_number: "SYNTHETIC", export_format: "pdf", export_delivery: "stored" } });
    expect(state.prepared).not.toHaveBeenCalled(); expect(state.writes).toHaveBeenCalledOnce();
  });
});