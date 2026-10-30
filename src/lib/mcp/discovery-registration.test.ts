import { expect, it } from "vitest";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import { defineMcp } from "@lovable.dev/mcp-js";
import { ATHENA_TOOLS } from "./index";
import { NATIVE_CARD_URI } from "./cards/native";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { TEXT_READ_TOOLS } from "./read-response";

it("keeps jobs text-first while drawing discovery retains its existing native view", async () => {
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
  for (const name of ["jobs_list", "drawing_sets_list"]) {
    const tool = listed.result.tools.find((row: { name: string }) => row.name === name);
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    if (name === "jobs_list") expect(tool._meta?.ui).toBeUndefined();
    else expect(tool._meta.ui.resourceUri).toBe(NATIVE_CARD_URI);
    expect(tool._meta?.["openai/outputTemplate"]).toBeUndefined();
  }
  for (const name of TEXT_READ_TOOLS) {
    const tool = listed.result.tools.find((row: { name: string }) => row.name === name);
    expect(tool._meta?.ui).toBeUndefined();
    expect(tool._meta?.["openai/outputTemplate"]).toBeUndefined();
  }
  const po = listed.result.tools.find(
    (row: { name: string }) => row.name === "purchase_orders_record",
  );
  const manifest = JSON.parse(readFileSync(".lovable/mcp/manifest.json", "utf8"));
  const committedPo = manifest.mcp.tools.find((row: { name: string }) => row.name === po.name);
  expect(po.inputSchema.properties.action.enum).toContain("approve_company_terms");
  expect(committedPo.inputSchema.properties.action.enum).toEqual(
    po.inputSchema.properties.action.enum,
  );
  expect(po.description).toContain("Unapproved company terms cannot be saved");
  mkdirSync("output/response-acceptance", { recursive: true });
  writeFileSync(
    "output/response-acceptance/source-catalog-contract.json",
    JSON.stringify(
      {
        purchase_orders_record: {
          description: po.description,
          actions: po.inputSchema.properties.action.enum,
        },
        text_read_tools: [...TEXT_READ_TOOLS].map((name) => {
          const t = listed.result.tools.find((row: { name: string }) => row.name === name);
          return { name, meta: t._meta ?? null };
        }),
      },
      null,
      2,
    ),
  );
});
