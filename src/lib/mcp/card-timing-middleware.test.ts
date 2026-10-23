import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ rpc: vi.fn(), sdk: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createStart: (f: () => unknown) => f(),
  createMiddleware: () => ({ server: (f: unknown) => f }),
}));
vi.mock("@/integrations/supabase/auth-attacher", () => ({ attachSupabaseAuth: {} }));
vi.mock("./supabase", () => ({ supabaseForToken: () => ({ rpc: fixture.rpc }) }));

const BASE = new Date("2026-10-23T16:00:00Z").getTime();
function req(method: string, params: unknown = {}) {
  return new Request("https://app.meetathena.io/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: "Bearer fictional",
      "user-agent": "claude-ai",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}
async function run(
  request: Request,
  sdkMs = 0,
  response = Response.json({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: "Fictional result" }] },
  }),
) {
  const { startInstance } = await import("../../start");
  type Handler = (args: { request: Request; next: () => Promise<unknown> }) => Promise<unknown>;
  const handlers = (startInstance as unknown as { requestMiddleware: Handler[] }).requestMiddleware;
  const next = async (i: number): Promise<unknown> => {
    if (i < handlers.length) return handlers[i]({ request, next: () => next(i + 1) });
    fixture.sdk();
    vi.setSystemTime(Date.now() + sdkMs);
    return { response };
  };
  return next(0);
}
function fields(name: string): Record<string, unknown> {
  const log = vi.mocked(console.info).mock.calls.find((c) => c[0] === name);
  expect(log, "Expected diagnostic line " + name).toBeTruthy();
  return log![1] as Record<string, unknown>;
}

