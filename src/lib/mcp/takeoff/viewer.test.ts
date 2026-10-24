import { Script } from "node:vm";
import { describe, it, expect } from "vitest";
import {
  takeoffCardHtml,
  TAKEOFF_CARD_URI,
  TAKEOFF_CARD_URIS,
  takeoffResourceMeta,
} from "../cards/takeoff-card";
import { paletteViolations } from "../cards/palette";
import { nativeCardVisit, nativeCardPayload } from "../native-card-transport";
describe("measurement resource and viewer safety", () => {
  function readControls() {
    const script = takeoffCardHtml().match(/<script>([\s\S]*?)<\/script>/)![1];
    const select = script.match(
      /function readPasses\(data, lineNo, calibration\) \{[\s\S]*?\n {2}\}/,
    )![0];
    const fresh = script.match(
      /function freshReadArguments\(data, lineNo, calibration\) \{[\s\S]*?\n {2}\}/,
    )![0];
    return new Script(`${select}\n${fresh}\n({readPasses, freshReadArguments})`).runInNewContext();
  }
  function readState() {
    const summary = {
      line_no: 2,
      takeoff_version: 1,
      source_hash: "hash",
      calibration_id: "cal-1",
      complete: false,
    };
    const pass = (id: string, extra = {}) => ({
      id,
      source_id: "source",
      page: 1,
      pass_summary: { ...summary, ...extra },
    });
    return {
      source: { id: "source", page: 1, sheet: "E-100", content_hash: "hash" },
      engine: {
        takeoff_version: 1,
        lines: [
          { id: "count", line_no: 1, unit: "EA" },
          { id: "run", line_no: 2, unit: "LF" },
        ],
        geometry: [] as { line_id: string; source_id: string; page: number; status: string }[],
        passes: [
          pass("wrong-line", {
            line_no: 1,
            calibration_id: null,
            count_area: {
              name: "Plan",
              bounds: { x: 0, y: 0, width: 1, height: 1 },
              confirmed: true,
            },
          }),
          pass("other-calibration", { calibration_id: "cal-2" }),
          pass("completed", { complete: true }),
          pass("older-unfinished"),
          pass("old-takeoff", { takeoff_version: 0 }),
          pass("changed-source", { source_hash: "old-hash" }),
        ],
      },
    };
  }
  it("selects only the displayed line and calibration and prefers its completed read to older checkpoints", () => {
    const { readPasses } = readControls();
    const state = readState();
    expect(readPasses(state, 2, "cal-1").map((p: { id: string }) => p.id)).toEqual([
      "completed",
      "older-unfinished",
    ]);
    expect(readPasses(state, 2, "cal-2").map((p: { id: string }) => p.id)).toEqual([
      "other-calibration",
    ]);
    expect(readPasses(state, 1).map((p: { id: string }) => p.id)).toEqual(["wrong-line"]);
    expect(readPasses(state, 2)).toEqual([]);
    state.source.page = 2;
    expect(readPasses(state, 2, "cal-1")).toEqual([]);
  });
  it("starts fresh only in the same confirmed scope with no active geometry and never supplies a quantity", () => {
    const { freshReadArguments } = readControls();
    const state = readState();
    expect(freshReadArguments(state, 2, "cal-1")).toEqual({
      operation: "propose",
      source_id: "source",
      sheet: "E-100",
      line_no: 2,
      calibration_id: "cal-1",
    });
    expect(freshReadArguments(state, 1)).toEqual({
      operation: "scope",
      source_id: "source",
      sheet: "E-100",
      line_no: 1,
      confirm: true,
      count_area: { name: "Plan", bounds: { x: 0, y: 0, width: 1, height: 1 } },
    });
    state.engine.geometry.push({
      line_id: "run",
      source_id: "source",
      page: 1,
      status: "proposed",
    });
    expect(() => freshReadArguments(state, 2, "cal-1")).toThrow(/Review or reject/);
    state.engine.geometry[0].status = "rejected";
    expect(freshReadArguments(state, 2, "cal-1")).not.toHaveProperty("pass_id");
    expect(freshReadArguments(state, 2, "cal-1")).not.toHaveProperty("quantity");
    expect(() => freshReadArguments(state, 2, "missing-calibration")).toThrow(/Confirm/);
  });
  it("is executable self-contained MCP Apps HTML with the house palette", () => {
    const html = takeoffCardHtml(),
      script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
    expect(() => new Script(script)).not.toThrow();
    expect(paletteViolations(html, true)).toEqual([]);
    expect(html).not.toMatch(/fetch\(|XMLHttpRequest|innerHTML|eval\(/);
    expect(html).not.toContain("window.confirm");
    expect(takeoffResourceMeta.ui.csp.connectDomains).toEqual([]);
  });
  it("keeps estimator acceptance, revision references, mobile review and factual errors in the actual card", () => {
    const html = takeoffCardHtml();
    for (const text of [
      "expected_version",
      "Reject geometry",
      "Non-drawable reason",
      "source_id",
      "Ask your AI to read selected line",
      "160 pixel crop",
    ])
      expect(html).toContain(text);
    expect(html).toMatch(/confirm:\s*true/);
    expect(html).toMatch(/window.innerWidth\s*<\s*768/);
    expect(html).not.toContain("Card shown");
    expect(html).not.toContain("REQUIRED VIEW");
    expect(takeoffResourceMeta["openai/ui"].availableDisplayModes).toEqual([
      "inline",
      "fullscreen",
    ]);
    expect(html).toContain("ui/request-display-mode");
    expect(html).toContain("ui/notifications/host-context-changed");
  });
  it("keeps a failed tool's facts without dumping its HTML into the live status", () => {
    const script = takeoffCardHtml().match(/<script>([\s\S]*?)<\/script>/)![1];
    const fn = script.match(/function failureText\(result\) \{[\s\S]*?\n {2}\}/)![0];
    const read = new Script(`(${fn})`).runInNewContext();
    const result = read({
      content: [
        {
          type: "text",
          text: "Drawing takeoff\nThe read timed out.\n<!doctype html><html><style>body{}</style>fallback</html>",
        },
        { type: "image", data: "ignored" },
      ],
    });
    expect(result).toBe("Drawing takeoff\nThe read timed out.");
    expect(
      read({ content: [{ type: "text", text: "<!doctype html><html>fallback</html>" }] }),
    ).toBe("The operation was not confirmed. Reload before retrying.");
  });
  it.each([...TAKEOFF_CARD_URIS])(
    "keeps current and cached takeoff resources readable: %s",
    async (uri) => {
      const request = new Request("https://athena.example.com/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "mcp-protocol-version": "2025-06-18",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "resources/read",
          params: { uri },
        }),
      });
      const visit = await nativeCardVisit(request);
      expect(visit).not.toBeNull();
      const reply = nativeCardPayload(
        { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } },
        visit!,
      );
      expect(reply.changed).toBe(true);
      expect(JSON.stringify(reply.value)).toContain("Athena takeoff");
      expect(JSON.stringify(reply.value)).toContain("text/html;profile=mcp-app");
    },
  );
});
