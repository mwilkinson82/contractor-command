import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { defineMcp } from "@lovable.dev/mcp-js";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import athena, { ATHENA_TOOLS } from "./index";

type Tool = {
  name: string;
  title: string;
  description: string;
  annotations: { readOnlyHint: boolean };
  inputSchema: { required?: string[]; properties: Record<string, unknown> };
};
let instructions: string;
let tools: Tool[];

beforeAll(async () => {
  // Real SDK discovery; no tool handler, application RPC or network is invoked.
  const fixture = defineMcp({
    name: "athena",
    title: "Athena",
    version: "test",
    instructions: athena.instructions,
    tools: ATHENA_TOOLS,
    metrics: false,
  } as never);
  const handler = createTanStackMcpHandler(fixture, { resourcePath: "/mcp" });
  async function send(method: string, id: number, params?: unknown) {
    const response = await handler({
      request: new Request("https://x/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      }),
    });
    const raw = await response.text();
    const message = JSON.parse(
      raw.trimStart().startsWith("{")
        ? raw
        : raw
            .split("\n")
            .find((line) => line.startsWith("data:"))!
            .slice(5),
    );
    expect(message.error).toBeUndefined();
    return message.result;
  }
  instructions = (
    await send("initialize", 1, {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "accounting-routing-review", version: "1" },
    })
  ).instructions;
  tools = (await send("tools/list", 2)).tools;
});

describe("accounting read-intent discovery", () => {
  it.each(["job cost accounting", "job accounting board", "job cost report"])(
    "publishes %s as accounting_report read vocabulary",
    (phrase) => {
      const report = tools.find((tool) => tool.name === "accounting_report")!;
      expect(report.description).toContain(phrase);
      expect(instructions).toContain(phrase);
      expect(instructions).toContain("call accounting_report first");
      expect(instructions).toContain("do not start bill submission or collect bill facts");
    },
  );

  it("keeps viewing a board distinct from authorizing a financial action", () => {
    expect(instructions).toContain(
      "Show/open/give-me requests do not authorize creating, correcting, approving, posting or paying a bill or expense",
    );
    for (const name of ["job_cost_submission_record", "job_cost_accounting_record"]) {
      const tool = tools.find((tool) => tool.name === name)!;
      expect(tool.description).toContain("Use only for an explicit request");
      expect(tool.description).toContain("never to show job cost accounting");
      expect(tool.description).toContain("use accounting_report");
      expect(tool.description).toContain("confirmation");
    }
    expect(tools.find((tool) => tool.name === "job_cost_submission_record")!.title).toBe(
      "Create or correct a supplier bill or field expense",
    );
    expect(tools.find((tool) => tool.name === "job_cost_accounting_record")!.title).toBe(
      "Review bill or expense approval, posting or recorded payment",
    );
  });

  it("preserves read-only annotations and keeps write payloads out of report discovery", () => {
    const report = tools.find((tool) => tool.name === "accounting_report")!;
    expect(report.annotations.readOnlyHint).toBe(true);
    expect(report.inputSchema.properties.report_type).toBeDefined();
    for (const field of ["facts", "payload", "step", "review_key", "confirmed"])
      expect(report.inputSchema.properties[field]).toBeUndefined();
    for (const name of ["job_cost_submission_record", "job_cost_accounting_record"]) {
      const tool = tools.find((tool) => tool.name === name)!;
      expect(tool.annotations.readOnlyHint).toBe(false);
      expect(tool.inputSchema.required).toContain("step");
      for (const field of ["payload", "review_key", "confirmed"])
        expect(tool.inputSchema.properties[field]).toBeDefined();
    }
    const read = tools.find((tool) => tool.name === "job_cost_submissions_read")!;
    expect(read.annotations.readOnlyHint).toBe(true);
    expect(read.title).toContain("existing supplier bills");
    expect(read.description).toContain("only the assigned superintendent’s own field submissions");
  });

  it("publishes identical accounting titles, descriptions, schemas and annotations in the manifest", () => {
    const manifest = JSON.parse(readFileSync(".lovable/mcp/manifest.json", "utf8")).mcp.tools;
    for (const name of [
      "accounting_report",
      "job_cost_submissions_read",
      "job_cost_submission_record",
      "job_cost_accounting_record",
    ]) {
      const actual = tools.find((tool) => tool.name === name)!;
      const committed = manifest.find((tool: Tool) => tool.name === name);
      for (const key of ["title", "description", "annotations", "inputSchema"] as const)
        expect(committed[key], `${name}.${key}`).toEqual(actual[key]);
    }
  });
});
