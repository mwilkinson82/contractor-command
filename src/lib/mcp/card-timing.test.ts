import { afterEach, describe, expect, it, vi } from "vitest";
import { beginCardTiming, markSdkDone, timingFields } from "./card-timing";
import { nativeCardResponse, nativeCardVisit } from "./native-card-transport";
import { NATIVE_CARD_MIME, NATIVE_CARD_URI } from "./cards/native";

const request = (method: string, params: unknown) =>
  new Request("https://app.meetathena.io/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer fictional-credential",
      "user-agent": "claude-ai",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
const logs = () =>
  (console.info as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .filter((c) => typeof c[0] === "string" && (c[0] as string).startsWith("[athena] card."))
    .map((c) => [c[0], c[1]] as [string, Record<string, unknown>]);

describe("card timing", () => {
  afterEach(() => vi.restoreAllMocks());

  it("measures the SDK and the whole request, and marks a cold isolate", () => {
    const t = beginCardTiming(1000);
    markSdkDone(t, 1300);
    const fields = timingFields(t, 1350);
    expect(fields).toMatchObject({ sdkMs: 300, totalMs: 350, cold: expect.any(Boolean) });
    expect(fields.requestNo).toBeGreaterThanOrEqual(1);
    expect(fields.isolateAgeMs).toBeGreaterThanOrEqual(0);
    expect(timingFields(undefined)).toEqual({});
  });

  it("logs a resource read with timing and nothing personal", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const visit = await nativeCardVisit(request("resources/read", { uri: NATIVE_CARD_URI }));
    const t = markSdkDone(beginCardTiming(5000), 5040);
    const sdk = Response.json(
      { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } },
      { status: 404 },
    );
    const out = await nativeCardResponse(sdk, visit, t);
    expect(out.status).toBe(200);
    const [name, fields] = logs().find(([n]) => n === "[athena] card.resource")!;
    expect(name).toBe("[athena] card.resource");
    expect(fields).toMatchObject({ outcome: "served", status: 200, sdkMs: 40 });
    expect(typeof fields.totalMs).toBe("number");
    expect(Object.keys(fields).sort()).toEqual(
      [
        "cold",
        "format",
        "isolateAgeMs",
        "outcome",
        "protocol",
        "requestNo",
        "sdkMs",
        "sdkStatus",
        "status",
        "totalMs",
      ].sort(),
    );
    expect(JSON.stringify(fields)).not.toMatch(/fictional-credential|Bearer|html/);
  });

  it("logs a native card tool call by tool name and host kind only", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const visit = await nativeCardVisit(
      request("tools/call", {
        name: "contract_terms",
        arguments: { job_number: "2701", company_id: "ALP Construction" },
      }),
    );
    const t = markSdkDone(beginCardTiming(100), 900);
    const sdk = Response.json({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: "rows" }],
        structuredContent: { html: "<!doctype html><html></html>" },
      },
    });
    await nativeCardResponse(sdk, visit, t);
    const [, fields] = logs().find(([n]) => n === "[athena] card.call")!;
    expect(fields).toMatchObject({
      tool: "contract_terms",
      host: "claude",
      status: 200,
      sdkMs: 800,
    });
    expect(JSON.stringify(fields)).not.toMatch(/2701|ALP|fictional-credential/);
  });

  it("does not log a tool that has no native card", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const visit = await nativeCardVisit(
      request("tools/call", { name: "cpm_activities", arguments: { job_number: "2701" } }),
    );
    expect(visit).toBeNull();
    await nativeCardResponse(
      Response.json({ jsonrpc: "2.0", id: 1, result: { content: [] } }),
      visit,
      beginCardTiming(),
    );
    expect(logs()).toEqual([]);
  });

  it("keeps the served resource identical with or without timing", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const sdk = () =>
      Response.json(
        { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } },
        { status: 404 },
      );
    const visit = await nativeCardVisit(request("resources/read", { uri: NATIVE_CARD_URI }));
    const a = await (await nativeCardResponse(sdk(), visit)).json();
    const b = await (await nativeCardResponse(sdk(), visit, beginCardTiming())).json();
    expect(b).toEqual(a);
    expect(a.result.contents[0].mimeType).toBe(NATIVE_CARD_MIME);
  });
});
