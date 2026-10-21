import { describe, expect, it } from "vitest";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import { defineMcp } from "@lovable.dev/mcp-js";
import * as W from "./tools/workflow-tools";
import { ATHENA_VERSION } from "./server-info-branding";

// Retest 2, fix 2: strict hosts validate against the published schema, so lookahead fields must accept LA- refs (no uuid format or pattern).
describe("published tools/list: lookahead fields take LA- refs or UUIDs", () => {
  it("no uuid format or pattern on any lookahead field", async () => {
    // Same tool definitions the server registers, without the OAuth gate.
    const m = defineMcp({ name: "athena", title: "A", version: "t", instructions: "i", tools: [W.onboarding, W.intake, W.nextQuestion, W.answer, W.report, W.contractTerms, W.carryForward, W.listOpenItems, W.resolveItem], metrics: false } as never);
    const h = createTanStackMcpHandler(m, { resourcePath: "/mcp" });
    const post = (b: unknown) => h({ request: new Request("https://x/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(b) }) });
    await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    const t = await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).text();
    const json = JSON.parse(t.trimStart().startsWith("{") ? t : t.split("\n").find((l) => l.startsWith("data:"))!.slice(5));
    const tools = json.result.tools as { name: string; inputSchema: { properties: Record<string, { format?: string; pattern?: string; description?: string }> } }[];
    const want: Record<string, string[]> = { carry_forward: ["from_lookahead_id", "to_lookahead_id"], next_question: ["lookahead_id"], report: ["lookahead_id"], list_open_items: ["lookahead_id"], answer: ["lookahead_id"] };
    for (const [tool, fields] of Object.entries(want)) {
      const props = tools.find((x) => x.name === tool)!.inputSchema.properties;
      for (const f of fields) {
        const p = props[f];
        expect(p, `${tool}.${f}`).toBeTruthy();
        expect(p.format, `${tool}.${f}`).toBeUndefined();
        expect(p.pattern, `${tool}.${f}`).toBeUndefined();
        expect(p.description, `${tool}.${f}`).toMatch(/LA-/);
        for (const v of ["LA-3F2A1", "40e2def3-eba5-497f-9c7c-6254ed1a2980"]) if (p.pattern) expect(new RegExp(p.pattern).test(v)).toBe(true);
      }
    }
  });
  it("version is past 0.7.0", () => expect(ATHENA_VERSION).toBe("0.8.18"));
});

