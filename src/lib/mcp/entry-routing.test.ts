import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import athena, { ATHENA_TOOLS } from "./index";
import { defineMcp } from "@lovable.dev/mcp-js";

async function rpc(method: string, id: number, params?: unknown) {
  // Discovery-only fixture reuses the actual emitted instructions/tools; no tool handler is executed.
  const fixture = defineMcp({
    name: "athena",
    title: "Athena",
    version: "test",
    instructions: athena.instructions,
    tools: ATHENA_TOOLS,
    metrics: false,
  } as never);
  const handler = createTanStackMcpHandler(fixture, { resourcePath: "/mcp" });
  const raw = await (
    await handler({
      request: new Request("https://x/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      }),
    })
  ).text();
  return JSON.parse(
    raw.trimStart().startsWith("{")
      ? raw
      : raw
          .split("\n")
          .find((line) => line.startsWith("data:"))!
          .slice(5),
  ).result;
}

describe("published Athena entry routing contract", () => {
  it("emits unambiguous entry priority and preserves explicit morning requests", async () => {
    const result = await rpc("initialize", 1, {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "entry-test", version: "1" },
    });
    expect(result.instructions).toContain("Hey Athena, let's get started opens getting_started");
    expect(result.instructions).toContain(
      "Entry intent takes priority over greeting and proactive morning-brief rules",
    );
    expect(result.instructions).toContain("Good morning Athena");
    expect(result.instructions).toContain("call morning_brief");
    expect(result.instructions).not.toContain("Athena at the start or mid-sentence");
    expect(result.instructions).not.toContain("call athena_hello or morning_brief");
  });
  it("keeps discovery descriptions identical to the committed manifest", async () => {
    const result = await rpc("tools/list", 2);
    const manifest = JSON.parse(readFileSync(".lovable/mcp/manifest.json", "utf8"));
    for (const name of ["getting_started", "athena_hello", "morning_brief"]) {
      const live = result.tools.find((tool: { name: string }) => tool.name === name);
      expect(live.annotations.readOnlyHint).toBe(true);
      expect(
        manifest.mcp.tools.find((tool: { name: string }) => tool.name === name).description,
      ).toBe(live.description);
    }
  });
});
