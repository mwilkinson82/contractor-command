import { expect, it } from "vitest";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import { defineMcp } from "@lovable.dev/mcp-js";
import { ATHENA_TOOLS } from "./index";
import { NATIVE_CARD_URI } from "./cards/native";

it("advertises real read-only portfolio and drawing-library tools with the existing native card", async () => {
  const mcp = defineMcp({
    name: "athena",
    title: "Athena",
    instructions: "Test registration",
    version: "test",
    tools: ATHENA_TOOLS,
    metrics: false,
  } as never);
  const handler = createTanStackMcpHandler(mcp, { resourcePath: "/mcp" });
  const send = async (id: number, method: string, params: Record<string, unknown>) => {
    const response = await handler({
      request: new Request("https://example.com/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      }),
    });
    const raw = await response.text();
    return JSON.parse(
      raw.startsWith("{")
        ? raw
        : raw
            .split("\n")
            .find((s) => s.startsWith("data:"))!
            .slice(5),
    );
  };
  await send(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  const listed = await send(2, "tools/list", {});
  expect(listed.error).toBeUndefined();
  for (const [name, readOnlyHint] of [
    ["job_cost_submissions_read", true],
    ["job_cost_submission_record", false],
    ["job_cost_accounting_record", false],
    ["job_cost_pm_payment_approval", false],
  ] as const) {
    const tool = listed.result.tools.find((row: { name: string }) => row.name === name);
    expect(tool).toBeDefined();
    expect(tool.annotations).toMatchObject({
      readOnlyHint,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  }
  for (const name of ["jobs_list", "drawing_sets_list"]) {
    const tool = listed.result.tools.find((row: { name: string }) => row.name === name);
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tool._meta.ui.resourceUri).toBe(NATIVE_CARD_URI);
    expect(tool._meta["openai/outputTemplate"]).toBeUndefined();
  }
});
