import { describe, expect, it } from "vitest";
import { defineMcp } from "@lovable.dev/mcp-js";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import * as W from "./tools/workflow-tools";
import mcp from "./index";
import { clauseFlag, effectiveFlag } from "./clauses";
import { makeWho, UNASSIGNED } from "./people";
import { draftHeader, draftIdentityText } from "./drafts";

describe("tools/list (retest 3, item 1)", () => {
  it("lists all 9 tools, contract_terms included, and answer exposes lookahead_help", async () => {
    const m = defineMcp({ name: "athena", title: "A", version: "t", instructions: "i", tools: [W.onboarding, W.intake, W.nextQuestion, W.answer, W.report, W.contractTerms, W.carryForward, W.listOpenItems, W.resolveItem], metrics: false } as never);
    const h = createTanStackMcpHandler(m, { resourcePath: "/mcp" });
    const post = (b: unknown) => h({ request: new Request("https://x/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(b) }) });
    await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    const t = await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).text();
    const json = JSON.parse(t.trimStart().startsWith("{") ? t : t.split("\n").find((l) => l.startsWith("data:"))!.slice(5));
    const tools = json.result.tools as { name: string; inputSchema: { properties: Record<string, unknown> } }[];
    expect(tools.map((x) => x.name).sort()).toEqual(["answer", "carry_forward", "contract_terms", "intake", "list_open_items", "next_question", "onboarding", "report", "resolve_item"]);
    expect(Object.keys(tools.find((x) => x.name === "answer")!.inputSchema.properties)).toContain("lookahead_help");
  });
  it("the real server registers contract_terms and bumped its version", () => {
    const src = JSON.stringify(mcp, (_k, v) => (typeof v === "function" ? undefined : v));
    expect(src).toContain("0.7.9");
    expect(src).toContain("contract_terms");
  });
});

describe("applicability (item 2)", () => {
  it("None / N/A / Not applicable with provenance notes read no", () => {
    expect(clauseFlag("None (user-typed; no contract document provided)")).toBe("no");
    expect(clauseFlag("Not applicable (user-typed; no contract document provided)")).toBe("no");
    expect(clauseFlag("N/A - user typed")).toBe("no");
    expect(clauseFlag("10% (user-typed; no contract document provided)")).toBe("yes");
    expect(clauseFlag("Not specified (user-typed)")).toBeUndefined();
    expect(clauseFlag("$500/day after substantial completion date")).toBe("yes");
  });
  it("a flag left ON over a None clause shows OFF; unknown flags stay unknown", () => {
    expect(effectiveFlag("yes", { value: "None (user-typed)", status: "known" })).toBe("no");
    expect(effectiveFlag("yes", { value: "Not applicable (user-typed)", status: "known" })).toBe("no");
    expect(effectiveFlag("unknown", { value: null, status: "unknown" })).toBe("unknown");
    expect(effectiveFlag("yes", { value: "10%", status: "known" })).toBe("yes");
    expect(effectiveFlag("yes", { value: null, status: "unknown" })).toBe("yes");
  });
});

describe("items follow a non-member PM (item 3)", () => {
  const who = makeWho([], null, "Sam Ortiz");
  it("re-points unassigned and relabels the PM", () => {
    expect(who(UNASSIGNED)).toBe("Sam Ortiz (PM)");
    expect(who("Sam Ortiz (non-member PM)")).toBe("Sam Ortiz (PM)");
    expect(who("sam ortiz")).toBe("Sam Ortiz (PM)");
    expect(who("Casey Lin (GC)")).toBe("Casey Lin (GC)");
  });
  it("stays unassigned with no PM", () => expect(makeWho([], null, null)(UNASSIGNED)).toBe(UNASSIGNED));
});

describe("draft header (item 4)", () => {
  const pm = { name: "Sam Ortiz", email: "sam.ortiz@example.com", title: null, isMember: false };
  it("carries the literal Sign as: and Suggested From: lines", () => {
    expect(draftHeader(pm, { name: "ALP Construction" })).toBe("Suggested From: sam.ortiz@example.com\nSign as: Sam Ortiz, Project Manager, ALP Construction");
    const t = draftIdentityText(pm, { name: "ALP Construction" });
    // Retest 4: visible data lines only; the instruction to put them above drafts is hidden guidance.
    expect(t).not.toContain("word for word");
    expect(t).toContain("- Sign as: Sam Ortiz, Project Manager, ALP Construction");
    expect(t).toContain("- Suggested From: sam.ortiz@example.com");
  });
});
