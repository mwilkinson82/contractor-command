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
      "Pause Athena read",
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
