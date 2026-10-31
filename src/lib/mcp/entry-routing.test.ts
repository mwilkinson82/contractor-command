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
  it("publishes project-home routing before greeting rules and keeps explicit items distinct", async () => {
    const initialized = await rpc("initialize", 3, {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "project-board-test", version: "1" },
    });
    expect(initialized.instructions).toContain(
      'call report_page_link with page "home" and the job_number the member supplied',
    );
    for (const phrase of [
      "open the project board",
      "open the job board",
      "give me the job board",
      "show me the job board",
    ]) {
      expect(initialized.instructions).toContain(`"${phrase}"`);
    }
    expect(initialized.instructions).toContain(
      'Use page "items" or list_open_items for explicit open-items requests',
    );
    expect(initialized.instructions).toContain(
      "use field_board or superintendent_view for explicit field board",
    );
    expect(initialized.instructions.indexOf('For "open the project board"')).toBeLessThan(
      initialized.instructions.indexOf("Welcome back. Athena is ready."),
    );
    const discovered = await rpc("tools/list", 4);
    const board = discovered.tools.find(
      (tool: { name: string }) => tool.name === "report_page_link",
    );
    expect(board.description).toContain(
      'project board, job board, project home, or job dashboard with page "home"',
    );
    expect(board.inputSchema.properties.page.default).toBe("home");
    expect(board.inputSchema.required ?? []).not.toContain("page");
    const items = discovered.tools.find(
      (tool: { name: string }) => tool.name === "list_open_items",
    );
    expect(items.description).toContain('use report_page_link with page "home" instead');
    for (const name of ["field_board", "superintendent_view"]) {
      const field = discovered.tools.find((tool: { name: string }) => tool.name === name);
      expect(field.description).toContain('generic "give me the job board"');
      expect(field.description).toContain('use report_page_link with page "home" instead');
    }
  });
  it("publishes native-first attachment routing and bounded expired-byte recovery", async () => {
    const result = await rpc("initialize", 5, {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "attachment-routing-test", version: "1" },
    });
    for (const rule of [
      "prefer the original attached in chat: call file_upload action from_url",
      "Do not request a second picker when a usable original is supplied",
      "preserve its exact company, job and upload_id",
      "Which job should I save this to?",
      "Never infer a destination from the filename",
      "an explicit company is a strict boundary",
      "The two-hour expiry blocks new bytes",
      "Authenticated finish may attach eligible bytes already received before expiry",
      "an expired empty or incomplete upload cannot be completed",
      "finish only after every intended chunk has arrived",
      "only after verified job association",
      "Never store a drawing as a contract or specification",
      "subject to the existing estimating plan and storage checks",
      "except filing attachments",
      "Never force a concept presentation, arbitrary reference file, or drawing",
      "without mislabeling or saving it",
    ])
      expect(result.instructions).toContain(rule);
    expect(result.instructions).not.toContain("Expired uploads require a new upload");
    expect(result.instructions).not.toContain("file, call file_upload action begin");
  });
  it("publishes estimating applicability rather than a universal foundation checklist", async () => {
    const result = await rpc("initialize", 6, {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "foundation-scope-test", version: "1" },
    });
    expect(result.instructions).toContain(
      "Use the agreed estimate in_scope/out_scope, not company trade alone",
    );
    expect(result.instructions).toContain("Missing or conflicting scope needs clarification");
    expect(result.instructions).toContain("Preserve existing gaps for explicit review");
  });
  it("keeps discovery descriptions identical to the committed manifest", async () => {
    const result = await rpc("tools/list", 2);
    const manifest = JSON.parse(readFileSync(".lovable/mcp/manifest.json", "utf8"));
    for (const name of [
      "getting_started",
      "athena_hello",
      "morning_brief",
      "report_page_link",
      "list_open_items",
      "field_board",
      "superintendent_view",
    ]) {
      const live = result.tools.find((tool: { name: string }) => tool.name === name);
      expect(live.annotations.readOnlyHint).toBe(true);
      expect(
        manifest.mcp.tools.find((tool: { name: string }) => tool.name === name).description,
      ).toBe(live.description);
    }
  });
});
