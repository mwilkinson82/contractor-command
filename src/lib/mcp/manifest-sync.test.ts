import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import { defineMcp } from "@lovable.dev/mcp-js";
import * as W from "./tools/workflow-tools";
import * as L from "./tools/living-tools";
import * as F from "./tools/file-tools";
import * as C from "./tools/cadence-tools";
import * as M from "./tools/morning-tools";
import * as R from "./tools/report-page-tools";
import { ATHENA_VERSION } from "./server-info-branding";

type Prop = { format?: string; pattern?: string; description?: string };
type Tool = { name: string; description?: string; inputSchema: { properties: Record<string, Prop> } };

// One source of truth: the committed .lovable/mcp/manifest.json must match what the source publishes.
// Regenerate with: npx lovable-mcp-extract-manifest .
const manifest = JSON.parse(readFileSync(".lovable/mcp/manifest.json", "utf8")) as { mcp: { server: { version: string }; tools: Tool[] } };

async function liveTools(): Promise<Tool[]> {
  const m = defineMcp({ name: "athena", title: "A", version: "t", instructions: "i", tools: [W.onboarding, W.intake, W.nextQuestion, W.answer, W.report, W.contractTerms, W.carryForward, W.listOpenItems, W.resolveItem, C.jobCadence, C.jobCadenceReminders, M.morningBriefing, L.cpmActivities, L.livingReportGet, L.livingReportSave, F.fileShare, F.fileShareRevoke, R.reportPageLink, R.reportPageShare, R.reportPageShareRevoke], metrics: false } as never);
  const h = createTanStackMcpHandler(m, { resourcePath: "/mcp" });
  const post = (b: unknown) => h({ request: new Request("https://x/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(b) }) });
  await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  const t = await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).text();
  const json = JSON.parse(t.trimStart().startsWith("{") ? t : t.split("\n").find((l) => l.startsWith("data:"))!.slice(5));
  return json.result.tools;
}

const isLookahead = (k: string) => /lookahead_id$/.test(k);

describe("MCP manifest is in sync with source", () => {
  it("manifest version matches ATHENA_VERSION", () => expect(manifest.mcp.server.version).toBe(ATHENA_VERSION));

  it("no lookahead field in the manifest carries a uuid format or pattern, and each mentions LA- refs", () => {
    let n = 0;
    for (const t of manifest.mcp.tools)
      for (const [k, p] of Object.entries(t.inputSchema.properties ?? {}))
        if (isLookahead(k)) {
          n++;
          expect(p.format, `${t.name}.${k}`).toBeUndefined();
          expect(p.pattern, `${t.name}.${k}`).toBeUndefined();
          expect(p.description, `${t.name}.${k}`).toMatch(/LA-/);
        }
    expect(n).toBe(6);
  });

  it("manifest tool schemas equal the source tools/list", async () => {
    const live = await liveTools();
    const byName = (ts: Tool[]) => Object.fromEntries(ts.map((t) => [t.name, t.inputSchema]));
    expect(Object.keys(byName(manifest.mcp.tools)).sort()).toEqual(Object.keys(byName(live)).sort());
    const lv = byName(live);
    for (const t of manifest.mcp.tools) expect(t.inputSchema, t.name).toEqual(lv[t.name]);
  });
});
