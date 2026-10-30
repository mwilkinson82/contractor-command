import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defineMcp } from "@lovable.dev/mcp-js";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import { ATHENA_TOOLS } from "./index";

describe("supplier original SDK discovery", () => {
  it("publishes the exact schema and host attachment metadata without changing OAuth metadata", async () => {
    const h = createTanStackMcpHandler(
      defineMcp({
        name: "athena",
        title: "Athena",
        version: "test",
        instructions: "",
        tools: ATHENA_TOOLS,
        metrics: false,
      } as never),
      { resourcePath: "/mcp" },
    );
    const post = (body: object) =>
      h({
        request: new Request("https://synthetic.invalid/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify(body),
        }),
      });
    await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    });
    const text = await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).text();
    const wire = JSON.parse(
      text.trimStart().startsWith("{")
        ? text
        : text
            .split("\n")
            .find((x) => x.startsWith("data:"))!
            .slice(5),
    ).result.tools as Array<{ name: string; inputSchema: object; _meta?: Record<string, unknown> }>;
    const tool = wire.find((t) => t.name === "job_cost_original")!;
    expect(tool).toBeDefined();
    expect(tool._meta?.["openai/fileParams"]).toEqual(["file"]);
    const path = ".lovable/mcp/manifest.json",
      manifest = JSON.parse(readFileSync(path, "utf8")),
      auth = JSON.stringify(manifest.auth);
    // Explicit offline generation mode uses actual SDK wire schemas; it never regenerates routes or touches auth fields.
    if (process.env.ATHENA_UPDATE_MCP_MANIFEST === "1") {
      const source = ATHENA_TOOLS.find((t) => t.name === "job_cost_original")!;
      const descriptor = {
        name: source.name,
        title: source.title,
        description: source.description,
        annotations: source.annotations,
        inputSchema: tool.inputSchema,
        outputSchema: null,
      };
      const present = manifest.mcp.tools.findIndex((t: { name: string }) => t.name === source.name);
      if (present >= 0) manifest.mcp.tools[present] = descriptor;
      else
        manifest.mcp.tools.splice(
          manifest.mcp.tools.findIndex((t: { name: string }) => t.name === "job_cost_receipt") + 1,
          0,
          descriptor,
        );
      writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
    }
    expect(JSON.stringify(JSON.parse(readFileSync(path, "utf8")).auth)).toBe(auth);
    const saved = JSON.parse(readFileSync(path, "utf8")).mcp.tools.find(
      (t: { name: string }) => t.name === "job_cost_original",
    );
    expect(saved.inputSchema).toEqual(tool.inputSchema);
  });
});
