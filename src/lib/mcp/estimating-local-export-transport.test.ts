import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
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