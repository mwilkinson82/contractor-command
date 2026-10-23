import { describe, expect, it } from "vitest";
import { outsideFencedBlocks, verbatimBlock } from "./verbatim";
import { stripInlineCardHtml } from "../native-card-transport";

describe("literal text inside Athena cards", () => {
  it.each(["\n", "\r\n"])(
    "preserves exact draft data with %j line endings through HTML cleanup",
    (newline) => {
      const body = [
        "  Supplier | reviewer",
        "",
        "",
        "````text",
        "literal | columns",
        "````",
        "<!doctype html><html>quoted email data</html>",
        "REQUIRED VIEW: quoted email data",
        "Card shown. Do not add text.",
        "Keep  spaces.  ",
      ].join(newline);
      const block = verbatimBlock(body);
      expect(block.startsWith("`````text\n")).toBe(true);
      const response =
        "## Athena\n\n" +
        block +
      "\n\nREQUIRED VIEW: render this HTML card as-is.\n<!doctype html><html>\n```text\noutside-card-sentinel\n```\n</html>";
      const cleaned = stripInlineCardHtml(response);
      expect(cleaned).toContain(block);
      expect(cleaned).toContain(body);
      expect(cleaned).not.toContain("outside-card-sentinel");
    },
  );
  it("keeps generic fenced source blocks and cleans only surrounding text", () => {
    const text = "remove\n~~~text\nremove | keep\n~~~\nremove";
    expect(outsideFencedBlocks(text, (part) => part.replace(/remove/g, ""))).toBe(
      "\n~~~text\nremove | keep\n~~~\n",
    );
  });
});