describe("MCP card timing middleware", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(BASE);
    vi.spyOn(console, "info").mockImplementation(() => {});
    fixture.rpc.mockReset().mockResolvedValue({ data: true, error: null });
    fixture.sdk.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reports an unavailable membership RPC as check-failed, not allowed", async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message: "fictional outage" } });
    await run(req("tools/call", { name: "contract_terms", arguments: { job_number: "2701" } }));
    expect(fields("[athena] mcp.entitlement").outcome).toBe("check-failed");
  });

  it("includes the preceding membership round trip in totalMs", async () => {
    fixture.rpc.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 200);
      return { data: true, error: null };
    });
    await run(
      req("tools/call", { name: "contract_terms", arguments: { job_number: "2701" } }),
      100,
    );
    expect(fields("[athena] mcp.entitlement").ms).toBe(200);
    expect(fields("[athena] card.call").totalMs).toBe(300);
    expect(fields("[athena] card.call").sdkMs).toBe(100);
  });

  it("counts a preceding MCP ping when classifying the first resource read", async () => {
    await run(req("ping"));
    vi.setSystemTime(BASE + 1000);
    const { NATIVE_CARD_URI } = await import("./cards/native");
    await run(
      req("resources/read", { uri: NATIVE_CARD_URI }),
      0,
      Response.json(
        { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } },
        { status: 404 },
      ),
    );
    expect(fields("[athena] card.resource").requestNo).toBe(2);
    expect(fields("[athena] card.resource").cold).toBe(false);
  });

  it.each([
    ["notification", () => req("notifications/initialized")],
    [
      "non-card tool",
      () => req("tools/call", { name: "cpm_activities", arguments: { job_number: "2701" } }),
    ],
    ["GET connection", () => new Request("https://app.meetathena.io/mcp")],
  ])("counts a preceding %s without changing its response", async (_label, makeRequest) => {
    const original = Response.json({ fixture: "unchanged" });
    const result = (await run(makeRequest(), 0, original)) as { response: Response };
    expect(result.response).toBe(original);
    const { NATIVE_CARD_URI } = await import("./cards/native");
    await run(
      req("resources/read", { uri: NATIVE_CARD_URI }),
      0,
      Response.json(
        { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } },
        { status: 404 },
      ),
    );
    expect(fields("[athena] card.resource")).toMatchObject({ requestNo: 2, cold: false });
  });

  it("preserves an allowed call and reports allowed", async () => {
    const original = Response.json({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "Fictional row" }] },
    });
    const result = (await run(
      req("tools/call", { name: "contract_terms", arguments: { job_number: "2701" } }),
      0,
      original,
    )) as { response: Response };
    expect(result.response).toBe(original);
    expect(fields("[athena] mcp.entitlement").outcome).toBe("allowed");
    expect(fixture.sdk).toHaveBeenCalledOnce();
  });

  it("preserves a denied call without invoking the SDK, and counts it", async () => {
    fixture.rpc.mockResolvedValue({ data: false, error: null });
    const result = (await run(
      req("tools/call", { name: "contract_terms", arguments: { job_number: "2701" } }),
    )) as Response;
    expect(result.status).toBe(403);
    expect(await result.json()).toEqual({
      error: "forbidden",
      message: "This account doesn't have an active membership that includes Athena.",
    });
    expect(fields("[athena] mcp.entitlement").outcome).toBe("denied");
    expect(fixture.sdk).not.toHaveBeenCalled();
    const { NATIVE_CARD_URI } = await import("./cards/native");
    await run(
      req("resources/read", { uri: NATIVE_CARD_URI }),
      0,
      Response.json(
        { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } },
        { status: 404 },
      ),
    );
    expect(fields("[athena] card.resource")).toMatchObject({ requestNo: 2, cold: false });
  });

  it("leaves SDK authentication challenges intact when membership is unavailable", async () => {
    fixture.rpc.mockRejectedValue(new Error("Fictional private outage detail"));
    const challenge = new Response("Fictional auth challenge", {
      status: 401,
      headers: { "www-authenticate": 'Bearer realm="Athena"' },
    });
    const result = (await run(
      req("tools/call", { name: "contract_terms", arguments: { job_number: "2701" } }),
      0,
      challenge,
    )) as { response: Response };
    expect(result.response).toBe(challenge);
    expect(result.response.status).toBe(401);
    expect(result.response.headers.get("www-authenticate")).toBe('Bearer realm="Athena"');
    expect(await result.response.text()).toBe("Fictional auth challenge");
    expect(fields("[athena] mcp.entitlement").outcome).toBe("check-failed");
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toMatch(
      /private outage|fictional|Bearer|2701/,
    );
  });

  it("leaves rejected card-resource requests intact", async () => {
    const { NATIVE_CARD_URI } = await import("./cards/native");
    const rejected = Response.json(
      { error: "unauthorized" },
      { status: 401, headers: { "www-authenticate": 'Bearer realm="Athena"' } },
    );
    const result = (await run(req("resources/read", { uri: NATIVE_CARD_URI }), 0, rejected)) as {
      response: Response;
    };
    expect(result.response).toBe(rejected);
    expect(await result.response.json()).toEqual({ error: "unauthorized" });
    expect(fields("[athena] card.resource")).toMatchObject({
      outcome: "sdk-rejected",
      status: 401,
      requestNo: 1,
      cold: true,
    });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it("does not count ordinary application pages as MCP requests", async () => {
    await run(new Request("https://app.meetathena.io/"));
    const { NATIVE_CARD_URI } = await import("./cards/native");
    await run(
      req("resources/read", { uri: NATIVE_CARD_URI }),
      0,
      Response.json(
        { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } },
        { status: 404 },
      ),
    );
    expect(fields("[athena] card.resource")).toMatchObject({ requestNo: 1, cold: true });
  });

  it("keeps an in-flight tool's timing separate from an overlapping ping", async () => {
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const checking = new Promise<void>((resolve) => {
      entered = resolve;
    });
    fixture.rpc.mockImplementationOnce(async () => {
      entered();
      await blocked;
      return { data: true, error: null };
    });
    const tool = run(
      req("tools/call", { name: "contract_terms", arguments: { job_number: "2701" } }),
      100,
    );
    await checking;
    vi.setSystemTime(BASE + 50);
    await run(req("ping"), 10);
    vi.setSystemTime(BASE + 200);
    release();
    await tool;
    expect(fields("[athena] card.call")).toMatchObject({
      requestNo: 1,
      cold: true,
      sdkMs: 100,
      totalMs: 300,
    });
  });
});
